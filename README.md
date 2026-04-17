# DBT-Agent Plugins

Platform plugin delivery repository for the Development Board Toolchain (`DBT-Agent`).

This repository currently contains two platform-specific plugin projects:

- `opencode_plugin/`
  - OpenCode plugin source, release package, installer, and docs
- `codex_plugin/`
  - Codex plugin source, release package, installer, and docs

## What This Repository Provides

| Platform | Status | Project folder | Install entry | Notes |
| --- | --- | --- | --- | --- |
| OpenCode | available | `opencode_plugin/` | `opencode_plugin/release/install.sh` | Includes demo videos in `demo/` |
| Codex | available | `codex_plugin/` | `codex_plugin/release/install.sh` | Demo videos will be added later |

## Repository Layout

```text
.
├── README.md
├── DBT-Agent-Plugins.md
├── demo/
│   ├── opencode_led_traffic_light.webm
│   ├── opencode_change_logo.webm
│   └── posters/
├── opencode_plugin/
│   ├── source/
│   ├── release/
│   ├── docs/
│   └── scripts/
└── codex_plugin/
    ├── source/
    ├── release/
    ├── docs/
    └── scripts/
```

## Quick Start

Both platform plugins use the shared local Development Board Toolchain runtime:

- runtime root:
  - `~/Library/Application Support/development-board-toolchain/runtime`

OpenCode install:

```bash
/bin/bash ./opencode_plugin/release/install.sh --force
```

Codex install:

```bash
/bin/bash ./codex_plugin/release/install.sh --force
```

Detailed installation guides:

- [OpenCode installation](./opencode_plugin/docs/installation.md)
- [Codex installation](./codex_plugin/docs/installation.md)

## OpenCode Demos

Click a cover image to open the demo video.

| LED traffic light workflow | Change logo workflow |
| --- | --- |
| [![OpenCode LED traffic light demo](./demo/posters/opencode_led_traffic_light.png)](./demo/opencode_led_traffic_light.webm) | [![OpenCode change logo demo](./demo/posters/opencode_change_logo.png)](./demo/opencode_change_logo.webm) |
| Generate and run an LED traffic light flow through the OpenCode + DBT-Agent workflow. | Update the device logo through the OpenCode + DBT-Agent workflow. |

Direct video links:

- [OpenCode LED traffic light demo](./demo/opencode_led_traffic_light.webm)
- [OpenCode change logo demo](./demo/opencode_change_logo.webm)

## Plugin Details

OpenCode project details:

- [OpenCode plugin README](./opencode_plugin/README.md)

Codex project details:

- [Codex plugin README](./codex_plugin/README.md)

Additional repository-level background:

- [DBT-Agent-Plugins.md](./DBT-Agent-Plugins.md)

## Notes

- This repository keeps each platform plugin self-contained in its own directory.
- OpenCode demos are included now.
- Codex demo videos will be added after the demo assets are ready.
