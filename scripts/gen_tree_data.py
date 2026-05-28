#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_tree_data.py - PoB2 Passive Tree Data Preprocessor

Converts TreeData/{version}/tree.json into web-friendly tree-web.json:
  1. Compute Cartesian coordinates (polar -> x, y)
  2. Expand connections into bidirectional topology (out + in)
  3. Classify node types (Normal/Notable/Keystone/...)
  4. Strip unused fields for smaller payload

Coordinate formula (from PassiveTree.lua:505-508):
  angle = orbitAnglesByOrbit[orbit][orbitIndex]
  radius = orbitRadii[orbit]
  x = group.x + sin(angle) * radius
  y = group.y - cos(angle) * radius

Usage:
  cd web
  python scripts/gen_tree_data.py                  # default: 0_4 -> public/data/tree-web-0_4.json
  python scripts/gen_tree_data.py 0_1               # 0_1 version -> public/data/tree-web-0_1.json
  python scripts/gen_tree_data.py 0_4 input.json output.json  # custom paths
"""

import json
import math
import sys
from pathlib import Path
from collections import defaultdict
from typing import Any


def classify_node_type(node: dict) -> str:
    """Mirrors PassiveTree.lua node classification logic.
    Handles both 0_1..0_3 field names (ks, not) and 0_4+ (isKeystone, isNotable).
    """
    if node.get("isOnlyImage"):
        return "OnlyImage"
    if node.get("ks") or node.get("isKeystone"):
        return "Keystone"
    if node.get("not") or node.get("isNotable"):
        return "Notable"
    if node.get("isJewelSocket"):
        return "JewelSocket"
    if node.get("isMastery"):
        return "Mastery"
    if node.get("classesStart"):
        return "ClassStart"
    if node.get("isAscendancyStart"):
        return "AscendClassStart"
    return "Normal"


def build_in_edges(nodes: dict) -> dict[str, list[str]]:
    """Build reverse in-edges from out connections"""
    in_map: dict[str, list[str]] = defaultdict(list)
    for nid, node in nodes.items():
        for out_id in node.get("out", []):
            in_map[str(out_id)].append(str(nid))
    return dict(in_map)


def generate(
    input_path: str,
    output_path: str,
    tree_version: str = "0_4",
) -> dict:
    """Main generation function, returns generated data for verification"""

    print(f"[gen_tree_data] Reading: {input_path}")
    with open(input_path, "r", encoding="utf-8") as f:
        tree = json.load(f)

    # Extract constants
    constants = tree.get("constants", {})
    skills_per_orbit: list[int] = constants.get("skillsPerOrbit", [])
    orbit_radii: list[float] = constants.get("orbitRadii", [])
    orbit_angles_by_orbit: list[list[float]] = constants.get(
        "orbitAnglesByOrbit", []
    )
    classes = tree.get("classes", [])

    raw_groups: list[dict] = tree.get("groups", [])
    raw_nodes: dict[str, dict] = tree.get("nodes", {})

    print(
        f"  Groups: {len(raw_groups)}, Nodes: {len(raw_nodes)}, "
        f"Orbits: {len(skills_per_orbit)}"
    )

    # ---- Convert Groups ----
    groups: dict[str, dict] = {}
    for idx, g in enumerate(raw_groups):
        if g is None:
            continue
        gid = str(idx + 1)
        groups[gid] = {
            "id": gid,
            "x": g.get("x", 0),
            "y": g.get("y", 0),
            "orbits": g.get("orbits", []),
            "nodes": [str(n) for n in g.get("nodes", [])],
        }

    # ---- Convert Nodes + Compute Coordinates ----
    nodes: dict[str, dict] = {}
    stats_total = 0

    for nid_str, node in raw_nodes.items():
        skill_id = str(node.get("skill", nid_str))
        gidx = node.get("group", 0)
        orbit = node.get("orbit", 0)
        orbit_idx = node.get("orbitIndex", 0)
        node_type = classify_node_type(node)

        # Coordinate calculation
        group_index = gidx - 1
        group = raw_groups[group_index] if 0 <= group_index < len(raw_groups) and raw_groups[group_index] is not None else {"x": 0, "y": 0}
        gx = group.get("x", 0)
        gy = group.get("y", 0)

        if orbit < len(orbit_angles_by_orbit) and orbit_idx < len(
            orbit_angles_by_orbit[orbit]
        ):
            angle = orbit_angles_by_orbit[orbit][orbit_idx]
        else:
            angle = 0.0

        radius = orbit_radii[orbit] if orbit < len(orbit_radii) else 0.0

        x = gx + math.sin(angle) * radius
        y = gy - math.cos(angle) * radius

        # Preserve connection metadata
        connections = node.get("connections", [])
        out_connections = []
        for c in connections:
            if isinstance(c, dict) and "id" in c:
                out_connections.append({
                    "id": str(c["id"]),
                    "orbit": c.get("orbit", 0),
                })
        out_ids = [c["id"] for c in out_connections]

        # Build node
        node_data: dict[str, Any] = {
            "id": skill_id,
            "name": node.get("name", ""),
            "icon": node.get("icon", ""),
            "type": node_type,
            "group": str(gidx),
            "orbit": orbit,
            "orbitIndex": orbit_idx,
            "x": round(x, 2),
            "y": round(y, 2),
            "out": out_ids,
            "connections": out_connections,
            "in": [],  # filled later
            # Visual fields for DDS sprite rendering
            "activeEffectImage": node.get("activeEffectImage", ""),
            "connectionArt": node.get("connectionArt", ""),
            "nodeOverlay": node.get("nodeOverlay", ""),
        }

        # Optional fields
        stats = node.get("stats", [])
        if stats:
            node_data["stats"] = stats
            stats_total += 1

        # Normalize text fields that may be string or string[] -> always string[]
        TEXT_ARRAY_KEYS = [
            "spc", "masteryEffect",
            "recipe", "reminderText", "flavourText", "classesStart",
        ]
        for key in TEXT_ARRAY_KEYS:
            val = node.get(key)
            if val is None or val == "":
                continue
            if isinstance(val, str):
                node_data[key] = [val]
            elif isinstance(val, list):
                node_data[key] = val
            else:
                node_data[key] = val

        # ascendancyName is always a string, not array
        asc_name = node.get("ascendancyName")
        if asc_name:
            node_data["ascendancyName"] = asc_name

        for key in [
            "ks", "not", "isKeystone", "isNotable",
            "isJewelSocket", "isMastery",
            "isAscendancyStart", "isMultipleChoice", "isMultipleChoiceOption",
            "isAttribute",
        ]:
            if node.get(key):
                node_data[key] = True

        nodes[skill_id] = node_data

    # ---- Fill in-edges ----
    in_map = build_in_edges(nodes)
    for nid, in_list in in_map.items():
        if nid in nodes:
            nodes[nid]["in"] = in_list

    # ---- Stats ----
    type_counts: dict[str, int] = defaultdict(int)
    for nd in nodes.values():
        type_counts[nd["type"]] += 1
    print(f"  Node types: {dict(type_counts)}")
    print(f"  Nodes with stats: {stats_total}")

    # Compute class startNodeId (same logic as PassiveTree.lua:187)
    # ClassStart nodes have classesStart field with class names
    class_name_to_id: dict[str, int] = {}
    class_start_map: dict[int, str] = {}  # class index -> node id
    if isinstance(classes, list):
        for i, cls in enumerate(classes):
            class_name_to_id[cls.get("name", "").lower()] = i
    for _nid_str, nd in nodes.items():
        classes_start = nd.get("classesStart")
        if classes_start and nd.get("type") == "ClassStart":
            for cn in classes_start:
                idx = class_name_to_id.get(cn.lower())
                if idx is not None:
                    class_start_map[idx] = nd["id"]

    # ---- Convert classes ----
    classes_out: dict[str, dict] = {}
    if isinstance(classes, list):
        for i, cls in enumerate(classes):
            cid = str(i)
            cls_bg = cls.get("background")
            # Skip ascendancies with no background (unused game data)
            ascendancies = cls.get("ascendancies", cls.get("classes", []))
            asc_out = []
            for asc in ascendancies:
                if asc.get("background"):
                    asc_out.append(asc)
            classes_out[cid] = {
                "name": cls.get("name", ""),
                "displayName": cls.get("displayName", cls.get("name", "")),
                "integerId": cls.get("integerId", i),
                "background": cls_bg,
                "startNodeId": class_start_map.get(i, ""),
                "ascendancies": asc_out,
            }

    # ---- Build output ----
    output: dict = {
        "version": {
            "version": tree_version,
            "display": tree_version,
            "num": int(tree_version.split("_")[1]) if "_" in tree_version else 4,
        },
        "constants": {
            "skillsPerOrbit": skills_per_orbit,
            "orbitRadii": orbit_radii,
            "classes": classes_out,
            "min_x": tree.get("min_x", 0),
            "max_x": tree.get("max_x", 0),
            "min_y": tree.get("min_y", 0),
            "max_y": tree.get("max_y", 0),
        },
        "nodeOverlay": tree.get("nodeOverlay", {}),
        "connectionArt": tree.get("connectionArt", {}),
        "groups": groups,
        "nodes": nodes,
    }

    # ---- Write ----
    print(f"[gen_tree_data] Writing: {output_path}")
    out_path = Path(output_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = out_path.stat().st_size / 1024
    print(f"  Output: {size_kb:.0f} KB")

    return output


def main():
    """CLI entry point.

    Paths resolve relative to web/ directory (script lives in web/scripts/).
    """
    web_dir = Path(__file__).resolve().parent.parent

    args = sys.argv[1:]
    # Detect if first arg is a version string (like "0_4") or a path
    tree_version = "0_4"
    actual_args = args
    if args and not any(c in args[0] for c in "/\\."):
        tree_version = args[0]
        actual_args = args[1:]

    default_input = web_dir / "sources" / "src" / "TreeData" / tree_version / "tree.json"
    default_output = web_dir / "public" / "data" / f"tree-web-{tree_version}.json"

    input_path = actual_args[0] if len(actual_args) > 0 else str(default_input)
    output_path = actual_args[1] if len(actual_args) > 1 else str(default_output)

    generate(input_path, output_path, tree_version)


if __name__ == "__main__":
    main()
