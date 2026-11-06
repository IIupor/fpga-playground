import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("run_job.py")
SPEC = importlib.util.spec_from_file_location("sta_run_job", SCRIPT)
RUN_JOB = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUN_JOB)


class NetlistClassificationTests(unittest.TestCase):
    def test_hierarchical_netlist_with_only_library_cells_is_mapped(self):
        design = {
            "modules": {
                "top": {"cells": {"u0": {"type": "wrapper"}}},
                "wrapper": {"cells": {"u1": {"type": "sky130__and2_1"}}},
            }
        }
        self.assertEqual(
            RUN_JOB.classify_netlist(design, "top", {"sky130__and2_1"}),
            "library_mapped",
        )

    def test_generic_yosys_cells_are_rtl(self):
        design = {
            "modules": {
                "top": {"cells": {"u0": {"type": "$_AND_"}}},
            }
        }
        self.assertEqual(RUN_JOB.classify_netlist(design, "top", set()), "rtl")

    def test_unknown_leaf_cell_is_not_misclassified_as_rtl(self):
        design = {
            "modules": {
                "top": {"cells": {"U96": {"type": "missing_cell"}}},
            }
        }
        with self.assertRaisesRegex(ValueError, "missing_cell"):
            RUN_JOB.classify_netlist(design, "top", {"known_cell"})

    def test_mixed_library_and_generic_cells_are_rejected(self):
        design = {
            "modules": {
                "top": {
                    "cells": {
                        "u0": {"type": "known_cell"},
                        "u1": {"type": "$_AND_"},
                    }
                }
            }
        }
        with self.assertRaisesRegex(ValueError, "mixes library-mapped cells"):
            RUN_JOB.classify_netlist(design, "top", {"known_cell"})

    def test_verilog_processes_are_rtl(self):
        design = {
            "modules": {
                "top": {"processes": {"proc": {}}, "cells": {}},
            }
        }
        self.assertEqual(RUN_JOB.classify_netlist(design, "top", {"known_cell"}), "rtl")

    def test_liberty_cell_names_ignore_comments_and_support_quotes(self):
        with tempfile.TemporaryDirectory() as directory:
            liberty = Path(directory) / "cells.lib"
            liberty.write_text(
                '/* cell (fake_comment) { } */\n'
                'cell (unquoted_cell) { pin (A) { direction : input; } }\n'
                'cell ("quoted_cell") { pin (Y) { direction : output; } }\n',
                encoding="utf-8",
            )
            self.assertEqual(
                RUN_JOB.liberty_cell_names(liberty),
                {"unquoted_cell", "quoted_cell"},
            )


if __name__ == "__main__":
    unittest.main()
