#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
copy_orbit_png.py - Copy orbit PNG sprites from TreeData/ to web/public/assets/orbit/

Copies orbit ring sprite PNGs from TreeData/{version}/ to web/public/assets/orbit/{version}/.
Handles both naming conventions:
  - 0_1: orbit_active{0-9}.png, orbit_intermediate{0-9}.png, orbit_normal{0-9}.png
  - 0_4: Character_orbit_intermediate{0-9}.png, CharacterAscendancy_orbit_normal{0-9}.png, etc.

These are the ring decorations drawn behind each node on the passive skill tree.

Usage:
  cd web
  python scripts/copy_orbit_png.py              # default: copy 0_4 -> public/assets/orbit/0_4/
  python scripts/copy_orbit_png.py 0_4 0_1      # copy both versions
  python scripts/copy_orbit_png.py --all         # copy all available versions
"""

import shutil
import sys
from pathlib import Path


ORBIT_PNG_PATTERNS = [
    # 0_1 convention (prefix-free)
    "orbit_active",
    "orbit_intermediate",
    "orbit_normal",
    # 0_4 convention (Character_ / CharacterAscendancy_ / CharacterPlanned_)
    "Character_orbit_intermediate",
    "Character_orbit_intermediateactive",
    "Character_orbit_normal",
    "CharacterAscendancy_orbit_intermediate",
    "CharacterAscendancy_orbit_intermediateactive",
    "CharacterAscendancy_orbit_normal",
    "CharacterPlanned_orbit_intermediate",
    "CharacterPlanned_orbit_intermediateactive",
    "CharacterPlanned_orbit_normal",
]


def copy_orbit_pngs(tree_version: str, web_dir: Path, source: Path | None = None, output: Path | None = None) -> int:
    """Copy orbit PNGs for a single tree version. Returns number of files copied."""
    src_dir = source or (web_dir / "upstreams" / "PathOfBuilding-PoE2" / "src" / "TreeData" / tree_version)
    dst_dir = output or (web_dir / "public" / "assets" / "orbit" / tree_version)

    if not src_dir.is_dir():
        print(f"  [skip] TreeData/{tree_version}/ not found")
        return 0

    dst_dir.mkdir(parents=True, exist_ok=True)

    found = 0
    copied = 0
    for pattern in ORBIT_PNG_PATTERNS:
        for orbit_idx in range(10):  # 0..9
            filename = f"{pattern}{orbit_idx}.png"
            src = src_dir / filename
            if src.exists():
                found += 1
                dst = dst_dir / filename
                if not dst.exists() or src.stat().st_mtime > dst.stat().st_mtime:
                    shutil.copy2(src, dst)
                    copied += 1

    if found:
        print(f"  [ok] TreeData/{tree_version}/ -> public/assets/orbit/{tree_version}/ ({found} PNGs, {copied} copied)")
    else:
        print(f"  [warn] TreeData/{tree_version}/: no orbit PNGs found")
    return found


def main():
    import argparse

    web_dir = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description="Copy orbit PNG sprites")
    ap.add_argument("versions", nargs="*", help="Tree versions to copy")
    ap.add_argument("--all", action="store_true", help="Copy all available versions")
    ap.add_argument("--source", help="Source TreeData directory")
    ap.add_argument("--output", help="Output orbit directory")
    args = ap.parse_args()

    if args.source:
        source = Path(args.source)
        tree_version = source.name
        total = copy_orbit_pngs(
            tree_version,
            web_dir,
            source=source,
            output=Path(args.output) if args.output else None,
        )
        print(f"\nDone: {total} orbit PNG files copied to web/public/assets/orbit/")
        return

    if not args.versions and not args.all:
        versions = ["0_4"]
    elif args.all:
        # Discover all TreeData/*/ directories
        tree_data_dir = web_dir / "upstreams" / "PathOfBuilding-PoE2" / "src" / "TreeData"
        versions = sorted(
            d.name for d in tree_data_dir.iterdir()
            if d.is_dir() and ((d / "tree.json").exists() or (d / "tree.lua").exists())
        )
    else:
        versions = args.versions

    total = 0
    for ver in versions:
        total += copy_orbit_pngs(ver, web_dir)

    print(f"\nDone: {total} orbit PNG files copied to web/public/assets/orbit/")


if __name__ == "__main__":
    main()
