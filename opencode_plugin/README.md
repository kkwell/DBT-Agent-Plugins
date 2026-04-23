# OpenCode Plugin Project

This directory is the self-contained source-of-truth project for the DBT-Agent OpenCode plugin.

OpenCode package identity:

- package/module name: `dbt-agent`
- plugin display name: `DBT-Agent`
- description: `development-board-toolchain`

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
- and the shared local backend agent at:
- `~/Library/Application Support/development-board-toolchain/agent`
- board-family assets are resolved from:
  - `~/Library/Application Support/development-board-toolchain/families/`

The packaged OpenCode module is structured so OpenCode can install it by npm-style module name,
following the same packaging model used by projects such as `oh-my-openagent`.

That means:

- OpenCode plugin entry should be `dbt-agent`, not a local `file://...` directory path
- the plugin display/export id stays `DBT-Agent`
- a package `postinstall` step writes `development-board-toolchain.runtime.json` beside the module

The standalone installer remains available as a local fallback. It now installs the package in module
cache layout under `~/.cache/opencode/packages/dbt-agent@latest/node_modules/dbt-agent`, stages the
local tarball under `~/.config/opencode/vendor/dbt-agent`, and updates `opencode.json` to use the
module name instead of a file path.

All board operations must go through the shared local `dbt-agentd` HTTP API. The plugin must not run
source-checkout tools, query `dbtctl --help`, or call binaries under `DBT-Agent-Project` /
`docker-project` paths for normal OpenCode board control.

## Tool surface

The plugin exposes DBT tools for status, board discovery, capability context, environment checks,
RP2350 single-USB workflows, TaishanPi/Linux-board probes, USB ECM setup, logo updates, program
build/run, and image flashing.

Image flashing has two OpenCode paths:

- `dbt_flash_image` / `dbtflashimage`
  - blocking path for dry-run validation or short jobs; it calls `POST /v1/jobs/flash`, then polls
    `/v1/jobs/{job_id}` until completion.
- `dbt_start_flash_image` / `dbtflashstart` plus `dbt_get_job_status` / `dbtjobstatus`
  - non-blocking path for long real image downloads and full-board flashing; the start tool returns
    `job_id` immediately, and status polling returns `progress_percent`, `progress_stage`,
    `progress_text`, `status_label`, `output_tail`, terminal state, and failure summary.

For TaishanPi initialization-image requests, OpenCode should use the non-blocking path for real
flashing with `image_source=factory` and `scope=all` unless the user asks for a different image source
or partition scope. The daemon owns running/download-mode detection and the actual installed-runtime
flashing workflow.

Update operations are release-source based. In installed mode, local filesystem update sources are
rejected so the plugin cannot execute development-tree install scripts. Development-only local update
testing requires setting `DBT_OPENCODE_ALLOW_LOCAL_UPDATE_SOURCE=true` explicitly.

The installed plugin now resolves update metadata from the `DBT-Agent-Plugins` delivery repository:

- version source:
  - `../../VERSION`
- manifest source:
  - `../../opencode-plugin-release-manifest.json`
- repository fallback:
  - [DBT-Agent-Plugins](https://github.com/kkwell/DBT-Agent-Plugins)

After a newer version is pushed to that repository, OpenCode can use `dbt_check_plugin_update` and
`dbt_update_plugin` to refresh the installed OpenCode package from the repository release source.

By default the OpenCode tool surface is kept Gemini-safe: it exposes no-underscore alias tools such as
`dbtstatus`, `dbtflashimage`, `dbtflashstart`, `dbtjobstatus`, `dbtenvcheck`, `dbtboardconfig`, `dbtcapabilities`,
`dbtcpufrequency`, `dbtwirelessprobe`, `dbtwifiscan`, and `dbtbluetoothscan`. These aliases route to
the canonical local `dbt-agentd` APIs and avoid the Gemini/OpenCode issue where external plugin tool
ids containing underscores can produce empty model responses.

Performance note:

- `dbtstatus` now prefers cached `GET /v1/status/summary` data unless the prompt explicitly asks for a refresh/live status probe.
- `dbtcapabilities` and `dbtcapabilitycontext` resolve the connected board through the low-cost cached status path first, so knowledge-only questions do not block on an unnecessary live status refresh.

The canonical underscore tool ids remain available for development or compatibility sessions by
setting `DBT_OPENCODE_EXPOSE_ADVANCED_TOOLS=true` before launching OpenCode. Development-only dispatch
testing can also set `DBT_OPENCODE_TOOLSET=dispatch`.

## OpenCode Provider Certificate Errors

If Google/Gemini requests fail with `UNKNOWN_CERTIFICATE_VERIFICATION_ERROR`, that error occurs in the
OpenCode provider request before the model can call DBT tools. The DBT plugin cannot convert it into a
tool-level result inside the chat turn. On macOS, launch OpenCode with:

```bash
NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem opencode
```

If a product UI needs a friendlier certificate prompt, implement it in the OpenCode launcher/preflight
layer so it can run before provider initialization.

## Tool event reporting

OpenCode is responsible for reporting plugin-side transport failures, polling timeouts, and other local pre-runtime failures to `dbt-agentd` using the local tool-event protocol:

- [../../dbt-agentd/dbt-agentd-project/protocols/LOCAL_TOOL_EVENT_PROTOCOL.md](../../dbt-agentd/dbt-agentd-project/protocols/LOCAL_TOOL_EVENT_PROTOCOL.md)

The plugin must not upload these events directly to a remote server.

## Main files

- `source/index.js`
  - plugin source used for development
- `source/package.json`
  - authoritative npm/OpenCode package metadata
- `source/postinstall.mjs`
  - package postinstall hook that writes local runtime config beside the installed module
- `source/development-board-toolchain.runtime.template.json`
  - authoritative runtime config template for package installs
- `release/install.sh`
  - standalone installer that installs the module layout and rewrites `opencode.json` plugin entry to `dbt-agent`
- `release/manifest.json`
  - release metadata for the plugin package
- `release/package/index.js`
  - packaged plugin entry for distribution
- `release/package/package.json`
  - packaged npm/OpenCode module metadata
- `release/package/development-board-toolchain.runtime.template.json`
  - runtime config template shipped with the plugin
- `docs/installation.md`
  - operator install instructions
- `../scripts/build_release_archives.sh`
  - build end-user release archives with top-level install entry

## Maintenance rule

Do not add plugin implementation files outside this directory.

Future model work should start from this directory and the top-level entry document:

- `../DBT-Agent-Plugins.md`
