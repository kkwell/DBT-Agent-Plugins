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

- When the user explicitly invokes `@dbt-agent`, `[@dbt-agent](plugin://dbt-agent@plugins)`, or the Embed Labs plugin, treat the message as a DBT tool intent and prefer MCP tools over shell commands.
- If the user writes a DBT MCP tool name such as `dbt_current_board_status`, including with a leading `$`, backticks, or command-like wording, call the matching MCP tool directly. Never run DBT MCP tool names through zsh, and never report `command not found` as a board result when the MCP server is available.
- For direct live-board requests such as `开发板状态`, `当前开发板状态`, `查看当前开发板状态`, `board status`, `what board is connected`, or `which device is active`, call the MCP tool `dbt_current_board_status` immediately as the first action.
- Do not run `dbtctl status`, shell commands, web search, workspace probes, memory-file searches, or repository/skill-file reads before `dbt_current_board_status` when that MCP tool is available.
- For simple status-only prompts, do not narrate the plan. Use `summary_for_user` as the compact status anchor, then answer naturally from the returned fields according to what the user asked; do not dump every field unless details are requested.
- Do not run shell workspace probes such as `pwd`, `ls`, `find`, or `rg`, and do not read repository files before `dbt_current_board_status` unless the user is explicitly asking about plugin source, installation, or repository maintenance.
- For broad capability or feature prompts such as `开发板有什么能力`, `当前开发板有什么能力`, `这个开发板支持什么功能`, `这块板能做什么`, or `what can this board do`, do not use `Search`, `Read`, `rg`, `find`, `ls`, memory files, repository docs, GUI docs, `DBT-Agent-Project.md`, or local handoff files. If the current board or variant is unknown, first call `dbt_current_board_status`; then call `dbt_list_capability_summaries` for that board and variant and answer from the returned capability summaries.
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
- Treat TaishanPi `rgb_led` as a capability contract, not as a built-in application feature. For simple atomic LED state changes such as a single solid color or off, `dbt_apply_effect` may be used as a compatibility/direct-control path. For any request with user logic, timing, blinking, breathing, repeat counts, multi-step sequences, or traffic-light behavior, fetch capability context and board config, generate self-contained C/C++ source in the current workspace, and call `dbt_build_run_program` with `capability=rgb_led`.
- For TaishanPi code-generation and deployment tasks, fetch capability context and board config first, then use `dbt_build_run_program`; always pass `workspace` as the current user/project directory so the plugin/runtime materializes source and local artifacts directly there, not in a fixed temp path or private source checkout.
- For TaishanPi build or environment work, call `dbt_get_board_config` with `probe_env=true` and inspect `environment.available_build_modes`. For generated program build/run, prefer omitting `build_mode` or using `auto`; the runtime must probe the running board rootfs/sysroot ABI and match `docker` or `local-llvm` to that userland ABI before compiling. Do not infer the application compiler from the kernel compiler string alone.
- Only pass `build_mode=docker` or `build_mode=local-llvm` when the user explicitly chose a mode, when installing/checking a specific environment, or when flashing/downloading a specific image family. If the runtime reports that the requested mode conflicts with the running board rootfs/sysroot ABI, stop and tell the user to switch to the matching mode; flash a matching image only when they intend to change the board's running rootfs/userdata ABI.
- For TaishanPi Qt or QtQuick app requests, do not use `dbt_build_run_program`, do not search for `qmlscene`, and do not manually guess qmake/CMake/linker paths. Call `dbt_get_board_config` with `probe_env=true`; create the Qt project files in the current user workspace; then call `dbt_qt_build_run_app` with `project_dir` and `workspace`.
- Qt runtime images are intentionally clean and may not include `qmlscene`. A visible QtQuick application should be a compiled executable (usually CMake + `qt_add_qml_module`) deployed under `/userdata/qt-project/<ProjectName>` by `dbt_qt_build_run_app`.
- For board-app autostart requests, call `dbt_configure_autostart` after the app has been deployed. Use `app_type=qt` with `remote_runner_path` returned by `dbt_qt_build_run_app`, and use `app_type=native` with `remote_binary_path`/`remote_artifact_path` returned by `dbt_build_run_program`. Do not inspect init systems, do not create per-app systemd units, and do not write custom `/etc/init.d` app scripts; the runtime owns the fixed `/userdata/.dbt-autostart` broker and single boot hook.
- If the user asks for display rotation in a Qt/QtQuick UI, implement it in the generated QML/C++ project or pass an explicit `qpa_platform` such as `linuxfb:fb=/dev/fb0:rotation=90` when appropriate; do not edit the system image just to rotate one app.
- For generic TaishanPi Linux C/C++ diagnostics, finite CPU stress tests, benchmarks, or board-side probes that are not owned by a narrower capability, use capability `linux_program` with `dbt_build_run_program`.
- Do not use capability `chip_control` with `dbt_build_run_program`; use `dbt_probe_chip_control` for live CPU, DDR, temperature, memory, and storage readings. If a workload is needed, run a finite `linux_program` first, then probe.
- For live CPU, DDR, temperature, WiFi, or Bluetooth checks on Linux boards, prefer `dbt_probe_chip_control` or `dbt_probe_wifi_bluetooth` over shell guesses.
- For Linux-board process-list requests such as `当前开发板有哪些进程`, call `dbt_list_board_processes` directly instead of using host shell, SSH narration, or capability lookups.
- For TaishanPi or other Linux-board requests to enter Loader/download mode, call `dbt_reboot_loader` directly. Do not call capability summary/context tools to discover this path.
- For normal board reboot requests, including returning a Linux board from Loader USB to the normal runtime state, call `dbt_reboot_device` directly.
- In DBT/TaishanPi context, user phrases such as `下载初始化镜像`, `恢复初始镜像`, `烧录初始化镜像`, `刷写初始化镜像`, `恢复出厂镜像`, or `factory image` mean factory full-image burning to the board unless the user explicitly says "只下载到本机" or "只检查本地缓存".
- For real TaishanPi initialization/factory full-image burning, first call `dbt_current_board_status`, then call `dbt_start_flash_image` with `image_source=factory` and `scope=all`, then call `dbt_get_job_status` with the returned `job_id` to show progress. Let `dbt-agentd`/the installed runtime handle running-vs-Loader/Maskrom transitions.
- Use `dbt_flash_image` only for `dry_run=true`, short blocking validation, or when the user explicitly asks to wait for final completion in one blocking tool call.
- Do not call `dbt_install_board_environment`, `dbt_list_installed_board_plugins`, file listing, or repository search for initialization-image burning. `dbt_install_board_environment` is only for installing/repairing local compiler/runtime environments.
- For startup-logo, boot-logo, splash-logo, or logo replacement requests, call `dbt_update_logo` directly with the user-provided host image path plus requested `rotate`, `scale`, `build_mode`, and `flash` options. Do not inspect boot workspace files, do not manually run `sips`, `magick`, `convert`, `rebuild_boot.sh`, or `dbt_flash_image`; the runtime `update-logo` method owns image conversion, sizing, boot/resource rebuild, and optional boot flashing.
- Do not invent Pico SDK include paths, link libraries, or support headers. Use DBT capability context exactly.

## Routing

- RP2350 hardware control: `../rp2350/SKILL.md`
- TaishanPi Linux-board flows: `../taishanpi/SKILL.md`
