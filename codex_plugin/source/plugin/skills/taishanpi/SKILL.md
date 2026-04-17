---
name: taishanpi
description: Use for TaishanPi 1M-RK3566 Linux-board work through DBT tools, including capability constraints, chip-control probes, WiFi/Bluetooth probes, environment checks, and build-run flows.
---

# TaishanPi

## Rules

- If the board is already identified and the task is capability lookup or code generation, use `dbt_get_capability_context` and `dbt_get_board_config` directly instead of re-checking status first.
- Use `dbt_get_board_config` and `dbt_get_capability_context` before generating code.
- Use `dbt_build_run_program` for code-generation, compile, upload, and run flows.
- Use `dbt_probe_chip_control` for CPU, DDR, temperature, memory, and storage.
- Use `dbt_probe_wifi_bluetooth`, `dbt_scan_wifi_networks`, and `dbt_scan_bluetooth_devices` for wireless checks.
- Use `dbt_ensure_usbnet` when USB ECM host configuration is relevant.
