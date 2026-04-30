# Codex Plugin Installation

This Codex plugin always uses the shared runtime installed at:

- `~/Library/development-board-toolchain/runtime`

When Codex has its generic local plugin mirror, and that mirror is still named
`plugins`, the plugin package installs into:

- `~/.codex/.tmp/plugins/plugins/dbt-agent`

The local marketplace entry is written to:

- `~/.codex/.tmp/plugins/.agents/plugins/marketplace.json`

That marketplace must stay named `plugins` with `interface.displayName` set to
`Plugins`; DBT-Agent is only one plugin entry inside it, using source path
`./plugins/dbt-agent`.

If Codex has refreshed `~/.codex/.tmp/plugins/.agents/plugins/marketplace.json`
as the official `openai-curated` marketplace, DBT-Agent must not write into it.
The installer then uses the stable home-local marketplace:

- plugin package: `~/.codex/plugins/dbt-agent`
- marketplace file: `~/.agents/plugins/marketplace.json`
- marketplace identity: `plugins`
- plugin source path: `./.codex/plugins/dbt-agent`

Fallback for older Codex layouts without that generic marketplace is:

- plugin package: `~/.codex/plugins/dbt-agent`
- marketplace file: `~/.agents/plugins/marketplace.json`
- marketplace identity: `plugins`

The old `local-development-board-marketplace` marketplace name must not be restored because it is too long for the current Codex plugin card layout.

## Requirements

- macOS
- Codex is recommended to be launched once before installation
- the shared runtime is installed locally first
- the shared `dbt-agentd` is installed locally first

## Preflight Check

Run the installer in check-only mode first:

```bash
/bin/bash ./release/install.sh --check-only
```

The preflight check validates:

- local release files
- writable install targets
- runtime availability
- `dbt-agentd` binary availability
- `dbt-agentd` local config availability
- native `dbt-agent-mcp-bridge` response

## Recommended Install Flow

1. Run the preflight check.
2. Install or update the Codex plugin package:

```bash
/bin/bash ./release/install.sh --force
```

3. Restart Codex.
4. Open the plugin list. `DBT-Agent` should appear as the local Development Board Toolchain plugin.

The installer merges the `dbt-agent` entry into Codex's generic `plugins` marketplace when it exists and is not the official `openai-curated` marketplace. It does not replace other generic marketplace plugin entries.
It also syncs an installed local copy into Codex's plugin cache and enables the matching plugin state in `~/.codex/config.toml`.
The installer removes stale standalone `dbt-agent-local` and `openai-curated/dbt-agent` state.

## Install The Runtime First

The Codex plugin installer does not auto-download the runtime.
The runtime support package is large because it contains board toolchains, cross-compilers, and the shared local `dbt-agentd`, so users need to install it offline first.

Download link:

- [Baidu Netdisk runtime package](https://pan.baidu.com/s/1SVGvOmNEWLoALkf7Sfi0dQ?pwd=0001)
- password: `0001`

After the runtime is installed, rerun:

```bash
/bin/bash ./release/install.sh --check-only
/bin/bash ./release/install.sh --force
```

## Install Model

- Codex plugin package:
  - local thin wrapper only
- Shared runtime:
  - all board control, build, flash, and probe work
- Shared agent:
  - `dbt-agentd`

The installer rewrites the plugin `.mcp.json` so Codex calls the installed `dbt-agent-mcp-bridge` binary in native MCP stdio mode. The bridge then talks to the shared local `dbt-agentd` service and avoids direct plugin-side `dbt-agentd --mcp-serve` process ownership.

Installed skill guidance must answer user-facing board feature and capability
questions from DBT tool results and installed capability data. It must not cite
maintainer source-checkout docs or private host paths outside
`~/Library/development-board-toolchain`.

The generated `.mcp.json` now uses the schema-valid approval mode `auto`. Older `always_allow` payloads are no longer emitted because newer Codex builds reject that enum during plugin MCP parsing. The native MCP bridge also publishes tool annotations:

- read-only/idempotent tools: status, device list, plugin catalog, capability context, environment checks, live probes, WiFi/Bluetooth scans, log tails
- state-changing tools: USB ECM repair, WiFi connect, environment install, generated build/run, RP2350 mode changes
- destructive tools: runtime update, image flashing, boot-logo flashing, RP2350 flashing/build-and-flash

MCP approval is a Codex-client security decision. DBT-Agent can mark tools accurately and emit a valid config, but it cannot force the client to stop prompting from inside the plugin. On the local verification machine, Codex CLI `0.121.0` still cancelled non-interactive MCP tool calls in `codex exec` with `ResolveElicitation(... decision: Cancel)`, so the remaining terminal CLI limitation is inside Codex's own MCP approval flow rather than the DBT-Agent install layout. If Codex Desktop shows a remember/always-allow option for the trusted local `dbt-agent` MCP server or a specific read-only tool, use that UI-level trust option; keep destructive DBT tools promptable.

## Verify The Installation

- confirm the plugin directory exists:
  - current Codex: `~/.codex/.tmp/plugins/plugins/dbt-agent`
  - fallback layout: `~/.codex/plugins/dbt-agent`
- confirm the installed cache copy exists:
  - `~/.codex/plugins/cache/<marketplace-name>/dbt-agent/local`
- confirm the local marketplace entry exists:
  - current Codex: `~/.codex/.tmp/plugins/.agents/plugins/marketplace.json`
  - fallback layout: `~/.agents/plugins/marketplace.json`
- confirm `~/.codex/config.toml` contains the enabled state for the installed plugin entry
- confirm `~/.codex/config.toml` points at `dbt-agent@plugins`, not `dbt-agent@openai-curated`
- confirm stale DBT-Agent caches are absent:
  - `~/.codex/plugins/cache/dbt-agent-local/dbt-agent`
  - `~/.codex/plugins/cache/openai-curated/dbt-agent`
  - `~/.codex/plugins/cache/local-development-board-marketplace/dbt-agent`
- restart Codex
- open the plugin list and confirm `DBT-Agent` is available

## Use From Codex CLI

Codex CLI uses the same installed plugin and MCP bridge as Codex Desktop. The plugin should resolve to the installed runtime, not to the project checkout.

Check that the MCP entry is enabled:

```bash
codex mcp list
```

Expected local command path:

```text
~/Library/development-board-toolchain/runtime/editor_plugins/codex/bin/dbt-agent-mcp-bridge
```

Check the active board:

```bash
codex exec -C /Users/kvell/kk-project/DBT-Agent-Project --skip-git-repo-check -s danger-full-access -m gpt-5.4-mini '使用 DBT-Agent 查看当前开发板状态，只调用 dbt_current_board_status。'
```

The `-C` path is only for maintainer validation inside this repository. User-facing plugin answers and prompts should reference the installed runtime under `~/Library/development-board-toolchain`, not this local source checkout.

Switch TaishanPi to Loader/download mode:

```bash
codex exec -C /Users/kvell/kk-project/DBT-Agent-Project --skip-git-repo-check -s danger-full-access -m gpt-5.4-mini '使用 DBT-Agent 将当前 TaishanPi 切换到 Loader 模式。直接调用 dbt_reboot_loader，不要查 capability，不要运行 shell。完成后调用 dbt_current_board_status 确认 USB mode。'
```

For Loader/download mode requests, the model must call `dbt_reboot_loader` directly. Capability lookup tools are for capability contracts and code-generation constraints, not for runtime mode switching.

For local operator diagnosis without model sampling:

```bash
curl -sS -X POST http://127.0.0.1:18082/v1/tools/execute \
  -H 'Content-Type: application/json' \
  -d '{"tool_name":"reboot_loader","arguments":{},"request_context":{"client_id":"terminal","session_id":"manual","client_type":"terminal","request_id":"reboot-loader"}}'

"$HOME/Library/development-board-toolchain/runtime/dbtctl" status --json
"$HOME/Library/development-board-toolchain/runtime/dbtctl" usb reboot-loader --json --quiet
```

## Troubleshooting

- if the installer says the runtime is missing, install the offline runtime package first, then rerun the installer
- if the installer says `dbt-agentd` is missing, install the shared toolkit support package first, then rerun the installer
- if the installer says the `dbt-agentd` MCP probe failed, the installed offline runtime package is too old; update it, then rerun the installer
- if the install directory already exists, rerun with `--force`
- if you use a custom `--marketplace-path`, keep `--install-dir` under the same marketplace root so the relative local plugin path stays valid
- if Codex does not show the plugin, restart Codex after installation

## Update Rule

If you change files under `source/plugin/`, sync the release package before publishing:

```bash
/bin/bash ./scripts/sync_release_from_source.sh
```
