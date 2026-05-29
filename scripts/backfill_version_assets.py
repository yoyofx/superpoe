#!/usr/bin/env python3
"""Copy missing generated assets from an older tree version into a new version."""

import argparse
import json
import shutil
from pathlib import Path


def copy_missing_tree(src_dir: Path, dst_dir: Path) -> tuple[int, int]:
    if not src_dir.exists():
        return 0, 0

    copied = 0
    skipped = 0
    for src in src_dir.rglob("*"):
        if not src.is_file():
            continue
        rel = src.relative_to(src_dir)
        dst = dst_dir / rel
        if dst.exists():
            skipped += 1
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied += 1
    return copied, skipped


def rewrite_dds_entry(entry: dict, version: str) -> dict:
    next_entry = dict(entry)
    file_value = next_entry.get("file")
    if isinstance(file_value, str):
        parts = file_value.split("/")
        if len(parts) >= 4 and parts[0] == "assets" and parts[1] == "dds":
            parts[2] = version
            next_entry["file"] = "/".join(parts)
    return next_entry


def merge_dds_index(src_dir: Path, dst_dir: Path, version: str) -> tuple[int, int]:
    src_index_path = src_dir / "sprite-index.json"
    dst_index_path = dst_dir / "sprite-index.json"
    if not src_index_path.exists():
        return 0, 0

    try:
        src_index = json.loads(src_index_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return 0, 0

    dst_index = {}
    if dst_index_path.exists():
        try:
            loaded = json.loads(dst_index_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                dst_index = loaded
        except json.JSONDecodeError:
            dst_index = {}

    added = 0
    kept = 0
    for key, entry in src_index.items():
        if key in dst_index:
            kept += 1
            continue
        if isinstance(entry, dict):
            dst_index[key] = rewrite_dds_entry(entry, version)
            added += 1

    dst_dir.mkdir(parents=True, exist_ok=True)
    dst_index_path.write_text(json.dumps(dst_index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return added, kept


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill missing assets from an older tree version")
    parser.add_argument("version", help="Target tree version, for example 0_5")
    parser.add_argument("--fallback-version", default="0_4")
    parser.add_argument(
        "--assets-root",
        default=Path(__file__).resolve().parents[1] / "public" / "assets",
        type=Path,
    )
    args = parser.parse_args()

    if args.version == args.fallback_version:
        print(f"Backfill skipped for fallback version {args.version}")
        return

    assets_root: Path = args.assets_root
    total_copied = 0

    for family in ("dds", "connectors", "orbit"):
        src_dir = assets_root / family / args.fallback_version
        dst_dir = assets_root / family / args.version
        copied, skipped = copy_missing_tree(src_dir, dst_dir)
        total_copied += copied
        print(f"{family}: copied {copied}, kept {skipped}")

        if family == "dds":
            added, kept = merge_dds_index(src_dir, dst_dir, args.version)
            print(f"{family} index: added {added}, kept {kept}")

    print(f"Backfill complete for {args.version}: copied {total_copied} missing files")


if __name__ == "__main__":
    main()
