from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / "pob-runtime.lock.json"
DEFAULT_SOURCE = ROOT / "upstreams" / "PathOfBuilding-PoE2" / "src"
DEFAULT_RUNTIME = ROOT / "upstreams" / "PathOfBuilding-PoE2" / "runtime" / "lua"
DEFAULT_OUT = ROOT / "public" / "pob-lua"
DEFAULT_PROJECT_SOURCE = ROOT / "lua" / "superpoe"
DEFAULT_PROJECT_OUT = ROOT / "public" / "superpoe-lua"

INCLUDE_DIRS = [
    "Classes",
    "Data",
    "Export",
    "Modules",
    "TreeData",
]

INCLUDE_FILES = [
    "GameVersions.lua",
    "HeadlessWrapper.lua",
    "Launch.lua",
]

BROWSER_SOURCE_PATCHES = {
    "Classes/TradeHelpers.lua": [
        (
            ':gsub("{.-} to {.-}", string.format("(%s to %s)", numberPattern, numberPattern))',
            ':gsub("{.-} to {.-}", function()\n'
            '\t\t\t\treturn string.format("(%s to %s)", numberPattern, numberPattern)\n'
            '\t\t\tend)',
        ),
        (
            '"%%%+%?(%%%-%?" .. numberPattern .. ")")',
            'function()\n'
            '\t\t\t\t\treturn "%%%+%?(%%%-%?" .. numberPattern .. ")"\n'
            '\t\t\t\tend)',
        ),
    ],
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def iter_lua_files(source: Path) -> list[Path]:
    files: list[Path] = []
    for name in INCLUDE_FILES:
        path = source / name
        if path.exists():
            files.append(path)
    for dirname in INCLUDE_DIRS:
        directory = source / dirname
        if not directory.exists():
            continue
        files.extend(sorted(directory.rglob("*.lua")))
    return sorted(set(files), key=lambda p: p.relative_to(source).as_posix().lower())


def iter_runtime_files(runtime: Path) -> list[Path]:
    if not runtime.exists():
        return []
    return sorted(runtime.rglob("*.lua"), key=lambda p: p.relative_to(runtime).as_posix().lower())


def copy_file(src: Path, dst: Path, label: str) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if not dst.exists() or sha256(src) != sha256(dst):
        try:
            shutil.copy2(src, dst)
        except OSError as error:
            raise SystemExit(f"Failed to copy {label}: {error}") from error


def remove_stale_lua(out: Path, expected_paths: set[str]) -> None:
    """Remove obsolete generated Lua files without touching other resources."""
    for path in out.rglob("*.lua"):
        if path.relative_to(out).as_posix() not in expected_paths:
            path.unlink()


def copy_bundle(source: Path, runtime: Path, out: Path) -> dict:
    if not source.exists():
        raise SystemExit(f"Missing source directory: {source}")
    out.mkdir(parents=True, exist_ok=True)

    lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    runtime_manifest = out / "manifest.xml"
    runtime_manifest.write_text(
        f'<PoBVersion><Version number="{lock["pob"]["version"]}"/></PoBVersion>\n',
        encoding="utf-8",
        newline="\n",
    )
    entries = [{
        "path": "manifest.xml",
        "hash": sha256(runtime_manifest),
        "size": runtime_manifest.stat().st_size,
    }]
    for src in iter_lua_files(source):
        rel = src.relative_to(source).as_posix()
        dst = out / rel
        copy_file(src, dst, f"Lua source {rel}")
        entries.append({
            "path": rel,
            "hash": sha256(dst),
            "size": dst.stat().st_size,
        })
    for src in iter_runtime_files(runtime):
        rel = src.relative_to(runtime).as_posix()
        dst = out / rel
        copy_file(src, dst, f"Lua runtime {rel}")
        entries.append({
            "path": rel,
            "hash": sha256(dst),
            "size": dst.stat().st_size,
        })
    remove_stale_lua(out, {entry["path"] for entry in entries})
    from verify_pob_runtime import source_tree_hash

    source_count, actual_source_hash = source_tree_hash(source)
    expected_source_hash = lock["pob"]["sourceTreeHash"]
    if actual_source_hash != expected_source_hash:
        raise SystemExit(
            "PoB source does not match the pinned commit: "
            f"expected {expected_source_hash}, got {actual_source_hash}"
        )

    manifest = {
        "version": "0_5",
        "pob": {
            "repository": lock["pob"]["repository"],
            "commit": lock["pob"]["commit"],
            "version": lock["pob"]["version"],
            "sourceTreeHash": actual_source_hash,
            "sourceFileCount": source_count,
        },
        "source": "upstreams/PathOfBuilding-PoE2/src",
        "runtime": "upstreams/PathOfBuilding-PoE2/runtime/lua",
        "browserPatches": sorted(BROWSER_SOURCE_PATCHES),
        "fileCount": len(entries),
        "totalBytes": sum(entry["size"] for entry in entries),
        "files": sorted(entries, key=lambda entry: entry["path"].lower()),
    }
    (out / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def copy_project_bundle(source: Path, out: Path) -> dict:
    """Build the project-owned Lua bundle separately from the pinned PoB files."""
    if not source.exists():
        raise SystemExit(f"Missing project Lua source directory: {source}")
    out.mkdir(parents=True, exist_ok=True)
    entries = []
    for src in sorted(source.rglob("*.lua"), key=lambda p: p.relative_to(source).as_posix().lower()):
        rel = src.relative_to(source).as_posix()
        dst = out / rel
        copy_file(src, dst, f"project Lua source {rel}")
        entries.append({
            "path": rel,
            "hash": sha256(dst),
            "size": dst.stat().st_size,
        })
    remove_stale_lua(out, {entry["path"] for entry in entries})
    manifest = {
        "schemaVersion": 1,
        "name": "superpoe",
        "source": "lua/superpoe",
        "fileCount": len(entries),
        "totalBytes": sum(entry["size"] for entry in entries),
        "files": entries,
    }
    (out / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Build separate PoB and SuperPoE Lua bundles")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--runtime", type=Path, default=DEFAULT_RUNTIME)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--project-source", type=Path, default=DEFAULT_PROJECT_SOURCE)
    parser.add_argument("--project-out", type=Path, default=DEFAULT_PROJECT_OUT)
    args = parser.parse_args()

    manifest = copy_bundle(args.source, args.runtime, args.out)
    project_manifest = copy_project_bundle(args.project_source, args.project_out)
    print(
        f"PoB Lua bundle: {manifest['fileCount']} files, "
        f"{manifest['totalBytes'] / 1024 / 1024:.2f} MiB -> {args.out}"
    )
    print(
        f"SuperPoE Lua bundle: {project_manifest['fileCount']} files, "
        f"{project_manifest['totalBytes'] / 1024:.1f} KiB -> {args.project_out}"
    )


if __name__ == "__main__":
    main()
