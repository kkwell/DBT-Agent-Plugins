#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_ROOT="${REPO_ROOT}/dist"
TMP_ROOT="${DIST_ROOT}/.tmp"

VERSION="$(
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${REPO_ROOT}/release/manifest.json" | head -n 1
)"

if [[ -z "${VERSION}" ]]; then
  echo "error: unable to read version from ${REPO_ROOT}/release/manifest.json" >&2
  exit 1
fi

RUNTIME_DOWNLOAD_URL="https://pan.baidu.com/s/1SVGvOmNEWLoALkf7Sfi0dQ?pwd=0001"
RUNTIME_DOWNLOAD_PASSWORD="0001"

rm -rf "${TMP_ROOT}"
mkdir -p "${TMP_ROOT}" "${DIST_ROOT}"

write_root_installer() {
  local target="$1"
  local inner_installer="$2"
  cat > "${target}" <<EOF
#!/bin/bash
set -euo pipefail

SCRIPT_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
exec /bin/bash "\${SCRIPT_DIR}/${inner_installer}" "\$@"
EOF
  chmod +x "${target}"
}

write_root_command() {
  local target="$1"
  cat > "${target}" <<'EOF'
#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec /bin/bash "${SCRIPT_DIR}/install.sh" "$@"
EOF
  chmod +x "${target}"
}

write_root_readme() {
  local target="$1"
  local platform_label="$2"
  local runtime_note="$3"
  cat > "${target}" <<EOF
# DBT-Agent ${platform_label} Installer

This archive is the end-user install package for the DBT-Agent ${platform_label} plugin.

## Install

1. Install the shared Development Board Toolchain runtime support package first.
2. Double-click \`install.command\`, or run \`/bin/bash ./install.sh --check-only\`.
3. If the check passes, run \`/bin/bash ./install.sh --force\`.

## Runtime Package

- Download: ${RUNTIME_DOWNLOAD_URL}
- Password: \`${RUNTIME_DOWNLOAD_PASSWORD}\`
- ${runtime_note}

## Files In This Archive

- \`install.sh\`
  - terminal install entry
- \`install.command\`
  - Finder double-click install entry on macOS
- platform release payload
  - internal files used by the installer
EOF
}

build_platform_archive() {
  local platform="$1"
  local archive_name="$2"
  local platform_label="$3"
  local inner_root="$4"
  local inner_installer="$5"
  local docs_source="$6"
  local runtime_note="$7"
  local stage_dir="${TMP_ROOT}/${archive_name}"
  local zip_path="${DIST_ROOT}/${archive_name}.zip"
  local tar_path="${DIST_ROOT}/${archive_name}.tar.gz"

  rm -rf "${stage_dir}"
  mkdir -p "${stage_dir}" "${stage_dir}/scripts"

  cp "${REPO_ROOT}/scripts/installer_common.sh" "${stage_dir}/scripts/installer_common.sh"
  mkdir -p "${stage_dir}/$(dirname "${inner_root}")"
  cp -R "${REPO_ROOT}/${inner_root}" "${stage_dir}/${inner_root}"
  mkdir -p "${stage_dir}/$(dirname "${docs_source}")"
  cp "${REPO_ROOT}/${docs_source}" "${stage_dir}/${docs_source}"

  write_root_installer "${stage_dir}/install.sh" "${inner_installer}"
  write_root_command "${stage_dir}/install.command"
  write_root_readme "${stage_dir}/README.md" "${platform_label}" "${runtime_note}"
  printf '%s\n' "${VERSION}" > "${stage_dir}/VERSION"

  rm -f "${zip_path}" "${tar_path}"
  (
    cd "${TMP_ROOT}"
    COPYFILE_DISABLE=1 /usr/bin/zip -qry -X "${zip_path}" "${archive_name}"
  )
  tar -czf "${tar_path}" -C "${TMP_ROOT}" "${archive_name}"

  printf '%s\n' "${zip_path}"
  printf '%s\n' "${tar_path}"
}

OPENCODE_ARCHIVE="DBT-Agent-OpenCode-v${VERSION}"
CODEX_ARCHIVE="DBT-Agent-Codex-v${VERSION}"

build_platform_archive \
  "opencode" \
  "${OPENCODE_ARCHIVE}" \
  "OpenCode" \
  "opencode_plugin/release" \
  "opencode_plugin/release/install.sh" \
  "opencode_plugin/docs/installation.md" \
  "The runtime support package contains the shared runtime, board toolchains, and local dbt-agentd."

build_platform_archive \
  "codex" \
  "${CODEX_ARCHIVE}" \
  "Codex" \
  "codex_plugin/release" \
  "codex_plugin/release/install.sh" \
  "codex_plugin/docs/installation.md" \
  "The runtime support package contains the shared runtime, local dbt-agentd, and Codex uses dbt-agentd directly."

(
  cd "${DIST_ROOT}"
  shasum -a 256 "${OPENCODE_ARCHIVE}.zip" "${OPENCODE_ARCHIVE}.tar.gz" "${CODEX_ARCHIVE}.zip" "${CODEX_ARCHIVE}.tar.gz" > SHA256SUMS.txt
)

cat > "${DIST_ROOT}/RELEASE_NOTES_v${VERSION}.md" <<EOF
# DBT-Agent Plugins v${VERSION}

Assets:

- ${OPENCODE_ARCHIVE}.zip
- ${OPENCODE_ARCHIVE}.tar.gz
- ${CODEX_ARCHIVE}.zip
- ${CODEX_ARCHIVE}.tar.gz

Each archive is platform-specific and includes a top-level \`install.sh\` and \`install.command\`.
Users only need to download the matching platform archive, extract it, and run the top-level installer.
EOF

echo "built release archives under: ${DIST_ROOT}"
