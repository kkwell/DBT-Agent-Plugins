#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PACKAGE_ROOT="${SCRIPT_DIR}/package"
COMMON_SH="${PLUGIN_ROOT}/../scripts/installer_common.sh"

DEFAULT_OPENCODE_HOME="${HOME}/.config/opencode"
DEFAULT_MODULE_NAME="dbt-agent"
DEFAULT_PACKAGE_CACHE_DIR="${HOME}/.cache/opencode/packages/${DEFAULT_MODULE_NAME}@latest"
DEFAULT_STAGING_DIR=""
LEGACY_INSTALL_DIR="${DEFAULT_OPENCODE_HOME}/plugins/development-board-toolchain"
LEGACY_MODULE_DIR="${DEFAULT_OPENCODE_HOME}/node_modules/${DEFAULT_MODULE_NAME}"
DEFAULT_RUNTIME_ROOT="${HOME}/Library/development-board-toolchain/runtime"
DEFAULT_UPDATE_MANIFEST_URL="https://raw.githubusercontent.com/kkwell/DBT-Agent-Plugins/main/opencode-plugin-release-manifest.json"
DEFAULT_UPDATE_REPOSITORY="https://github.com/kkwell/DBT-Agent-Plugins.git"
DEFAULT_UPDATE_VERSION_URL="https://raw.githubusercontent.com/kkwell/DBT-Agent-Plugins/main/VERSION"

PACKAGE_CACHE_DIR="${DEFAULT_PACKAGE_CACHE_DIR}"
STAGING_DIR="${DEFAULT_STAGING_DIR}"
RUNTIME_ROOT="${DEFAULT_RUNTIME_ROOT}"
UPDATE_MANIFEST_URL="${DEFAULT_UPDATE_MANIFEST_URL}"
INSTALL_DIR_ARG=""
WITH_OPENCODE=0
FORCE=0
CHECK_ONLY=0
AUTO_STAGING_DIR=""

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
  --cache-dir <path>              OpenCode package cache directory
  --install-dir <path>            Deprecated alias for --cache-dir
  --staging-dir <path>            Local tarball staging directory
  --runtime-root <path>           Shared runtime root
  --manifest-url <url>            Override the remote update manifest URL
  --with-opencode                 Compatibility flag for remote updater
  --check-only                    Run environment checks without installing
  --force                         Overwrite existing package cache
  -h, --help                      Show this help
EOF
}

workspace_root_for_runtime() {
  local runtime_root="$1"
  printf '%s/workspaces' "$(dirname "${runtime_root}")"
}

module_install_dir() {
  local package_cache_dir="$1"
  printf '%s/node_modules/%s' "${package_cache_dir}" "${DEFAULT_MODULE_NAME}"
}

validate_release_layout() {
  require_dir "${PACKAGE_ROOT}" "release package not found: ${PACKAGE_ROOT}"
  require_file "${PACKAGE_ROOT}/index.js" "release entry not found: ${PACKAGE_ROOT}/index.js"
  require_file "${PACKAGE_ROOT}/package.json" "release package manifest not found: ${PACKAGE_ROOT}/package.json"
  require_file "${PACKAGE_ROOT}/postinstall.mjs" "release postinstall script not found: ${PACKAGE_ROOT}/postinstall.mjs"
  require_file "${PACKAGE_ROOT}/development-board-toolchain.runtime.template.json" \
    "runtime config template not found: ${PACKAGE_ROOT}/development-board-toolchain.runtime.template.json"
}

validate_environment() {
  require_macos
  require_command npm "npm is required to install the OpenCode package cache"
  validate_release_layout
  ensure_parent_dir "${PACKAGE_CACHE_DIR}"
  if [[ -n "${STAGING_DIR}" ]]; then
    ensure_parent_dir "${STAGING_DIR}"
  fi
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
  print_summary_line "module name" "${DEFAULT_MODULE_NAME}"
  print_summary_line "package cache" "${PACKAGE_CACHE_DIR}"
  print_summary_line "installed module" "$(module_install_dir "${PACKAGE_CACHE_DIR}")"
  if [[ -n "${STAGING_DIR}" ]]; then
    print_summary_line "staging dir" "${STAGING_DIR}"
  else
    print_summary_line "staging dir" "temporary"
  fi
  print_summary_line "runtime root" "${RUNTIME_ROOT}"
  print_summary_line "runtime status" "present"
  if [[ -e "${PACKAGE_CACHE_DIR}" && "${FORCE}" -ne 1 ]]; then
    warn "package cache directory already exists; rerun with --force to replace it"
  fi
  if [[ -e "${LEGACY_INSTALL_DIR}" ]]; then
    warn "legacy file-based plugin directory exists and will be removed on install: ${LEGACY_INSTALL_DIR}"
  fi
  if [[ -e "${LEGACY_MODULE_DIR}" ]]; then
    warn "legacy direct module copy exists and will be removed on install: ${LEGACY_MODULE_DIR}"
  fi
}

write_runtime_config() {
  local target="$1"
  local runtime_root_json
  local workspace_root_json

  runtime_root_json="$(json_escape "${RUNTIME_ROOT}")"
  workspace_root_json="$(json_escape "$(workspace_root_for_runtime "${RUNTIME_ROOT}")")"

  cat > "${target}" <<EOF
{
  "toolkitRoot": "${runtime_root_json}",
  "updateManifestURL": "${UPDATE_MANIFEST_URL}",
  "updateRepository": "${DEFAULT_UPDATE_REPOSITORY}",
  "updateVersionURL": "${DEFAULT_UPDATE_VERSION_URL}",
  "localAgentURL": "http://127.0.0.1:18082",
  "workspaceRoot": "${workspace_root_json}",
  "insightUploadEnabled": false
}
EOF
}

update_opencode_config() {
  local config_path="${DEFAULT_OPENCODE_HOME}/opencode.json"
  if [[ ! -f "${config_path}" ]]; then
    warn "OpenCode config was not found; skipping plugin entry update: ${config_path}"
    return
  fi

  node - "${config_path}" "${DEFAULT_MODULE_NAME}" "${LEGACY_INSTALL_DIR}" <<'NODE'
const fs = require("node:fs")

const [configPath, moduleName, legacyInstallDir] = process.argv.slice(2)

let data = {}
try {
  data = JSON.parse(fs.readFileSync(configPath, "utf8"))
} catch {
  data = {}
}

const plugins = Array.isArray(data.plugin) ? data.plugin : []
const legacySpecs = new Set([
  "./plugins/development-board-toolchain",
  "development-board-toolchain",
  "rk356x-toolkit",
  legacyInstallDir,
  `file://${legacyInstallDir}`,
])

const filtered = []
for (const entry of plugins) {
  if (typeof entry === "string" && (legacySpecs.has(entry) || entry.startsWith("file:"))) {
    continue
  }
  filtered.push(entry)
}
if (!filtered.includes(moduleName)) {
  filtered.push(moduleName)
}
data.plugin = filtered
fs.writeFileSync(configPath, `${JSON.stringify(data, null, 2)}\n`, "utf8")
NODE
}

cleanup_legacy_install_dir() {
  if [[ -e "${LEGACY_INSTALL_DIR}" ]]; then
    rm -rf "${LEGACY_INSTALL_DIR}"
  fi
}

cleanup_legacy_module_dir() {
  if [[ -e "${LEGACY_MODULE_DIR}" ]]; then
    rm -rf "${LEGACY_MODULE_DIR}"
  fi
}

cleanup_opencode_project_dependency_state() {
  local config_root="${DEFAULT_OPENCODE_HOME}"
  local package_json="${config_root}/package.json"
  if [[ ! -f "${package_json}" ]]; then
    return
  fi

  if npm uninstall --prefix "${config_root}" --silent --no-fund --no-audit \
    dbt-agent development-board-toolchain development-board-toolchain-opencode-plugin rk356x-toolkit >/dev/null 2>&1; then
    :
  fi

  rm -rf \
    "${config_root}/node_modules/dbt-agent" \
    "${config_root}/node_modules/development-board-toolchain" \
    "${config_root}/plugins/development-board-toolchain" \
    "${config_root}/plugins/rk356x-toolkit"
}

pack_release_tarball() {
  local tarball_name
  local stage_dir="${STAGING_DIR}"

  if [[ -z "${stage_dir}" ]]; then
    stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/dbt-opencode-plugin-stage.XXXXXX")"
    AUTO_STAGING_DIR="${stage_dir}"
  fi

  mkdir -p "${stage_dir}"
  tarball_name="$(npm pack "${PACKAGE_ROOT}" --silent --pack-destination "${stage_dir}" | tail -n 1)"
  [[ -n "${tarball_name}" ]] || fail "failed to create package tarball"
  printf '%s/%s' "${stage_dir}" "${tarball_name}"
}

install_package_cache() {
  local tarball_path="$1"
  local target_module_dir
  local temp_extract_dir
  local extracted_package_dir

  target_module_dir="$(module_install_dir "${PACKAGE_CACHE_DIR}")"
  temp_extract_dir="$(mktemp -d "${TMPDIR:-/tmp}/dbt-opencode-cache.XXXXXX")"

  mkdir -p "${PACKAGE_CACHE_DIR}/node_modules"
  tar -xzf "${tarball_path}" -C "${temp_extract_dir}"
  extracted_package_dir="${temp_extract_dir}/package"
  [[ -d "${extracted_package_dir}" ]] || fail "failed to unpack plugin tarball: ${tarball_path}"

  rm -rf "${target_module_dir}"
  mkdir -p "${target_module_dir}"
  rsync -aH --delete "${extracted_package_dir}/" "${target_module_dir}/"
  (
    cd "${target_module_dir}"
    npm install --no-package-lock --silent --omit=dev
  )
  rm -f \
    "${PACKAGE_CACHE_DIR}/package.json" \
    "${PACKAGE_CACHE_DIR}/package-lock.json" \
    "${PACKAGE_CACHE_DIR}/node_modules/.package-lock"
  rm -rf "${temp_extract_dir}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cache-dir)
      PACKAGE_CACHE_DIR="$2"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR_ARG="$2"
      shift 2
      ;;
    --staging-dir)
      STAGING_DIR="$2"
      shift 2
      ;;
    --runtime-root)
      RUNTIME_ROOT="$2"
      shift 2
      ;;
    --manifest-url)
      UPDATE_MANIFEST_URL="$2"
      shift 2
      ;;
    --with-opencode)
      WITH_OPENCODE=1
      shift
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

if [[ -n "${INSTALL_DIR_ARG}" ]]; then
  if [[ "${WITH_OPENCODE}" -eq 1 ]]; then
    RUNTIME_ROOT="${INSTALL_DIR_ARG}"
  else
    PACKAGE_CACHE_DIR="${INSTALL_DIR_ARG}"
  fi
fi

validate_environment
print_environment_summary

if [[ "${CHECK_ONLY}" -eq 1 ]]; then
  exit 0
fi

if [[ -e "${PACKAGE_CACHE_DIR}" ]]; then
  if [[ "${FORCE}" -ne 1 ]]; then
    echo "package cache directory already exists: ${PACKAGE_CACHE_DIR}" >&2
    echo "rerun with --force to overwrite" >&2
    exit 1
  fi
  rm -rf "${PACKAGE_CACHE_DIR}"
fi

if [[ -n "${STAGING_DIR}" && -e "${STAGING_DIR}" && "${FORCE}" -eq 1 ]]; then
  rm -rf "${STAGING_DIR}"
fi

TARBALL_PATH="$(pack_release_tarball)"
install_package_cache "${TARBALL_PATH}"

INSTALL_DIR="$(module_install_dir "${PACKAGE_CACHE_DIR}")"
RUNTIME_CONFIG="${INSTALL_DIR}/development-board-toolchain.runtime.json"
write_runtime_config "${RUNTIME_CONFIG}"

require_file "${RUNTIME_CONFIG}" "runtime config was not written: ${RUNTIME_CONFIG}"
update_opencode_config
cleanup_legacy_install_dir
cleanup_legacy_module_dir
cleanup_opencode_project_dependency_state
if [[ -n "${AUTO_STAGING_DIR}" ]]; then
  rm -rf "${AUTO_STAGING_DIR}"
fi

echo "installed OpenCode plugin module (${DEFAULT_MODULE_NAME}) to: ${INSTALL_DIR}"
echo "OpenCode package cache: ${PACKAGE_CACHE_DIR}"
if [[ -n "${STAGING_DIR}" ]]; then
  echo "local package tarball: ${TARBALL_PATH}"
fi
echo "shared runtime: ${RUNTIME_ROOT}"
echo "next step: restart OpenCode and open a new session"
