#!/usr/bin/env python3
"""Run Yosys/ABC synthesis followed by OpenSTA for one submitted design."""

import argparse
import json
import math
import os
import re
import subprocess
import sys
from pathlib import Path

IDENTIFIER = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")

NUMBER = r"(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?"
PORT = r"[A-Za-z_$][A-Za-z0-9_$]*"
PORTS = rf"(?:\{{({PORT}(?: {PORT})*)\}}|({PORT}))"


def validate_sdc(sdc):
    """Accept only the small, data-only SDC subset emitted by the editor.

    OpenSTA reads SDC as Tcl. Never execute arbitrary Tcl supplied by a job.
    """
    if not isinstance(sdc, str) or not sdc.strip() or len(sdc) > 64_000:
        raise ValueError("The request does not contain valid SDC constraints.")

    patterns = [
        ("create_clock", re.compile(
            rf"create_clock -name core_clk -period ({NUMBER})(?: \[get_ports (?:\{{({PORT})\}}|({PORT}))\])?"
        )),
        ("set_input_delay", re.compile(
            rf"set_input_delay -clock core_clk ({NUMBER}) \[get_ports {PORTS}\]"
        )),
        ("set_input_transition", re.compile(
            rf"set_input_transition ({NUMBER}) \[get_ports {PORTS}\]"
        )),
        ("set_output_delay", re.compile(
            rf"set_output_delay -clock core_clk ({NUMBER}) \[get_ports {PORTS}\]"
        )),
        ("set_load", re.compile(
            rf"set_load ({NUMBER}) \[get_ports {PORTS}\]"
        )),
    ]
    seen = set()
    for raw_line in sdc.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        matched = False
        for name, pattern in patterns:
            match = pattern.fullmatch(line)
            if not match:
                continue
            if name in seen:
                raise ValueError(f"Duplicate SDC command: {name}.")
            seen.add(name)
            numeric_values = [
                value for value in match.groups()
                if value is not None and re.fullmatch(NUMBER, value)
            ]
            for value in numeric_values:
                number = float(value)
                if not math.isfinite(number) or number < 0 or (name == "create_clock" and number == 0):
                    raise ValueError(f"Invalid numeric value in SDC command: {name}.")
            matched = True
            break
        if not matched:
            raise ValueError(
                "Unsupported SDC command. Only editor-generated clock, input-delay, "
                "transition, output-delay and load constraints are accepted."
            )
    if "create_clock" not in seen:
        raise ValueError("The SDC must contain exactly one editor-generated create_clock command.")

def run(command, *, cwd, log_path, timeout=300):
    completed = subprocess.run(
        command, cwd=cwd, text=True, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, timeout=timeout, check=False,
    )
    log_path.write_text(completed.stdout, encoding="utf-8")
    if completed.returncode:
        detail = completed.stdout[-12000:] if os.environ.get("STA_DEBUG") == "1" else "Detailed design-specific logs were kept on the temporary runner."
        raise RuntimeError(
            f"Command failed ({completed.returncode}): {' '.join(command)}\n" + detail
        )
    return completed.stdout


def parse_paths(report, path_type):
    starts = list(re.finditer(r"^Startpoint:\s*(.+)$", report, re.MULTILINE))
    paths = []
    for index, match in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(report)
        block = report[match.start():end]
        endpoint = re.search(r"^Endpoint:\s*(.+)$", block, re.MULTILINE)
        slack = re.search(r"(-?\d+(?:\.\d+)?)\s+slack\s+\((VIOLATED|MET)\)", block)
        nets, cells = [], []
        for line in block.splitlines():
            net = re.search(r"\s([A-Za-z_$][A-Za-z0-9_$]*(?:\[[^]]+\])?)\s+\(net\)\s*$", line)
            if net and net.group(1) not in nets:
                nets.append(net.group(1))
            cell = re.search(r"\s((?:[A-Za-z_$][A-Za-z0-9_$]*/)*[A-Za-z_$][A-Za-z0-9_$]*)/([A-Za-z_$][A-Za-z0-9_$]*)\s+\(([^)]+)\)", line)
            if cell:
                top_instance = cell.group(1).split("/")[0]
                if top_instance not in cells:
                    cells.append(top_instance)
        paths.append({
            "type": path_type,
            "startpoint": match.group(1).strip(),
            "endpoint": endpoint.group(1).strip() if endpoint else "",
            "slack": float(slack.group(1)) if slack else None,
            "status": slack.group(2).lower() if slack else "unknown",
            "nets": nets,
            "cells": cells,
            "raw": block.strip(),
        })
    return paths


def metric(report, name):
    match = re.search(rf"^{name}\s+(-?\d+(?:\.\d+)?)\s*$", report, re.MULTILINE)
    return float(match.group(1)) if match else None


def liberty_cell_names(liberty_path):
    """Return declared Liberty cell names, ignoring comments."""
    source = liberty_path.read_text(encoding="utf-8", errors="replace")
    source = re.sub(r"/\*[\s\S]*?\*/|//[^\n]*", "", source)
    names = set()
    pattern = re.compile(r'\bcell\s*\(\s*(?:"([^"]+)"|([^)]*?))\s*\)\s*\{')
    for match in pattern.finditer(source):
        name = (match.group(1) or match.group(2) or "").strip()
        if name:
            names.add(name)
    if not names:
        raise ValueError("No Liberty cell names were found in the timing library.")
    return names


def classify_netlist(design, top, library_cells):
    """Classify a parsed Yosys JSON design without modifying its netlist.

    A library-mapped design has only Liberty cells at its reachable leaves.
    Generic Yosys cells/processes indicate RTL. Unknown leaf types are rejected
    rather than accidentally passed through synthesis as if they were RTL.
    """
    modules = {name.lstrip("\\"): module for name, module in design.get("modules", {}).items()}
    top = top.lstrip("\\")
    if top not in modules:
        raise ValueError(f"Top module {top!r} was not found in the Verilog design.")

    kinds = set()
    unknown = set()
    visited = set()

    def visit(module_name):
        module_name = module_name.lstrip("\\")
        if module_name in library_cells:
            kinds.add("library")
            return
        if module_name in visited:
            return
        module = modules.get(module_name)
        if module is None:
            unknown.add(module_name)
            return
        visited.add(module_name)
        attributes = module.get("attributes", {})
        if attributes.get("blackbox") in ("1", "00000000000000000000000000000001"):
            unknown.add(module_name)
            return
        if module.get("processes"):
            kinds.add("rtl")
        for cell in module.get("cells", {}).values():
            cell_type = str(cell.get("type", "")).lstrip("\\")
            if cell_type in library_cells:
                kinds.add("library")
            elif cell_type in modules:
                visit(cell_type)
            elif cell_type.startswith("$") or cell_type.startswith("$_"):
                kinds.add("rtl")
            else:
                unknown.add(cell_type or "<unnamed cell>")

    visit(top)
    if unknown:
        names = ", ".join(sorted(unknown)[:20])
        suffix = " ..." if len(unknown) > 20 else ""
        raise ValueError(
            "Verilog contains unresolved Cell Name(s) not found in the loaded "
            f"Liberty library or Verilog module definitions: {names}{suffix}. "
            "Load the matching library/model files before running STA."
        )
    if "library" in kinds and "rtl" in kinds:
        raise ValueError(
            "The design mixes library-mapped cells with generic RTL logic. "
            "Separate the mapped netlist from RTL before running STA; automatic "
            "resynthesis could change already-mapped cells."
        )
    if "library" in kinds:
        return "library_mapped"
    return "rtl"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("request", type=Path)
    parser.add_argument("--liberty", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    request = json.loads(args.request.read_text(encoding="utf-8"))
    source, top, sdc = request.get("verilog"), request.get("top"), request.get("sdc")
    if not isinstance(source, str) or not source.strip():
        raise ValueError("The request does not contain Verilog source.")
    if not isinstance(top, str) or not IDENTIFIER.fullmatch(top):
        raise ValueError("The top module name is invalid.")
    validate_sdc(sdc)

    sources = request.get("sources", [])
    if not isinstance(sources, list):
        raise ValueError("Supplementary sources must be an array.")
    analysis = request.get("analysis", "both")
    if analysis not in ("setup", "hold", "both"):
        analysis = "both"
    combined_size = len(source) + sum(
        len(item.get("text", "")) for item in sources if isinstance(item, dict)
    )
    if combined_size > 5_000_000 or len(sdc) > 64_000:
        raise ValueError("The submitted design or SDC exceeds the supported size.")

    design = args.out / "design.v"
    constraints = args.out / "constraints.sdc"
    netlist = args.out / "mapped.v"
    netlist_json = args.out / "mapped.json"
    design.write_text(source, encoding="utf-8")
    constraints.write_text(sdc, encoding="utf-8")

    read_commands = [f'read_liberty -lib "{args.liberty.resolve()}"']
    for index, item in enumerate(sources):
        if not isinstance(item, dict) or not isinstance(item.get("text"), str):
            raise ValueError(f"Supplementary source {index} is malformed.")
        if not item["text"].strip():
            continue
        library_source = args.out / f"library_{index}.v"
        library_source.write_text(item["text"], encoding="utf-8")
        read_commands.append(f'read_verilog -sv "{library_source.resolve()}"')
    read_commands.append(f'read_verilog -sv "{design.resolve()}"')

    # First parse the design and inspect its reachable cell types. This keeps
    # already technology-mapped Verilog intact instead of synthesizing it again.
    preflight_json = args.out / "preflight.json"
    preflight_script = args.out / "preflight.ys"
    preflight_script.write_text("\n".join([
        *read_commands,
        "proc",
        f'write_json "{preflight_json.resolve()}"',
        "",
    ]), encoding="utf-8")
    run(["yosys", "-Q", "-s", str(preflight_script)], cwd=Path.cwd(),
        log_path=args.out / "preflight.log", timeout=300)
    parsed_design = json.loads(preflight_json.read_text(encoding="utf-8"))
    flow_mode = classify_netlist(parsed_design, top, liberty_cell_names(args.liberty))

    if flow_mode == "library_mapped":
        # Flatten only the hierarchy so OpenSTA receives a self-contained
        # structural netlist. No logic synthesis or technology mapping occurs.
        mapped_script = args.out / "mapped.ys"
        mapped_script.write_text("\n".join([
            *read_commands,
            f"hierarchy -check -top {top}",
            "flatten",
            f'write_verilog -noattr "{netlist.resolve()}"',
            f'write_json "{netlist_json.resolve()}"',
            "",
        ]), encoding="utf-8")
        run(["yosys", "-Q", "-s", str(mapped_script)], cwd=Path.cwd(),
            log_path=args.out / "yosys.log", timeout=300)
        with (args.out / "yosys.log").open("a", encoding="utf-8") as log:
            log.write(
                "\nDetected a library-mapped netlist: all reachable leaf Cell "
                "Names exist in the loaded Liberty library. Yosys synth, "
                "dfflibmap and ABC were skipped; only hierarchy flattening "
                "was performed.\n"
            )
    else:
        yosys_script = args.out / "synthesis.ys"
        yosys_script.write_text("\n".join([
            *read_commands,
            f"hierarchy -check -top {top}",
            f"synth -top {top}",
            f'dfflibmap -liberty "{args.liberty.resolve()}"',
            f'abc -liberty "{args.liberty.resolve()}"',
            "clean",
            f'write_verilog -noattr "{netlist.resolve()}"',
            f'write_json "{netlist_json.resolve()}"',
            "",
        ]), encoding="utf-8")
        run(["yosys", "-Q", "-s", str(yosys_script)], cwd=Path.cwd(),
            log_path=args.out / "yosys.log", timeout=600)
        flow_mode = "rtl_synthesized"

    sta_lines = [
        f'read_liberty "{args.liberty.resolve()}"',
        f'read_verilog "{netlist.resolve()}"',
        f"link_design {top}",
        f'read_sdc "{constraints.resolve()}"',
    ]
    if analysis in ("setup", "both"):
        sta_lines += [
            'puts "=== SETUP PATHS ==="',
            "report_checks -path_delay max -group_count 20 -format full_clock_expanded -fields {slew cap input_pin net} -digits 4",
        ]
    if analysis in ("hold", "both"):
        sta_lines += [
            'puts "=== HOLD PATHS ==="',
            "report_checks -path_delay min -group_count 20 -format full_clock_expanded -fields {slew cap input_pin net} -digits 4",
        ]
    sta_lines += [
        'puts "=== WORST NEGATIVE SLACK ==="',
        "report_wns",
        'puts "=== TOTAL NEGATIVE SLACK ==="',
        "report_tns",
        "exit",
        "",
    ]
    sta_script = args.out / "analysis.tcl"
    sta_script.write_text("\n".join(sta_lines), encoding="utf-8")
    sta_report = run(["sta", "-exit", str(sta_script)], cwd=Path.cwd(),
                     log_path=args.out / "opensta.log", timeout=300)
    if "Error:" in sta_report or "Startpoint:" not in sta_report:
        if os.environ.get("STA_DEBUG") == "1":
            netlist_excerpt = "\\n".join(netlist.read_text(encoding="utf-8").splitlines()[30:48])
            detail = sta_report[-12000:] + "\\nMapped netlist excerpt:\\n" + netlist_excerpt
        else:
            detail = "Check the timing constraints and library compatibility; design-specific report text is not written to public logs."
        raise RuntimeError("OpenSTA did not produce valid timing paths.\\n" + detail)

    setup_section = (
        sta_report.split("=== SETUP PATHS ===", 1)[-1].split("=== HOLD PATHS ===", 1)[0]
        if "=== SETUP PATHS ===" in sta_report else ""
    )
    hold_section = (
        sta_report.split("=== HOLD PATHS ===", 1)[-1].split("=== WORST NEGATIVE SLACK ===", 1)[0]
        if "=== HOLD PATHS ===" in sta_report else ""
    )
    setup_paths = parse_paths(setup_section, "setup")
    hold_paths = parse_paths(hold_section, "hold")
    result = {
        "status": "completed",
        "top": top,
        "flow_mode": flow_mode,
        "summary": {
            "flow_mode": flow_mode,
            "setup_wns": metric(sta_report, "wns") if analysis in ("setup", "both") else None,
            "setup_tns": metric(sta_report, "tns") if analysis in ("setup", "both") else None,
            "setup_path_count": len(setup_paths),
            "hold_path_count": len(hold_paths),
            "mapped_netlist_bytes": netlist.stat().st_size,
        },
        "setup_paths": setup_paths,
        "hold_paths": hold_paths,
        "signalMap": request.get("signalMap", {}),
        "instanceMap": request.get("instanceMap", {}),
        "report": sta_report[-100_000:],
    }
    if flow_mode == "rtl_synthesized":
        mapped_source = netlist.read_text(encoding="utf-8")
        if len(mapped_source.encode("utf-8")) <= 600_000:
            result["mapped_verilog"] = mapped_source
        else:
            result["mapped_verilog_unavailable_reason"] = (
                "The synthesized Verilog is larger than the result transfer limit."
            )
    (args.out / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result["summary"], indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"STA job failed: {error}", file=sys.stderr)
        sys.exit(1)
