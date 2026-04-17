#!/bin/bash

RUNTIME_DOWNLOAD_URL="https://pan.baidu.com/s/1SVGvOmNEWLoALkf7Sfi0dQ?pwd=0001"
RUNTIME_DOWNLOAD_PASSWORD="0001"

fail() {
  echo "error: $*" >&2
  exit 1
}

warn() {
  echo "warning: $*" >&2
}

info() {
  echo "$*"
}

have_command() {
  command -v "$1" >/dev/null 2>&1
}

require_command() {
  local command_name="$1"
  local message="${2:-required command not found: ${command_name}}"
  have_command "${command_name}" || fail "${message}"
}

require_file() {
  local path="$1"
  local message="${2:-required file not found: ${path}}"
  [[ -f "${path}" ]] || fail "${message}"
}

require_dir() {
  local path="$1"
  local message="${2:-required directory not found: ${path}}"
  [[ -d "${path}" ]] || fail "${message}"
}

require_macos() {
  local platform
  platform="$(uname -s 2>/dev/null || echo unknown)"
  [[ "${platform}" == "Darwin" ]] || fail "this installer currently supports macOS only (detected: ${platform})"
}

ensure_parent_dir() {
  local path="$1"
  local parent
  parent="$(dirname "${path}")"
  mkdir -p "${parent}" || fail "unable to create directory: ${parent}"
  [[ -w "${parent}" ]] || fail "directory is not writable: ${parent}"
}

ensure_dir_writable() {
  local path="$1"
  mkdir -p "${path}" || fail "unable to create directory: ${path}"
  [[ -w "${path}" ]] || fail "directory is not writable: ${path}"
}

print_summary_line() {
  printf "  %-20s %s\n" "$1" "$2"
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "${value}"
}

print_runtime_download_instructions() {
  local runtime_root="$1"
  local extra_requirement="${2:-}"
  cat >&2 <<EOF
error: shared Development Board Toolchain support files are not ready at:
  ${runtime_root}

The DBT runtime support package is distributed as an offline package because it contains large
cross-compilers, board toolchains, and the shared local dbt-agentd. Download and install it
first, then rerun this installer.

Download link:
  ${RUNTIME_DOWNLOAD_URL}
Password:
  ${RUNTIME_DOWNLOAD_PASSWORD}

Expected runtime file:
  ${runtime_root}/dbtctl
EOF

  if [[ -n "${extra_requirement}" ]]; then
    cat >&2 <<EOF
Additional required file:
  ${extra_requirement}
EOF
  fi
}
