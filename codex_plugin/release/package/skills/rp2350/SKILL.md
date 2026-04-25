---
name: rp2350
description: Use for ColorEasyPICO2 and RaspberryPiPico2W work through DBT tools, including BOOTSEL, flash, verify, run, serial logs, and RP2350 code generation.
---

# RP2350

## Rules

- For live RP2350 state, use `dbt_current_board_status` by default. Use `dbt_rp2350_detect` only when you specifically need the RP2350 runtime/BOOTSEL detection view.
- If the board is already identified and the task is capability lookup or code generation, use `dbt_get_capability_context` and `dbt_get_board_config` directly instead of re-checking status first.
- Keep the last confirmed RP2350 board and variant sticky within the current conversation. If a previous turn already established `ColorEasyPICO2` or `RaspberryPiPico2W`, keep using that scope until the user says the hardware changed.
- If capability summaries or full capability context were already fetched earlier in the conversation, do not call `dbt_get_capability_context` again to re-prove that the board supports that feature. Reuse the earlier result and only fetch again when the implementation contract is missing.
- If board config was already fetched for the same RP2350 board in the current conversation, reuse it instead of calling `dbt_get_board_config` again.
- For BOOTSEL transitions, use `dbt_rp2350_enter_bootsel`, `dbt_rp2350_flash`, `dbt_rp2350_verify`, and `dbt_rp2350_run`.
- For firmware generation, use `dbt_get_capability_context` and `dbt_get_board_config` first, then `dbt_rp2350_build_flash_source`.
- For log inspection, use `dbt_rp2350_tail_logs`.
- `ColorEasyPICO2` and `RaspberryPiPico2W` share the same SDK base, but differ in board metadata, examples, and capability constraints.
