#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RELEASE_ROOT="$(cd "${SCRIPT_DIR}" && pwd)"
PACKAGE_ROOT="${RELEASE_ROOT}/package"
MARKETPLACE_SOURCE="${RELEASE_ROOT}/marketplace.json"
COMMON_SH="${RELEASE_ROOT}/../../scripts/installer_common.sh"

DEFAULT_CODEX_HOME="${HOME}/.codex"
DEFAULT_PLUGIN_REPO="${DEFAULT_CODEX_HOME}/.tmp/plugins"
DEFAULT_PLUGIN_REPO_MARKETPLACE_PATH="${DEFAULT_PLUGIN_REPO}/.agents/plugins/marketplace.json"

codex_tmp_marketplace_name() {
  local marketplace_path="$1"
  perl -MJSON::PP -e '
      use strict;
      use warnings;
      my ($path) = @ARGV;
      open my $fh, "<", $path or exit 1;
      local $/;
      my $payload = eval { decode_json(<$fh>) } || exit 1;
      close $fh;
      print $payload->{name} // q{};
    ' "${marketplace_path}" 2>/dev/null || true
}

# Newer Codex builds use ~/.codex/.tmp/plugins for the official openai-curated
# marketplace. That directory is client-managed and can be refreshed at any time,
# so DBT-Agent must only use it when it is explicitly the generic local
# "plugins" marketplace. Otherwise use the stable home-local marketplace.
if [[ -f "${DEFAULT_PLUGIN_REPO_MARKETPLACE_PATH}" ]] && \
  [[ "$(codex_tmp_marketplace_name "${DEFAULT_PLUGIN_REPO_MARKETPLACE_PATH}")" == "plugins" ]]; then
  DEFAULT_MARKETPLACE_PATH="${DEFAULT_PLUGIN_REPO_MARKETPLACE_PATH}"
else
  DEFAULT_MARKETPLACE_PATH="${HOME}/.agents/plugins/marketplace.json"
fi
DEFAULT_SUPPORT_ROOT="${HOME}/Library/development-board-toolchain"
DEFAULT_RUNTIME_ROOT="${DEFAULT_SUPPORT_ROOT}/runtime"

INSTALL_DIR=""
MARKETPLACE_PATH="${DEFAULT_MARKETPLACE_PATH}"
RUNTIME_ROOT="${DEFAULT_RUNTIME_ROOT}"
FORCE=0
CHECK_ONLY=0
INSTALL_DIR_EXPLICIT=0

if [[ ! -f "${COMMON_SH}" ]]; then
  echo "error: installer helper not found: ${COMMON_SH}" >&2
  exit 1
fi

# shellcheck source=../../scripts/installer_common.sh
source "${COMMON_SH}"

usage() {
  cat <<'EOF'
Usage: install.sh [options]

Options:
  --install-dir <path>            Codex plugin install directory
  --marketplace-path <path>       Codex local marketplace JSON path
  --runtime-root <path>           Shared runtime root
  --check-only                    Run environment checks without installing
  --force                         Overwrite existing plugin directory
  -h, --help                      Show this help
EOF
}

support_root_for_runtime() {
  dirname "$1"
}

marketplace_root_for_path() {
  local marketplace_path="$1"
  dirname "$(dirname "$(dirname "${marketplace_path}")")"
}

default_install_dir_for_marketplace_path() {
  local marketplace_path="$1"
  local marketplace_root

  marketplace_root="$(marketplace_root_for_path "${marketplace_path}")"
  if [[ "${marketplace_root}" == "$(legacy_plugin_repo_root)" ]]; then
    printf '%s/plugins/dbt-agent' "${marketplace_root}"
  else
    printf '%s/.codex/plugins/dbt-agent' "${marketplace_root}"
  fi
}

validate_install_layout() {
  local marketplace_root

  marketplace_root="$(marketplace_root_for_path "${MARKETPLACE_PATH}")"
  case "${INSTALL_DIR}" in
    "${marketplace_root}"/*)
      ;;
    *)
      fail "install dir must live under marketplace root ${marketplace_root} so Codex can resolve the local plugin path"
      ;;
  esac
}

marketplace_source_path_for_install_dir() {
  local marketplace_root
  local relative_path

  marketplace_root="$(marketplace_root_for_path "${MARKETPLACE_PATH}")"
  relative_path="${INSTALL_DIR#${marketplace_root}/}"

  if [[ "${relative_path}" == "${INSTALL_DIR}" || -z "${relative_path}" ]]; then
    fail "failed to derive plugin source path from install dir ${INSTALL_DIR}"
  fi

  printf './%s' "${relative_path}"
}

agent_root_for_runtime() {
  local runtime_root="$1"
  printf '%s/agent' "$(support_root_for_runtime "${runtime_root}")"
}

agent_binary_for_runtime() {
  local runtime_root="$1"
  printf '%s/bin/dbt-agentd' "$(agent_root_for_runtime "${runtime_root}")"
}

agent_config_for_runtime() {
  local runtime_root="$1"
  printf '%s/config/dbt-agentd.local.json' "$(agent_root_for_runtime "${runtime_root}")"
}

bridge_binary_for_runtime() {
  local runtime_root="$1"
  printf '%s/editor_plugins/codex/bin/dbt-agent-mcp-bridge' "${runtime_root}"
}

validate_bridge_mcp_server() {
  local bridge_binary="$1"
  local agent_config="$2"
  local toolkit_root="$3"
  local agent_root="$4"
  local probe_input
  local probe_output

  probe_input="$(mktemp)"
  probe_output="$(mktemp)"

  cat > "${probe_input}" <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"dbt-agent-codex-installer","version":"1.0"}}}
EOF

  if ! perl -e '
      use strict;
      use warnings;
      use IPC::Open3;
      use Symbol qw(gensym);

      my ($binary, $config, $toolkit_root, $agent_root, $input_path, $output_path) = @ARGV;
      open my $in_fh, "<", $input_path or die "open input failed: $!";
      local $/;
      my $payload = <$in_fh>;
      close $in_fh;

      my $stderr = gensym();
      my $pid = open3(
          my $writer,
          my $reader,
          $stderr,
          $binary,
          "--config", $config,
          "--toolkit-root", $toolkit_root,
          "--agent-root", $agent_root
      );
      print {$writer} $payload;
      close $writer;

      eval {
          local $SIG{ALRM} = sub { die "timeout\n"; };
          alarm 5;
          open my $out_fh, ">", $output_path or die "open output failed: $!";
          while (my $line = <$reader>) {
              print {$out_fh} $line;
              last if $line =~ /"result"\s*:/;
          }
          close $out_fh;
          alarm 0;
      };

      my $error = $@;
      close $reader;
      close $stderr;
      waitpid($pid, 0);

      if ($error) {
          exit 1;
      }

      exit 0;
    ' "${bridge_binary}" "${agent_config}" "${toolkit_root}" "${agent_root}" "${probe_input}" "${probe_output}"; then
    rm -f "${probe_input}" "${probe_output}"
    fail "installed dbt-agent-mcp-bridge did not respond; update the offline runtime package from ${RUNTIME_DOWNLOAD_URL}"
  fi

  if ! grep -q '"serverInfo"' "${probe_output}"; then
    rm -f "${probe_input}" "${probe_output}"
    fail "installed dbt-agent-mcp-bridge probe failed; update the offline runtime package from ${RUNTIME_DOWNLOAD_URL}"
  fi

  rm -f "${probe_input}" "${probe_output}"
}

validate_release_layout() {
  require_dir "${PACKAGE_ROOT}" "release package not found: ${PACKAGE_ROOT}"
  require_file "${MARKETPLACE_SOURCE}" "release marketplace not found: ${MARKETPLACE_SOURCE}"
  require_file "${PACKAGE_ROOT}/.codex-plugin/plugin.json" \
    "plugin manifest not found: ${PACKAGE_ROOT}/.codex-plugin/plugin.json"
  require_file "${PACKAGE_ROOT}/.mcp.json" "plugin MCP config not found: ${PACKAGE_ROOT}/.mcp.json"
}

validate_environment() {
  local agent_binary
  local agent_config
  local agent_root
  local bridge_binary

  require_macos
  validate_release_layout
  validate_install_layout
  ensure_parent_dir "${INSTALL_DIR}"
  ensure_parent_dir "${MARKETPLACE_PATH}"
  ensure_parent_dir "${RUNTIME_ROOT}"

  if [[ ! -d "${DEFAULT_CODEX_HOME}" ]]; then
    warn "Codex home was not found: ${DEFAULT_CODEX_HOME}"
    warn "the installer will still continue, but launching Codex once before install is recommended"
  fi

  agent_binary="$(agent_binary_for_runtime "${RUNTIME_ROOT}")"
  agent_root="$(agent_root_for_runtime "${RUNTIME_ROOT}")"
  agent_config="$(agent_config_for_runtime "${RUNTIME_ROOT}")"
  bridge_binary="$(bridge_binary_for_runtime "${RUNTIME_ROOT}")"

  if [[ ! -x "${RUNTIME_ROOT}/dbtctl" ]]; then
    print_runtime_download_instructions "${RUNTIME_ROOT}" "${agent_binary}"
    exit 1
  fi

  if [[ ! -x "${agent_binary}" ]]; then
    print_runtime_download_instructions "${RUNTIME_ROOT}" "${agent_binary}"
    exit 1
  fi

  if [[ ! -x "${bridge_binary}" ]]; then
    print_runtime_download_instructions "${RUNTIME_ROOT}" "${bridge_binary}"
    exit 1
  fi

  if [[ ! -f "${agent_config}" ]]; then
    print_runtime_download_instructions "${RUNTIME_ROOT}" "${agent_config}"
    exit 1
  fi

  validate_bridge_mcp_server "${bridge_binary}" "${agent_config}" "${RUNTIME_ROOT}" "${agent_root}"
}

print_environment_summary() {
  local agent_root
  local agent_binary
  local agent_config
  local bridge_binary

  agent_root="$(agent_root_for_runtime "${RUNTIME_ROOT}")"
  agent_binary="$(agent_binary_for_runtime "${RUNTIME_ROOT}")"
  agent_config="$(agent_config_for_runtime "${RUNTIME_ROOT}")"
  bridge_binary="$(bridge_binary_for_runtime "${RUNTIME_ROOT}")"

  info "environment checks passed for Codex plugin release"
  print_summary_line "platform" "codex"
  print_summary_line "install dir" "${INSTALL_DIR}"
  print_summary_line "marketplace" "${MARKETPLACE_PATH}"
  print_summary_line "marketplace root" "$(marketplace_root_for_path "${MARKETPLACE_PATH}")"
  print_summary_line "runtime root" "${RUNTIME_ROOT}"
  print_summary_line "agent root" "${agent_root}"
  print_summary_line "agent binary" "${agent_binary}"
  print_summary_line "agent config" "${agent_config}"
  print_summary_line "mcp bridge" "${bridge_binary}"
  print_summary_line "runtime status" "present (native MCP bridge ready)"
  if [[ -e "${INSTALL_DIR}" && "${FORCE}" -ne 1 ]]; then
    warn "install directory already exists; rerun with --force to replace it"
  fi
}

write_runtime_mcp_config() {
  local target="$1"
  local runtime_root_json
  local agent_root
  local agent_config
  local bridge_binary
  local agent_root_json
  local agent_config_json
  local bridge_binary_json
  local bridge_cwd_json

  runtime_root_json="$(json_escape "${RUNTIME_ROOT}")"
  agent_root="$(agent_root_for_runtime "${RUNTIME_ROOT}")"
  agent_config="$(agent_config_for_runtime "${RUNTIME_ROOT}")"
  bridge_binary="$(bridge_binary_for_runtime "${RUNTIME_ROOT}")"
  agent_root_json="$(json_escape "${agent_root}")"
  agent_config_json="$(json_escape "${agent_config}")"
  bridge_binary_json="$(json_escape "${bridge_binary}")"
  bridge_cwd_json="$(json_escape "$(dirname "${bridge_binary}")")"

  cat > "${target}" <<EOF
{
  "mcpServers": {
    "dbt-agent": {
      "command": "${bridge_binary_json}",
      "args": [
        "--config",
        "${agent_config_json}",
        "--toolkit-root",
        "${runtime_root_json}",
        "--agent-root",
        "${agent_root_json}",
        "--idle-timeout-seconds",
        "0"
      ],
      "cwd": "${bridge_cwd_json}",
      "default_tools_approval_mode": "auto",
      "env": {
        "DBT_TOOLKIT_ROOT": "${runtime_root_json}",
        "RK356X_TOOLKIT_ROOT": "${runtime_root_json}",
        "DBT_AGENT_INSTALL_DIR": "${agent_root_json}",
        "DBT_TELEMETRY_SOURCE": "codex_plugin",
        "DBT_CLIENT_KIND": "codex_plugin"
      }
    }
  }
}
EOF
}

write_marketplace_entry() {
  local target="$1"
  local source_path="$2"

  perl -MJSON::PP -e '
      use strict;
      use warnings;

      my ($target_path, $seed_path, $plugin_source_path) = @ARGV;

      sub read_json_file {
          my ($path) = @_;
          return undef if !-f $path || !-s $path;
          open my $fh, "<", $path or die "open failed for $path: $!";
          local $/;
          my $text = <$fh>;
          close $fh;
          return decode_json($text);
      }

      my $seed = read_json_file($seed_path);
      die "invalid marketplace seed\n" if ref($seed) ne "HASH";
      my $seed_plugins = $seed->{plugins};
      die "invalid marketplace seed plugins\n" if ref($seed_plugins) ne "ARRAY";

      my ($plugin_entry) = grep {
          ref($_) eq "HASH" && defined $_->{name} && $_->{name} eq "dbt-agent"
      } @$seed_plugins;
      die "dbt-agent marketplace entry missing from seed\n" if ref($plugin_entry) ne "HASH";

      my $target = read_json_file($target_path);
      if (ref($target) ne "HASH") {
          $target = {
              name => $seed->{name},
              interface => $seed->{interface},
              plugins => [],
          };
      }

      my $should_migrate_root = 0;
      $should_migrate_root = 1 if !defined $target->{name} || $target->{name} eq q{};
      $should_migrate_root = 1 if defined $target->{name} && $target->{name} eq "local-rk356x-marketplace";

      if (ref($target->{plugins}) eq "ARRAY") {
          my @other_plugins = grep {
              !(ref($_) eq "HASH" && defined $_->{name} && $_->{name} eq "dbt-agent")
          } @{$target->{plugins}};
          $should_migrate_root = 1 if !@other_plugins;
      }

      $target->{name} = $seed->{name} if $should_migrate_root;
      if (ref($target->{interface}) ne "HASH") {
          $target->{interface} = ref($seed->{interface}) eq "HASH" ? { %{$seed->{interface}} } : {};
      }
      if ($should_migrate_root && ref($seed->{interface}) eq "HASH") {
          $target->{interface} = { %{$seed->{interface}} };
      }
      $target->{plugins} = [] if ref($target->{plugins}) ne "ARRAY";

      my %entry = %{$plugin_entry};
      $entry{source} = {
          source => "local",
          path => $plugin_source_path,
      };

      my @plugins = grep {
          !(ref($_) eq "HASH" && defined $_->{name} && $_->{name} eq $entry{name})
      } @{$target->{plugins}};
      push @plugins, \%entry;
      $target->{plugins} = \@plugins;

      open my $out, ">", $target_path or die "write failed for $target_path: $!";
      print {$out} JSON::PP->new->ascii->pretty->canonical->encode($target);
      close $out;
    ' "${target}" "${MARKETPLACE_SOURCE}" "${source_path}"
}

read_marketplace_name() {
  local target="$1"

  perl -MJSON::PP -e '
      use strict;
      use warnings;

      my ($target_path) = @ARGV;
      open my $fh, "<", $target_path or die "open failed for $target_path: $!";
      local $/;
      my $payload = decode_json(<$fh>);
      close $fh;

      die "marketplace name missing\n" if ref($payload) ne "HASH" || !defined $payload->{name} || $payload->{name} eq q{};
      print $payload->{name};
    ' "${target}"
}

plugin_cache_dir_for_marketplace() {
  local marketplace_name="$1"
  local plugin_version
  plugin_version="$(perl -MJSON::PP -e '
      use strict;
      use warnings;
      my ($manifest) = @ARGV;
      open my $fh, "<", $manifest or die "open failed: $!";
      local $/;
      my $payload = decode_json(<$fh>);
      close $fh;
      my $version = $payload->{version} // "local";
      $version =~ s/^\s+|\s+$//g;
      print $version eq "" ? "local" : $version;
    ' "${PACKAGE_ROOT}/.codex-plugin/plugin.json")"
  printf '%s/plugins/cache/%s/dbt-agent/%s' "${DEFAULT_CODEX_HOME}" "${marketplace_name}" "${plugin_version}"
}

legacy_plugin_repo_root() {
  printf '%s/.tmp/plugins' "${DEFAULT_CODEX_HOME}"
}

legacy_plugin_marketplace_path() {
  printf '%s/.agents/plugins/marketplace.json' "$(legacy_plugin_repo_root)"
}

legacy_plugin_install_dir() {
  printf '%s/plugins/dbt-agent' "$(legacy_plugin_repo_root)"
}

legacy_plugin_repo_available() {
  [[ -f "$(legacy_plugin_marketplace_path)" ]]
}

legacy_plugin_cache_dir() {
  local plugins_sha_path="${DEFAULT_CODEX_HOME}/.tmp/plugins.sha"
  local plugins_sha=""

  if [[ -f "${plugins_sha_path}" ]]; then
    plugins_sha="$(tr -d '[:space:]' < "${plugins_sha_path}")"
  fi

  if [[ -z "${plugins_sha}" ]]; then
    return 1
  fi

  printf '%s/plugins/cache/openai-curated/dbt-agent/%s' "${DEFAULT_CODEX_HOME}" "${plugins_sha}"
}

register_marketplace_in_codex_config() {
  local marketplace_name="$1"
  local config_path="${DEFAULT_CODEX_HOME}/config.toml"
  local marketplace_root

  marketplace_root="$(marketplace_root_for_path "${MARKETPLACE_PATH}")"

  mkdir -p "$(dirname "${config_path}")"
  if [[ ! -f "${config_path}" ]]; then
    : > "${config_path}"
  fi

  perl -0pi -e 's/^\[marketplaces\."?local-rk356x-marketplace"?\]\n(?:(?!^\[).*\n?)*//msg' "${config_path}"
  perl -0pi -e 's/^\[marketplaces\."?local-development-board-marketplace"?\]\n(?:(?!^\[).*\n?)*//msg' "${config_path}"
  perl -0pi -e 's/^\[marketplaces\."?dbt-agent-local"?\]\n(?:(?!^\[).*\n?)*//msg' "${config_path}"
  perl -0pi -e "s/^\\[marketplaces\\.\"?\\Q${marketplace_name}\\E\"?\\]\\n(?:(?!^\\[).*\n?)*//msg" "${config_path}"
  perl -0pi -e 's/\n*\z/\n/' "${config_path}"

  if [[ "${marketplace_root}" == "$(legacy_plugin_repo_root)" && "${marketplace_name}" == "plugins" ]]; then
    return 0
  fi

  cat >> "${config_path}" <<EOF

[marketplaces.${marketplace_name}]
source_type = "local"
source = "${marketplace_root}"
EOF
}

cleanup_legacy_plugin_cache() {
  local legacy_marketplace_name="local-rk356x-marketplace"
  local legacy_cache_dir

  legacy_cache_dir="$(plugin_cache_dir_for_marketplace "${legacy_marketplace_name}")"
  if [[ "${MARKETPLACE_NAME}" != "${legacy_marketplace_name}" ]]; then
    rm -rf "$(dirname "${legacy_cache_dir}")"
  fi
  if [[ "${MARKETPLACE_NAME}" != "dbt-agent-local" ]]; then
    rm -rf "${DEFAULT_CODEX_HOME}/plugins/cache/dbt-agent-local"
  fi
  rm -rf "${DEFAULT_CODEX_HOME}/plugins/cache/local-development-board-marketplace/dbt-agent"
  rm -rf "${DEFAULT_CODEX_HOME}/plugins/cache/openai-curated/dbt-agent"
}

sync_installed_plugin_cache() {
  local marketplace_name="$1"
  local plugin_cache_root
  local cache_dir

  cache_dir="$(plugin_cache_dir_for_marketplace "${marketplace_name}")"
  plugin_cache_root="$(dirname "${cache_dir}")"
  rm -rf "${plugin_cache_root}"
  mkdir -p "${cache_dir}"
  cp -R "${INSTALL_DIR}/." "${cache_dir}/"
}

sync_legacy_plugin_repository() {
  local legacy_marketplace_path
  local legacy_install_dir

  if ! legacy_plugin_repo_available; then
    return 0
  fi

  if [[ "$(marketplace_root_for_path "${MARKETPLACE_PATH}")" == "$(legacy_plugin_repo_root)" ]]; then
    return 0
  fi

  legacy_marketplace_path="$(legacy_plugin_marketplace_path)"
  legacy_install_dir="$(legacy_plugin_install_dir)"

  rm -rf "${legacy_install_dir}"
  perl -MJSON::PP -e '
      use strict;
      use warnings;
      my ($target_path) = @ARGV;
      exit 0 if !-f $target_path || !-s $target_path;
      open my $fh, "<", $target_path or die "open failed for $target_path: $!";
      local $/;
      my $target = decode_json(<$fh>);
      close $fh;
      exit 0 if ref($target) ne "HASH" || ref($target->{plugins}) ne "ARRAY";
      my @plugins = grep {
          !(ref($_) eq "HASH" && defined $_->{name} && $_->{name} eq "dbt-agent")
      } @{$target->{plugins}};
      $target->{plugins} = \@plugins;
      if (defined $target->{name} && $target->{name} eq "dbt-agent-local" && !@plugins) {
          unlink $target_path;
          exit 0;
      }
      if (defined $target->{name} && $target->{name} eq "dbt-agent-local" && @plugins) {
          $target->{name} = "plugins";
          $target->{interface} = {} if ref($target->{interface}) ne "HASH";
          $target->{interface}->{displayName} = "Plugins";
      }
      open my $out, ">", $target_path or die "write failed for $target_path: $!";
      print {$out} JSON::PP->new->ascii->pretty->canonical->encode($target);
      close $out;
    ' "${legacy_marketplace_path}"
}

cleanup_standalone_codex_plugin_repository() {
  local home_marketplace_path="${HOME}/.agents/plugins/marketplace.json"

  if [[ "$(marketplace_root_for_path "${MARKETPLACE_PATH}")" != "$(legacy_plugin_repo_root)" ]]; then
    return 0
  fi

  rm -rf "${DEFAULT_CODEX_HOME}/plugins/dbt-agent"
  perl -MJSON::PP -e '
      use strict;
      use warnings;
      my ($target_path) = @ARGV;
      exit 0 if !-f $target_path || !-s $target_path;
      open my $fh, "<", $target_path or die "open failed for $target_path: $!";
      local $/;
      my $target = decode_json(<$fh>);
      close $fh;
      exit 0 if ref($target) ne "HASH" || ref($target->{plugins}) ne "ARRAY";
      my @plugins = grep {
          !(ref($_) eq "HASH" && defined $_->{name} && $_->{name} eq "dbt-agent")
      } @{$target->{plugins}};
      if (defined $target->{name} && $target->{name} eq "dbt-agent-local" && !@plugins) {
          unlink $target_path;
          exit 0;
      }
      $target->{plugins} = \@plugins;
      if (defined $target->{name} && $target->{name} eq "dbt-agent-local" && @plugins) {
          $target->{name} = "plugins";
          $target->{interface} = {} if ref($target->{interface}) ne "HASH";
          $target->{interface}->{displayName} = "Plugins";
      }
      open my $out, ">", $target_path or die "write failed for $target_path: $!";
      print {$out} JSON::PP->new->ascii->pretty->canonical->encode($target);
      close $out;
    ' "${home_marketplace_path}"
}

sync_legacy_plugin_cache() {
  local legacy_cache_dir
  local legacy_cache_root

  if ! legacy_cache_dir="$(legacy_plugin_cache_dir)"; then
    return 0
  fi

  legacy_cache_root="$(dirname "${legacy_cache_dir}")"
  rm -rf "${legacy_cache_root}"
}

preferred_codex_plugin_marketplace() {
  local marketplace_name="$1"

  printf '%s' "${marketplace_name}"
}

enable_plugin_in_codex_config() {
  local marketplace_name="$1"
  local config_path="${DEFAULT_CODEX_HOME}/config.toml"

  mkdir -p "$(dirname "${config_path}")"
  if [[ ! -f "${config_path}" ]]; then
    : > "${config_path}"
  fi

  perl -0pi -e 's/^\[plugins\."dbt-agent@[^\"]+"\]\n(?:(?!^\[).*\n?)*//msg' "${config_path}"

  perl -0pi -e 's/\n*\z/\n/' "${config_path}"

  cat >> "${config_path}" <<EOF

[plugins."dbt-agent@${marketplace_name}"]
enabled = true
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir)
      INSTALL_DIR="$2"
      INSTALL_DIR_EXPLICIT=1
      shift 2
      ;;
    --marketplace-path)
      MARKETPLACE_PATH="$2"
      shift 2
      ;;
    --runtime-root)
      RUNTIME_ROOT="$2"
      shift 2
      ;;
    --check-only)
      CHECK_ONLY=1
      shift
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

if [[ "${INSTALL_DIR_EXPLICIT}" -ne 1 ]]; then
  INSTALL_DIR="$(default_install_dir_for_marketplace_path "${MARKETPLACE_PATH}")"
fi

validate_environment
print_environment_summary

if [[ "${CHECK_ONLY}" -eq 1 ]]; then
  exit 0
fi

if [[ -e "${INSTALL_DIR}" ]]; then
  if [[ "${FORCE}" -ne 1 ]]; then
    echo "install directory already exists: ${INSTALL_DIR}" >&2
    echo "rerun with --force to overwrite" >&2
    exit 1
  fi
  rm -rf "${INSTALL_DIR}"
fi

mkdir -p "${INSTALL_DIR}"
mkdir -p "$(dirname "${MARKETPLACE_PATH}")"
rm -rf "$(dirname "${INSTALL_DIR}")/development-board-toolchain" "$(dirname "${INSTALL_DIR}")/rk356x-mac-toolkit"
cp -R "${PACKAGE_ROOT}/." "${INSTALL_DIR}/"

write_marketplace_entry "${MARKETPLACE_PATH}" "$(marketplace_source_path_for_install_dir)"
write_runtime_mcp_config "${INSTALL_DIR}/.mcp.json"

MARKETPLACE_NAME="$(read_marketplace_name "${MARKETPLACE_PATH}")"
register_marketplace_in_codex_config "${MARKETPLACE_NAME}"
cleanup_legacy_plugin_cache
sync_installed_plugin_cache "${MARKETPLACE_NAME}"
sync_legacy_plugin_repository
cleanup_standalone_codex_plugin_repository
sync_legacy_plugin_cache
enable_plugin_in_codex_config "$(preferred_codex_plugin_marketplace "${MARKETPLACE_NAME}")"

require_file "${INSTALL_DIR}/.mcp.json" "Codex MCP config was not written: ${INSTALL_DIR}/.mcp.json"
require_file "${MARKETPLACE_PATH}" "Codex marketplace entry was not written: ${MARKETPLACE_PATH}"

echo "installed Codex plugin to: ${INSTALL_DIR}"
echo "local marketplace: ${MARKETPLACE_PATH}"
echo "shared runtime: ${RUNTIME_ROOT}"
echo "shared agent: $(agent_root_for_runtime "${RUNTIME_ROOT}")"
echo "next step: restart Codex and confirm that DBT-Agent appears in the plugin list"
