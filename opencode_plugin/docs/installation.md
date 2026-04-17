# OpenCode Plugin Installation

This plugin always uses the shared runtime installed at:

- `~/Library/Application Support/development-board-toolchain/runtime`

## Requirements

- macOS
- `python3`
- OpenCode is recommended to be launched once before installation
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
2. Install or update the plugin package:

```bash
/bin/bash ./release/install.sh --force
```

3. Restart OpenCode and open a new session.

## If Runtime Is Not Installed Yet

The installer supports bootstrapping runtime through remote URLs:

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

- if the installer says the runtime is missing, rerun with `--runtime-installer-url` or `--runtime-manifest-url`
- if the install directory already exists, rerun with `--force`
- if OpenCode does not detect the plugin, restart OpenCode after installation
