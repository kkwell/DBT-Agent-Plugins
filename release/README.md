# DBT-Agent Release Entry

This directory is the user-facing release entry for installing a specific DBT-Agent platform plugin.

## Choose Your Platform

OpenCode:

```bash
/bin/bash ./release/install-opencode.sh --check-only
/bin/bash ./release/install-opencode.sh --force
```

Codex:

```bash
/bin/bash ./release/install-codex.sh --check-only
/bin/bash ./release/install-codex.sh --force
```

Unified installer:

```bash
/bin/bash ./release/install.sh --platform opencode --check-only
/bin/bash ./release/install.sh --platform codex --force
```

## What The Installers Check

- macOS host environment
- required local release files
- runtime presence
- writable install targets
- platform home detection with warnings if the client has not been launched yet
- for Codex only: `python3` availability, because Codex launches `dbt_agent_mcp.py` through `python3`

## Runtime Installation

The shared DBT runtime is not auto-downloaded by these installers. It contains large cross-compilers
and board toolchains, so users must download and install it offline first.

Download link:

- [Baidu Netdisk runtime package](https://pan.baidu.com/s/1SVGvOmNEWLoALkf7Sfi0dQ?pwd=0001)
- password: `0001`

After the runtime is installed, rerun the platform installer:

```bash
/bin/bash ./release/install-opencode.sh --check-only
/bin/bash ./release/install-codex.sh --check-only
```

## Why Codex Still Checks `python3`

The Codex plugin launches the local MCP bridge script `dbt_agent_mcp.py` through `python3`.
This requirement belongs to the Codex plugin wrapper itself, not to the offline DBT runtime package.

## Platform Docs

- [OpenCode installation guide](../opencode_plugin/docs/installation.md)
- [Codex installation guide](../codex_plugin/docs/installation.md)

## Maintainer Check

Before publishing a tag or a GitHub release, run:

```bash
/bin/bash ./scripts/verify_release_ready.sh
```
