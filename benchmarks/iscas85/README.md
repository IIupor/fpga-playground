# ISCAS'85 benchmark circuits

Structural Verilog files for the classic ISCAS'85 combinational logic benchmarks.

## Included circuits

| Circuit | Primary inputs | Primary outputs | Gate instances | Maximum gate fan-in |
|---|---:|---:|---:|---:|
| c17 | 5 | 2 | 6 | 2 |
| c432 | 36 | 7 | 171 | 4 |
| c499 | 41 | 32 | 174 | 4 |
| c880 | 60 | 26 | 323 | 4 |
| c1355 | 41 | 32 | 518 | 4 |
| c1908 | 33 | 25 | 479 | 8 |
| c2670 | 233 | 140 | 699 | 4 |
| c3540 | 50 | 22 | 1043 | 4 |
| c5315 | 178 | 123 | 1586 | 4 |
| c6288 | 32 | 32 | 2353 | 2 |
| c7552 | 207 | 108 | 2331 | 4 |

Counts are reference metadata for classic benchmark circuits and may vary between source/netlist variants. The files were collected from jpsety/verilog_benchmark_circuits, which describes its collection as a mix of ISCAS'85 and EPFL benchmarks, formatted as generic gate-level Verilog synthesized with Cadence Genus. Original comments and netlist contents are retained.

## Importing into FPGA Playground

Use Import Verilog and select a .v file. The editor importer currently supports only a subset of structural Verilog; large circuits may need importer and layout improvements. c1908 includes gates with up to eight inputs.

## Source

- Collection: https://github.com/jpsety/verilog_benchmark_circuits
- ISCAS benchmark suite context: https://pld.ttu.ee/~maksim/benchmarks/iscas85/
