read_liberty build/sta/sky130_fd_sc_hd__tt_025C_1v80.lib
read_verilog build/sta/netlist.v
link_design sta_smoke
read_sdc scripts/sta/smoke.sdc

puts "=== SETUP PATHS ==="
report_checks -path_delay max -format full_clock_expanded -fields {slew cap input_pin net} -digits 4

puts "=== HOLD PATHS ==="
report_checks -path_delay min -format full_clock_expanded -fields {slew cap input_pin net} -digits 4

puts "=== WORST SETUP SLACK ==="
report_worst_slack -max

puts "=== TOTAL NEGATIVE SLACK ==="
report_tns

exit
