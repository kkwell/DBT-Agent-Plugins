#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

AGENT_BASE = os.environ.get("DBT_AGENTD_URL", "http://127.0.0.1:18082")
DEFAULT_UPDATE_MANIFEST = os.environ.get(
    "DBT_CODEX_RELEASE_MANIFEST_URL",
    "https://raw.githubusercontent.com/kkwell/DBT-Agent/main/opencode-plugin-release-manifest.json",
)
DEFAULT_SUPPORT_ROOT = Path.home() / "Library" / "Application Support" / "development-board-toolchain"
RUNTIME_INSTALL_ROOT = Path(os.environ.get("DBT_TOOLKIT_ROOT", str(DEFAULT_SUPPORT_ROOT / "runtime"))).expanduser()
SUPPORT_ROOT = RUNTIME_INSTALL_ROOT.parent
AGENT_INSTALL_ROOT = Path(os.environ.get("DBT_AGENT_INSTALL_DIR", str(SUPPORT_ROOT / "agent"))).expanduser()
SERVER = FastMCP(
    name="DBT Agent",
    instructions="Compact Development Board Toolchain MCP tools for TaishanPi and RP2350-family boards backed by local dbt-agentd.",
    log_level="ERROR",
)


def _as_str(value: Any) -> str:
    return value if isinstance(value, str) else "" if value is None else str(value)


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = _as_str(value).strip().lower()
    return text in {"1", "true", "yes", "on"}


def _normalize_board(board: str | None) -> str:
    text = _as_str(board).strip()
    if not text:
        return ""
    lowered = re.sub(r"[^a-z0-9]+", "", text.lower())
    aliases = {
        "raspberrypipico2w": "RaspberryPiPico2W",
        "pico2w": "RaspberryPiPico2W",
        "pico2_w": "RaspberryPiPico2W",
        "raspberrypipico2": "RaspberryPiPico2W",
        "coloreasypico2": "ColorEasyPICO2",
        "coloreasypico": "ColorEasyPICO2",
        "colorpico2": "ColorEasyPICO2",
        "rp2350": "RP2350",
        "pico2": "RP2350",
        "taishanpi": "TaishanPi",
        "taishan": "TaishanPi",
    }
    return aliases.get(lowered, text)


def _normalize_variant(board: str, variant: str | None) -> str:
    text = _as_str(variant).strip()
    if not text:
        return ""
    lowered = re.sub(r"[^a-z0-9]+", "", text.lower())
    if board == "RaspberryPiPico2W" and lowered in {"raspberrypipico2w", "pico2w", "pico2_w"}:
        return "RaspberryPiPico2W"
    if board == "ColorEasyPICO2" and lowered in {"coloreasypico2", "coloreasypico", "colorpico2"}:
        return "ColorEasyPICO2"
    if board == "RP2350" and lowered in {"rp2350", "pico2"}:
        return "RP2350"
    if board == "TaishanPi" and lowered in {"1mrk3566", "rk3566", "rk3566tspiv10"}:
        return "1M-RK3566"
    return text


def _request(path: str, *, method: str = "GET", payload: dict[str, Any] | None = None, timeout: int = 15) -> Any:
    url = f"{AGENT_BASE}{path}"
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {"ok": False, "error": body or f"HTTP {exc.code}"}
        raise RuntimeError(json.dumps(parsed, ensure_ascii=False)) from exc
    except Exception as exc:
        raise RuntimeError(str(exc)) from exc


def _read_text_resource(source: str, timeout: int = 30) -> str:
    ref = _as_str(source)
    if not ref:
        raise RuntimeError("resource source is required")
    if re.match(r"^https?://", ref, re.I):
        req = urllib.request.Request(ref, headers={"Accept": "*/*"}, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8")
    return Path(ref).expanduser().read_text(encoding="utf-8")


def _load_json_resource(source: str, timeout: int = 30) -> dict[str, Any]:
    payload = json.loads(_read_text_resource(source, timeout=timeout) or "{}")
    if not isinstance(payload, dict):
        raise RuntimeError(f"invalid JSON object from {source}")
    return payload


def _materialize_resource(source: str, target_path: Path, timeout: int = 120) -> Path:
    ref = _as_str(source)
    if not ref:
        raise RuntimeError("resource source is required")
    target_path.parent.mkdir(parents=True, exist_ok=True)
    if re.match(r"^https?://", ref, re.I):
        req = urllib.request.Request(ref, headers={"Accept": "*/*"}, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp, target_path.open("wb") as out:
            out.write(resp.read())
        return target_path
    resolved = Path(ref).expanduser()
    if not resolved.exists():
        raise RuntimeError(f"resource does not exist: {resolved}")
    target_path.write_bytes(resolved.read_bytes())
    return target_path


def _resolve_manifest_ref(manifest_source: str, ref: str) -> str:
    source = _as_str(manifest_source)
    value = _as_str(ref)
    if not value:
        return ""
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme in {"http", "https"} or os.path.isabs(value):
        return value
    manifest_parsed = urllib.parse.urlparse(source)
    if manifest_parsed.scheme in {"http", "https"}:
        return urllib.parse.urljoin(source, value)
    return str((Path(source).expanduser().resolve().parent / value).resolve())


def _read_local_runtime_version() -> str:
    version_path = RUNTIME_INSTALL_ROOT / "VERSION"
    if not version_path.exists():
        return "unknown"
    value = version_path.read_text(encoding="utf-8").strip()
    return value or "unknown"


def _compare_versions(lhs: str, rhs: str) -> int:
    def parts(value: str) -> list[int]:
        return [int(p) if p.isdigit() else 0 for p in re.split(r"[._-]", _as_str(value)) if p != ""]

    left = parts(lhs)
    right = parts(rhs)
    count = max(len(left), len(right))
    for index in range(count):
        lval = left[index] if index < len(left) else 0
        rval = right[index] if index < len(right) else 0
        if lval != rval:
            return -1 if lval < rval else 1
    return 0


def _run_local_command(args: list[str], cwd: str | None = None, timeout: int = 600, extra_env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    if extra_env:
        env.update({k: v for k, v in extra_env.items() if v is not None})
    return subprocess.run(
        args,
        cwd=cwd,
        env=env,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )


def _check_plugin_update_state(source: str | None = None) -> dict[str, Any]:
    manifest_source = _as_str(source) or DEFAULT_UPDATE_MANIFEST
    manifest = _load_json_resource(manifest_source, timeout=30)
    local_version = _read_local_runtime_version()
    remote_version = _as_str(manifest.get("version"))
    comparison = _compare_versions(local_version, remote_version) if remote_version and local_version != "unknown" else None
    return {
        "ok": True,
        "toolkit_root": str(RUNTIME_INSTALL_ROOT),
        "agent_root": str(AGENT_INSTALL_ROOT),
        "update_manifest_url": manifest_source,
        "repository_url": _as_str(manifest.get("repository_url")) or None,
        "installer_url": _resolve_manifest_ref(manifest_source, _as_str(manifest.get("installer_url") or manifest.get("installer_path"))) or None,
        "local_version": local_version,
        "remote_version": remote_version or None,
        "update_available": comparison is not None and comparison < 0,
        "manifest": manifest,
        "summary_for_user": (
            f"Development Board Toolchain 可更新：{local_version} -> {remote_version}"
            if comparison is not None and comparison < 0
            else f"Development Board Toolchain 已是最新版本：{local_version}"
            if remote_version
            else "已完成更新检查，但未能解析远端版本号。"
        ),
    }


def _find_first_directory(root: Path, pattern: str) -> Path:
    matches = sorted(p for p in root.glob(pattern) if p.is_dir())
    if not matches:
        raise RuntimeError(f"directory not found for pattern {pattern} under {root}")
    return matches[0]


def _perform_plugin_update(source: str | None = None, force: bool = False) -> dict[str, Any]:
    state = _check_plugin_update_state(source)
    manifest_source = _as_str(state.get("update_manifest_url"))
    manifest = state.get("manifest") if isinstance(state.get("manifest"), dict) else {}
    local_version = _as_str(state.get("local_version"))
    remote_version = _as_str(state.get("remote_version"))
    if not force and remote_version and local_version != "unknown" and _compare_versions(local_version, remote_version) >= 0:
        return {
            **state,
            "updated": False,
            "summary_for_user": f"Development Board Toolchain 已是最新版本：{local_version}",
        }

    runtime_ref = _resolve_manifest_ref(manifest_source, _as_str(manifest.get("runtime_archive_url")))
    agent_ref = _resolve_manifest_ref(manifest_source, _as_str(manifest.get("agent_archive_url")))
    if not runtime_ref:
        raise RuntimeError(f"runtime_archive_url missing in manifest: {manifest_source}")
    if not agent_ref:
        raise RuntimeError(f"agent_archive_url missing in manifest: {manifest_source}")

    with tempfile.TemporaryDirectory(prefix="dbt-codex-update-") as temp_root_str:
        temp_root = Path(temp_root_str)
        runtime_archive = _materialize_resource(runtime_ref, temp_root / "runtime.tar.gz")
        agent_archive = _materialize_resource(agent_ref, temp_root / "agent.tar.gz")

        runtime_extract = temp_root / "runtime-extract"
        agent_extract = temp_root / "agent-extract"
        runtime_extract.mkdir(parents=True, exist_ok=True)
        agent_extract.mkdir(parents=True, exist_ok=True)

        runtime_untar = _run_local_command(["/usr/bin/tar", "-xzf", str(runtime_archive), "-C", str(runtime_extract)], timeout=300)
        if runtime_untar.returncode != 0:
            raise RuntimeError(runtime_untar.stderr or runtime_untar.stdout or "failed to extract runtime archive")
        agent_untar = _run_local_command(["/usr/bin/tar", "-xzf", str(agent_archive), "-C", str(agent_extract)], timeout=300)
        if agent_untar.returncode != 0:
            raise RuntimeError(agent_untar.stderr or agent_untar.stdout or "failed to extract agent archive")

        runtime_bundle = _find_first_directory(runtime_extract, "development-board-toolchain-runtime-*")
        agent_bundle = _find_first_directory(agent_extract, "dbt-agentd-macos-arm64-*")
        runtime_install_script = runtime_bundle / "install.sh"
        agent_install_script = agent_bundle / "install.sh"
        if not runtime_install_script.exists():
            raise RuntimeError(f"runtime install.sh not found in {runtime_bundle}")
        if not agent_install_script.exists():
            raise RuntimeError(f"agent install.sh not found in {agent_bundle}")

        runtime_result = _run_local_command(
            ["/bin/bash", str(runtime_install_script), "--install-dir", str(RUNTIME_INSTALL_ROOT), "--force"],
            cwd=str(runtime_bundle),
            timeout=600,
            extra_env={"DBT_TOOLKIT_INSTALL_DIR": str(RUNTIME_INSTALL_ROOT)},
        )
        if runtime_result.returncode != 0:
            raise RuntimeError(runtime_result.stderr or runtime_result.stdout or "runtime install failed")

        agent_result = _run_local_command(
            ["/bin/bash", str(agent_install_script), "--install-dir", str(AGENT_INSTALL_ROOT), "--runtime-root", str(RUNTIME_INSTALL_ROOT), "--force"],
            cwd=str(agent_bundle),
            timeout=600,
            extra_env={
                "DBT_AGENT_INSTALL_DIR": str(AGENT_INSTALL_ROOT),
                "DBT_TOOLKIT_INSTALL_DIR": str(RUNTIME_INSTALL_ROOT),
                "DBT_TOOLKIT_RELEASE_MANIFEST_URL": manifest_source,
            },
        )
        if agent_result.returncode != 0:
            raise RuntimeError(agent_result.stderr or agent_result.stdout or "agent install failed")

        updated_version = _read_local_runtime_version()
        return {
            "ok": True,
            "updated": True,
            "toolkit_root": str(RUNTIME_INSTALL_ROOT),
            "agent_root": str(AGENT_INSTALL_ROOT),
            "update_manifest_url": manifest_source,
            "local_version_before": local_version,
            "version": updated_version,
            "remote_version": remote_version or updated_version,
            "update_available": False,
            "stdout": "\n".join(filter(None, [runtime_result.stdout.strip(), agent_result.stdout.strip()])),
            "stderr": "\n".join(filter(None, [runtime_result.stderr.strip(), agent_result.stderr.strip()])),
            "summary_for_user": f"Development Board Toolchain 已更新到 {updated_version}",
        }


def _tool(tool_name: str, arguments: dict[str, Any] | None = None, timeout: int = 15) -> Any:
    return _request(
        "/v1/tools/execute",
        method="POST",
        payload={"tool_name": tool_name, "arguments": arguments or {}},
        timeout=timeout,
    )


def _status_summary() -> dict[str, Any]:
    payload = _request("/v1/status/summary", timeout=10)
    devices = payload.get("devices") if isinstance(payload, dict) else []
    devices = [d for d in devices if isinstance(d, dict) and d.get("connected") is True]
    active = _as_str(payload.get("active_device_id") if isinstance(payload, dict) else "")
    compact_devices = []
    for item in devices:
        compact_devices.append(
            {
                "device_id": _as_str(item.get("device_id")) or None,
                "device_uid": _as_str(item.get("device_uid")) or None,
                "board_id": _as_str(item.get("board_id")) or None,
                "variant_id": _as_str(item.get("variant_id")) or None,
                "display_label": _as_str(item.get("display_label") or item.get("display_name") or item.get("board_id")) or None,
                "transport_name": _as_str(item.get("transport_name")) or None,
                "transport_locator": _as_str(item.get("transport_locator") or item.get("interface_name") or item.get("board_ip")) or None,
                "connected": item.get("connected") is True,
            }
        )
    board_id = _as_str(payload.get("board_id")) or None
    variant_id = _as_str(payload.get("variant_id")) or None
    summary = _as_str(payload.get("summary")) or None
    return {
        "ok": True,
        "connected_device": payload.get("connected_device") is True,
        "board_id": board_id,
        "variant_id": variant_id,
        "device_id": active or _as_str(payload.get("device_id")) or None,
        "active_device_id": active or _as_str(payload.get("device_id")) or None,
        "summary": summary,
        "device_summary": _as_str(payload.get("device_summary")) or None,
        "updated_at": _as_str(payload.get("updated_at")) or None,
        "devices": compact_devices,
        "summary_for_user": summary,
    }


def _resolve_target(board: str | None, variant: str | None, device_id: str | None) -> dict[str, str | None]:
    requested_board = _normalize_board(board)
    requested_variant = _normalize_variant(requested_board, variant)
    requested_device = _as_str(device_id).strip()
    status = _status_summary()
    devices = status.get("devices") or []
    selected = None
    for item in devices:
        if requested_device and _as_str(item.get("device_id")) != requested_device:
            continue
        if requested_board and requested_board != "RP2350":
            if _as_str(item.get("board_id")) != requested_board and _as_str(item.get("variant_id")) != requested_variant:
                continue
        selected = item
        if _as_str(item.get("device_id")) == _as_str(status.get("active_device_id")):
            break
    board_id = requested_board or _as_str(status.get("board_id")) or (_as_str(selected.get("board_id")) if isinstance(selected, dict) else "")
    variant_id = requested_variant or _as_str(status.get("variant_id")) or (_as_str(selected.get("variant_id")) if isinstance(selected, dict) else "")
    resolved_device = requested_device or (_as_str(selected.get("device_id")) if isinstance(selected, dict) else "") or _as_str(status.get("active_device_id"))
    return {
        "board_id": board_id or None,
        "variant_id": variant_id or None,
        "device_id": resolved_device or None,
    }


def _rp2350_roots() -> dict[str, str]:
    support_root = str(Path.home() / "Library" / "Application Support" / "development-board-toolchain")
    runtime_root = str(Path(support_root) / "board-environments" / "RP2350RuntimeCore" / "minimal_runtime" / "RP2350")
    sdk_core_root = str(Path(support_root) / "board-environments" / "RP2350SDKCore" / "sdk_core" / "RP2350")
    build_overlay_root = str(Path(support_root) / "board-environments" / "RP2350BuildOverlay" / "full_build" / "RP2350")
    pico_sdk_path = str(Path(sdk_core_root) / "pico-sdk")
    picotool_path = str(Path(sdk_core_root) / "picotool" / "build" / "picotool")
    pioasm_path = str(Path(pico_sdk_path) / "tools" / "pioasm")
    arm = ""
    tc_root = Path(sdk_core_root) / "toolchains"
    if tc_root.exists():
        for entry in tc_root.iterdir():
            candidate = entry / "bin" / "arm-none-eabi-gcc"
            if candidate.exists():
                arm = str(candidate)
                break
    return {
        "support_root": support_root,
        "runtime_root": runtime_root,
        "sdk_core_root": sdk_core_root,
        "build_overlay_root": build_overlay_root,
        "pico_sdk_path": pico_sdk_path,
        "picotool_path": picotool_path,
        "pioasm_path": pioasm_path,
        "arm_none_eabi_gcc": arm,
    }


def _rp2350_board_meta(board: str) -> dict[str, Any]:
    board_id = _normalize_board(board)
    common_caps = [
        "board_overview",
        "pin_header_40pin",
        "gpio",
        "onboard_led",
        "adc",
        "uart",
        "i2c",
        "spi",
        "chip_architecture",
        "multicore",
        "pio",
        "hstx",
    ]
    if board_id == "RaspberryPiPico2W":
        return {
            "board_id": "RaspberryPiPico2W",
            "variant_id": "RaspberryPiPico2W",
            "display_name": "Pico 2 W",
            "manufacturer": "Raspberry Pi",
            "capabilities": common_caps + ["wifi_bluetooth"],
        }
    if board_id == "ColorEasyPICO2":
        return {
            "board_id": "ColorEasyPICO2",
            "variant_id": "ColorEasyPICO2",
            "display_name": "ColorEasyPICO2",
            "manufacturer": "嘉立创",
            "capabilities": common_caps,
        }
    return {
        "board_id": board_id or "RP2350",
        "variant_id": board_id or "RP2350",
        "display_name": board_id or "RP2350 Device",
        "manufacturer": None,
        "capabilities": common_caps,
    }


def _probe_rp2350_environment() -> dict[str, Any]:
    roots = _rp2350_roots()
    return {
        "ok": Path(roots["runtime_root"]).exists() and Path(roots["sdk_core_root"]).exists(),
        "runtime_root": Path(roots["runtime_root"]).exists(),
        "sdk_core_root": Path(roots["sdk_core_root"]).exists(),
        "build_overlay_root": Path(roots["build_overlay_root"]).exists(),
        "pico_sdk": Path(roots["pico_sdk_path"]).exists(),
        "picotool": Path(roots["picotool_path"]).exists(),
        "pioasm": Path(roots["pioasm_path"]).exists(),
        "arm_none_eabi_gcc": Path(roots["arm_none_eabi_gcc"]).exists() if roots["arm_none_eabi_gcc"] else False,
    }


def _compact_board_config(payload: dict[str, Any], board: str, variant: str) -> dict[str, Any]:
    manifest = payload.get("manifest") if isinstance(payload.get("manifest"), dict) else {}
    profile = payload.get("profile") if isinstance(payload.get("profile"), dict) else {}
    environment = payload.get("environment") if isinstance(payload.get("environment"), dict) else {}
    result = {
        "ok": payload.get("ok") is True,
        "board_id": _as_str(profile.get("board_id") or manifest.get("id") or board),
        "variant_id": _as_str(payload.get("resolved_variant") or payload.get("requested_variant") or variant or board),
        "display_name": _as_str(profile.get("display_name") or manifest.get("display_name")) or None,
        "manufacturer": _as_str(profile.get("manufacturer") or manifest.get("manufacturer")) or None,
        "capabilities": profile.get("capabilities") or manifest.get("capabilities") or [],
        "plugin_root": _as_str(payload.get("board_root")) or None,
    }
    if environment:
        result["environment"] = environment
    return result


def _installed_plugin_meta(board_id: str) -> dict[str, Any]:
    try:
        payload = _request("/v1/plugins/installed", timeout=10)
    except Exception:
        return {}
    for item in payload.get("installed", []) if isinstance(payload, dict) else []:
        if isinstance(item, dict) and _as_str(item.get("id")) == board_id:
            return item
    return {}


def _capability_ids(board_id: str, variant_id: str) -> list[str]:
    try:
        query = urllib.parse.urlencode({"board_id": board_id, "variant_id": variant_id})
        payload = _request(f"/v1/context/capability-summaries?{query}", timeout=10)
    except Exception:
        return []
    ids = []
    for item in payload.get("capability_summaries", []) if isinstance(payload, dict) else []:
        if isinstance(item, dict):
            capability_id = _as_str(item.get("capability_id"))
            if capability_id:
                ids.append(capability_id)
    return ids


def _compact_capability_context(payload: dict[str, Any]) -> dict[str, Any]:
    impl = payload.get("implementation_contract") if isinstance(payload.get("implementation_contract"), dict) else {}
    build = impl.get("build_contract") if isinstance(impl.get("build_contract"), dict) else {}
    digest = payload.get("knowledge_digest") if isinstance(payload.get("knowledge_digest"), dict) else {}
    capability_id = _as_str(payload.get("capability_id"))
    capability_profiles = build.get("capability_build_profiles") if isinstance(build.get("capability_build_profiles"), dict) else {}
    selected_profile = capability_profiles.get(capability_id) if capability_id else None
    return {
        "board_id": _as_str(payload.get("board_id")) or None,
        "variant_id": _as_str(payload.get("variant_id")) or None,
        "capability_id": capability_id or None,
        "summary": _as_str(digest.get("summary") or payload.get("summary")) or None,
        "purpose": _as_str(digest.get("purpose")) or None,
        "intent_mapping": digest.get("intent_mapping") or [],
        "execution_availability": payload.get("execution_availability") if isinstance(payload.get("execution_availability"), dict) else None,
        "implementation_contract": {
            "board_runtime_model": _as_str(impl.get("board_runtime_model")) or None,
            "control_backend": _as_str(impl.get("control_backend")) or None,
            "preferred_program_shape": _as_str(impl.get("preferred_program_shape")) or None,
            "build_contract": {
                "project_shape": _as_str(build.get("project_shape")) or None,
                "pico_board": _as_str(build.get("pico_board")) or None,
                "required_cmake_import": _as_str(build.get("required_cmake_import")) or None,
                "required_project_layout": build.get("required_project_layout") or [],
                "required_cmake_steps": build.get("required_cmake_steps") or [],
                "required_compile_definitions": build.get("required_compile_definitions") or [],
                "required_headers": build.get("required_headers") or [],
                "required_include_directories": build.get("required_include_directories") or [],
                "required_link_libraries": build.get("required_link_libraries") or [],
                "generated_support_headers": build.get("generated_support_headers") or [],
                "selected_capability_profile": selected_profile,
            },
        },
        "tooling_requirements": payload.get("tooling_requirements") if isinstance(payload.get("tooling_requirements"), dict) else None,
    }


def _compact_scope(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": payload.get("ok") is True if isinstance(payload, dict) else False,
        "resolved_board_id": _as_str(payload.get("resolved_board_id")) or None,
        "resolved_variant_id": _as_str(payload.get("resolved_variant_id")) or None,
        "resolved_capability_id": _as_str(payload.get("resolved_capability_id")) or None,
        "device_id": _as_str(payload.get("device_id")) or None,
        "should_stop": payload.get("should_stop") is True,
        "summary_for_user": _as_str(payload.get("summary_for_user")) or None,
        "recommended_tools": payload.get("recommended_tools") or [],
        "response_rules": payload.get("response_rules") or [],
    }


def _write_temp_source(source: str, language: str, binary_name: str | None) -> tuple[str, str]:
    ext = "cpp" if _as_str(language).lower() in {"cpp", "c++", "cxx"} else "c"
    base = re.sub(r"[^a-zA-Z0-9._-]+", "-", _as_str(binary_name) or "dbt-generated").strip("-") or "dbt-generated"
    temp_dir = Path(tempfile.mkdtemp(prefix="dbt-agent-codex-"))
    source_path = temp_dir / f"{base}.{ext}"
    source_path.write_text(source, encoding="utf-8")
    return str(source_path), base


def _rp2350_job(action: str, board: str | None, variant: str | None, device_id: str | None, **kwargs: Any) -> dict[str, Any]:
    target = _resolve_target(board, variant, device_id)
    payload: dict[str, Any] = {
        "action": action,
        "board_id": target["board_id"] or "RP2350",
        "variant_id": target["variant_id"] or target["board_id"] or "RP2350",
    }
    if target["device_id"]:
        payload["device_id"] = target["device_id"]
    for key, value in kwargs.items():
        if value is None:
            continue
        if isinstance(value, str) and not value:
            continue
        payload[key] = value
    created = _request("/v1/jobs/rp2350", method="POST", payload=payload, timeout=20)
    job_id = _as_str((created.get("job") or {}).get("job_id") if isinstance(created, dict) else "")
    if not job_id:
        raise RuntimeError(f"rp2350 {action} did not return a job id")
    deadline = time.time() + 180
    while time.time() < deadline:
        state = _request(f"/v1/jobs/{urllib.parse.quote(job_id)}", timeout=10)
        job = state.get("job") if isinstance(state, dict) and isinstance(state.get("job"), dict) else {}
        status = _as_str(job.get("state"))
        if status in {"finished", "failed", "error", "cancelled"}:
            result = job.get("result") if isinstance(job.get("result"), dict) else {}
            return {
                "ok": job.get("ok") is True or result.get("ok") is True,
                "job_id": job_id,
                "action": _as_str(result.get("action") or action),
                "state": status,
                "summary_for_user": _as_str(result.get("summary_for_user") or job.get("output_tail") or job.get("failure_summary") or result.get("output") or result.get("error")) or None,
                "board_id": _as_str(result.get("board_id") or payload.get("board_id")) or None,
                "variant_id": _as_str(result.get("variant_id") or payload.get("variant_id")) or None,
                "runtime_port": result.get("runtime_port") if isinstance(result.get("runtime_port"), dict) else None,
                "bootsel_present": result.get("bootsel_present") is True,
                "runtime_resettable": result.get("runtime_resettable") is True,
                "returncode": job.get("returncode"),
                "output": _as_str(result.get("output")) or None,
                "stdout_excerpt": _as_str(result.get("stdout_excerpt")) or None,
            }
        time.sleep(0.5)
    raise RuntimeError(f"timed out waiting for rp2350 job {job_id}")


def _fast_rp2350_detect(board: str, variant: str | None, device_id: str | None) -> dict[str, Any]:
    target = _resolve_target(board, variant, device_id)
    status = _status_summary()
    requested_device = _as_str(target["device_id"])
    requested_board = _as_str(target["board_id"])
    requested_variant = _as_str(target["variant_id"])
    devices = status.get("devices") or []
    filtered = []
    for item in devices:
        if not isinstance(item, dict):
            continue
        if requested_device and _as_str(item.get("device_id")) != requested_device:
            continue
        if requested_board not in {"", "RP2350"}:
            if _as_str(item.get("board_id")) != requested_board and _as_str(item.get("variant_id")) != requested_variant:
                continue
        filtered.append(item)
    active_id = _as_str(status.get("active_device_id") or status.get("device_id"))
    selected = None
    for item in filtered:
        if _as_str(item.get("device_id")) == active_id:
            selected = item
            break
    if selected is None and filtered:
        selected = filtered[0]
    ok = selected is not None or bool(filtered)
    if selected is not None:
        locator = _as_str(selected.get("transport_locator"))
        label = _as_str(selected.get("display_label") or selected.get("board_id"))
        summary = f"{label} 已连接"
        if locator:
            summary += f"，位置：{locator}"
    elif filtered:
        summary = f"检测到 {len(filtered)} 台 RP2350 设备"
    else:
        summary = "当前没有检测到匹配的 RP2350 设备"
    return {
        "ok": ok,
        "action": "detect",
        "state": "finished",
        "board_id": _as_str(selected.get("board_id")) if isinstance(selected, dict) else (requested_board or None),
        "variant_id": _as_str(selected.get("variant_id")) if isinstance(selected, dict) else (requested_variant or None),
        "device_id": _as_str(selected.get("device_id")) if isinstance(selected, dict) else (requested_device or None),
        "active_device_id": active_id or None,
        "devices": filtered,
        "summary_for_user": summary,
    }


@SERVER.tool(name="dbt_current_board_status", description="Get the current board status summary, including connected devices and the active device id.")
def dbt_current_board_status() -> dict[str, Any]:
    return _status_summary()


@SERVER.tool(name="dbt_list_connected_devices", description="Get the raw connected-device list and active device id when explicit picker-style enumeration is needed.")
def dbt_list_connected_devices() -> dict[str, Any]:
    return _status_summary()


@SERVER.tool(name="dbt_prepare_request", description="Resolve board, variant, capability, and recommended next DBT tools for a user request.")
def dbt_prepare_request(request: str, board: str | None = None, variant: str | None = None, device_id: str | None = None, capability: str | None = None) -> dict[str, Any]:
    target = _resolve_target(board, variant, device_id)
    payload = _request(
        "/v1/agent/resolve-scope",
        method="POST",
        payload={
            "user_text": _as_str(request),
            "board_id": target["board_id"] or "",
            "variant_id": target["variant_id"] or "",
            "device_id": target["device_id"] or "",
            "capability_id": _as_str(capability),
        },
        timeout=10,
    )
    return _compact_scope(payload)


@SERVER.tool(name="dbt_list_capability_summaries", description="List concise capability summaries for a board and variant.")
def dbt_list_capability_summaries(board: str, variant: str | None = None) -> dict[str, Any]:
    board_id = _normalize_board(board)
    variant_id = _normalize_variant(board_id, variant) or board_id
    query = urllib.parse.urlencode({"board_id": board_id, "variant_id": variant_id})
    return _request(f"/v1/context/capability-summaries?{query}", timeout=10)


@SERVER.tool(name="dbt_list_installed_board_plugins", description="List installed DBT board plugins.")
def dbt_list_installed_board_plugins() -> dict[str, Any]:
    return _request("/v1/plugins/installed", timeout=10)


@SERVER.tool(name="dbt_list_available_board_plugins", description="List available DBT board plugins from the local catalog.")
def dbt_list_available_board_plugins() -> dict[str, Any]:
    return _request("/v1/plugins/available", timeout=10)


@SERVER.tool(name="dbt_search_board_plugins", description="Search installed and available DBT board plugins.")
def dbt_search_board_plugins(query: str) -> dict[str, Any]:
    q = urllib.parse.quote(_as_str(query))
    return _request(f"/v1/plugins/search?q={q}", timeout=10)


@SERVER.tool(name="dbt_get_board_config", description="Get minimal board tooling config. For RP2350 boards this includes actual installed runtime/sdk/build root paths.")
def dbt_get_board_config(board: str, variant: str | None = None, probe_env: bool = False) -> dict[str, Any]:
    board_id = _normalize_board(board)
    variant_id = _normalize_variant(board_id, variant)
    if board_id in {"RP2350", "ColorEasyPICO2", "RaspberryPiPico2W"}:
        result = {"ok": True, **_rp2350_board_meta(board_id), "plugin_root": None, "runtime_contract": _rp2350_roots()}
        if probe_env:
            result["environment"] = _probe_rp2350_environment()
        return result
    payload = _tool("get_board_config", {"board_id": board_id, "variant_id": variant_id, "probe_env": probe_env}, timeout=20)
    result = _compact_board_config(payload, board_id, variant_id)
    if result.get("ok") is not True:
        plugin = _installed_plugin_meta(board_id)
        result["board_id"] = result.get("board_id") or _as_str(plugin.get("id")) or board_id
        result["variant_id"] = result.get("variant_id") or variant_id or board_id
        result["display_name"] = result.get("display_name") or _as_str(plugin.get("display_name")) or board_id
        result["manufacturer"] = result.get("manufacturer") or _as_str(plugin.get("manufacturer")) or None
        caps = _capability_ids(board_id, variant_id or board_id)
        if caps:
            result["capabilities"] = caps
        if probe_env and "environment" not in result:
            try:
                query = urllib.parse.urlencode({"board_id": board_id, "variant_id": variant_id or board_id, "profile": "full_build"})
                result["environment"] = _request(f"/v1/environment/check?{query}", timeout=20)
            except Exception:
                pass
        result["ok"] = True
    return result


@SERVER.tool(name="dbt_get_capability_context", description="Get the minimal implementation contract for a board capability.")
def dbt_get_capability_context(board: str, capability: str, variant: str | None = None) -> dict[str, Any]:
    board_id = _normalize_board(board)
    variant_id = _normalize_variant(board_id, variant) or board_id
    query = urllib.parse.urlencode({"board_id": board_id, "variant_id": variant_id, "capability_id": _as_str(capability)})
    payload = _request(f"/v1/context/capability?{query}", timeout=10)
    return _compact_capability_context(payload)


@SERVER.tool(name="dbt_check_board_environment", description="Check whether the selected board environment is installed.")
def dbt_check_board_environment(board: str, variant: str | None = None, profile: str | None = None) -> dict[str, Any]:
    board_id = _normalize_board(board)
    variant_id = _normalize_variant(board_id, variant) or board_id
    query = urllib.parse.urlencode({"board_id": board_id, "variant_id": variant_id, "profile": _as_str(profile)})
    return _request(f"/v1/environment/check?{query}", timeout=20)


@SERVER.tool(name="dbt_install_board_environment", description="Install the selected board environment through local dbt-agentd.")
def dbt_install_board_environment(board: str, variant: str | None = None, profile: str | None = None, force: bool = False) -> dict[str, Any]:
    board_id = _normalize_board(board)
    variant_id = _normalize_variant(board_id, variant) or board_id
    return _request(
        "/v1/environment/install",
        method="POST",
        payload={"board_id": board_id, "variant_id": variant_id, "profile": _as_str(profile), "force": force},
        timeout=180,
    )


@SERVER.tool(name="dbt_check_plugin_update", description="Check the current Development Board Toolchain runtime version against the configured release manifest.")
def dbt_check_plugin_update(source: str | None = None) -> dict[str, Any]:
    return _check_plugin_update_state(source)


@SERVER.tool(name="dbt_update_plugin", description="Update the local Development Board Toolchain runtime and dbt-agentd from the configured release manifest.")
def dbt_update_plugin(force: bool = False, source: str | None = None) -> dict[str, Any]:
    return _perform_plugin_update(source=source, force=force)


@SERVER.tool(name="dbt_probe_chip_control", description="Probe live chip-control data such as DDR frequency, CPU frequency, temperature, memory, or storage.")
def dbt_probe_chip_control(target: str, board: str | None = None, variant: str | None = None) -> dict[str, Any]:
    resolved = _resolve_target(board, variant, None)
    return _request(
        "/v1/tools/chip-control/probe",
        method="POST",
        payload={"board_id": resolved["board_id"] or "", "variant_id": resolved["variant_id"] or "", "target": _as_str(target)},
        timeout=15,
    )


@SERVER.tool(name="dbt_get_cpu_frequency", description="Get the live current CPU frequency from the connected board.")
def dbt_get_cpu_frequency(board: str | None = None, variant: str | None = None) -> dict[str, Any]:
    return dbt_probe_chip_control("cpu_current_frequency", board, variant)


@SERVER.tool(name="dbt_get_ddr_frequency", description="Get the live current DDR frequency from the connected board.")
def dbt_get_ddr_frequency(board: str | None = None, variant: str | None = None) -> dict[str, Any]:
    return dbt_probe_chip_control("ddr_current_frequency", board, variant)


@SERVER.tool(name="dbt_get_cpu_temperature", description="Get the live current CPU or SoC temperature from the connected board.")
def dbt_get_cpu_temperature(board: str | None = None, variant: str | None = None) -> dict[str, Any]:
    return dbt_probe_chip_control("soc_temperature", board, variant)


@SERVER.tool(name="dbt_probe_wifi_bluetooth", description="Probe live WiFi and Bluetooth module state or interface details.")
def dbt_probe_wifi_bluetooth(target: str, board: str | None = None, variant: str | None = None) -> dict[str, Any]:
    resolved = _resolve_target(board, variant, None)
    return _request(
        "/v1/tools/wifi-bluetooth/probe",
        method="POST",
        payload={"board_id": resolved["board_id"] or "", "variant_id": resolved["variant_id"] or "", "target": _as_str(target)},
        timeout=15,
    )


@SERVER.tool(name="dbt_connect_wifi", description="Connect the current board to a WiFi network through dbt-agentd.")
def dbt_connect_wifi(ssid: str, psk: str | None = None, key_mgmt: str | None = None, interface: str | None = None, config_path: str | None = None, board: str | None = None, variant: str | None = None, device_id: str | None = None) -> dict[str, Any]:
    target = _resolve_target(board, variant, device_id)
    return _request(
        "/v1/tools/wifi-bluetooth/connect",
        method="POST",
        payload={
            "board_id": target["board_id"] or "",
            "variant_id": target["variant_id"] or "",
            "device_id": target["device_id"] or "",
            "ssid": _as_str(ssid),
            "psk": _as_str(psk),
            "key_mgmt": _as_str(key_mgmt),
            "interface": _as_str(interface),
            "config_path": _as_str(config_path),
        },
        timeout=20,
    )


@SERVER.tool(name="dbt_scan_wifi_networks", description="Scan WiFi networks on the current board.")
def dbt_scan_wifi_networks(board: str | None = None, variant: str | None = None, interface: str | None = None, config_path: str | None = None) -> dict[str, Any]:
    resolved = _resolve_target(board, variant, None)
    return _request(
        "/v1/tools/wifi-bluetooth/scan",
        method="POST",
        payload={
            "board_id": resolved["board_id"] or "",
            "variant_id": resolved["variant_id"] or "",
            "interface": _as_str(interface),
            "config_path": _as_str(config_path),
        },
        timeout=20,
    )


@SERVER.tool(name="dbt_scan_bluetooth_devices", description="Scan nearby Bluetooth devices on the current board.")
def dbt_scan_bluetooth_devices(board: str | None = None, variant: str | None = None) -> dict[str, Any]:
    resolved = _resolve_target(board, variant, None)
    return _request(
        "/v1/tools/wifi-bluetooth/bluetooth-scan",
        method="POST",
        payload={"board_id": resolved["board_id"] or "", "variant_id": resolved["variant_id"] or ""},
        timeout=20,
    )


@SERVER.tool(name="dbt_build_run_program", description="Compile, upload, and run generated C/C++ source for a selected board capability.")
def dbt_build_run_program(capability: str, source: str, board: str | None = None, variant: str | None = None, device_id: str | None = None, language: str = "c", binary_name: str | None = None, remote_workdir: str | None = None, dry_run: bool = False) -> dict[str, Any]:
    target = _resolve_target(board, variant, device_id)
    source_file, base = _write_temp_source(source, language, binary_name)
    return _tool(
        "build_run_program",
        {
            "board_id": target["board_id"] or "",
            "variant_id": target["variant_id"] or "",
            "device_id": target["device_id"] or "",
            "capability": _as_str(capability),
            "source_file": source_file,
            "language": _as_str(language) or "c",
            "binary_name": _as_str(binary_name) or base,
            "remote_workdir": _as_str(remote_workdir),
            "dry_run": dry_run,
        },
        timeout=300,
    )


@SERVER.tool(name="dbt_ensure_usbnet", description="Ensure the macOS USB ECM host interface is configured to the expected static IP.")
def dbt_ensure_usbnet(board: str | None = None, variant: str | None = None, device_id: str | None = None) -> dict[str, Any]:
    target = _resolve_target(board, variant, device_id)
    return _tool("ensure_usbnet", {"board_id": target["board_id"] or "", "variant_id": target["variant_id"] or "", "device_id": target["device_id"] or ""}, timeout=20)


@SERVER.tool(name="dbt_update_logo", description="Replace the startup logo, rebuild assets, and optionally flash the board boot partition.")
def dbt_update_logo(logo_path: str, kernel_logo_path: str | None = None, rotate: str | None = None, scale: str | None = None, dtb_name: str | None = None, flash: bool = False, board: str | None = None, variant: str | None = None, device_id: str | None = None) -> dict[str, Any]:
    target = _resolve_target(board, variant, device_id)
    return _tool(
        "update_logo",
        {
            "board_id": target["board_id"] or "",
            "variant_id": target["variant_id"] or "",
            "device_id": target["device_id"] or "",
            "logo_path": _as_str(logo_path),
            "kernel_logo_path": _as_str(kernel_logo_path),
            "rotate": _as_str(rotate),
            "scale": _as_str(scale),
            "dtb_name": _as_str(dtb_name),
            "flash": flash,
        },
        timeout=180,
    )


@SERVER.tool(name="dbt_rp2350_detect", description="Detect the current RP2350 device state.")
def dbt_rp2350_detect(board: str = "RP2350", variant: str | None = None, device_id: str | None = None) -> dict[str, Any]:
    return _fast_rp2350_detect(board, variant, device_id)


@SERVER.tool(name="dbt_rp2350_set_board_model", description="Bind the current RP2350 hardware uid to a board profile such as ColorEasyPICO2 or RaspberryPiPico2W.")
def dbt_rp2350_set_board_model(board: str, variant: str | None = None, device_id: str | None = None) -> dict[str, Any]:
    return _rp2350_job("set_board_model", board, variant, device_id)


@SERVER.tool(name="dbt_rp2350_enter_bootsel", description="Switch the current RP2350 board into BOOTSEL mode.")
def dbt_rp2350_enter_bootsel(board: str = "RP2350", variant: str | None = None, device_id: str | None = None) -> dict[str, Any]:
    return _rp2350_job("enter_bootsel", board, variant, device_id)


@SERVER.tool(name="dbt_rp2350_flash", description="Flash a UF2 file to the current RP2350 board.")
def dbt_rp2350_flash(uf2_path: str, board: str = "RP2350", variant: str | None = None, device_id: str | None = None, allow_runtime_switch: bool = True) -> dict[str, Any]:
    return _rp2350_job("flash", board, variant, device_id, uf2_path=uf2_path, allow_runtime_switch=allow_runtime_switch)


@SERVER.tool(name="dbt_rp2350_verify", description="Verify a UF2 file against the current RP2350 board flash.")
def dbt_rp2350_verify(uf2_path: str, board: str = "RP2350", variant: str | None = None, device_id: str | None = None, allow_runtime_switch: bool = True) -> dict[str, Any]:
    return _rp2350_job("verify", board, variant, device_id, uf2_path=uf2_path, allow_runtime_switch=allow_runtime_switch)


@SERVER.tool(name="dbt_rp2350_run", description="Return the current RP2350 board to runtime mode.")
def dbt_rp2350_run(board: str = "RP2350", variant: str | None = None, device_id: str | None = None) -> dict[str, Any]:
    return _rp2350_job("run", board, variant, device_id)


@SERVER.tool(name="dbt_rp2350_tail_logs", description="Read recent serial log lines from the current RP2350 board.")
def dbt_rp2350_tail_logs(board: str = "RP2350", variant: str | None = None, device_id: str | None = None, lines: int = 40, follow: bool = False) -> dict[str, Any]:
    result = _rp2350_job("tail_logs", board, variant, device_id, lines=lines, follow=follow)
    if result.get("ok") is not True:
        result["ok"] = True
        result["log_lines"] = []
        result["summary_for_user"] = result.get("summary_for_user") or "当前没有可读取的串口日志，或运行态程序暂未输出日志。"
    return result


@SERVER.tool(name="dbt_rp2350_save_flash", description="Read back current RP2350 flash contents into a local output file.")
def dbt_rp2350_save_flash(output_path: str, board: str = "RP2350", variant: str | None = None, device_id: str | None = None, allow_runtime_switch: bool = True) -> dict[str, Any]:
    return _rp2350_job("save_flash", board, variant, device_id, output_path=output_path, allow_runtime_switch=allow_runtime_switch)


@SERVER.tool(name="dbt_rp2350_build_flash_source", description="Write a C/C++ source file to a temp workspace, build it through dbt-agentd, flash it to the current RP2350 board, and return the job result.")
def dbt_rp2350_build_flash_source(source: str, board: str = "RP2350", variant: str | None = None, device_id: str | None = None, language: str = "c", binary_name: str | None = None, allow_runtime_switch: bool = True) -> dict[str, Any]:
    target = _resolve_target(board, variant, device_id)
    source_file, base = _write_temp_source(source, language, binary_name)
    return _tool(
        "rp2350_build_flash_source",
        {
            "board_id": target["board_id"] or "RP2350",
            "variant_id": target["variant_id"] or target["board_id"] or "RP2350",
            "device_id": target["device_id"] or "",
            "source_file": source_file,
            "language": language,
            "binary_name": base,
            "workspace": str(Path.cwd()),
            "allow_runtime_switch": allow_runtime_switch,
        },
        timeout=300,
    )


if __name__ == "__main__":
    SERVER.run(transport="stdio")
