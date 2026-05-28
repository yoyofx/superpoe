#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
copy_ui_assets.py - Copy UI sprite assets from Assets/ to web/public/assets/ui/

Copies passive-tree-related UI images from the project's Assets/ folder to the web
public directory where Vite can serve them directly.

Included assets:
  - Ring decorations: ring.png, small_ring.png, ShadedInnerRing.png, etc.
  - Passive headers: normalpassiveheader*.png, notablepassiveheader*.png, etc.
  - Range guide: range_guide.png

Usage:
  cd web
  python scripts/copy_ui_assets.py              # copy all relevant UI assets
  python scripts/copy_ui_assets.py --dry-run    # list what would be copied
"""

import shutil
import sys
from pathlib import Path


# Patterns to match from Assets/ (glob-style prefix match)
ASSET_PATTERNS = [
    # Ring decorations
    "ring.png",
    "small_ring.png",
    "ShadedInnerRing",
    "ShadedOuterRing",
    "range_guide.png",
    # Passive node headers
    "normalpassiveheader",
    "notablepassiveheader",
    "keystonepassiveheader",
    "jewelpassiveheader",
    "ascendancypassiveheader",
    "oraclenormalpassiveheader",
    "oraclenotablepassiveheader",
    "oraclekeystonepassiveheader",
    # Item/skill icons (for future phases)
    "game_ui_small.png",
    "fractureditemsymbol.png",
    "veileditemsymbol.png",
    "vaalitemicon.png",
    "gemhovermodbg.png",
    "hovermodbgabyss.png",
]


def copy_assets(web_dir: Path, dry_run: bool = False) -> int:
    """Copy matching assets from Assets/ to web/public/assets/ui/. Returns count."""
    src_dir = web_dir / "sources" / "src" / "Assets"
    dst_dir = web_dir / "public" / "assets" / "ui"

    if not src_dir.is_dir():
        print("  [error] Assets/ directory not found")
        return 0

    if not dry_run:
        dst_dir.mkdir(parents=True, exist_ok=True)

    count = 0
    existing = set(p.name.lower() for p in src_dir.iterdir()) if src_dir.is_dir() else set()

    for pattern in ASSET_PATTERNS:
        pattern_lower = pattern.lower()
        for src_path in sorted(src_dir.iterdir()):
            if not src_path.is_file():
                continue
            name_lower = src_path.name.lower()
            if name_lower.startswith(pattern_lower.rstrip(".png")) or name_lower == pattern_lower:
                dst = dst_dir / src_path.name
                if dry_run:
                    print(f"  [dry-run] {src_path.name}")
                else:
                    if not dst.exists() or src_path.stat().st_mtime > dst.stat().st_mtime:
                        shutil.copy2(src_path, dst)
                count += 1
                break

    if dry_run:
        print(f"\nWould copy {count} files to public/assets/ui/")
    else:
        print(f"  [ok] Assets/ -> public/assets/ui/ ({count} files)")
    return count


def main():
    web_dir = Path(__file__).resolve().parent.parent

    dry_run = "--dry-run" in sys.argv

    copy_assets(web_dir, dry_run=dry_run)
    print("Done.")


if __name__ == "__main__":
    main()
