#!/usr/bin/env python3
"""
One-click master script to regenerate all web assets from the PoB2 upstream.
Run after git pull of upstreams/PathOfBuilding-PoE2/ to update game data.

Usage:
  python web/scripts/extract_game_assets.py              # All assets
  python web/scripts/extract_game_assets.py --skip-dds   # Skip DDS (slow)
  python web/scripts/extract_game_assets.py --version 0_1 # Specific version
  python web/scripts/extract_game_assets.py --dry-run     # List what would run
"""
import subprocess
import sys
import os
import time
import json
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent
WEB_DIR = SCRIPTS_DIR.parent
SOURCES_DIR = WEB_DIR / 'upstreams' / 'PathOfBuilding-PoE2' / 'src'


def run_step(name, args, skip=False):
    """Run a preprocessing step and report timing."""
    if skip:
        print(f"  [SKIP] {name}")
        return True, 0
    
    print(f"  [{name}] ", end='', flush=True)
    t0 = time.time()
    try:
        result = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / args[0])] + args[1:],
            cwd=str(WEB_DIR.parent),
            capture_output=True,
            text=True,
            timeout=300
        )
        elapsed = time.time() - t0
        if result.returncode == 0:
            print(f"OK ({elapsed:.1f}s)")
            # Print last line of output for summary
            for line in result.stdout.strip().split('\n')[-3:]:
                if line.strip():
                    print(f"    {line.strip()}")
            return True, elapsed
        else:
            print(f"FAIL ({elapsed:.1f}s)")
            print(f"    {result.stderr[:200]}")
            return False, elapsed
    except subprocess.TimeoutExpired:
        elapsed = time.time() - t0
        print(f"TIMEOUT ({elapsed:.1f}s)")
        return False, elapsed
    except Exception as e:
        elapsed = time.time() - t0
        print(f"ERROR: {e}")
        return False, elapsed


def main():
    import argparse
    ap = argparse.ArgumentParser(description='Extract all game assets for PoB2 Web')
    ap.add_argument('--version', default='0_4', help='Tree version (0_1, 0_4)')
    ap.add_argument('--skip-dds', action='store_true', help='Skip DDS pipeline (slow)')
    ap.add_argument('--skip-orbit', action='store_true', help='Skip orbit PNG copy')
    ap.add_argument('--skip-ui', action='store_true', help='Skip UI assets copy')
    ap.add_argument('--skip-tree', action='store_true', help='Skip tree data generation')
    ap.add_argument('--skip-backfill', action='store_true', help='Skip copying missing assets from fallback version')
    ap.add_argument('--fallback-version', help='Asset fallback version used for backfill (defaults to newest existing version)')
    ap.add_argument('--dry-run', action='store_true', help='List steps without running')
    args = ap.parse_args()
    
    version = args.version
    fallback_version = args.fallback_version
    if not fallback_version:
        manifest_path = WEB_DIR / 'public' / 'data' / 'tree-versions.json'
        try:
            existing_versions = json.loads(manifest_path.read_text(encoding='utf-8'))
            fallback_version = next((item for item in existing_versions if isinstance(item, str) and item != version), None)
        except (OSError, json.JSONDecodeError):
            fallback_version = None
    fallback_version = fallback_version or '0_4'
    tree_data_dir = SOURCES_DIR / 'TreeData' / version
    
    if not tree_data_dir.exists() and not args.dry_run:
        print(f"ERROR: TreeData/{version} not found at {tree_data_dir}")
        print("Make sure upstreams/PathOfBuilding-PoE2/ is available.")
        sys.exit(1)
    
    steps = [
        ("Prepare Fallback Version Assets",
         ['backfill_version_assets.py', version, '--fallback-version', fallback_version],
         args.skip_backfill),
        ("Tree Data (tree-web.json)", 
         ['gen_tree_data.py', version, str(tree_data_dir / 'tree.json'),
          str(WEB_DIR / 'public' / 'data' / f'tree-web-{version}.json')],
         args.skip_tree),
        ("Orbit PNGs",
         ['copy_orbit_png.py', '--source', str(tree_data_dir),
          '--output', str(WEB_DIR / 'public' / 'assets' / 'orbit' / version)],
         args.skip_orbit),
        ("UI Assets",
         ['copy_ui_assets.py', '--source', str(SOURCES_DIR / 'Assets'),
          '--output', str(WEB_DIR / 'public' / 'assets' / 'ui')],
         args.skip_ui),
        ("DDS Pipeline (icons + sprites)",
         ['dds_to_webp.py', '--tree-data', str(tree_data_dir),
          '--output', str(WEB_DIR / 'public' / 'assets' / 'dds'),
          '--version', version],
         args.skip_dds),
        ("Backfill Missing Version Assets",
         ['backfill_version_assets.py', version, '--fallback-version', fallback_version],
         args.skip_backfill),
        ("Tree Version Manifest",
         ['update_tree_versions.py', version],
         args.skip_tree),
    ]
    
    if args.dry_run:
        print("=== Dry Run ===\n")
        for name, cmd, skip in steps:
            status = "SKIP" if skip else "RUN"
            print(f"  [{status}] {name}")
            if not skip:
                print(f"         {' '.join(cmd)}")
        print(f"\nTree version: {version}")
        print(f"Tree data: {tree_data_dir}")
        return
    
    print(f"=== Extract Game Assets v{version} ===\n")
    t_start = time.time()
    
    success_count = 0
    total = 0
    for name, cmd, skip in steps:
        if not skip:
            total += 1
        ok, elapsed = run_step(name, cmd, skip=skip)
        if ok and not skip:
            success_count += 1
    
    total_time = time.time() - t_start
    print(f"\n=== Complete: {success_count}/{total} steps OK in {total_time:.1f}s ===")
    
    if success_count < total:
        print("Some steps failed. Check errors above.")
        sys.exit(1)


if __name__ == '__main__':
    main()
