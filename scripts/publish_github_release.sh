#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

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

git -C "${REPO_ROOT}" rev-parse "${TAG}" >/dev/null 2>&1 || git -C "${REPO_ROOT}" tag -a "${TAG}" -m "Release ${TAG}"
git -C "${REPO_ROOT}" push origin "${TAG}"

if gh release view "${TAG}" --repo kkwell/DBT-Agent-Plugins >/dev/null 2>&1; then
  gh release upload "${TAG}" "${DIST_ROOT}"/*.zip "${DIST_ROOT}"/*.tar.gz "${DIST_ROOT}/SHA256SUMS.txt" --clobber --repo kkwell/DBT-Agent-Plugins
  gh release edit "${TAG}" --notes-file "${NOTES_FILE}" --repo kkwell/DBT-Agent-Plugins
else
  gh release create "${TAG}" "${DIST_ROOT}"/*.zip "${DIST_ROOT}"/*.tar.gz "${DIST_ROOT}/SHA256SUMS.txt" \
    --title "DBT-Agent Plugins ${TAG}" \
    --notes-file "${NOTES_FILE}" \
    --repo kkwell/DBT-Agent-Plugins
fi

echo "published GitHub release: ${TAG}"
