#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

perl -MJSON::PP -MFile::Spec -e '
  use strict;
  use warnings;

  my $decoder = JSON::PP->new->utf8;
  my $repo_root = $ARGV[0];

  sub join_path {
      return File::Spec->catfile(@_);
  }

  sub slurp_utf8 {
      my ($path) = @_;
      open my $fh, "<:encoding(UTF-8)", $path or die "unable to open $path: $!\n";
      local $/;
      my $content = <$fh>;
      close $fh;
      return $content;
  }

  my $release_manifest_path = join_path($repo_root, "release", "manifest.json");
  my $opencode_manifest_path = join_path($repo_root, "opencode_plugin", "release", "manifest.json");
  my $codex_manifest_path = join_path($repo_root, "codex_plugin", "release", "manifest.json");

  my @required_paths = (
      $release_manifest_path,
      join_path($repo_root, "release", "README.md"),
      join_path($repo_root, "release", "install.sh"),
      join_path($repo_root, "release", "install-opencode.sh"),
      join_path($repo_root, "release", "install-codex.sh"),
      join_path($repo_root, "scripts", "build_release_archives.sh"),
      join_path($repo_root, "scripts", "publish_github_release.sh"),
      join_path($repo_root, "opencode_plugin", "docs", "installation.md"),
      join_path($repo_root, "codex_plugin", "docs", "installation.md"),
  );

  for my $path (@required_paths) {
      die "missing required release file: $path\n" unless -e $path;
  }

  my $release_manifest = $decoder->decode(slurp_utf8($release_manifest_path));
  my $opencode_manifest = $decoder->decode(slurp_utf8($opencode_manifest_path));
  my $codex_manifest = $decoder->decode(slurp_utf8($codex_manifest_path));

  my $release_version = $release_manifest->{version};
  my $opencode_version = $opencode_manifest->{version};
  my $codex_version = $codex_manifest->{version};

  die "release manifest is missing version\n" unless $release_version;
  if ($release_version ne $opencode_version || $release_version ne $codex_version) {
      die "release version mismatch: release=$release_version, opencode=$opencode_version, codex=$codex_version\n";
  }

  my $release_assets = $release_manifest->{release_assets} || {};
  for my $platform (qw(opencode codex)) {
      my $asset = $release_assets->{$platform};
      die "release asset metadata missing for platform: $platform\n" unless ref($asset) eq "HASH";
      die "incomplete release asset metadata for platform: $platform\n"
          unless $asset->{zip} && $asset->{tar_gz} && $asset->{root_dir};
  }

  print "release is ready for version $release_version\n";
' "${REPO_ROOT}"
