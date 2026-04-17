# Codex Plugin Project

This directory is the self-contained source-of-truth project for the DBT-Agent Codex plugin.

Everything required to maintain the Codex plugin lives under this directory:

- `source/`
  - authoritative plugin source code, marketplace seed, skills, assets, and MCP wrapper
- `release/`
  - release-facing package structure, standalone installer, and manifest
- `docs/`
  - plugin-specific operator documentation
- `scripts/`
  - local maintenance helpers for keeping release artifacts in sync with source

## Source of truth

The authoritative Codex plugin implementation is:

- `source/plugin/`

The release package published to users is:

- `release/package/`

When `source/plugin/` or `source/marketplace.json` changes, sync the release assets with:

```bash
/bin/bash ./scripts/sync_release_from_source.sh
```

## Plugin identity

- Plugin id: `dbt-agent`
- Plugin display name: `DBT-Agent`
- Full product name in descriptions: `Development Board Toolchain`
- Developer: `kvell`
- Website: `https://kong-cn.com/`

`DBT` is the short form of `Development Board Toolchain`. `DBT-Agent` is the Codex-facing plugin name.

## Runtime relationship

This plugin does not embed a separate board-control runtime.

It always uses the shared runtime installed at:

- `~/Library/Application Support/development-board-toolchain/runtime`

and the shared local backend agent at:

- `~/Library/Application Support/development-board-toolchain/agent`

GUI, OpenCode, and Codex all call the same runtime and `dbt-agentd`.

## Covered boards

- `TaishanPi / 1M-RK3566`
- `ColorEasyPICO2`
- `RaspberryPiPico2W`

## Main files

- `source/plugin/.codex-plugin/plugin.json`
  - Codex plugin manifest
- `source/plugin/.mcp.json`
  - development-time MCP entry
- `source/plugin/scripts/dbt_agent_mcp.py`
  - Codex MCP tool server wrapper
- `release/install.sh`
  - standalone installer for local Codex distribution
- `release/manifest.json`
  - release metadata
- `docs/installation.md`
  - operator install instructions

## Maintenance rule

Do not spread Codex plugin implementation files outside this directory.

If a file belongs to the Codex plugin project, it must live under:

- `platform_plugin/codex_plugin/`
