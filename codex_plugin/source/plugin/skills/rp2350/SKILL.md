---
name: rp2350
description: Use for ColorEasyPICO2 and RaspberryPiPico2W work through DBT tools, including BOOTSEL, flash, verify, run, serial logs, and RP2350 code generation.
---

# RP2350

## Rules

- When the user explicitly invokes `@dbt-agent`, `[@dbt-agent](plugin://dbt-agent@plugins)`, or the Embed Labs plugin for RP2350 work, treat the message as a DBT tool intent and prefer MCP tools over shell commands.
- If the user writes a DBT MCP tool name such as `dbt_current_board_status`, including with a leading `$`, backticks, or command-like wording, call the matching MCP tool directly. Never run DBT MCP tool names through zsh.
- For live RP2350 state, use the MCP tool `dbt_current_board_status` by default. Use `dbt_rp2350_detect` only when you specifically need the RP2350 runtime/BOOTSEL detection view.
- For direct live-board status requests such as `开发板状态`, `当前开发板状态`, or `查看当前开发板状态`, call `dbt_current_board_status` immediately as the first action; do not run `dbtctl status`, shell commands, web search, workspace probes, memory-file searches, or repository/skill-file reads before that MCP tool.
- If the board is already identified and the task is capability lookup or code generation, use `dbt_get_capability_context` and `dbt_get_board_config` directly instead of re-checking status first.
- Keep the last confirmed RP2350 board and variant sticky within the current conversation. If a previous turn already established `ColorEasyPICO2` or `RaspberryPiPico2W`, keep using that scope until the user says the hardware changed.
- If capability summaries or full capability context were already fetched earlier in the conversation, do not call `dbt_get_capability_context` again to re-prove that the board supports that feature. Reuse the earlier result and only fetch again when the implementation contract is missing.
- If board config was already fetched for the same RP2350 board in the current conversation, reuse it instead of calling `dbt_get_board_config` again.
- For broad capability or feature prompts such as `开发板有什么能力`, `当前开发板有什么能力`, `这个开发板支持什么功能`, or `what can this board do`, use `dbt_list_capability_summaries` for the confirmed RP2350 board and variant. Do not use `Search`, `Read`, `rg`, memory files, repository docs, GUI docs, `DBT-Agent-Project.md`, or local handoff files for user-facing answers.
- For BOOTSEL transitions, use `dbt_rp2350_enter_bootsel`, `dbt_rp2350_flash`, `dbt_rp2350_verify`, and `dbt_rp2350_run`.
- For firmware generation, use `dbt_get_capability_context` and `dbt_get_board_config` first, then `dbt_rp2350_build_flash_source`.
- For log inspection, use `dbt_rp2350_tail_logs`.
- `ColorEasyPICO2` and `RaspberryPiPico2W` share the same SDK base, but differ in board metadata, examples, and capability constraints.
