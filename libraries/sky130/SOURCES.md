# SKY130 library sources

Pinned third-party source files used by the FPGA Playground hierarchical
Verilog and Liberty import regression.

## Gate-level Verilog
- Repository: https://github.com/wilson/risc-v-soc-full-synth
- Commit: `6ed4604cff77c9cc975d64fa50bc67b00de2d4eb`
- Path: `src/` (all 35 `.v` files)
- License: MIT; see `LICENSES/MIT-LICENSE`.
- Files are copied without modification.

## SKY130 standard-cell Liberty
- Repository: https://github.com/siliconcompiler/lambdapdk
- Commit: `e8d9fbe31e7ab1c0f82db86c9ae3539b8b622727`
- Path: `lambdapdk/sky130/libs/sky130hd/nldm/sky130_fd_sc_hd__tt_025C_1v80.lib.gz`
- License: Apache-2.0; see `LICENSES/Apache-2.0`.
- The compressed file is preserved byte-for-byte. This upstream version
  includes the repository's documented `dont_use` additions.
- Git blob SHA-1: `e032d41deb2875be28cfa184b279c64bff6ccd57`.
