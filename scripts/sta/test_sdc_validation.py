#!/usr/bin/env python3
"""Security tests for the restricted SDC subset accepted by STA jobs."""

import unittest

from run_job import validate_sdc


class ValidateSdcTests(unittest.TestCase):
    def test_accepts_editor_generated_constraints(self):
        validate_sdc("""create_clock -name core_clk -period 10 [get_ports {CLK}]
set_input_delay -clock core_clk 0.2 [get_ports {A B}]
set_input_transition 0.1 [get_ports {A B}]
set_output_delay -clock core_clk 0.2 [get_ports {Y}]
set_load 5 [get_ports {Y}]
""")

    def test_accepts_virtual_clock(self):
        validate_sdc("create_clock -name core_clk -period 1e-2\n")

    def test_rejects_arbitrary_tcl(self):
        for payload in (
            "exec curl https://attacker.invalid/",
            "create_clock -name core_clk -period 10; exec id",
            "create_clock -name core_clk -period 10 [get_ports {CLK}]\nsource /tmp/payload.tcl",
            "create_clock -name core_clk -period 10 [get_ports {CLK}]\n[exec id]",
        ):
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    validate_sdc(payload)

    def test_rejects_invalid_numbers_and_duplicate_commands(self):
        for payload in (
            "create_clock -name core_clk -period 0",
            "create_clock -name core_clk -period -1",
            "create_clock -name core_clk -period 10\ncreate_clock -name core_clk -period 20",
        ):
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    validate_sdc(payload)


if __name__ == "__main__":
    unittest.main()
