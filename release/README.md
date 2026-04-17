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
- `python3` availability
- runtime presence, or runtime bootstrap inputs if the runtime is missing
- writable install targets
- platform home detection with warnings if the client has not been launched yet

## Runtime Bootstrap

If the shared runtime is not installed yet, both platform installers support runtime bootstrap through a remote installer URL:

```bash
/bin/bash ./release/install-opencode.sh \
  --runtime-installer-url "<runtime-installer-url>" \
  --force
```

or a manifest URL:

```bash
/bin/bash ./release/install-codex.sh \
  --runtime-manifest-url "<runtime-manifest-url>" \
  --force
```

## Platform Docs

- [OpenCode installation guide](../opencode_plugin/docs/installation.md)
- [Codex installation guide](../codex_plugin/docs/installation.md)

## Maintainer Check

Before publishing a tag or a GitHub release, run:

```bash
/bin/bash ./scripts/verify_release_ready.sh
```
