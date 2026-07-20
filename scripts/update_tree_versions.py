#!/usr/bin/env python3
"""Update public/data/tree-versions.json after generating a tree version."""

import argparse
import json
import shutil
from pathlib import Path


def version_key(version: str) -> tuple[int, ...]:
    parts = []
    for part in version.split("_"):
        try:
            parts.append(int(part))
        except ValueError:
            parts.append(-1)
    return tuple(parts)


def prune_version_assets(root: Path, versions: list[str], dry_run: bool) -> list[Path]:
    targets: list[Path] = []
    for version in versions:
        targets.append(root / "public" / "data" / f"tree-web-{version}.json")
        for family in ("dds", "orbit", "connectors"):
            targets.append(root / "public" / "assets" / family / version)

    removed: list[Path] = []
    for target in targets:
        if not target.exists():
            continue
        removed.append(target)
        if dry_run:
            continue
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
    return removed


def main() -> None:
    parser = argparse.ArgumentParser(description="Update frontend tree version manifest")
    parser.add_argument("version", help="Tree version, for example 0_5")
    parser.add_argument(
        "--output",
        default=Path(__file__).resolve().parents[1] / "public" / "data" / "tree-versions.json",
        type=Path,
    )
    parser.add_argument("--keep", type=int, default=2, help="Number of newest generated tree versions to retain")
    parser.add_argument("--dry-run", action="store_true", help="Report retained and removed versions without writing files")
    args = parser.parse_args()
    if args.keep < 1:
        raise SystemExit("--keep must be at least 1")

    output: Path = args.output
    versions: list[str] = []
    if output.exists():
        try:
            loaded = json.loads(output.read_text(encoding="utf-8"))
            if isinstance(loaded, list):
                versions = [v for v in loaded if isinstance(v, str)]
        except json.JSONDecodeError:
            versions = []

    data_dir = output.parent
    if data_dir.exists():
        for path in data_dir.glob("tree-web-*.json"):
            versions.append(path.stem.removeprefix("tree-web-"))
    versions.append(args.version)

    unique_versions = sorted(set(versions), key=version_key, reverse=True)
    retained_versions = unique_versions[:args.keep]
    removed_versions = unique_versions[args.keep:]
    root = output.resolve().parents[2]
    removed_paths = prune_version_assets(root, removed_versions, args.dry_run)
    if args.dry_run:
        print(f"Would retain: {', '.join(retained_versions)}")
        print(f"Would remove: {', '.join(str(path) for path in removed_paths) or 'nothing'}")
        return

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(retained_versions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {output} -> {', '.join(retained_versions)}")
    if removed_paths:
        print(f"Pruned {len(removed_paths)} old version asset path(s)")


if __name__ == "__main__":
    main()
