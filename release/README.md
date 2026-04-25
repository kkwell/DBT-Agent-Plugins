# DBT-Agent Release Entry

This directory is the user-facing release entry for installing a specific DBT-Agent platform plugin.

End users should prefer the GitHub Releases page:

- [DBT-Agent-Plugins Releases](https://github.com/kkwell/DBT-Agent-Plugins/releases)
- download the platform-specific archive only
- extract it and run the top-level `install.sh` or `install.command`

Current archive naming:

- `DBT-Agent-OpenCode-v1.0.11.zip`
- `DBT-Agent-Codex-v1.0.11.zip`

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
- `dbt-agentd` binary presence
- `dbt-agentd` local config presence
- native `dbt-agentd --mcp-serve` readiness for Codex archives
- writable install targets
- platform home detection with warnings if the client has not been launched yet

## Runtime Installation

The shared DBT runtime support package is not auto-downloaded by these installers. It contains large
cross-compilers, board toolchains, and the shared local `dbt-agentd`, so users must download and
install it offline first.

Download link:

- [Baidu Netdisk runtime package](https://pan.baidu.com/s/1SVGvOmNEWLoALkf7Sfi0dQ?pwd=0001)
- password: `0001`

After the runtime is installed, rerun the platform installer:

```bash
/bin/bash ./release/install-opencode.sh --check-only
/bin/bash ./release/install-codex.sh --check-only
```

If the Codex archive reports an MCP probe failure, the offline runtime package is still an older build.
Update the runtime package first, then rerun the archive installer.

## Board Development Environments

Board-family development environments are large and remain separate offline downloads. The plugin
release manifest advertises the available family packages, but the user still chooses and installs
the package for the board family they want to use.

- TaishanPi development requires the `TaishanPi` offline package.
- `ColorEasyPICO2` and `RaspberryPiPico2W` firmware builds require the shared `RP2350` offline package.
- If a user later switches board families, DBT tools should report the missing package and ask the
  user to install it before continuing with model-driven build work.

## Platform Docs

- [OpenCode installation guide](../opencode_plugin/docs/installation.md)
- [Codex installation guide](../codex_plugin/docs/installation.md)

## Maintainer Check

Before publishing a tag or a GitHub release, run:

```bash
/bin/bash ./scripts/verify_release_ready.sh
/bin/bash ./scripts/build_release_archives.sh
```
