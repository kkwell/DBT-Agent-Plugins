#!/bin/bash

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

check_download_support() {
  if have_command curl; then
    return 0
  fi
  if have_command python3; then
    return 0
  fi
  fail "runtime bootstrap requires curl or python3 to download remote installer assets"
}

print_summary_line() {
  printf "  %-20s %s\n" "$1" "$2"
}
