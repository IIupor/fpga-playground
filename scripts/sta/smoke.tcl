read_liberty build/sta/sky130_fd_sc_hd__tt_025C_1v80.lib
read_verilog build/sta/netlist.v
link_design s27
read_sdc scripts/sta/smoke.sdc

puts "=== SETUP PATHS ==="
report_checks -path_delay max -group_path_count 20 -format full_clock_expanded -fields {slew cap input_pin net} -digits 4

puts "=== HOLD PATHS ==="
report_checks -path_delay min -group_path_count 20 -format full_clock_expanded -fields {slew cap input_pin net} -digits 4

puts "=== WORST NEGATIVE SLACK ==="
report_wns

puts "=== TOTAL NEGATIVE SLACK ==="
report_tns

exit
