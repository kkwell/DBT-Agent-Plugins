# Codex Plugin Project

This directory is the self-contained source-of-truth project for the Embed Labs Codex plugin.

Everything required to maintain the Codex plugin lives under this directory:

- `source/`
  - authoritative plugin source code, marketplace seed, skills, assets, and MCP entry config
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
- Plugin display name: `Embed Labs`
- Full product name in descriptions: `Development Board Toolchain`
- Developer: `Kvell`
- Website: `https://kong-cn.com/`

`DBT` is the short form of `Development Board Toolchain`. `Embed Labs` is the Codex-facing plugin display name.

On current Codex, Embed Labs is installed as one plugin inside the generic
local `plugins` marketplace. If Codex's temporary marketplace at
`~/.codex/.tmp/plugins/.agents/plugins/marketplace.json` still has `name=plugins`,
the plugin package lives at `~/.codex/.tmp/plugins/plugins/dbt-agent` and points
to `./plugins/dbt-agent`.

If Codex refreshes that temporary marketplace as the official `openai-curated`
marketplace, the installer must not write DBT-Agent there. It falls back to the
stable home-local marketplace at `~/.agents/plugins/marketplace.json`, keeps
`name=plugins`, installs the package at `~/.codex/plugins/dbt-agent`, and points
to `./.codex/plugins/dbt-agent`.

Fallback for older Codex layouts without that generic marketplace is the
home-local `~/.agents/plugins/marketplace.json` marketplace with
`name=plugins`, pointing to `./.codex/plugins/dbt-agent`.

Do not restore the old long marketplace name
`local-development-board-marketplace`; it truncates poorly in the Codex plugin
directory UI. Do not rename Codex's generic `plugins` marketplace to
Embed Labs, because that creates a separate product-specific category and can label
unrelated plugins incorrectly.

## Runtime relationship

This plugin does not embed a separate board-control runtime.

It always uses the shared runtime installed at:

- `~/Library/development-board-toolchain/runtime`

and the shared local backend agent at:

- `~/Library/development-board-toolchain/agent`

GUI, OpenCode, and Codex all call the same runtime and `dbt-agentd`.

Codex CLI uses the same installed local plugin. It should call the installed MCP bridge and runtime under:

- `~/Library/development-board-toolchain/runtime/editor_plugins/codex/bin/dbt-agent-mcp-bridge`
- `~/Library/development-board-toolchain/runtime/dbtctl`

Do not point Codex prompts or plugin configs at this source checkout for normal board operations.
Installed skill guidance must answer user-facing board feature and capability
questions from DBT tool results and installed capability data, not from private
maintainer docs or source-checkout paths.

## Terminal Usage

After the plugin is installed, verify Codex sees the local MCP entry:

```bash
codex mcp list
```

Check the current board through Codex CLI:

```bash
codex exec -C /Users/kvell/kk-project/DBT-Agent-Project --skip-git-repo-check -s danger-full-access -m gpt-5.4-mini '使用 Embed Labs 查看当前开发板状态，只调用 dbt_current_board_status。'
```

The `-C` path above is maintainer-only. End-user plugin guidance and model answers must not cite this source checkout path; normal board operations use the installed runtime under `~/Library/development-board-toolchain`.

Switch a connected TaishanPi to Loader mode through Codex CLI:

```bash
codex exec -C /Users/kvell/kk-project/DBT-Agent-Project --skip-git-repo-check -s danger-full-access -m gpt-5.4-mini '使用 Embed Labs 将当前 TaishanPi 切换到 Loader 模式。直接调用 dbt_reboot_loader，不要查 capability，不要运行 shell。完成后调用 dbt_current_board_status 确认 USB mode。'
```

For local diagnosis without the LLM, call the shared `dbt-agentd` API or the installed runtime directly:

```bash
curl -sS -X POST http://127.0.0.1:18082/v1/tools/execute \
  -H 'Content-Type: application/json' \
  -d '{"tool_name":"reboot_loader","arguments":{},"request_context":{"client_id":"terminal","session_id":"manual","client_type":"terminal","request_id":"reboot-loader"}}'

"$HOME/Library/development-board-toolchain/runtime/dbtctl" status --json
"$HOME/Library/development-board-toolchain/runtime/dbtctl" usb reboot-loader --json --quiet
```

## Tool event reporting

Codex-side MCP tool calls are captured by `dbt-agentd` under the shared local tool-event protocol:

- [../../dbt-agentd/dbt-agentd-project/protocols/LOCAL_TOOL_EVENT_PROTOCOL.md](../../dbt-agentd/dbt-agentd-project/protocols/LOCAL_TOOL_EVENT_PROTOCOL.md)

Any future Codex-specific failure reporting should still route through `dbt-agentd`, not a direct remote uploader.

## Covered boards

- `TaishanPi / 1M-RK3566`
- `ColorEasyPICO2`
- `RaspberryPiPico2W`

## Main files

- `source/plugin/.codex-plugin/plugin.json`
  - Codex plugin manifest
- `source/plugin/.mcp.json`
  - plugin MCP entry template; installation rewrites it to the installed runtime-shared `dbt-agent-mcp-bridge`
- `release/install.sh`
  - standalone installer for local Codex distribution
- `release/manifest.json`
  - release metadata
- `docs/installation.md`
  - operator install instructions
- `../scripts/build_release_archives.sh`
  - build end-user release archives with top-level install entry

## Maintenance rule

Do not spread Codex plugin implementation files outside this directory.

If a file belongs to the Codex plugin project, it must live under:

- `platform_plugin/codex_plugin/`
