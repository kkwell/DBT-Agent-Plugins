# Codex Plugin Installation

This Codex plugin always uses the shared runtime installed at:

- `~/Library/Application Support/development-board-toolchain/runtime`

The plugin package itself installs into Codex's local plugin area:

- `~/.codex/.tmp/plugins/plugins/dbt-agent`

The local marketplace entry is written to:

- `~/.codex/.tmp/plugins/.agents/plugins/marketplace.json`

## Requirements

- macOS
- `python3`
- Codex is recommended to be launched once before installation
- the shared runtime already exists, or a runtime bootstrap URL is provided during install

## Preflight Check

Run the installer in check-only mode first:

```bash
/bin/bash ./release/install.sh --check-only
```

The preflight check validates:

- local release files
- writable install targets
- runtime availability
- runtime bootstrap prerequisites when remote URLs are used

## Recommended Install Flow

1. Run the preflight check.
2. Install or update the Codex plugin package:

```bash
/bin/bash ./release/install.sh --force
```

3. Restart Codex.
4. Open the plugin list. `DBT-Agent` should appear as the local Development Board Toolchain plugin.

## If Runtime Is Not Installed Yet

The installer supports bootstrapping the shared runtime through remote URLs:

```bash
/bin/bash ./release/install.sh \
  --runtime-installer-url "<runtime-installer-url>" \
  --force
```

or:

```bash
/bin/bash ./release/install.sh \
  --runtime-manifest-url "<runtime-manifest-url>" \
  --force
```

## Install Model

- Codex plugin package:
  - local thin wrapper only
- Shared runtime:
  - all board control, build, flash, and probe work
- Shared agent:
  - `dbt-agentd`

The installer rewrites the plugin `.mcp.json` so Codex calls the shared runtime MCP script, not a duplicated plugin-local runtime.

## Verify The Installation

- confirm the plugin directory exists:
  - `~/.codex/.tmp/plugins/plugins/dbt-agent`
- confirm the local marketplace entry exists:
  - `~/.codex/.tmp/plugins/.agents/plugins/marketplace.json`
- restart Codex
- open the plugin list and confirm `DBT-Agent` is available

## Troubleshooting

- if the installer says the runtime is missing, rerun with `--runtime-installer-url` or `--runtime-manifest-url`
- if the install directory already exists, rerun with `--force`
- if Codex does not show the plugin, restart Codex after installation

## Update Rule

If you change files under `source/plugin/`, sync the release package before publishing:

```bash
/bin/bash ./scripts/sync_release_from_source.sh
```
