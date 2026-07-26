from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / "pob-runtime.lock.json"
SOURCE_ROOT = ROOT / "upstreams" / "PathOfBuilding-PoE2" / "src"
BUNDLE_ROOT = ROOT / "public" / "pob-lua"
INCLUDE_DIRS = ["Classes", "Data", "Export", "Modules", "TreeData"]
INCLUDE_FILES = ["GameVersions.lua", "HeadlessWrapper.lua", "Launch.lua"]


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


def main() -> None:
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

    if SOURCE_ROOT.exists():
        count, actual_hash = source_tree_hash(SOURCE_ROOT)
        expected_hash = lock["pob"]["sourceTreeHash"]
        if actual_hash != expected_hash:
            raise SystemExit(
                f"PoB source snapshot mismatch: expected {expected_hash}, got {actual_hash}"
            )
        print(f"PoB source: {count} files, commit {expected_commit}, hash {actual_hash}")

    print(f"PoB bundle: {manifest['fileCount']} files, all hashes valid")


if __name__ == "__main__":
    main()
