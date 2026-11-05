#!/usr/bin/env python3
"""Run Yosys/ABC synthesis followed by OpenSTA for one submitted design."""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

IDENTIFIER = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")


def run(command, *, cwd, log_path, timeout=300):
    completed = subprocess.run(
        command, cwd=cwd, text=True, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, timeout=timeout, check=False,
    )
    log_path.write_text(completed.stdout, encoding="utf-8")
    if completed.returncode:
        raise RuntimeError(
            f"Command failed ({completed.returncode}): {' '.join(command)}\n"
            + completed.stdout[-12000:]
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
            cell = re.search(r"\s([A-Za-z_$][A-Za-z0-9_$]*)/([A-Za-z_$][A-Za-z0-9_$]*)\s+\(([^)]+)\)", line)
            if cell and cell.group(1) not in cells:
                cells.append(cell.group(1))
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
    if not isinstance(sdc, str) or not sdc.strip():
        raise ValueError("The request does not contain SDC constraints.")

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

    sta_lines = [
        f'read_liberty "{args.liberty.resolve()}"',
        f'read_verilog "{netlist.resolve()}"',
        f"link_design {top}",
        f'read_sdc "{constraints.resolve()}"',
    ]
    if analysis in ("setup", "both"):
        sta_lines += [
            'puts "=== SETUP PATHS ==="',
            "report_checks -path_delay max -format full_clock_expanded -fields {slew cap input_pin net} -digits 4",
        ]
    if analysis in ("hold", "both"):
        sta_lines += [
            'puts "=== HOLD PATHS ==="',
            "report_checks -path_delay min -format full_clock_expanded -fields {slew cap input_pin net} -digits 4",
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
        raise RuntimeError("OpenSTA did not produce valid timing paths. See opensta.log.")

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
        "summary": {
            "setup_wns": metric(sta_report, "wns") if analysis in ("setup", "both") else None,
            "setup_tns": metric(sta_report, "tns") if analysis in ("setup", "both") else None,
            "setup_path_count": len(setup_paths),
            "hold_path_count": len(hold_paths),
            "mapped_netlist_bytes": netlist.stat().st_size,
        },
        "setup_paths": setup_paths,
        "hold_paths": hold_paths,
        "signalMap": request.get("signalMap", {}),
        "report": sta_report[-100_000:],
    }
    (args.out / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result["summary"], indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"STA job failed: {error}", file=sys.stderr)
        sys.exit(1)
