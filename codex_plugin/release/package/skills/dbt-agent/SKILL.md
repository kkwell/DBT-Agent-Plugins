---
name: dbt-agent
description: Use for Development Board Toolchain work in Codex, including TaishanPi and RP2350-family boards. Prefer these local DBT tools for board status, capability constraints, environment checks, flashing, runtime control, and board-scoped code execution.
---

# DBT-Agent

## Overview

This skill is the umbrella entrypoint for local development-board work through the `dbt-agent` Codex plugin.

Supported families:

- `TaishanPi`
- `ColorEasyPICO2`
- `RaspberryPiPico2W`

## Rules

- For direct live-board requests such as `当前开发板状态`, `board status`, `what board is connected`, or `which device is active`, call the MCP tool `dbt_current_board_status` immediately as the first action.
- Do not run `dbtctl status`, shell commands, web search, workspace probes, or repository/skill-file reads before `dbt_current_board_status` when that MCP tool is available.
- For simple status-only prompts, do not narrate the plan. Use `summary_for_user` as the compact status anchor, then answer naturally from the returned fields according to what the user asked; do not dump every field unless details are requested.
- Do not run shell workspace probes such as `pwd`, `ls`, `find`, or `rg`, and do not read repository files before `dbt_current_board_status` unless the user is explicitly asking about plugin source, installation, or repository maintenance.
- For broad capability or feature prompts such as `开发板有什么能力`, `当前开发板有什么能力`, `这个开发板支持什么功能`, `这块板能做什么`, or `what can this board do`, do not use `Search`, `Read`, `rg`, `find`, `ls`, repository docs, GUI docs, `DBT-Agent-Project.md`, or local handoff files. If the current board or variant is unknown, first call `dbt_current_board_status`; then call `dbt_list_capability_summaries` for that board and variant and answer from the returned capability summaries.
- For user-facing questions about the current board's features, characteristics, supported functions, or coding constraints, answer from DBT tool results such as `dbt_current_board_status`, `dbt_list_capability_summaries`, `dbt_get_board_config`, and `dbt_get_capability_context`. Do not cite source-checkout docs, local development handoff files, GUI docs, or private paths outside `~/Library/development-board-toolchain`.
- For user-facing pin, 40PIN header, pinmux, GPIO, PWM, UART, I2C, or SPI questions, use DBT capability summaries/context first. If DBT tools are temporarily unavailable and the answer is knowledge-only, read only installed published knowledge under `~/Library/development-board-toolchain/agent/{vault,registry}/published`; never read or cite `DBT-Agent-Project`, source checkout docs, GUI docs, or absolute maintainer paths.
- When citing board knowledge, prefer capability names and relative installed knowledge references such as `vault/published/boards/<board>/<variant>/pin_header_40pin/usage.md`. Do not include absolute `/Users/.../DBT-Agent-Project/...` paths in the final answer.
- Treat `pin_header_40pin` as a reference-only capability. It can answer physical pin mapping and default mux, but it does not prove that a Linux runtime node is currently enabled. For PWM, do not claim executable PWM output support from the 40PIN table alone; require a published PWM capability or a live runtime probe of `/sys/class/pwm` and the device-tree/pinmux state.
- If a DBT tool result includes host paths that are not necessary to answer the user, omit them. If a path is necessary, mention only installed runtime paths under `~/Library/development-board-toolchain`, not source workspace paths.
- Do not read sibling board-family skills before the first live status call. Route to them only after `dbt_current_board_status` if the follow-up task needs board-specific flows.
- Persist the last confirmed `board_id`, `variant_id`, `device_id`, fetched capability summaries, fetched capability context, and fetched board config within the current conversation. Reuse them for follow-up turns unless the user says the hardware changed or asks to verify live state again.
- If a previous turn already showed that a capability exists for the current board, do not call `dbt_get_capability_context` again just to confirm support. Call it only when you need implementation-contract details that are not already present in the conversation.
- If `dbt_get_board_config` or `dbt_get_capability_context` already ran for the same board, variant, and capability in the current conversation, reuse that result instead of re-fetching it.
- Only use `dbt_list_connected_devices` when the caller explicitly needs a raw picker-style device list.
- If the board is already known and the user asks a broad capability question, call `dbt_list_capability_summaries` directly. If the user asks about a specific capability or code-generation constraint, use `dbt_get_capability_context` and `dbt_get_board_config`. Do not re-query live board state first unless the user asks for fresh live status.
- For RP2350 code-generation tasks, fetch `dbt_get_capability_context` and `dbt_get_board_config` first, then use `dbt_rp2350_build_flash_source`.
- For TaishanPi `rgb_led` natural-language effects, including single color, off, heartbeat, timer blink, breath, repeat counts, and multi-color sequences such as red/yellow/green traffic-light cycling, call `dbt_apply_effect` directly. Do not generate C and do not call `dbt_build_run_program` for LED effects; the runtime owns the direct-sysfs versus generated-C decision.
- For TaishanPi code-generation and deployment tasks that really need generated C/C++ source, fetch capability context and board config first, then use `dbt_build_run_program`; always pass `workspace` as the current user/project directory so the plugin/runtime materializes source and local artifacts directly there, not in a fixed temp path or private source checkout.
- For TaishanPi build or environment work, call `dbt_get_board_config` with `probe_env=true` and inspect `environment.available_build_modes`. For generated program build/run, prefer omitting `build_mode` or using `auto`; the runtime must probe the running board rootfs/sysroot ABI and match `docker` or `local-llvm` to that userland ABI before compiling. Do not infer the application compiler from the kernel compiler string alone.
- Only pass `build_mode=docker` or `build_mode=local-llvm` when the user explicitly chose a mode, when installing/checking a specific environment, or when flashing/downloading a specific image family. If the runtime reports that the requested mode conflicts with the running board rootfs/sysroot ABI, stop and tell the user to switch modes or reflash the matching image.
- For generic TaishanPi Linux C/C++ diagnostics, finite CPU stress tests, benchmarks, or board-side probes that are not owned by a narrower capability, use capability `linux_program` with `dbt_build_run_program`.
- Do not use capability `chip_control` with `dbt_build_run_program`; use `dbt_probe_chip_control` for live CPU, DDR, temperature, memory, and storage readings. If a workload is needed, run a finite `linux_program` first, then probe.
- For live CPU, DDR, temperature, WiFi, or Bluetooth checks on Linux boards, prefer `dbt_probe_chip_control` or `dbt_probe_wifi_bluetooth` over shell guesses.
- For Linux-board process-list requests such as `当前开发板有哪些进程`, call `dbt_list_board_processes` directly instead of using host shell, SSH narration, or capability lookups.
- For TaishanPi or other Linux-board requests to enter Loader/download mode, call `dbt_reboot_loader` directly. Do not call capability summary/context tools to discover this path.
- For normal board reboot requests, including returning a Linux board from Loader USB to the normal runtime state, call `dbt_reboot_device` directly.
- For full TaishanPi image flashing, call `dbt_flash_image` and let `dbt-agentd`/the installed runtime handle running-vs-Loader state transitions.
- Do not invent Pico SDK include paths, link libraries, or support headers. Use DBT capability context exactly.

## Routing

- RP2350 hardware control: `../rp2350/SKILL.md`
- TaishanPi Linux-board flows: `../taishanpi/SKILL.md`
