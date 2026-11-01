# SKY130 gate-level benchmark sources

Pinned third-party Verilog designs used to regression-test hierarchical
Verilog import and standard-cell resolution against the SKY130 Liberty library.

## Gate-level Verilog
- Repository: https://github.com/wilson/risc-v-soc-full-synth
- Commit: `6ed4604cff77c9cc975d64fa50bc67b00de2d4eb`
- Path: `src/` (all 35 `.v` files)
- License: MIT; see `LICENSES/MIT-LICENSE`.
- Files are copied without modification.

The designs are benchmark inputs, not standard-cell library models. Their
mapped cell instances are resolved using `libraries/sky130/liberty/`.
