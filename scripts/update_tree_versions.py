#!/usr/bin/env python3
"""Update public/data/tree-versions.json after generating a tree version."""

import argparse
import json
from pathlib import Path


def version_key(version: str) -> tuple[int, ...]:
    parts = []
    for part in version.split("_"):
        try:
            parts.append(int(part))
        except ValueError:
            parts.append(-1)
    return tuple(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description="Update frontend tree version manifest")
    parser.add_argument("version", help="Tree version, for example 0_5")
    parser.add_argument(
        "--output",
        default=Path(__file__).resolve().parents[1] / "public" / "data" / "tree-versions.json",
        type=Path,
    )
    args = parser.parse_args()

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
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(unique_versions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {output} -> {', '.join(unique_versions)}")


if __name__ == "__main__":
    main()
