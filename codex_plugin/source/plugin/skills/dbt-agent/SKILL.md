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

- For direct live-board requests such as `当前开发板状态`, `board status`, `what board is connected`, or `which device is active`, call `dbt_current_board_status` immediately as the first action.
- For simple status-only prompts, do not narrate the plan. Use `summary_for_user` as the compact status anchor, then answer naturally from the returned fields according to what the user asked; do not dump every field unless details are requested.
- Do not run shell workspace probes such as `pwd`, `ls`, `find`, or `rg`, and do not read repository files before `dbt_current_board_status` unless the user is explicitly asking about plugin source, installation, or repository maintenance.
- For user-facing questions about the current board's features, characteristics, supported functions, or coding constraints, answer from DBT tool results such as `dbt_current_board_status`, `dbt_get_board_config`, and `dbt_get_capability_context`. Do not cite source-checkout docs, local development handoff files, or private paths outside `~/Library/development-board-toolchain`.
- If a DBT tool result includes host paths that are not necessary to answer the user, omit them. If a path is necessary, mention only installed runtime paths under `~/Library/development-board-toolchain`, not source workspace paths.
- Do not read sibling board-family skills before the first live status call. Route to them only after `dbt_current_board_status` if the follow-up task needs board-specific flows.
- Persist the last confirmed `board_id`, `variant_id`, `device_id`, fetched capability summaries, fetched capability context, and fetched board config within the current conversation. Reuse them for follow-up turns unless the user says the hardware changed or asks to verify live state again.
- If a previous turn already showed that a capability exists for the current board, do not call `dbt_get_capability_context` again just to confirm support. Call it only when you need implementation-contract details that are not already present in the conversation.
- If `dbt_get_board_config` or `dbt_get_capability_context` already ran for the same board, variant, and capability in the current conversation, reuse that result instead of re-fetching it.
- Only use `dbt_list_connected_devices` when the caller explicitly needs a raw picker-style device list.
- If the board is already known and the user asks about capabilities or coding constraints, go straight to `dbt_get_capability_context` and `dbt_get_board_config`. Do not re-query live board state first.
- For RP2350 code-generation tasks, fetch `dbt_get_capability_context` and `dbt_get_board_config` first, then use `dbt_rp2350_build_flash_source`.
- For TaishanPi code-generation and deployment tasks, fetch capability context and board config first, then use `dbt_build_run_program`.
- For TaishanPi build or environment work, call `dbt_get_board_config` with `probe_env=true` and inspect `environment.available_build_modes`. If both `docker` and `local-llvm` are available and the user has not chosen, ask one concise compile-mode question before mutating, downloading, building, or flashing generated images.
- When a TaishanPi compile mode is known, pass `build_mode=docker` for Linux GCC / Docker builds or `build_mode=local-llvm` for Mac LLVM builds to `dbt_get_board_config`, `dbt_check_board_environment`, `dbt_install_board_environment`, `dbt_build_run_program`, and custom-image flash tools unless the user explicitly provides `host_image_dir`.
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
