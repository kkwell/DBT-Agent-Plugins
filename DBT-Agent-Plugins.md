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
- TaishanPi/Linux-board factory image flashing through `dbt_flash_image` and non-blocking `dbt_start_flash_image` + `dbt_get_job_status`
- plugin update checks and runtime-aware installation
- structured tool-failure reporting through `dbt-agentd`

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

- `~/Library/development-board-toolchain/runtime`
- board-family assets resolve from:
  - `~/Library/development-board-toolchain/families/`

Platform plugins themselves install into platform-specific client directories.

For OpenCode:

- plugin package/module:
  - `dbt-agent`
- installed module directory:
  - `~/.cache/opencode/packages/dbt-agent@latest/node_modules/dbt-agent`
- local fallback tarball staging:
  - `~/.config/opencode/vendor/dbt-agent`
- repository-driven update sources:
  - `VERSION`
  - `opencode-plugin-release-manifest.json`
  - `https://github.com/kkwell/DBT-Agent-Plugins.git`
- shared runtime:
  - `~/Library/development-board-toolchain/runtime`

The OpenCode plugin should present itself as:

- plugin display name:
  - `Embed Labs`
- plugin description:
  - `development-board-toolchain`

OpenCode board operations are installed-runtime only. The plugin must call local `dbt-agentd`
tools and runtime files under `~/Library/development-board-toolchain`; it must not use `DBT-Agent-Project`,
`docker-project`, or source-checkout `dbtctl` paths for normal board control.
User-facing answers about board features, characteristics, supported functions, and coding constraints must be based on DBT runtime tool results and installed capability data. Maintainer source paths and local handoff documents are not user-visible product knowledge.

For TaishanPi initialization-image or full-board image flashing, OpenCode has two paths:

- blocking validation or short jobs:
  - `dbt_flash_image` / `dbtflashimage`
- long real downloads and flashing:
  - `dbt_start_flash_image` / `dbtflashstart` to create the local `POST /v1/jobs/flash` job
  - `dbt_get_job_status` / `dbtjobstatus` to poll `/v1/jobs/{job_id}` for `progress_percent`,
    `progress_stage`, `progress_text`, `status_label`, `output_tail`, terminal state, and failure summary

`dbt-agentd` owns running/download-mode detection and the actual flashing workflow.

The default OpenCode tool surface is intentionally trimmed for Gemini tool-call reliability. It exposes
no-underscore alias tools such as `dbtstatus`, `dbtflashimage`, `dbtflashstart`, `dbtjobstatus`,
`dbtenvcheck`, `dbtboardconfig`, `dbtcapabilities`, `dbtcpufrequency`, `dbtwirelessprobe`,
`dbtwifiscan`, and `dbtbluetoothscan`.
These aliases route to the canonical local `dbt-agentd` APIs and avoid the OpenCode/Gemini empty
response observed with external plugin tool ids containing underscores. Development sessions can
expose the canonical underscore tool ids with `DBT_OPENCODE_EXPOSE_ADVANCED_TOOLS=true`.

For responsiveness, `dbtstatus` and knowledge-only board resolution for `dbtcapabilities` prefer the
cached local status summary first; explicit refresh wording still routes to the live status path.

If OpenCode/Gemini reports `UNKNOWN_CERTIFICATE_VERIFICATION_ERROR`, the failure happens in the
provider request before DBT tools execute. The DBT plugin cannot emit a DBT-specific tool result in
that chat turn; launch OpenCode with `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem` or handle it in a
launcher/preflight UI.

## OpenCode install flow

1. Ensure the shared runtime is installed.
2. If `dbt-agent` is already published to npm, run:

```bash
opencode plugin dbt-agent
```

3. For local release testing before npm publication, run:

```bash
/bin/bash ./opencode_plugin/release/install.sh --force
```

4. Restart OpenCode and open a new session.

## Update responsibility

- shared runtime package:
  - distributed separately, but always installed into `~/Library/development-board-toolchain`
- OpenCode plugin:
  - distributed from `opencode_plugin/release/`
- board plugins:
  - distributed independently from their own release channel

## Release and update protocol

The platform plugin repository is the core update channel for model-facing DBT integrations:

- release repository:
  - `https://github.com/kkwell/DBT-Agent-Plugins.git`
- update manifest:
  - `opencode-plugin-release-manifest.json`
- release version:
  - one repository-level plugin release version must be shared by the OpenCode and Codex release manifests
- GUI release:
  - the macOS GUI is a separate optional convenience client
  - GUI packages use their own `toolkit-manifest.json` from the GUI release repository
  - GUI version changes must not be used to decide whether core plugin/runtime/board-environment updates are available

Board-family development environments stay offline and manual because they are large:

- `TaishanPi` users install the `TaishanPi` offline package when they need TaishanPi build/development support
- `ColorEasyPICO2` and `RaspberryPiPico2W` share the `RP2350` offline package when local C/C++ firmware builds are needed
- if a user later asks the model to use a different board family and the required environment is missing, the plugin/runtime should report the exact package family to download and install before continuing
- updated board-environment package versions can be advertised through the `DBT-Agent-Plugins` release manifest and GitHub release assets, but tools must not silently download large environments without the user explicitly taking the offline install step

## Failure telemetry rule

Structured tool-failure and tool-event collection follows the runtime protocol defined in:

- [../dbt-agentd/dbt-agentd-project/protocols/LOCAL_TOOL_EVENT_PROTOCOL.md](../dbt-agentd/dbt-agentd-project/protocols/LOCAL_TOOL_EVENT_PROTOCOL.md)

Platform plugins may submit structured local failures to `dbt-agentd`, but must not upload them directly to a remote server.

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
- TaishanPi Loader/download-mode switching through `dbt_reboot_loader`; this is a runtime-control tool path, not a capability lookup path
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

- `~/Library/development-board-toolchain/runtime`

When Codex exposes its generic local plugin mirror, and that mirror is still named `plugins`,
the local Codex plugin package installs into:

- `~/.codex/.tmp/plugins/plugins/dbt-agent`

And the marketplace entry is merged into:

- `~/.codex/.tmp/plugins/.agents/plugins/marketplace.json`

That marketplace identity must remain:

- marketplace `name`: `plugins`
- marketplace `interface.displayName`: `Plugins`
- plugin package `name`: `dbt-agent`
- plugin source path from the generic marketplace: `./plugins/dbt-agent`

If Codex refreshes `~/.codex/.tmp/plugins/.agents/plugins/marketplace.json` as the official
`openai-curated` marketplace, do not write DBT-Agent there. Use the stable home-local
marketplace instead:

- `~/.agents/plugins/marketplace.json`
- marketplace `name`: `plugins`
- plugin source path: `./.codex/plugins/dbt-agent`

Fallback for older Codex layouts without the generic marketplace is still the home-local marketplace:

- `~/.agents/plugins/marketplace.json`
- marketplace `name`: `plugins`
- plugin source path: `./.codex/plugins/dbt-agent`

Do not use the old long marketplace name `local-development-board-marketplace`; it can overflow or cover the plugin title in Codex's plugin card UI.
Do not rename Codex's generic `plugins` marketplace to `Embed Labs`; that creates a separate product-specific dropdown category and can label unrelated plugins incorrectly.

## Brand assets

Plugin logo assets are sourced from the project-level `logo/` directory.

- light UI icon source: `logo/embed-labs-logo-light.png`
- dark UI icon source: `logo/embed-labs-logo-dark.png`
- English wordmark source: `logo/embed-labs-wordmark.svg`

Codex requires the same icon payload in the root plugin assets and in each local skill assets folder:

- `codex_plugin/source/plugin/assets/`
- `codex_plugin/source/plugin/skills/dbt-agent/assets/`
- `codex_plugin/source/plugin/skills/taishanpi/assets/`
- `codex_plugin/source/plugin/skills/rp2350/assets/`

OpenCode packages the same brand assets under `opencode_plugin/source/assets/`; `package.json`
must include `assets` so the release package carries the logo files.

## Codex install flow

1. Ensure the shared runtime is installed.
2. Run:

```bash
/bin/bash ./codex_plugin/release/install.sh --force
```

3. Restart Codex.
4. Open the plugin list and use `Embed Labs`.

Expected installed state on current Codex:

- `~/.agents/plugins/marketplace.json` keeps `name=plugins` and contains one `dbt-agent` entry when the Codex temporary marketplace is `openai-curated`
- `~/.codex/config.toml` contains only `[plugins."dbt-agent@plugins"]` for Embed Labs
- `~/.codex/plugins/cache/plugins/dbt-agent/<version>` is the active Embed Labs plugin cache
- the official `openai-curated` marketplace has no DBT-Agent entry
- stale `dbt-agent-local/dbt-agent`, `openai-curated/dbt-agent`, and `local-development-board-marketplace/dbt-agent` caches are absent

## Codex CLI usage

Codex CLI uses the same installed local plugin and MCP bridge as Codex Desktop. Confirm the entry with:

```bash
codex mcp list
```

For terminal-driven TaishanPi Loader switching, ask Codex CLI to call the DBT tool directly:

```bash
codex exec -C /Users/kvell/kk-project/DBT-Agent-Project --skip-git-repo-check -s danger-full-access -m gpt-5.4-mini '使用 DBT-Agent 将当前 TaishanPi 切换到 Loader 模式。直接调用 dbt_reboot_loader，不要查 capability，不要运行 shell。完成后调用 dbt_current_board_status 确认 USB mode。'
```

Normal board operations must resolve to the installed runtime under `~/Library/development-board-toolchain/`, not to source-checkout binaries.
For user-facing questions such as “当前开发板有什么功能和特点”, “开发板有什么能力”, “当前开发板有什么能力”, and “这个开发板支持什么功能”, Codex should resolve the board if needed, call `dbt_list_capability_summaries`, and answer from DBT tool results and installed capability data, not from source-checkout docs. If a tool result contains a host path that is not needed for the answer, omit it; if a path must be shown, keep it under `~/Library/development-board-toolchain`.
For pin-header questions such as 40PIN, GPIO, PWM, UART, I2C, SPI, or pinmux, Codex follows the same rule: use DBT tools first, then installed published knowledge under `~/Library/development-board-toolchain/agent/{vault,registry}/published` only. Treat `pin_header_40pin` as reference-only; it can explain physical pin mapping and default mux labels, but runnable code/control answers require a published execution capability plus live board runtime evidence.

## Codex maintenance rule

Do not spread the Codex plugin across unrelated directories.

If a file belongs to the Codex plugin project, it must live under:

- `platform_plugin/codex_plugin/`
