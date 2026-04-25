# DBT-Agent Codex Plugin

This file describes the plugin payload itself.

For the full self-contained Codex plugin project, start from:

- `../../README.md`

Codex local plugin for the shared Development Board Toolchain runtime.

`DBT` is the short form of `Development Board Toolchain`. `DBT-Agent` is the Codex-facing plugin name.

## Canonical model

- Plugin install target: Codex plugin directory and local marketplace
- Execution target: `~/Library/development-board-toolchain/runtime`
- Backend agent: `~/Library/development-board-toolchain/agent`

The plugin is only a thin Codex integration package. GUI, OpenCode, and Codex all use the same shared runtime and local `dbt-agentd`.

## Covered boards

- `TaishanPi / 1M-RK3566`
- `TaishanPi / 1F-RK3566`
- `TaishanPi / 3M-RK3576`
- `ColorEasyPICO2`
- `RaspberryPiPico2W`

## Installed pieces

- `.codex-plugin/plugin.json`
- `.mcp.json`
- `skills/`

During real installation, `release/install.sh` rewrites `.mcp.json` so Codex calls the installed native `dbt-agent-mcp-bridge` under the shared runtime. The bridge owns MCP stdio behavior and talks to the local `dbt-agentd` service.

The generated `.mcp.json` now uses the schema-valid approval mode `auto`; older `always_allow` payloads are no longer emitted because newer Codex builds reject that enum during plugin MCP parsing. The MCP bridge advertises tool annotations such as `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` so clients can distinguish status/catalog reads from board state changes, flashing, or runtime updates.

MCP tool-call approval is ultimately enforced by the Codex client. DBT-Agent can provide accurate metadata and a schema-valid `.mcp.json`, but it cannot bypass a client prompt from inside the plugin. On local verification, Codex CLI `0.121.0` still cancelled non-interactive MCP tool calls in `codex exec` with `ResolveElicitation(... decision: Cancel)` after the plugin MCP config parsed successfully, so that remaining terminal CLI limitation is inside Codex's own MCP approval flow rather than the DBT-Agent install shape. If the Codex UI offers a remember/always-allow choice for the trusted local `dbt-agent` MCP server, use that UI-level trust setting for repeated local calls; destructive DBT tools should still stay promptable.
