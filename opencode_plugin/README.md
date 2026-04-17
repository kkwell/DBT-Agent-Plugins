# OpenCode Plugin Project

This directory is the self-contained source-of-truth project for the Development Board Toolchain OpenCode plugin.

Everything required to maintain the OpenCode plugin lives under this directory:

- `source/`
  - authoritative plugin source code and development package metadata
- `release/`
  - release-facing package structure, installer, and manifest
- `docs/`
  - plugin-specific documentation
- `scripts/`
  - local maintenance helpers for keeping release artifacts in sync with source

## Source of truth

The authoritative plugin implementation is:

- `source/index.js`

The installable OpenCode package entry is:

- `release/package/index.js`

When `source/index.js` changes, sync the release package with:

```bash
/bin/bash ./scripts/sync_release_from_source.sh
```

## Runtime relationship

This plugin does not embed a local runtime copy.

It always uses the shared runtime installed at:

- `~/Library/Application Support/development-board-toolchain/runtime`

If the runtime is missing, `release/install.sh` can either:

- use an already installed runtime
- or bootstrap the runtime from a remote installer URL / manifest URL

## Main files

- `source/index.js`
  - plugin source used for development
- `source/package.json`
  - OpenCode plugin development dependencies
- `release/install.sh`
  - standalone installer for the OpenCode plugin
- `release/manifest.json`
  - release metadata for the plugin package
- `release/package/index.js`
  - packaged plugin entry for distribution
- `release/package/development-board-toolchain.runtime.template.json`
  - runtime config template shipped with the plugin
- `docs/installation.md`
  - operator install instructions

## Maintenance rule

Do not add plugin implementation files outside this directory.

Future model work should start from this directory and the top-level entry document:

- `../DBT-Agent-Plugins.md`
