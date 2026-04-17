#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

python3 - "${REPO_ROOT}" <<'PY'
import json
import sys
from pathlib import Path

repo_root = Path(sys.argv[1])

release_manifest_path = repo_root / "release" / "manifest.json"
opencode_manifest_path = repo_root / "opencode_plugin" / "release" / "manifest.json"
codex_manifest_path = repo_root / "codex_plugin" / "release" / "manifest.json"

required_paths = [
    release_manifest_path,
    repo_root / "release" / "README.md",
    repo_root / "release" / "install.sh",
    repo_root / "release" / "install-opencode.sh",
    repo_root / "release" / "install-codex.sh",
    repo_root / "scripts" / "build_release_archives.sh",
    repo_root / "scripts" / "publish_github_release.sh",
    repo_root / "opencode_plugin" / "docs" / "installation.md",
    repo_root / "codex_plugin" / "docs" / "installation.md",
]

for path in required_paths:
    if not path.exists():
        raise SystemExit(f"missing required release file: {path}")

with release_manifest_path.open("r", encoding="utf-8") as fh:
    release_manifest = json.load(fh)
with opencode_manifest_path.open("r", encoding="utf-8") as fh:
    opencode_manifest = json.load(fh)
with codex_manifest_path.open("r", encoding="utf-8") as fh:
    codex_manifest = json.load(fh)

release_version = release_manifest.get("version")
opencode_version = opencode_manifest.get("version")
codex_version = codex_manifest.get("version")

if not release_version:
    raise SystemExit("release manifest is missing version")
if release_version != opencode_version or release_version != codex_version:
    raise SystemExit(
        "release version mismatch: "
        f"release={release_version}, opencode={opencode_version}, codex={codex_version}"
    )

release_assets = release_manifest.get("release_assets") or {}
for platform in ("opencode", "codex"):
    asset = release_assets.get(platform)
    if not isinstance(asset, dict):
        raise SystemExit(f"release asset metadata missing for platform: {platform}")
    if not asset.get("zip") or not asset.get("tar_gz") or not asset.get("root_dir"):
        raise SystemExit(f"incomplete release asset metadata for platform: {platform}")

print(f"release is ready for version {release_version}")
PY
