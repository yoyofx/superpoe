#!/usr/bin/env python3
"""Build the PoB node id -> game Build Planner passive id mapping."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "public" / "data"


def poe2db_tree_version(tree_version: str) -> str:
    parts = tree_version.split("_", 1)
    if len(parts) != 2 or not all(part.isdigit() for part in parts):
        raise ValueError(f"Invalid tree version: {tree_version}")
    return f"4.{int(parts[1])}"


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def fetch_json(url: str) -> dict:
    request = Request(url, headers={"User-Agent": "SuperPoE2 resource pipeline"})
    with urlopen(request, timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("version", nargs="?", default="0_5")
    parser.add_argument("--poe2db-version")
    args = parser.parse_args()

    tree_path = DATA_DIR / f"tree-web-{args.version}.json"
    if not tree_path.exists():
        raise SystemExit(f"Tree data not found: {tree_path}")

    source_version = args.poe2db_version or poe2db_tree_version(args.version)
    source_url = f"https://poe2db.tw/data/passive-skill-tree/{source_version}/data_us.json"
    source = fetch_json(source_url)
    source_nodes = source.get("nodes") or {}
    mapping = {
        str(node.get("skill")): str(node["id"])
        for node in source_nodes.values()
        if isinstance(node, dict) and node.get("skill") is not None and node.get("id")
    }

    tree = load_json(tree_path)
    local_nodes = tree.get("nodes") or {}
    required = {
        str(node_id)
        for node_id, node in local_nodes.items()
        if isinstance(node, dict)
        and node.get("type") not in {"ClassStart", "AscendClassStart", "OnlyImage"}
    }
    missing = sorted(required - mapping.keys(), key=lambda value: int(value) if value.isdigit() else value)
    if missing:
        preview = ", ".join(missing[:20])
        raise SystemExit(
            f"PoE2DB planner mapping is missing {len(missing)} allocatable nodes for "
            f"{args.version}: {preview}"
        )

    local_mapping = {
        node_id: mapping[node_id]
        for node_id in sorted(local_nodes, key=lambda value: int(value) if value.isdigit() else value)
        if node_id in mapping
    }
    output = {
        "schemaVersion": 1,
        "treeVersion": args.version,
        "source": source_url,
        "sourceVersion": source_version,
        "nodes": local_mapping,
    }
    output_path = DATA_DIR / f"build-planner-passives-{args.version}.json"
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"[ok] {output_path.relative_to(ROOT)}: {len(local_mapping)} mapped nodes, "
        f"{len(required)}/{len(required)} allocatable nodes covered"
    )


if __name__ == "__main__":
    main()
