from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
DATA = PUBLIC / "data"
OUTPUT = DATA / "resource-manifest.json"
POB = ROOT / "upstreams" / "PathOfBuilding-PoE2"
POECHARM = ROOT / "upstreams" / "PoeCharm2"


def load_json(path: Path) -> Any:
    if not path.is_file():
        raise RuntimeError(f"Missing required generated file: {path.relative_to(ROOT)}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Invalid JSON in {path.relative_to(ROOT)}: {error}") from error


def git_value(path: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(path), *args],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return result.stdout.strip() or None


def upstream_info(path: Path) -> dict[str, Any]:
    if not path.is_dir():
        raise RuntimeError(f"Missing upstream checkout: {path.relative_to(ROOT)}")
    status = git_value(path, "status", "--porcelain")
    return {
        "repository": git_value(path, "config", "--get", "remote.origin.url"),
        "commit": git_value(path, "rev-parse", "HEAD"),
        "dirty": bool(status),
    }


def public_path(value: str) -> Path:
    relative = value.lstrip("/")
    path = (PUBLIC / relative).resolve()
    path.relative_to(PUBLIC.resolve())
    return path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_local_paths(label: str, paths: set[str], errors: list[str]) -> None:
    for value in sorted(paths):
        path = public_path(value)
        if not path.is_file() or path.stat().st_size == 0:
            errors.append(f"{label}: missing or empty {value}")


def validate_and_collect(version: str) -> tuple[dict[str, Any], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    skill_catalog = load_json(DATA / "skill-catalog.json")
    item_icons = load_json(DATA / "item-icons.json")
    skill_icons = load_json(DATA / "skill-icons.json")
    rune_details = load_json(DATA / "rune-details.json")
    item_bases = load_json(DATA / "item-bases.json")
    tree_versions = load_json(DATA / "tree-versions.json")
    translations = load_json(DATA / "Translate" / "translation-files.json")
    lua_manifest = load_json(PUBLIC / "pob-lua" / "manifest.json")

    visible_skills = [entry for entry in skill_catalog.get("entries", {}).values() if entry.get("userVisible")]
    skill_paths = {entry["icon"] for entry in visible_skills if entry.get("icon")}
    validate_local_paths("skill", skill_paths, errors)
    for entry in visible_skills:
        if not entry.get("icon"):
            errors.append(f"skill: no icon for {entry.get('id')} ({entry.get('name')})")
        if not entry.get("description"):
            warnings.append(f"skill: no upstream description for {entry.get('id')} ({entry.get('name')})")

    granted_skill_details = [
        detail for detail in rune_details.get("lookup", {}).values()
        if detail.get("variants", {}).get("skill")
    ]
    granted_skill_localizations = {
        language: sum(bool(
            detail.get("variants", {}).get("skill", {}).get("localizedStats", {}).get(language)
        ) for detail in granted_skill_details)
        for language in ("zh-rCN", "zh-rTW", "ko-KR")
    }
    for language, count in granted_skill_localizations.items():
        if count < len(granted_skill_details):
            warnings.append(
                f"skill: {language} item-granted descriptions {count}/{len(granted_skill_details)}"
            )
    item_paths = {item.get("path") for item in item_icons.get("items", []) if item.get("path")}
    validate_local_paths("item", item_paths, errors)
    indexed_skill_paths = {item.get("path") for item in skill_icons.get("items", []) if item.get("path")}
    validate_local_paths("skill-index", indexed_skill_paths, errors)

    versions = [value for value in tree_versions if isinstance(value, str)]
    if version not in versions:
        errors.append(f"tree: requested version {version} is absent from tree-versions.json")
    for tree_version in versions:
        tree_path = DATA / f"tree-web-{tree_version}.json"
        if not tree_path.is_file() or tree_path.stat().st_size == 0:
            errors.append(f"tree: missing data/tree-web-{tree_version}.json")
        for asset_dir in ("dds", "orbit", "connectors"):
            path = PUBLIC / "assets" / asset_dir / tree_version
            if not path.is_dir() or not any(file.is_file() for file in path.rglob("*")):
                errors.append(f"tree: missing assets/{asset_dir}/{tree_version}")

    for language, files in translations.get("languages", {}).items():
        for filename in files:
            path = DATA / "Translate" / language / filename
            if not path.is_file() or path.stat().st_size == 0:
                errors.append(f"translation: missing data/Translate/{language}/{filename}")

    for entry in lua_manifest.get("files", []):
        path = PUBLIC / "pob-lua" / entry["path"]
        if not path.is_file() or path.stat().st_size != entry.get("size"):
            errors.append(f"lua: missing or changed pob-lua/{entry.get('path')}")

    stats = {
        "treeVersions": versions,
        "itemIcons": len(item_icons.get("items", [])),
        "itemBases": len(item_bases.get("bases", {})),
        "runeDetails": len(rune_details.get("lookup", {})),
        "itemGrantedSkillDescriptions": {
            "total": len(granted_skill_details),
            **granted_skill_localizations,
        },
        "skillIcons": len(skill_icons.get("items", [])),
        "skills": skill_catalog.get("stats", {}),
        "translationLanguages": {
            language: len(files) for language, files in translations.get("languages", {}).items()
        },
        "luaFiles": len(lua_manifest.get("files", [])),
    }
    return {"stats": stats, "warnings": warnings}, errors


def generated_files() -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    for path in sorted(PUBLIC.rglob("*"), key=lambda value: value.relative_to(PUBLIC).as_posix().lower()):
        if not path.is_file() or path == OUTPUT or path.suffix == ".tmp":
            continue
        files.append({
            "path": path.relative_to(PUBLIC).as_posix(),
            "size": path.stat().st_size,
            "hash": sha256(path),
        })
    return files


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate generated resources and build the global manifest")
    parser.add_argument("version", nargs="?", default="0_5")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()

    report, errors = validate_and_collect(args.version)
    if errors:
        print("Resource validation failed:")
        for error in errors[:100]:
            print(f"  - {error}")
        raise SystemExit(1)

    print(f"[ok] Resource references valid; {len(report['warnings'])} documented warnings")
    if args.validate_only:
        return

    files = generated_files()
    manifest = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dataVersion": args.version,
        "sources": {
            "pathOfBuilding": upstream_info(POB),
            "poeCharm": upstream_info(POECHARM),
            "poe2db": {
                "site": "https://poe2db.tw/",
                "runtimeDependency": False,
            },
        },
        **report,
        "fileCount": len(files),
        "totalBytes": sum(entry["size"] for entry in files),
        "files": files,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] Resource manifest: {len(files)} files, {manifest['totalBytes']} bytes -> {OUTPUT}")


if __name__ == "__main__":
    main()
