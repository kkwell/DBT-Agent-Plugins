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

- Start with `dbt_current_board_status` for live board questions. It already includes connected devices and the active device id.
- Only use `dbt_list_connected_devices` when the caller explicitly needs a raw picker-style device list.
- If the board is already known and the user asks about capabilities or coding constraints, go straight to `dbt_get_capability_context` and `dbt_get_board_config`. Do not re-query live board state first.
- For RP2350 code-generation tasks, fetch `dbt_get_capability_context` and `dbt_get_board_config` first, then use `dbt_rp2350_build_flash_source`.
- For TaishanPi code-generation and deployment tasks, fetch capability context and board config first, then use `dbt_build_run_program`.
- For live CPU, DDR, temperature, WiFi, or Bluetooth checks on Linux boards, prefer `dbt_probe_chip_control` or `dbt_probe_wifi_bluetooth` over shell guesses.
- Do not invent Pico SDK include paths, link libraries, or support headers. Use DBT capability context exactly.

## Routing

- RP2350 hardware control: `../rp2350/SKILL.md`
- TaishanPi Linux-board flows: `../taishanpi/SKILL.md`
