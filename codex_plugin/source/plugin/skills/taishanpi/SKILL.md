---
name: taishanpi
description: Use for TaishanPi Linux-board work through DBT tools, including 1M-RK3566, 1F-RK3566, and 3M-RK3576 capability constraints, chip-control probes, WiFi/Bluetooth probes, environment checks, and build-run flows.
---

# TaishanPi

## Rules

- If the board is already identified and the task is capability lookup or code generation, use `dbt_get_capability_context` and `dbt_get_board_config` directly instead of re-checking status first.
- Keep the last confirmed TaishanPi board, variant, and fetched capability context sticky within the current conversation. Reuse them for follow-up turns unless the user says the hardware changed or asks for a fresh live check.
- If capability summaries or capability context were already fetched earlier in the conversation, do not re-call `dbt_get_capability_context` just to confirm support.
- If board config was already fetched for the same board and variant in the current conversation, reuse it instead of calling `dbt_get_board_config` again.
- For user-facing feature or characteristic questions, summarize the board from DBT status/config/capability data. Do not quote local source-checkout docs or private host paths; omit paths unless the user asks where an installed runtime artifact lives.
- Use `dbt_get_board_config` and `dbt_get_capability_context` before generating code.
- Use `dbt_get_board_config` with `probe_env=true` before TaishanPi build or environment work. If both `docker` and `local-llvm` are available and the user has not selected a mode, ask whether to use Linux GCC / Docker or Mac LLVM before any mutating install, build, generated-image download, or flash action.
- Pass `build_mode=docker` for Linux GCC / Docker builds and `build_mode=local-llvm` for Mac LLVM builds to environment tools, `dbt_build_run_program`, and custom-image flash tools once the mode is known, unless the user explicitly provides `host_image_dir`.
- Use `dbt_build_run_program` for code-generation, compile, upload, and run flows.
- Use capability `linux_program` with `dbt_build_run_program` for generic Linux C/C++ diagnostics, finite CPU stress tests, benchmarks, and board-side probes.
- Do not use capability `chip_control` with `dbt_build_run_program`; `chip_control` live CPU, DDR, temperature, memory, and storage checks should use `dbt_probe_chip_control`.
- Use `dbt_probe_chip_control` for CPU, DDR, temperature, memory, and storage.
- Use `dbt_list_board_processes` for Linux-board process and daemon inspection requests.
- Use `dbt_probe_wifi_bluetooth`, `dbt_scan_wifi_networks`, and `dbt_scan_bluetooth_devices` for wireless checks.
- Use `dbt_ensure_usbnet` when USB ECM host configuration is relevant.
- For `进入 Loader`, `进入下载模式`, `loader mode`, or `download mode`, call `dbt_reboot_loader` directly. Do not route this through `dbt_get_capability_context`.
- For normal reboot, or for returning from Loader USB back to the normal runtime state, call `dbt_reboot_device`.
- For full factory/init image flashing, call `dbt_flash_image`. The installed runtime is responsible for moving between USB ECM runtime and Loader USB modes.
