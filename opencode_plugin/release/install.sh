#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PACKAGE_ROOT="${SCRIPT_DIR}/package"

DEFAULT_INSTALL_DIR="${HOME}/.config/opencode/plugins/development-board-toolchain"
DEFAULT_RUNTIME_ROOT="${HOME}/Library/Application Support/development-board-toolchain/runtime"

INSTALL_DIR="${DEFAULT_INSTALL_DIR}"
RUNTIME_ROOT="${DEFAULT_RUNTIME_ROOT}"
RUNTIME_BIN=""
RUNTIME_INSTALLER_URL="${DBT_RUNTIME_INSTALLER_URL:-}"
RUNTIME_MANIFEST_URL="${DBT_RUNTIME_MANIFEST_URL:-}"
FORCE=0

usage() {
  cat <<'EOF'
Usage: install.sh [options]

Options:
  --install-dir <path>            OpenCode plugin install directory
  --runtime-root <path>           Shared runtime root
  --runtime-installer-url <url>   Remote runtime installer URL
  --runtime-manifest-url <url>    Remote runtime manifest URL
  --force                         Overwrite existing plugin directory
  -h, --help                      Show this help
EOF
}

download_file() {
  local url="$1"
  local output="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$output"
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$url" "$output" <<'PY'
import sys
import urllib.request

url = sys.argv[1]
output = sys.argv[2]
with urllib.request.urlopen(url) as response:
    data = response.read()
with open(output, "wb") as fh:
    fh.write(data)
PY
  else
    echo "curl or python3 is required to download ${url}" >&2
    exit 1
  fi
}

install_runtime_if_needed() {
  RUNTIME_BIN="${RUNTIME_ROOT}/dbtctl"
  if [[ -x "${RUNTIME_BIN}" ]]; then
    return 0
  fi

  local temp_dir
  temp_dir="$(mktemp -d)"
  trap 'rm -rf "${temp_dir}"' EXIT

  local installer_path="${temp_dir}/runtime-install.sh"

  if [[ -n "${RUNTIME_INSTALLER_URL}" ]]; then
    download_file "${RUNTIME_INSTALLER_URL}" "${installer_path}"
  elif [[ -n "${RUNTIME_MANIFEST_URL}" ]]; then
    if command -v python3 >/dev/null 2>&1; then
      python3 - "${RUNTIME_MANIFEST_URL}" "${installer_path}" <<'PY'
import json
import sys
import urllib.request

manifest_url = sys.argv[1]
installer_path = sys.argv[2]

with urllib.request.urlopen(manifest_url) as response:
    manifest = json.loads(response.read().decode("utf-8"))

installer_url = manifest.get("installer_url") or manifest.get("installer_path")
if not installer_url:
    raise SystemExit("runtime manifest is missing installer_url")

with urllib.request.urlopen(installer_url) as response:
    data = response.read()

with open(installer_path, "wb") as fh:
    fh.write(data)
PY
    else
      echo "python3 is required to resolve runtime manifest URL" >&2
      exit 1
    fi
  else
    cat >&2 <<EOF
shared runtime not found at:
  ${RUNTIME_ROOT}

Install the runtime first, or rerun with one of:
  --runtime-installer-url <url>
  --runtime-manifest-url <url>
EOF
    exit 1
  fi

  chmod +x "${installer_path}"
  /bin/bash "${installer_path}" --force
  RUNTIME_BIN="${RUNTIME_ROOT}/dbtctl"

  if [[ ! -x "${RUNTIME_BIN}" ]]; then
    echo "runtime installation finished but dbtctl is still missing: ${RUNTIME_BIN}" >&2
    exit 1
  fi
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
    --runtime-installer-url)
      RUNTIME_INSTALLER_URL="$2"
      shift 2
      ;;
    --runtime-manifest-url)
      RUNTIME_MANIFEST_URL="$2"
      shift 2
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

install_runtime_if_needed

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
python3 - "${PACKAGE_ROOT}/development-board-toolchain.runtime.template.json" "${RUNTIME_CONFIG}" "${RUNTIME_ROOT}" <<'PY'
import json
import sys

template_path = sys.argv[1]
target_path = sys.argv[2]
runtime_root = sys.argv[3]

with open(template_path, "r", encoding="utf-8") as fh:
    config = json.load(fh)

config["toolkitRoot"] = runtime_root

with open(target_path, "w", encoding="utf-8") as fh:
    json.dump(config, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
PY

echo "installed OpenCode plugin to: ${INSTALL_DIR}"
echo "shared runtime: ${RUNTIME_ROOT}"
