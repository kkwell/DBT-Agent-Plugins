#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SOURCE_INDEX="${PLUGIN_ROOT}/source/index.js"
RELEASE_INDEX="${PLUGIN_ROOT}/release/package/index.js"

if [[ ! -f "${SOURCE_INDEX}" ]]; then
  echo "source plugin entry not found: ${SOURCE_INDEX}" >&2
  exit 1
fi

mkdir -p "$(dirname "${RELEASE_INDEX}")"
cp "${SOURCE_INDEX}" "${RELEASE_INDEX}"

echo "synced release/package/index.js from source/index.js"
