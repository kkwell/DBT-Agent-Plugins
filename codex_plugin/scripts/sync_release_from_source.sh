#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SOURCE_PLUGIN="${PLUGIN_ROOT}/source/plugin"
SOURCE_MARKETPLACE="${PLUGIN_ROOT}/source/marketplace.json"
RELEASE_PLUGIN="${PLUGIN_ROOT}/release/package"
RELEASE_MARKETPLACE="${PLUGIN_ROOT}/release/marketplace.json"

if [[ ! -d "${SOURCE_PLUGIN}" ]]; then
  echo "source plugin directory not found: ${SOURCE_PLUGIN}" >&2
  exit 1
fi

if [[ ! -f "${SOURCE_MARKETPLACE}" ]]; then
  echo "source marketplace not found: ${SOURCE_MARKETPLACE}" >&2
  exit 1
fi

rm -rf "${RELEASE_PLUGIN}"
mkdir -p "${RELEASE_PLUGIN}"
cp -R "${SOURCE_PLUGIN}/." "${RELEASE_PLUGIN}/"
cp "${SOURCE_MARKETPLACE}" "${RELEASE_MARKETPLACE}"

echo "synced Codex release package from source/"
