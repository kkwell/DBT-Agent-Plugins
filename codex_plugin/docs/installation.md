# Codex Plugin Installation

This Codex plugin always uses the shared runtime installed at:

- `~/Library/Application Support/development-board-toolchain/runtime`

The plugin package itself installs into Codex's local plugin area:

- `~/.codex/.tmp/plugins/plugins/dbt-agent`

The local marketplace entry is written to:

- `~/.codex/.tmp/plugins/.agents/plugins/marketplace.json`

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
- native `dbt-agentd --mcp-serve` response

## Recommended Install Flow

1. Run the preflight check.
2. Install or update the Codex plugin package:

```bash
/bin/bash ./release/install.sh --force
```

3. Restart Codex.
4. Open the plugin list. `DBT-Agent` should appear as the local Development Board Toolchain plugin.

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

The installer rewrites the plugin `.mcp.json` so Codex calls the installed `dbt-agentd` binary directly in native MCP stdio mode.

## Verify The Installation

- confirm the plugin directory exists:
  - `~/.codex/.tmp/plugins/plugins/dbt-agent`
- confirm the local marketplace entry exists:
  - `~/.codex/.tmp/plugins/.agents/plugins/marketplace.json`
- restart Codex
- open the plugin list and confirm `DBT-Agent` is available

## Troubleshooting

- if the installer says the runtime is missing, install the offline runtime package first, then rerun the installer
- if the installer says `dbt-agentd` is missing, install the shared toolkit support package first, then rerun the installer
- if the installer says the `dbt-agentd` MCP probe failed, the installed offline runtime package is too old; update it, then rerun the installer
- if the install directory already exists, rerun with `--force`
- if Codex does not show the plugin, restart Codex after installation

## Update Rule

If you change files under `source/plugin/`, sync the release package before publishing:

```bash
/bin/bash ./scripts/sync_release_from_source.sh
```
