from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "sources" / "src"
DEFAULT_RUNTIME = ROOT / "sources" / "runtime" / "lua"
DEFAULT_OUT = ROOT / "public" / "pob-lua"

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


def copy_bundle(source: Path, runtime: Path, out: Path) -> dict:
    if not source.exists():
        raise SystemExit(f"Missing source directory: {source}")
    out.mkdir(parents=True, exist_ok=True)

    entries = []
    for src in iter_lua_files(source):
        rel = src.relative_to(source).as_posix()
        dst = out / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        entries.append({
            "path": rel,
            "hash": sha256(dst),
            "size": dst.stat().st_size,
        })
    for src in iter_runtime_files(runtime):
        rel = src.relative_to(runtime).as_posix()
        dst = out / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        entries.append({
            "path": rel,
            "hash": sha256(dst),
            "size": dst.stat().st_size,
        })

    manifest = {
        "version": "0_5",
        "source": "sources/src",
        "runtime": "sources/runtime/lua",
        "fileCount": len(entries),
        "totalBytes": sum(entry["size"] for entry in entries),
        "files": sorted(entries, key=lambda entry: entry["path"].lower()),
    }
    (out / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Build browser-readable PoB Lua bundle")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--runtime", type=Path, default=DEFAULT_RUNTIME)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    manifest = copy_bundle(args.source, args.runtime, args.out)
    print(
        f"PoB Lua bundle: {manifest['fileCount']} files, "
        f"{manifest['totalBytes'] / 1024 / 1024:.2f} MiB -> {args.out}"
    )


if __name__ == "__main__":
    main()
