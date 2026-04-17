#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PLATFORM=""
PASS_ARGS=()

usage() {
  cat <<'EOF'
Usage: install.sh --platform <opencode|codex> [installer options]

Options:
  --platform <name>   Target platform plugin to install
  --list-platforms    Print supported platforms
  -h, --help          Show this help

Examples:
  /bin/bash ./release/install.sh --platform opencode --check-only
  /bin/bash ./release/install.sh --platform codex --force
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)
      PLATFORM="$2"
      shift 2
      ;;
    --list-platforms)
      echo "opencode"
      echo "codex"
      exit 0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      PASS_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ -z "${PLATFORM}" ]]; then
  echo "error: --platform is required" >&2
  usage >&2
  exit 1
fi

case "${PLATFORM}" in
  opencode)
    TARGET="${REPO_ROOT}/opencode_plugin/release/install.sh"
    ;;
  codex)
    TARGET="${REPO_ROOT}/codex_plugin/release/install.sh"
    ;;
  *)
    echo "error: unsupported platform: ${PLATFORM}" >&2
    usage >&2
    exit 1
    ;;
esac

exec /bin/bash "${TARGET}" "${PASS_ARGS[@]}"
