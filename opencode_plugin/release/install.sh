#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PACKAGE_ROOT="${SCRIPT_DIR}/package"
COMMON_SH="${PLUGIN_ROOT}/../scripts/installer_common.sh"

DEFAULT_INSTALL_DIR="${HOME}/.config/opencode/plugins/development-board-toolchain"
DEFAULT_OPENCODE_HOME="${HOME}/.config/opencode"
DEFAULT_RUNTIME_ROOT="${HOME}/Library/Application Support/development-board-toolchain/runtime"
DEFAULT_WORKSPACE_ROOT="${HOME}/Library/Application Support/development-board-toolchain/workspaces"

INSTALL_DIR="${DEFAULT_INSTALL_DIR}"
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
  --install-dir <path>            OpenCode plugin install directory
  --runtime-root <path>           Shared runtime root
  --check-only                    Run environment checks without installing
  --force                         Overwrite existing plugin directory
  -h, --help                      Show this help
EOF
}

validate_release_layout() {
  require_dir "${PACKAGE_ROOT}" "release package not found: ${PACKAGE_ROOT}"
  require_file "${PACKAGE_ROOT}/index.js" "release entry not found: ${PACKAGE_ROOT}/index.js"
  require_file "${PACKAGE_ROOT}/package.json" "release package manifest not found: ${PACKAGE_ROOT}/package.json"
  require_file "${PACKAGE_ROOT}/development-board-toolchain.runtime.template.json" \
    "runtime config template not found: ${PACKAGE_ROOT}/development-board-toolchain.runtime.template.json"
}

validate_environment() {
  require_macos
  validate_release_layout
  ensure_parent_dir "${INSTALL_DIR}"
  ensure_parent_dir "${RUNTIME_ROOT}"

  if [[ ! -d "${DEFAULT_OPENCODE_HOME}" ]]; then
    warn "OpenCode config root was not found: ${DEFAULT_OPENCODE_HOME}"
    warn "the installer will still continue, but starting OpenCode once before install is recommended"
  fi

  if [[ ! -x "${RUNTIME_ROOT}/dbtctl" ]]; then
    print_runtime_download_instructions "${RUNTIME_ROOT}"
    exit 1
  fi
}

print_environment_summary() {
  info "environment checks passed for OpenCode plugin release"
  print_summary_line "platform" "opencode"
  print_summary_line "install dir" "${INSTALL_DIR}"
  print_summary_line "runtime root" "${RUNTIME_ROOT}"
  print_summary_line "runtime status" "present"
  if [[ -e "${INSTALL_DIR}" && "${FORCE}" -ne 1 ]]; then
    warn "install directory already exists; rerun with --force to replace it"
  fi
}

write_runtime_config() {
  local target="$1"
  local runtime_root_json
  local workspace_root_json

  runtime_root_json="$(json_escape "${RUNTIME_ROOT}")"
  workspace_root_json="$(json_escape "${DEFAULT_WORKSPACE_ROOT}")"

  cat > "${target}" <<EOF
{
  "toolkitRoot": "${runtime_root_json}",
  "updateManifestURL": "https://raw.githubusercontent.com/kkwell/DBT-Agent/main/opencode-plugin-release-manifest.json",
  "updateRepository": "https://github.com/kkwell/DBT-Agent.git",
  "updateVersionURL": "https://raw.githubusercontent.com/kkwell/DBT-Agent/main/VERSION",
  "localAgentURL": "http://127.0.0.1:18082",
  "workspaceRoot": "${workspace_root_json}",
  "insightUploadEnabled": false
}
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir)
      INSTALL_DIR="$2"
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
cp -R "${PACKAGE_ROOT}/." "${INSTALL_DIR}/"

RUNTIME_CONFIG="${INSTALL_DIR}/development-board-toolchain.runtime.json"
write_runtime_config "${RUNTIME_CONFIG}"

require_file "${RUNTIME_CONFIG}" "runtime config was not written: ${RUNTIME_CONFIG}"

echo "installed OpenCode plugin to: ${INSTALL_DIR}"
echo "shared runtime: ${RUNTIME_ROOT}"
echo "next step: restart OpenCode and open a new session"
