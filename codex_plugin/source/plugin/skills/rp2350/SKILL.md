---
name: rp2350
description: Use for ColorEasyPICO2 and RaspberryPiPico2W work through DBT tools, including BOOTSEL, flash, verify, run, serial logs, and RP2350 code generation.
---

# RP2350

## Rules

- For live RP2350 state, use `dbt_current_board_status` by default. Use `dbt_rp2350_detect` only when you specifically need the RP2350 runtime/BOOTSEL detection view.
- If the board is already identified and the task is capability lookup or code generation, use `dbt_get_capability_context` and `dbt_get_board_config` directly instead of re-checking status first.
- For BOOTSEL transitions, use `dbt_rp2350_enter_bootsel`, `dbt_rp2350_flash`, `dbt_rp2350_verify`, and `dbt_rp2350_run`.
- For firmware generation, use `dbt_get_capability_context` and `dbt_get_board_config` first, then `dbt_rp2350_build_flash_source`.
- For log inspection, use `dbt_rp2350_tail_logs`.
- `ColorEasyPICO2` and `RaspberryPiPico2W` share the same SDK base, but differ in board metadata, examples, and capability constraints.
