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

Preferred model after package publication:

```bash
opencode plugin dbt-agent
```

This installs the module by package name, so OpenCode no longer renders a local `file://...` plugin
path in the plugin list.

Local fallback for unpublished or offline testing:

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

The plugin module is installed to:

- `~/.cache/opencode/packages/dbt-agent@latest/node_modules/dbt-agent`

The OpenCode plugin entry written into `opencode.json` is:

- `dbt-agent`

The local tarball staged by the standalone installer is written to:

- `~/.config/opencode/vendor/dbt-agent`

The runtime config written beside the plugin is:

- `development-board-toolchain.runtime.json`

It points to the shared runtime root under Application Support.

## Runtime-Only Operation Rule

After installation, OpenCode should use only the installed runtime and local daemon:

- runtime: `~/Library/Application Support/development-board-toolchain/runtime`
- agent: `~/Library/Application Support/development-board-toolchain/agent`
- plugin module: `~/.cache/opencode/packages/dbt-agent@latest/node_modules/dbt-agent`

Board operations, including TaishanPi initialization-image flashing, must be performed through DBT
plugin tools backed by local `dbt-agentd`. OpenCode should not run `dbtctl --help`, shell out to
`dbtctl`, or use source-checkout paths under `DBT-Agent-Project` / `docker-project` for normal board
control.

For dry-run validation or short full image flashing, use the blocking `dbt_flash_image` tool. The tool
calls local `dbt-agentd` `POST /v1/jobs/flash` and polls `/v1/jobs/{job_id}` until completion.

For long real downloads and full-board flashing, use the non-blocking path:

1. `dbt_start_flash_image` / `dbtflashstart`
2. `dbt_get_job_status` / `dbtjobstatus` with the returned `job_id`

The status result includes `progress_percent`, `progress_stage`, `progress_text`, `status_label`,
`output_tail`, terminal state, and failure summary so the model can report progress while the job is
still running. Default TaishanPi initialization flashing uses:

```text
image_source=factory
scope=all
```

The default OpenCode tool surface is trimmed for Gemini tool-call reliability. It exposes
no-underscore alias tools that route to canonical `dbt-agentd` APIs, including `dbtstatus`,
`dbtflashimage`, `dbtflashstart`, `dbtjobstatus`, `dbtenvcheck`, `dbtboardconfig`, `dbtcapabilities`, `dbtcpufrequency`,
`dbtwirelessprobe`, `dbtwifiscan`, and `dbtbluetoothscan`. These aliases avoid the OpenCode/Gemini
empty-response behavior seen with external plugin tool ids that contain underscores.

For development or compatibility sessions that need the canonical underscore tool ids visible, launch
OpenCode with:

```bash
DBT_OPENCODE_EXPOSE_ADVANCED_TOOLS=true opencode
```

If Google/Gemini requests fail on macOS with `UNKNOWN_CERTIFICATE_VERIFICATION_ERROR`, launch OpenCode
with the system certificate bundle:

```bash
NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem opencode
```

This certificate error happens before the DBT plugin tools are called, so the plugin cannot show a
DBT-specific in-chat result for it. A GUI or launcher should run this preflight before starting
OpenCode if a friendlier user prompt is required.

## In-Chat Update Path

The installed OpenCode package records these update sources by default:

- manifest:
  - `https://raw.githubusercontent.com/kkwell/DBT-Agent-Plugins/main/opencode-plugin-release-manifest.json`
- version:
  - `https://raw.githubusercontent.com/kkwell/DBT-Agent-Plugins/main/VERSION`
- repository:
  - `https://github.com/kkwell/DBT-Agent-Plugins.git`

After a newer plugin version is pushed to that repository, OpenCode can check and apply updates in
chat with:

- `dbt_check_plugin_update`
- `dbt_update_plugin`

## Verify The Installation

- confirm the plugin module directory exists:
  - `~/.cache/opencode/packages/dbt-agent@latest/node_modules/dbt-agent`
- confirm `~/.config/opencode/opencode.json` contains:
  - `"dbt-agent"` in the `plugin` array
- confirm the runtime config exists:
  - `~/.cache/opencode/packages/dbt-agent@latest/node_modules/dbt-agent/development-board-toolchain.runtime.json`
- confirm the local installer staged the package tarball:
  - `~/.config/opencode/vendor/dbt-agent/`
- restart OpenCode and open a new session

## Troubleshooting

- if the installer says the runtime is missing, install the offline runtime package first, then rerun the installer
- if the package cache already exists, rerun with `--force`
- if OpenCode does not detect the plugin, restart OpenCode after installation
- if you want OpenCode to install this package by itself with `opencode plugin dbt-agent`, publish `dbt-agent` to npm first; before publication, use the standalone installer to seed the same cache layout locally
