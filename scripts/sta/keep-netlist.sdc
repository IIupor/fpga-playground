create_clock -name core_clk -period 10.0
set_input_delay -clock core_clk 0.2 [get_ports {A B}]
set_output_delay -clock core_clk 0.2 [get_ports Y]
set_input_transition 0.1 [get_ports {A B}]
set_load 1.0 [get_ports Y]
