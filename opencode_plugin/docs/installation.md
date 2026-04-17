# OpenCode Plugin Installation

This plugin always uses the shared runtime installed at:

- `~/Library/Application Support/development-board-toolchain/runtime`

## Recommended install flow

1. Ensure the shared runtime already exists.
2. Install or update the plugin package:

```bash
/bin/bash ./release/install.sh --force
```

3. Restart OpenCode and open a new session.

## If runtime is not installed yet

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

## Default install location

The plugin is installed to:

- `~/.config/opencode/plugins/development-board-toolchain`

The runtime config written beside the plugin is:

- `development-board-toolchain.runtime.json`

It points to the shared runtime root under Application Support.
