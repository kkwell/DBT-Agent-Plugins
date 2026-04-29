#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SOURCE_INDEX="${PLUGIN_ROOT}/source/index.js"
RELEASE_INDEX="${PLUGIN_ROOT}/release/package/index.js"
SOURCE_PACKAGE_JSON="${PLUGIN_ROOT}/source/package.json"
RELEASE_PACKAGE_JSON="${PLUGIN_ROOT}/release/package/package.json"
SOURCE_POSTINSTALL="${PLUGIN_ROOT}/source/postinstall.mjs"
RELEASE_POSTINSTALL="${PLUGIN_ROOT}/release/package/postinstall.mjs"
SOURCE_RUNTIME_TEMPLATE="${PLUGIN_ROOT}/source/development-board-toolchain.runtime.template.json"
RELEASE_RUNTIME_TEMPLATE="${PLUGIN_ROOT}/release/package/development-board-toolchain.runtime.template.json"
SOURCE_ASSETS="${PLUGIN_ROOT}/source/assets"
RELEASE_ASSETS="${PLUGIN_ROOT}/release/package/assets"

if [[ ! -f "${SOURCE_INDEX}" ]]; then
  echo "source plugin entry not found: ${SOURCE_INDEX}" >&2
  exit 1
fi

if [[ ! -f "${SOURCE_PACKAGE_JSON}" ]]; then
  echo "source package manifest not found: ${SOURCE_PACKAGE_JSON}" >&2
  exit 1
fi

if [[ ! -f "${SOURCE_POSTINSTALL}" ]]; then
  echo "source postinstall script not found: ${SOURCE_POSTINSTALL}" >&2
  exit 1
fi

if [[ ! -f "${SOURCE_RUNTIME_TEMPLATE}" ]]; then
  echo "source runtime template not found: ${SOURCE_RUNTIME_TEMPLATE}" >&2
  exit 1
fi

mkdir -p "$(dirname "${RELEASE_INDEX}")"
cp "${SOURCE_INDEX}" "${RELEASE_INDEX}"
cp "${SOURCE_PACKAGE_JSON}" "${RELEASE_PACKAGE_JSON}"
cp "${SOURCE_POSTINSTALL}" "${RELEASE_POSTINSTALL}"
cp "${SOURCE_RUNTIME_TEMPLATE}" "${RELEASE_RUNTIME_TEMPLATE}"
if [[ -d "${SOURCE_ASSETS}" ]]; then
  rm -rf "${RELEASE_ASSETS}"
  mkdir -p "${RELEASE_ASSETS}"
  cp -R "${SOURCE_ASSETS}/." "${RELEASE_ASSETS}/"
fi

echo "synced release/package artifacts from source/"
