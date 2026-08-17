from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / "pob-runtime.lock.json"
SOURCE_ROOT = ROOT / "upstreams" / "PathOfBuilding-PoE2" / "src"
BUNDLE_ROOT = ROOT / "public" / "pob-lua"
PROJECT_SOURCE_ROOT = ROOT / "lua" / "superpoe"
PROJECT_BUNDLE_ROOT = ROOT / "public" / "superpoe-lua"
INCLUDE_DIRS = ["Classes", "Data", "Export", "Modules", "TreeData"]
INCLUDE_FILES = ["GameVersions.lua", "HeadlessWrapper.lua", "Launch.lua"]
# Files supplied by the checked-in Lua runtime dependency. Project modules are
# never allowed at the bundle root alongside these files.
RUNTIME_ROOT_FILES = ["base64.lua", "dkjson.lua", "lua-profiler.lua", "sha2.lua", "socket.lua", "xml.lua"]


def normalized_bytes(path: Path) -> bytes:
    return path.read_bytes().replace(b"\r\n", b"\n")


def iter_source_files(root: Path) -> list[Path]:
    files = [root / name for name in INCLUDE_FILES if (root / name).exists()]
    for dirname in INCLUDE_DIRS:
        directory = root / dirname
        if directory.exists():
            files.extend(directory.rglob("*.lua"))
    return sorted(set(files), key=lambda path: path.relative_to(root).as_posix().lower())


def source_tree_hash(root: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    files = iter_source_files(root)
    for path in files:
        relative = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        digest.update(normalized_bytes(path))
    return len(files), digest.hexdigest()


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def iter_project_files(root: Path) -> list[Path]:
    if not root.exists():
        return []
    return sorted(root.rglob("*.lua"), key=lambda path: path.relative_to(root).as_posix().lower())


def project_tree_hash(root: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    files = iter_project_files(root)
    for path in files:
        relative = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        digest.update(normalized_bytes(path))
    return len(files), digest.hexdigest()


def verify_project_bundle(verify_source: bool) -> tuple[int, str | None]:
    manifest_path = PROJECT_BUNDLE_ROOT / "manifest.json"
    if not manifest_path.is_file():
        raise SystemExit(f"Project Lua bundle manifest is missing: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 1 or manifest.get("name") != "superpoe":
        raise SystemExit("Unsupported project Lua bundle manifest")
    mismatches = []
    for entry in manifest.get("files", []):
        path = PROJECT_BUNDLE_ROOT / entry["path"]
        if not path.is_file() or file_hash(path) != entry.get("hash") or path.stat().st_size != entry.get("size"):
            mismatches.append(entry.get("path"))
    if mismatches:
        raise SystemExit(f"Project Lua bundle hash mismatch ({len(mismatches)}): {mismatches[:10]}")
    count, tree_hash = project_tree_hash(PROJECT_BUNDLE_ROOT)
    manifest_paths = {entry.get("path") for entry in manifest.get("files", [])}
    actual_paths = {path.relative_to(PROJECT_BUNDLE_ROOT).as_posix() for path in iter_project_files(PROJECT_BUNDLE_ROOT)}
    if manifest_paths != actual_paths:
        raise SystemExit(
            "Project Lua manifest file list mismatch: "
            f"missing={sorted(manifest_paths - actual_paths)}, extra={sorted(actual_paths - manifest_paths)}"
        )
    if count != manifest.get("fileCount"):
        raise SystemExit(
            f"Project Lua file count mismatch: expected {manifest.get('fileCount')}, got {count}"
        )
    source_hash: str | None = None
    if verify_source:
        if not PROJECT_SOURCE_ROOT.exists():
            raise SystemExit(f"Project Lua source directory is missing: {PROJECT_SOURCE_ROOT}")
        source_count, source_hash = project_tree_hash(PROJECT_SOURCE_ROOT)
        if source_count != count or source_hash != tree_hash:
            raise SystemExit(
                "Project Lua bundle does not match source tree: "
                f"bundle={count}/{tree_hash}, source={source_count}/{source_hash}"
            )
    return count, source_hash


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--verify-upstream",
        action="store_true",
        help="also require the local PoB checkout to match the pinned bundle source",
    )
    args = parser.parse_args()
    lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    manifest_path = BUNDLE_ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    expected_commit = lock["pob"]["commit"]
    if manifest.get("pob", {}).get("commit") != expected_commit:
        raise SystemExit("PoB bundle manifest does not match pob-runtime.lock.json")

    mismatches = []
    for entry in manifest["files"]:
        path = BUNDLE_ROOT / entry["path"]
        if not path.is_file() or file_hash(path) != entry["hash"]:
            mismatches.append(entry["path"])
    if mismatches:
        raise SystemExit(f"PoB bundle hash mismatch ({len(mismatches)}): {mismatches[:10]}")

    allowed_root_lua = set(INCLUDE_FILES + RUNTIME_ROOT_FILES)
    unexpected_root_lua = sorted(path.name for path in BUNDLE_ROOT.glob("*.lua") if path.name not in allowed_root_lua)
    if unexpected_root_lua:
        raise SystemExit(
            "PoB bundle contains non-upstream root Lua files: "
            f"{unexpected_root_lua}; move project Lua to public/superpoe-lua"
        )

    bundle_source_count, bundle_source_hash = source_tree_hash(BUNDLE_ROOT)
    expected_source_hash = lock["pob"]["sourceTreeHash"]
    if bundle_source_hash != expected_source_hash:
        raise SystemExit(
            "Committed PoB bundle does not match the pinned source tree: "
            f"expected {expected_source_hash}, got {bundle_source_hash}"
        )
    expected_source_count = manifest.get("pob", {}).get("sourceFileCount")
    if expected_source_count != bundle_source_count:
        raise SystemExit(
            f"Committed PoB source file count mismatch: expected {expected_source_count}, "
            f"got {bundle_source_count}"
        )

    if args.verify_upstream:
        if not SOURCE_ROOT.exists():
            raise SystemExit(f"PoB source checkout is missing: {SOURCE_ROOT}")
        count, actual_hash = source_tree_hash(SOURCE_ROOT)
        if actual_hash != expected_source_hash:
            raise SystemExit(
                f"PoB source snapshot mismatch: expected {expected_source_hash}, got {actual_hash}"
            )
        print(f"PoB source: {count} files, commit {expected_commit}, hash {actual_hash}")

    project_count, project_source_hash = verify_project_bundle(args.verify_upstream)

    for binary in lock["luajit"].get("binaries", []):
        path = ROOT / binary["path"]
        if not path.is_file():
            raise SystemExit(f"Committed LuaJIT binary is missing: {binary['path']}")
        actual_size = path.stat().st_size
        if actual_size != binary["size"]:
            raise SystemExit(
                f"LuaJIT binary size mismatch for {binary['path']}: "
                f"expected {binary['size']}, got {actual_size}"
            )
        actual_hash = file_hash(path)
        if actual_hash != binary["sha256"]:
            raise SystemExit(
                f"LuaJIT binary hash mismatch for {binary['path']}: "
                f"expected {binary['sha256']}, got {actual_hash}"
            )
        if binary["platform"] == "darwin" and os.name != "nt":
            if path.stat().st_mode & 0o111 == 0:
                raise SystemExit(f"LuaJIT binary is not executable: {binary['path']}")

    print(
        f"PoB bundle: {manifest['fileCount']} files, {bundle_source_count} pinned source files, "
        "all hashes valid"
    )
    project_suffix = f", source hash {project_source_hash}" if project_source_hash else ""
    print(f"SuperPoE Lua bundle: {project_count} project files{project_suffix}, all hashes valid")
    print(f"LuaJIT binaries: {len(lock['luajit'].get('binaries', []))} files, all hashes valid")


if __name__ == "__main__":
    main()
