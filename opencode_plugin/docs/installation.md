# OpenCode Plugin Installation

This plugin always uses the shared runtime installed at:

- `~/Library/Application Support/development-board-toolchain/runtime`

## Requirements

- macOS
- OpenCode is recommended to be launched once before installation
- the shared runtime is installed locally first

## Preflight Check

Run the installer in check-only mode first:

```bash
/bin/bash ./release/install.sh --check-only
```

The preflight check validates:

- local release files
- writable install targets
- runtime availability

## Recommended Install Flow

1. Run the preflight check.
2. Install or update the plugin package:

```bash
/bin/bash ./release/install.sh --force
```

3. Restart OpenCode and open a new session.

## Install The Runtime First

The OpenCode plugin installer does not auto-download the runtime.
The runtime package is large because it contains board toolchains and cross-compilers, so users need to install it offline first.

Download link:

- [Baidu Netdisk runtime package](https://pan.baidu.com/s/1SVGvOmNEWLoALkf7Sfi0dQ?pwd=0001)
- password: `0001`

After the runtime is installed, rerun:

```bash
/bin/bash ./release/install.sh --check-only
/bin/bash ./release/install.sh --force
```

## Default Install Location

The plugin is installed to:

- `~/.config/opencode/plugins/development-board-toolchain`

The runtime config written beside the plugin is:

- `development-board-toolchain.runtime.json`

It points to the shared runtime root under Application Support.

## Verify The Installation

- confirm the plugin directory exists:
  - `~/.config/opencode/plugins/development-board-toolchain`
- confirm the runtime config exists:
  - `~/.config/opencode/plugins/development-board-toolchain/development-board-toolchain.runtime.json`
- restart OpenCode and open a new session

## Troubleshooting

- if the installer says the runtime is missing, install the offline runtime package first, then rerun the installer
- if the install directory already exists, rerun with `--force`
- if OpenCode does not detect the plugin, restart OpenCode after installation
