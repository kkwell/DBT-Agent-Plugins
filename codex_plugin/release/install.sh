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
DEFAULT_RUNTIME_ROOT="${HOME}/Library/Application Support/development-board-toolchain/runtime"

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

validate_release_layout() {
  require_dir "${PACKAGE_ROOT}" "release package not found: ${PACKAGE_ROOT}"
  require_file "${MARKETPLACE_SOURCE}" "release marketplace not found: ${MARKETPLACE_SOURCE}"
  require_file "${PACKAGE_ROOT}/.codex-plugin/plugin.json" \
    "plugin manifest not found: ${PACKAGE_ROOT}/.codex-plugin/plugin.json"
  require_file "${PACKAGE_ROOT}/.mcp.json" "plugin MCP config not found: ${PACKAGE_ROOT}/.mcp.json"
  require_file "${PACKAGE_ROOT}/scripts/dbt_agent_mcp.py" \
    "plugin MCP wrapper not found: ${PACKAGE_ROOT}/scripts/dbt_agent_mcp.py"
}

validate_environment() {
  require_macos
  require_command python3 "python3 is required by the Codex plugin to launch scripts/dbt_agent_mcp.py"
  validate_release_layout
  ensure_parent_dir "${INSTALL_DIR}"
  ensure_parent_dir "${MARKETPLACE_PATH}"
  ensure_parent_dir "${RUNTIME_ROOT}"

  if [[ ! -d "${DEFAULT_CODEX_HOME}" ]]; then
    warn "Codex home was not found: ${DEFAULT_CODEX_HOME}"
    warn "the installer will still continue, but launching Codex once before install is recommended"
  fi

  local runtime_mcp_script="${RUNTIME_ROOT}/editor_plugins/codex/scripts/dbt_agent_mcp.py"
  if [[ ! -x "${RUNTIME_ROOT}/dbtctl" ]]; then
    print_runtime_download_instructions "${RUNTIME_ROOT}" "${runtime_mcp_script}"
    exit 1
  fi

  if [[ ! -f "${runtime_mcp_script}" ]]; then
    print_runtime_download_instructions "${RUNTIME_ROOT}" "${runtime_mcp_script}"
    exit 1
  fi
}

print_environment_summary() {
  info "environment checks passed for Codex plugin release"
  print_summary_line "platform" "codex"
  print_summary_line "install dir" "${INSTALL_DIR}"
  print_summary_line "marketplace" "${MARKETPLACE_PATH}"
  print_summary_line "runtime root" "${RUNTIME_ROOT}"
  print_summary_line "runtime status" "present"
  print_summary_line "python3" "$(command -v python3)"
  if [[ -e "${INSTALL_DIR}" && "${FORCE}" -ne 1 ]]; then
    warn "install directory already exists; rerun with --force to replace it"
  fi
}

write_runtime_mcp_config() {
  local target="$1"
  local runtime_root_json
  local script_path_json

  runtime_root_json="$(json_escape "${RUNTIME_ROOT}")"
  script_path_json="$(json_escape "${RUNTIME_ROOT}/editor_plugins/codex/scripts/dbt_agent_mcp.py")"

  cat > "${target}" <<EOF
{
  "mcpServers": {
    "dbt-agent": {
      "command": "python3",
      "args": [
        "${script_path_json}"
      ],
      "cwd": ".",
      "env": {
        "PYTHONUNBUFFERED": "1",
        "DBT_TOOLKIT_ROOT": "${runtime_root_json}",
        "RK356X_TOOLKIT_ROOT": "${runtime_root_json}",
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
echo "next step: restart Codex and confirm that DBT-Agent appears in the plugin list"
