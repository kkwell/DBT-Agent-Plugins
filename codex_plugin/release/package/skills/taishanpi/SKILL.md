---
name: taishanpi
description: Use for TaishanPi Linux-board work through DBT tools, including 1M-RK3566, 1F-RK3566, and 3M-RK3576 capability constraints, chip-control probes, WiFi/Bluetooth probes, environment checks, and build-run flows.
---

# TaishanPi

## Rules

- If the board is already identified and the task is capability lookup or code generation, use `dbt_get_capability_context` and `dbt_get_board_config` directly instead of re-checking status first.
- For direct live-board status requests such as `当前开发板状态`, call the MCP tool `dbt_current_board_status` immediately as the first action; do not run `dbtctl status`, shell commands, web search, workspace probes, or repository/skill-file reads before that MCP tool.
- Keep the last confirmed TaishanPi board, variant, and fetched capability context sticky within the current conversation. Reuse them for follow-up turns unless the user says the hardware changed or asks for a fresh live check.
- If capability summaries or capability context were already fetched earlier in the conversation, do not re-call `dbt_get_capability_context` just to confirm support.
- If board config was already fetched for the same board and variant in the current conversation, reuse it instead of calling `dbt_get_board_config` again.
- For broad capability or feature prompts such as `开发板有什么能力`, `当前开发板有什么能力`, `这个开发板支持什么功能`, or `这块板能做什么`, use `dbt_list_capability_summaries` for the confirmed TaishanPi board and variant. Do not use `Search`, `Read`, `rg`, repository docs, GUI docs, `DBT-Agent-Project.md`, or local handoff files for user-facing answers.
- For user-facing feature or characteristic questions, summarize the board from DBT status/config/capability data. Do not quote local source-checkout docs, GUI docs, or private host paths; omit paths unless the user asks where an installed runtime artifact lives.
- For TaishanPi pin, 40PIN header, pinmux, GPIO, PWM, UART, I2C, or SPI questions, use DBT capability summaries/context first. If DBT tools are unavailable and the request is knowledge-only, use installed published knowledge under `~/Library/development-board-toolchain/agent/{vault,registry}/published`, not the current source checkout.
- Treat `pin_header_40pin` as reference-only: it maps physical pins and default mux, but it is not an execution contract. Do not promise PWM output from the pin table alone; require a published PWM capability or a live check of `/sys/class/pwm` plus the running device-tree/pinmux state.
- Use `dbt_get_board_config` and `dbt_get_capability_context` before generating code.
- Use `dbt_get_board_config` with `probe_env=true` before TaishanPi build or environment work. For generated program build/run, prefer omitting `build_mode` or using `auto`; the runtime must probe the running board rootfs/sysroot ABI and match `docker` or `local-llvm` to that userland ABI before compiling. Do not infer the application compiler from the kernel compiler string alone.
- Pass `build_mode=docker` or `build_mode=local-llvm` only when the user explicitly selected a mode, when installing/checking a specific environment, or when flashing/downloading a specific image family. If the runtime reports a rootfs/sysroot ABI mismatch, stop and tell the user to switch modes or reflash the matching image.
- For `rgb_led` natural-language effects, including single color, off, heartbeat, timer blink, breath, repeat counts, and multi-color sequences such as red/yellow/green traffic-light cycling, call `dbt_apply_effect` directly. Do not generate C and do not call `dbt_build_run_program` for LED effects; the runtime owns the direct-sysfs versus generated-C decision.
- Use `dbt_build_run_program` for code-generation, compile, upload, and run flows that really need generated C/C++ source; always pass `workspace` as the current user/project directory so generated source and local artifacts are created directly there, not in a fixed temp path or private source checkout.
- Use capability `linux_program` with `dbt_build_run_program` for generic Linux C/C++ diagnostics, finite CPU stress tests, benchmarks, and board-side probes.
- Do not use capability `chip_control` with `dbt_build_run_program`; `chip_control` live CPU, DDR, temperature, memory, and storage checks should use `dbt_probe_chip_control`.
- Use `dbt_probe_chip_control` for CPU, DDR, temperature, memory, and storage.
- Use `dbt_list_board_processes` for Linux-board process and daemon inspection requests.
- Use `dbt_probe_wifi_bluetooth`, `dbt_scan_wifi_networks`, and `dbt_scan_bluetooth_devices` for wireless checks.
- Use `dbt_ensure_usbnet` when USB ECM host configuration is relevant.
- For `进入 Loader`, `进入下载模式`, `loader mode`, or `download mode`, call `dbt_reboot_loader` directly. Do not route this through `dbt_get_capability_context`.
- For normal reboot, or for returning from Loader USB back to the normal runtime state, call `dbt_reboot_device`.
- For full factory/init image flashing, call `dbt_flash_image`. The installed runtime is responsible for moving between USB ECM runtime and Loader USB modes.
