#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT_ROOT="$(cd "${REPO_ROOT}/.." && pwd)"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh is required to publish GitHub releases" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "error: gh is not authenticated. Run 'gh auth login' first." >&2
  exit 1
fi

"/bin/bash" "${SCRIPT_DIR}/build_release_archives.sh"

VERSION="$(
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${REPO_ROOT}/release/manifest.json" | head -n 1
)"

if [[ -z "${VERSION}" ]]; then
  echo "error: unable to read version from ${REPO_ROOT}/release/manifest.json" >&2
  exit 1
fi

TAG="v${VERSION}"
DIST_ROOT="${REPO_ROOT}/dist"
NOTES_FILE="${DIST_ROOT}/RELEASE_NOTES_v${VERSION}.md"
RUNTIME_ARCHIVE_PATH="${PROJECT_ROOT}/dbt-agentd/product_release/runtime/development-board-toolchain-runtime-${VERSION}.tar.gz"
AGENT_ARCHIVE_PATH="${PROJECT_ROOT}/dbt-agentd/product_release/agent/dbt-agentd-macos-arm64-${VERSION}.tar.gz"
BOARD_ENV_ARCHIVE_PATHS=(
  "${PROJECT_ROOT}/dbt-agentd/product_release/board_environments/RP2350RuntimeCore/dbt-rp2350-runtime-core-${VERSION}.tar.gz"
  "${PROJECT_ROOT}/dbt-agentd/product_release/board_environments/RP2350SDKCore/dbt-rp2350-sdk-core-${VERSION}.tar.gz"
  "${PROJECT_ROOT}/dbt-agentd/product_release/board_environments/RP2350BuildOverlay/dbt-rp2350-full-build-${VERSION}.tar.gz"
)
ASSETS=(
  "${DIST_ROOT}/DBT-Agent-OpenCode-v${VERSION}.zip"
  "${DIST_ROOT}/DBT-Agent-OpenCode-v${VERSION}.tar.gz"
  "${DIST_ROOT}/DBT-Agent-Codex-v${VERSION}.zip"
  "${DIST_ROOT}/DBT-Agent-Codex-v${VERSION}.tar.gz"
  "${DIST_ROOT}/SHA256SUMS.txt"
)

if [[ -f "${RUNTIME_ARCHIVE_PATH}" ]]; then
  ASSETS+=("${RUNTIME_ARCHIVE_PATH}")
fi
if [[ -f "${AGENT_ARCHIVE_PATH}" ]]; then
  ASSETS+=("${AGENT_ARCHIVE_PATH}")
fi
for archive_path in "${BOARD_ENV_ARCHIVE_PATHS[@]}"; do
  if [[ -f "${archive_path}" ]]; then
    ASSETS+=("${archive_path}")
  fi
done

for asset in "${ASSETS[@]}"; do
  if [[ ! -f "${asset}" ]]; then
    echo "error: release asset missing: ${asset}" >&2
    exit 1
  fi
done

git -C "${REPO_ROOT}" rev-parse "${TAG}" >/dev/null 2>&1 || git -C "${REPO_ROOT}" tag -a "${TAG}" -m "Release ${TAG}"
git -C "${REPO_ROOT}" push origin "${TAG}"

if gh release view "${TAG}" --repo kkwell/DBT-Agent-Plugins >/dev/null 2>&1; then
  gh release upload "${TAG}" "${ASSETS[@]}" --clobber --repo kkwell/DBT-Agent-Plugins
  gh release edit "${TAG}" --notes-file "${NOTES_FILE}" --repo kkwell/DBT-Agent-Plugins
else
  gh release create "${TAG}" "${ASSETS[@]}" \
    --title "DBT-Agent Plugins ${TAG}" \
    --notes-file "${NOTES_FILE}" \
    --repo kkwell/DBT-Agent-Plugins
fi

echo "published GitHub release: ${TAG}"
