---
name: taishanpi
description: Use for TaishanPi Linux-board work through DBT tools, including 1M-RK3566, 1F-RK3566, and 3M-RK3576 capability constraints, chip-control probes, WiFi/Bluetooth probes, environment checks, and build-run flows.
---

# TaishanPi

## Rules

- When the user explicitly invokes `@dbt-agent`, `[@dbt-agent](plugin://dbt-agent@plugins)`, or the Embed Labs plugin for TaishanPi work, treat the message as a DBT tool intent and prefer MCP tools over shell commands.
- If the user writes a DBT MCP tool name such as `dbt_current_board_status`, including with a leading `$`, backticks, or command-like wording, call the matching MCP tool directly. Never run DBT MCP tool names through zsh.
- If the board is already identified and the task is capability lookup or code generation, use `dbt_get_capability_context` and `dbt_get_board_config` directly instead of re-checking status first.
- For direct live-board status requests such as `开发板状态`, `当前开发板状态`, or `查看当前开发板状态`, call the MCP tool `dbt_current_board_status` immediately as the first action; do not run `dbtctl status`, shell commands, web search, workspace probes, memory-file searches, or repository/skill-file reads before that MCP tool.
- Keep the last confirmed TaishanPi board, variant, and fetched capability context sticky within the current conversation. Reuse them for follow-up turns unless the user says the hardware changed or asks for a fresh live check.
- If capability summaries or capability context were already fetched earlier in the conversation, do not re-call `dbt_get_capability_context` just to confirm support.
- If board config was already fetched for the same board and variant in the current conversation, reuse it instead of calling `dbt_get_board_config` again.
- For broad capability or feature prompts such as `开发板有什么能力`, `当前开发板有什么能力`, `这个开发板支持什么功能`, or `这块板能做什么`, use `dbt_list_capability_summaries` for the confirmed TaishanPi board and variant. Do not use `Search`, `Read`, `rg`, memory files, repository docs, GUI docs, `DBT-Agent-Project.md`, or local handoff files for user-facing answers.
- For user-facing feature or characteristic questions, summarize the board from DBT status/config/capability data. Do not quote local source-checkout docs, GUI docs, or private host paths; omit paths unless the user asks where an installed runtime artifact lives.
- For TaishanPi pin, 40PIN header, pinmux, GPIO, PWM, UART, I2C, or SPI questions, use DBT capability summaries/context first. If DBT tools are unavailable and the request is knowledge-only, use installed published knowledge under `~/Library/development-board-toolchain/agent/{vault,registry}/published`, not the current source checkout.
- Treat `pin_header_40pin` as reference-only: it maps physical pins and default mux, but it is not an execution contract. Do not promise PWM output from the pin table alone; require a published PWM capability or a live check of `/sys/class/pwm` plus the running device-tree/pinmux state.
- Use `dbt_get_board_config` and `dbt_get_capability_context` before generating code.
- Use `dbt_get_board_config` with `probe_env=true` before TaishanPi build or environment work. For generated program build/run, prefer omitting `build_mode` or using `auto`; the runtime must probe the running board rootfs/sysroot ABI and match `docker` or `local-llvm` to that userland ABI before compiling. Do not infer the application compiler from the kernel compiler string alone.
- Pass `build_mode=docker` or `build_mode=local-llvm` only when the user explicitly selected a mode, when installing/checking a specific environment, or when flashing/downloading a specific image family. If the runtime reports a rootfs/sysroot ABI mismatch, stop and tell the user to switch to the matching mode; flash a matching image only when they intend to change the board's running rootfs/userdata ABI.
- Treat `rgb_led` as a capability contract, not as a built-in application feature. For simple atomic LED state changes such as a single solid color or off, `dbt_apply_effect` may be used as a compatibility/direct-control path. For any request with user logic, timing, blinking, breathing, repeat counts, multi-step sequences, or traffic-light behavior, generate self-contained C/C++ source in the current workspace and use `dbt_build_run_program` with `capability=rgb_led`.
- Use `dbt_build_run_program` for code-generation, compile, upload, and run flows; always pass `workspace` as the current user/project directory so generated source and local artifacts are created directly there, not in a fixed temp path or private source checkout.
- Use capability `linux_program` with `dbt_build_run_program` for generic Linux C/C++ diagnostics, finite CPU stress tests, benchmarks, and board-side probes.
- Do not use capability `chip_control` with `dbt_build_run_program`; `chip_control` live CPU, DDR, temperature, memory, and storage checks should use `dbt_probe_chip_control`.
- Use `dbt_probe_chip_control` for CPU, DDR, temperature, memory, and storage.
- Use `dbt_list_board_processes` for Linux-board process and daemon inspection requests.
- Use `dbt_probe_wifi_bluetooth`, `dbt_scan_wifi_networks`, and `dbt_scan_bluetooth_devices` for wireless checks.
- Use `dbt_ensure_usbnet` when USB ECM host configuration is relevant.
- For `进入 Loader`, `进入下载模式`, `loader mode`, or `download mode`, call `dbt_reboot_loader` directly. Do not route this through `dbt_get_capability_context`.
- For normal reboot, or for returning from Loader USB back to the normal runtime state, call `dbt_reboot_device`.
- For full factory/init image flashing, call `dbt_flash_image`. The installed runtime is responsible for moving between USB ECM runtime and Loader USB modes.
