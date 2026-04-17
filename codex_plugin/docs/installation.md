# Codex Plugin Installation

This Codex plugin always uses the shared runtime installed at:

- `~/Library/Application Support/development-board-toolchain/runtime`

The plugin package itself installs into Codex's local plugin area:

- `~/.codex/.tmp/plugins/plugins/dbt-agent`

The local marketplace entry is written to:

- `~/.codex/.tmp/plugins/.agents/plugins/marketplace.json`

## Recommended install flow

1. Ensure the shared runtime already exists.
2. Install or update the Codex plugin package:

```bash
/bin/bash ./release/install.sh --force
```

3. Restart Codex.
4. Open the plugin list. `DBT-Agent` should appear as the local Development Board Toolchain plugin.

## If runtime is not installed yet

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

## Install model

- Codex plugin package:
  - local thin wrapper only
- Shared runtime:
  - all board control, build, flash, and probe work
- Shared agent:
  - `dbt-agentd`

The installer rewrites the plugin `.mcp.json` so Codex calls the shared runtime MCP script, not a duplicated plugin-local runtime.

## Update rule

If you change files under `source/plugin/`, sync the release package before publishing:

```bash
/bin/bash ./scripts/sync_release_from_source.sh
```
