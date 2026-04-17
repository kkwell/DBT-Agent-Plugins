# DBT-Agent Codex Plugin

This file describes the plugin payload itself.

For the full self-contained Codex plugin project, start from:

- `../../README.md`

Codex local plugin for the shared Development Board Toolchain runtime.

`DBT` is the short form of `Development Board Toolchain`. `DBT-Agent` is the Codex-facing plugin name.

## Canonical model

- Plugin install target: Codex plugin directory and local marketplace
- Execution target: `~/Library/Application Support/development-board-toolchain/runtime`
- Backend agent: `~/Library/Application Support/development-board-toolchain/agent`

The plugin is only a thin Codex wrapper. GUI, OpenCode, and Codex all use the same shared runtime and local `dbt-agentd`.

## Covered boards

- `TaishanPi / 1M-RK3566`
- `ColorEasyPICO2`
- `RaspberryPiPico2W`

## Installed pieces

- `.codex-plugin/plugin.json`
- `.mcp.json`
- `skills/`
- `scripts/dbt_agent_mcp.py`

During real installation, `release/install.sh` rewrites `.mcp.json` so Codex calls the runtime-shared MCP server script under the support-root runtime, not a duplicated plugin-local runtime.
