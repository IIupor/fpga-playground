# ISCAS'89 sequential benchmarks

This directory contains 28 normalized ISCAS'89 sequential benchmark circuits, sourced from the public TalTech mirror and the normalized RTL redistribution maintained by zeroasiccorp/logikbench.

Circuits: s27, s298, s344, s349, s382, s386, s400, s420, s444, s510, s526, s641, s713, s820, s832, s838, s953, s1196, s1238, s1423, s1488, s5378, s9234, s13207, s15850, s35932, s38417, s38584.

The top-level circuit module is placed first so the FPGA Playground structural Verilog importer can parse it. The behavioral DFF model is retained after the top-level module and initializes Q to zero, matching the editor's documented initial state. DFF instances use the original positional port order (CK, Q, D); the importer maps these to data and clock pins internally.

The s1196 source uses the corrected synchronous clock connection from the normalized redistribution. Logic functions and netlist connectivity are otherwise preserved.

Sources:
- Original benchmark mirror: https://pld.ttu.ee/~maksim/benchmarks/iscas89/verilog/
- Normalized RTL source and provenance notes: https://github.com/zeroasiccorp/logikbench/tree/main/logikbench/benchmarks/iscas89
- Original publication: F. Brglez, D. Bryan, K. Kozminski, "Combinational Profiles of Sequential Benchmark Circuits," ISCAS 1989, pp. 1929–1934, DOI: 10.1109/ISCAS.1989.100747.

The upstream ISCAS'89 netlists are distributed as benchmark data without a formal modern open-source license. This directory records source provenance and only applies the documented structural normalization required by the importer and sequential testbench.
