# DBT-Agent Platform Plugins

This document is the extended project note for platform plugin delivery under `platform_plugin/`.

For the repository homepage overview, installation entry points, and demo links, see:

- [README.md](./README.md)

Each platform plugin project must stay self-contained inside its own folder.
Files outside `platform_plugin/` are not part of the authoritative plugin project layout.

## Supported platform plugins

| Platform | Status | Project folder | Main package | Install entry |
| --- | --- | --- | --- | --- |
| OpenCode | available | `opencode_plugin/` | `opencode_plugin/release/package/` | `opencode_plugin/release/install.sh` |
| Codex | available | `codex_plugin/` | `codex_plugin/release/package/` | `codex_plugin/release/install.sh` |

## OpenCode plugin

Detailed project entry:

- [opencode_plugin/README.md](./opencode_plugin/README.md)

Key capabilities:

- board status inspection
- board config and capability context lookup
- local runtime execution through the shared Development Board Toolchain runtime
- local build / deploy / log collection workflows
- plugin update checks and runtime-aware installation

Important directories:

- source code:
  - [opencode_plugin/source](./opencode_plugin/source)
- release package:
  - [opencode_plugin/release/package](./opencode_plugin/release/package)
- installer:
  - [opencode_plugin/release/install.sh](./opencode_plugin/release/install.sh)
- install docs:
  - [opencode_plugin/docs/installation.md](./opencode_plugin/docs/installation.md)

## Installation model

All platform plugins share one local runtime root:

- `~/Library/Application Support/development-board-toolchain/runtime`

Platform plugins themselves install into platform-specific client directories.

For OpenCode:

- plugin directory:
  - `~/.config/opencode/plugins/development-board-toolchain`
- shared runtime:
  - `~/Library/Application Support/development-board-toolchain/runtime`

## OpenCode install flow

1. Ensure the shared runtime is installed.
2. Run:

```bash
/bin/bash ./opencode_plugin/release/install.sh --force
```

3. Restart OpenCode and open a new session.

## Update responsibility

- shared runtime package:
  - distributed separately, but always installed into Application Support
- OpenCode plugin:
  - distributed from `opencode_plugin/release/`
- board plugins:
  - distributed independently from their own release channel

## Maintenance rule

Do not spread a platform plugin across unrelated directories.

If a file belongs to the OpenCode plugin project, it must live under:

- `platform_plugin/opencode_plugin/`

## Codex plugin

Detailed project entry:

- [codex_plugin/README.md](./codex_plugin/README.md)

Key capabilities:

- board status inspection
- board config and capability context lookup
- shared runtime execution through the shared Development Board Toolchain runtime
- RP2350 BOOTSEL, flash, verify, run, and serial log workflows
- TaishanPi chip-control, wireless probe, and build-run workflows
- plugin update checks and runtime-aware installation support

Important directories:

- source code:
  - [codex_plugin/source/plugin](./codex_plugin/source/plugin)
- release package:
  - [codex_plugin/release/package](./codex_plugin/release/package)
- installer:
  - [codex_plugin/release/install.sh](./codex_plugin/release/install.sh)
- install docs:
  - [codex_plugin/docs/installation.md](./codex_plugin/docs/installation.md)

## Codex installation model

Codex uses the same shared runtime root:

- `~/Library/Application Support/development-board-toolchain/runtime`

The local Codex plugin package installs into:

- `~/.codex/.tmp/plugins/plugins/dbt-agent`

The local Codex marketplace entry installs into:

- `~/.codex/.tmp/plugins/.agents/plugins/marketplace.json`

## Codex install flow

1. Ensure the shared runtime is installed.
2. Run:

```bash
/bin/bash ./codex_plugin/release/install.sh --force
```

3. Restart Codex.
4. Open the plugin list and use `DBT-Agent`.

## Codex maintenance rule

Do not spread the Codex plugin across unrelated directories.

If a file belongs to the Codex plugin project, it must live under:

- `platform_plugin/codex_plugin/`
