#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RELEASE_ROOT="$(cd "${SCRIPT_DIR}" && pwd)"
PACKAGE_ROOT="${RELEASE_ROOT}/package"
MARKETPLACE_SOURCE="${RELEASE_ROOT}/marketplace.json"
COMMON_SH="${RELEASE_ROOT}/../../scripts/installer_common.sh"

DEFAULT_CODEX_HOME="${HOME}/.codex"
DEFAULT_PLUGIN_ROOT="${DEFAULT_CODEX_HOME}/.tmp/plugins"
DEFAULT_INSTALL_DIR="${DEFAULT_PLUGIN_ROOT}/plugins/dbt-agent"
DEFAULT_MARKETPLACE_PATH="${DEFAULT_PLUGIN_ROOT}/.agents/plugins/marketplace.json"
DEFAULT_SUPPORT_ROOT="${HOME}/Library/Application Support/development-board-toolchain"
DEFAULT_RUNTIME_ROOT="${DEFAULT_SUPPORT_ROOT}/runtime"

INSTALL_DIR="${DEFAULT_INSTALL_DIR}"
MARKETPLACE_PATH="${DEFAULT_MARKETPLACE_PATH}"
RUNTIME_ROOT="${DEFAULT_RUNTIME_ROOT}"
FORCE=0
CHECK_ONLY=0

if [[ ! -f "${COMMON_SH}" ]]; then
  echo "error: installer helper not found: ${COMMON_SH}" >&2
  exit 1
fi

# shellcheck source=../../scripts/installer_common.sh
source "${COMMON_SH}"

usage() {
  cat <<'EOF'
Usage: install.sh [options]

Options:
  --install-dir <path>            Codex plugin install directory
  --marketplace-path <path>       Codex local marketplace JSON path
  --runtime-root <path>           Shared runtime root
  --check-only                    Run environment checks without installing
  --force                         Overwrite existing plugin directory
  -h, --help                      Show this help
EOF
}

support_root_for_runtime() {
  dirname "$1"
}

agent_root_for_runtime() {
  local runtime_root="$1"
  printf '%s/agent' "$(support_root_for_runtime "${runtime_root}")"
}

agent_binary_for_runtime() {
  local runtime_root="$1"
  printf '%s/bin/dbt-agentd' "$(agent_root_for_runtime "${runtime_root}")"
}

agent_config_for_runtime() {
  local runtime_root="$1"
  printf '%s/config/dbt-agentd.local.json' "$(agent_root_for_runtime "${runtime_root}")"
}

validate_agent_mcp_server() {
  local agent_binary="$1"
  local agent_config="$2"
  local probe_input
  local probe_output

  probe_input="$(mktemp)"
  probe_output="$(mktemp)"

  cat > "${probe_input}" <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"dbt-agent-codex-installer","version":"1.0"}}}
EOF

  if ! perl -e '
      use strict;
      use warnings;
      use IPC::Open3;
      use Symbol qw(gensym);

      my ($binary, $config, $input_path, $output_path) = @ARGV;
      open my $in_fh, "<", $input_path or die "open input failed: $!";
      local $/;
      my $payload = <$in_fh>;
      close $in_fh;

      my $stderr = gensym();
      my $pid = open3(my $writer, my $reader, $stderr, $binary, "--mcp-serve", "--config", $config);
      print {$writer} $payload;
      close $writer;

      eval {
          local $SIG{ALRM} = sub { die "timeout\n"; };
          alarm 5;
          open my $out_fh, ">", $output_path or die "open output failed: $!";
          while (my $line = <$reader>) {
              print {$out_fh} $line;
              last if $line =~ /"result"\s*:/;
          }
          close $out_fh;
          alarm 0;
      };

      my $error = $@;
      close $reader;
      close $stderr;
      waitpid($pid, 0);

      if ($error) {
          exit 1;
      }

      exit 0;
    ' "${agent_binary}" "${agent_config}" "${probe_input}" "${probe_output}"; then
    rm -f "${probe_input}" "${probe_output}"
    fail "shared dbt-agentd does not respond to '--mcp-serve'; update the offline runtime package from ${RUNTIME_DOWNLOAD_URL}"
  fi

  if ! grep -q '"serverInfo"' "${probe_output}"; then
    rm -f "${probe_input}" "${probe_output}"
    fail "shared dbt-agentd MCP probe failed; update the offline runtime package from ${RUNTIME_DOWNLOAD_URL}"
  fi

  rm -f "${probe_input}" "${probe_output}"
}

validate_release_layout() {
  require_dir "${PACKAGE_ROOT}" "release package not found: ${PACKAGE_ROOT}"
  require_file "${MARKETPLACE_SOURCE}" "release marketplace not found: ${MARKETPLACE_SOURCE}"
  require_file "${PACKAGE_ROOT}/.codex-plugin/plugin.json" \
    "plugin manifest not found: ${PACKAGE_ROOT}/.codex-plugin/plugin.json"
  require_file "${PACKAGE_ROOT}/.mcp.json" "plugin MCP config not found: ${PACKAGE_ROOT}/.mcp.json"
}

validate_environment() {
  local agent_binary
  local agent_config

  require_macos
  validate_release_layout
  ensure_parent_dir "${INSTALL_DIR}"
  ensure_parent_dir "${MARKETPLACE_PATH}"
  ensure_parent_dir "${RUNTIME_ROOT}"

  if [[ ! -d "${DEFAULT_CODEX_HOME}" ]]; then
    warn "Codex home was not found: ${DEFAULT_CODEX_HOME}"
    warn "the installer will still continue, but launching Codex once before install is recommended"
  fi

  agent_binary="$(agent_binary_for_runtime "${RUNTIME_ROOT}")"
  agent_config="$(agent_config_for_runtime "${RUNTIME_ROOT}")"

  if [[ ! -x "${RUNTIME_ROOT}/dbtctl" ]]; then
    print_runtime_download_instructions "${RUNTIME_ROOT}" "${agent_binary}"
    exit 1
  fi

  if [[ ! -x "${agent_binary}" ]]; then
    print_runtime_download_instructions "${RUNTIME_ROOT}" "${agent_binary}"
    exit 1
  fi

  if [[ ! -f "${agent_config}" ]]; then
    print_runtime_download_instructions "${RUNTIME_ROOT}" "${agent_config}"
    exit 1
  fi

  validate_agent_mcp_server "${agent_binary}" "${agent_config}"
}

print_environment_summary() {
  local agent_root
  local agent_binary
  local agent_config

  agent_root="$(agent_root_for_runtime "${RUNTIME_ROOT}")"
  agent_binary="$(agent_binary_for_runtime "${RUNTIME_ROOT}")"
  agent_config="$(agent_config_for_runtime "${RUNTIME_ROOT}")"

  info "environment checks passed for Codex plugin release"
  print_summary_line "platform" "codex"
  print_summary_line "install dir" "${INSTALL_DIR}"
  print_summary_line "marketplace" "${MARKETPLACE_PATH}"
  print_summary_line "runtime root" "${RUNTIME_ROOT}"
  print_summary_line "agent root" "${agent_root}"
  print_summary_line "agent binary" "${agent_binary}"
  print_summary_line "agent config" "${agent_config}"
  print_summary_line "runtime status" "present (native MCP ready)"
  if [[ -e "${INSTALL_DIR}" && "${FORCE}" -ne 1 ]]; then
    warn "install directory already exists; rerun with --force to replace it"
  fi
}

write_runtime_mcp_config() {
  local target="$1"
  local runtime_root_json
  local agent_root
  local agent_binary
  local agent_config
  local agent_root_json
  local agent_binary_json
  local agent_config_json

  runtime_root_json="$(json_escape "${RUNTIME_ROOT}")"
  agent_root="$(agent_root_for_runtime "${RUNTIME_ROOT}")"
  agent_binary="$(agent_binary_for_runtime "${RUNTIME_ROOT}")"
  agent_config="$(agent_config_for_runtime "${RUNTIME_ROOT}")"
  agent_root_json="$(json_escape "${agent_root}")"
  agent_binary_json="$(json_escape "${agent_binary}")"
  agent_config_json="$(json_escape "${agent_config}")"

  cat > "${target}" <<EOF
{
  "mcpServers": {
    "dbt-agent": {
      "command": "${agent_binary_json}",
      "args": [
        "--mcp-serve",
        "--config",
        "${agent_config_json}"
      ],
      "cwd": ".",
      "env": {
        "DBT_TOOLKIT_ROOT": "${runtime_root_json}",
        "RK356X_TOOLKIT_ROOT": "${runtime_root_json}",
        "DBT_AGENT_INSTALL_DIR": "${agent_root_json}",
        "DBT_TELEMETRY_SOURCE": "codex_plugin",
        "DBT_CLIENT_KIND": "codex_plugin"
      }
    }
  }
}
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --marketplace-path)
      MARKETPLACE_PATH="$2"
      shift 2
      ;;
    --runtime-root)
      RUNTIME_ROOT="$2"
      shift 2
      ;;
    --check-only)
      CHECK_ONLY=1
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

validate_environment
print_environment_summary

if [[ "${CHECK_ONLY}" -eq 1 ]]; then
  exit 0
fi

if [[ -e "${INSTALL_DIR}" ]]; then
  if [[ "${FORCE}" -ne 1 ]]; then
    echo "install directory already exists: ${INSTALL_DIR}" >&2
    echo "rerun with --force to overwrite" >&2
    exit 1
  fi
  rm -rf "${INSTALL_DIR}"
fi

mkdir -p "${INSTALL_DIR}"
mkdir -p "$(dirname "${MARKETPLACE_PATH}")"
rm -rf "$(dirname "${INSTALL_DIR}")/development-board-toolchain" "$(dirname "${INSTALL_DIR}")/rk356x-mac-toolkit"
cp -R "${PACKAGE_ROOT}/." "${INSTALL_DIR}/"
cp "${MARKETPLACE_SOURCE}" "${MARKETPLACE_PATH}"

write_runtime_mcp_config "${INSTALL_DIR}/.mcp.json"

require_file "${INSTALL_DIR}/.mcp.json" "Codex MCP config was not written: ${INSTALL_DIR}/.mcp.json"
require_file "${MARKETPLACE_PATH}" "Codex marketplace entry was not written: ${MARKETPLACE_PATH}"

echo "installed Codex plugin to: ${INSTALL_DIR}"
echo "local marketplace: ${MARKETPLACE_PATH}"
echo "shared runtime: ${RUNTIME_ROOT}"
echo "shared agent: $(agent_root_for_runtime "${RUNTIME_ROOT}")"
echo "next step: restart Codex and confirm that DBT-Agent appears in the plugin list"
