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
import struct
import sys
from pathlib import Path
from collections import defaultdict
from typing import Any

CONNECTOR_FILE_ORBIT = {
    "LineConnector": 0,
    "Orbit1": 9,
    "Orbit2": 8,
    "Orbit3": 6,
    "Orbit4": 5,
    "Orbit5": 4,
    "Orbit6": 3,
    "Orbit7": 7,
    "Orbit8": 2,
    "Orbit9": 1,
}

FALLBACK_CONNECTOR_ART_SIZES = {
    "Character": {
        "LineConnector": {"width": 1435, "height": 29},
        "Orbit1": {"width": 91, "height": 90},
        "Orbit2": {"width": 176, "height": 176},
        "Orbit3": {"width": 346, "height": 346},
        "Orbit4": {"width": 501, "height": 502},
        "Orbit5": {"width": 671, "height": 671},
        "Orbit6": {"width": 853, "height": 853},
        "Orbit7": {"width": 263, "height": 263},
        "Orbit8": {"width": 1090, "height": 1091},
        "Orbit9": {"width": 1333, "height": 1333},
    },
    "CharacterAscendancy": {
        "LineConnector": {"width": 1435, "height": 29},
        "Orbit1": {"width": 91, "height": 90},
        "Orbit2": {"width": 176, "height": 176},
        "Orbit3": {"width": 346, "height": 346},
        "Orbit4": {"width": 501, "height": 502},
        "Orbit5": {"width": 671, "height": 671},
        "Orbit6": {"width": 853, "height": 853},
        "Orbit7": {"width": 263, "height": 263},
        "Orbit8": {"width": 1090, "height": 1091},
        "Orbit9": {"width": 1333, "height": 1333},
    },
    "CharacterPlanned": {
        "LineConnector": {"width": 1435, "height": 29},
        "Orbit1": {"width": 91, "height": 90},
        "Orbit2": {"width": 176, "height": 176},
        "Orbit3": {"width": 346, "height": 346},
        "Orbit4": {"width": 501, "height": 502},
        "Orbit5": {"width": 671, "height": 671},
        "Orbit6": {"width": 853, "height": 853},
        "Orbit7": {"width": 263, "height": 263},
        "Orbit8": {"width": 1090, "height": 1091},
        "Orbit9": {"width": 1333, "height": 1333},
    },
}


def read_png_size(path: Path) -> dict[str, int] | None:
    """Read PNG dimensions without pulling in an image dependency."""
    try:
        with path.open("rb") as fh:
            header = fh.read(24)
    except OSError:
        return None
    if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    width, height = struct.unpack(">II", header[16:24])
    return {"width": width, "height": height}


def load_connector_art_sizes(version: str, out_path: Path) -> dict[str, dict[str, dict[str, int]]]:
    """Mirror PoB's runtime image-size lookup for connector quads.

    Original TreeData maps OrbitN names to non-linear PNG suffixes, for example
    Orbit1 uses *_normal9.png and Orbit9 uses *_normal1.png. Reading the local
    PNG headers keeps generated connector quads aligned with the current assets.
    """
    root = out_path.parent.parent / "assets" / "connectors" / version
    sizes: dict[str, dict[str, dict[str, int]]] = {}
    for prefix, fallback in FALLBACK_CONNECTOR_ART_SIZES.items():
        prefix_sizes: dict[str, dict[str, int]] = {}
        for connector_type, file_orbit in CONNECTOR_FILE_ORBIT.items():
            size = read_png_size(root / f"{prefix}_orbit_normal{file_orbit}.png")
            prefix_sizes[connector_type] = size or fallback[connector_type]
        sizes[prefix] = prefix_sizes
    return sizes


def get_node_target_size(node: dict, node_type: str) -> dict:
    """Mirror PassiveTreeClass:GetNodeTargetSize() for node asset sizing."""
    if node.get("isAscendancyStart"):
        return {"overlay": {"width": 50, "height": 50}}
    if node_type == "Normal" and node.get("ascendancyName"):
        return {"overlay": {"width": 80, "height": 80}, "width": 37, "height": 37}
    if node.get("containJewelSocket"):
        return {"overlay": {"width": 80, "height": 80}, "width": 80, "height": 80}
    if node.get("ascendancyName"):
        return {"overlay": {"width": 100, "height": 100}, "width": 54, "height": 54}
    if node_type == "Notable":
        return {
            "effect": {"width": 380, "height": 380},
            "overlay": {"width": 80, "height": 80},
            "width": 54,
            "height": 54,
        }
    if node_type == "AscendClassStart":
        return {
            "effect": {"width": 380, "height": 380},
            "overlay": {"width": 24, "height": 24},
            "width": 16,
            "height": 16,
        }
    if node_type == "OnlyImage":
        return {"width": 380, "height": 380}
    if node_type == "Keystone":
        return {
            "effect": {"width": 380, "height": 380},
            "overlay": {"width": 120, "height": 120},
            "width": 82,
            "height": 82,
        }
    if node_type == "Normal":
        return {"overlay": {"width": 54, "height": 54}, "width": 37, "height": 37}
    if node_type == "Socket" or node_type == "JewelSocket":
        return {"overlay": {"width": 76, "height": 76}, "width": 76, "height": 76}
    if node_type == "ClassStart":
        return {"overlay": {"width": 1, "height": 1}, "width": 37, "height": 37}
    return {"width": 0, "height": 0}


def build_connectors(
    nodes: dict[str, dict],
    groups: dict[str, dict],
    orbit_radii: list[float],
    connection_art: dict,
    connector_art_sizes: dict[str, dict[str, dict[str, int]]],
) -> list[dict]:
    """Precompute PassiveTree connector quads in tree space.

    This mirrors PassiveTreeClass:BuildConnector()/BuildArc() closely enough for
    Canvas to draw the same textured affine quads instead of hand-drawn strokes.
    """
    connectors: list[dict] = []
    for node in nodes.values():
        if node.get("type") == "OnlyImage":
            continue
        for connection in node.get("connections", []):
            other = nodes.get(str(connection.get("id")))
            if not other or other.get("type") == "OnlyImage":
                continue
            if node.get("id") == other.get("id"):
                continue
            if node.get("ascendancyName") != other.get("ascendancyName"):
                continue
            if node.get("classesStart") is not None or other.get("classesStart") is not None:
                continue

            built = build_connector(node, other, connection, groups, orbit_radii, connection_art, connector_art_sizes)
            if built:
                connectors.extend(built)
    return connectors


def build_connector(
    node1: dict,
    node2: dict,
    connection: dict,
    groups: dict[str, dict],
    orbit_radii: list[float],
    connection_art: dict,
    connector_art_sizes: dict[str, dict[str, dict[str, int]]],
) -> list[dict]:
    art_prefix = (
        node1.get("connectionArt")
        or node2.get("connectionArt")
        or connection_art.get("ascendancy" if node1.get("ascendancyName") else "default", "Character")
    )
    connector = {
        "nodeId1": node1["id"],
        "nodeId2": node2["id"],
        "ascendancyName": node1.get("ascendancyName", ""),
        "connectionArt": art_prefix,
        "type": "",
        "texCoords": [],
        "vert": {},
    }

    orbit = int(connection.get("orbit") or 0)
    abs_orbit = abs(orbit)
    if orbit != 0 and abs_orbit < len(orbit_radii):
        r = orbit_radii[abs_orbit]
        dx, dy = node2["x"] - node1["x"], node2["y"] - node1["y"]
        dist = math.hypot(dx, dy)
        if dist and dist < r * 2:
            perp = math.sqrt(max(r * r - (dist * dist) / 4, 0)) * (1 if orbit > 0 else -1)
            cx = node1["x"] + dx / 2 + perp * (dy / dist)
            cy = node1["y"] + dy / 2 - perp * (dx / dist)
            angle1 = math.atan2(node1["y"] - cy, node1["x"] - cx)
            angle2 = math.atan2(node2["y"] - cy, node2["x"] - cx)
            if angle1 > angle2:
                angle1, angle2 = angle2, angle1
            arc_angle = angle2 - angle1
            if arc_angle >= math.pi:
                angle1, angle2 = angle2, angle1
                arc_angle = math.pi * 2 - arc_angle
            angle1 += math.pi / 2
            if arc_angle <= math.pi:
                return build_arc_pair(connector, arc_angle, abs_orbit, cx, cy, angle1, connector_art_sizes)

    if (
        node1.get("group") == node2.get("group")
        and node1.get("orbit") == node2.get("orbit")
        and orbit == 0
    ):
        first, second = node1, node2
        if first.get("angle", 0) > second.get("angle", 0):
            first, second = second, first
        arc_angle = second.get("angle", 0) - first.get("angle", 0)
        if arc_angle >= math.pi:
            first, second = second, first
            arc_angle = math.pi * 2 - arc_angle
        if arc_angle <= math.pi:
            group = groups.get(str(first.get("group")))
            if group:
                return build_arc_pair(
                    connector,
                    arc_angle,
                    int(first.get("orbit", 0)),
                    group.get("x", 0),
                    group.get("y", 0),
                    first.get("angle", 0),
                    connector_art_sizes,
                )

    return [build_line_connector(connector, node1, node2, connector_art_sizes)]


def build_line_connector(
    connector: dict,
    node1: dict,
    node2: dict,
    connector_art_sizes: dict[str, dict[str, dict[str, int]]],
) -> dict:
    out = dict(connector)
    art = connector_art_sizes.get(out["connectionArt"], connector_art_sizes["Character"])["LineConnector"]
    vx, vy = node2["x"] - node1["x"], node2["y"] - node1["y"]
    dist = math.hypot(vx, vy)
    if not dist:
        dist = 1
    scale = art["height"] * 0.5 / dist
    nx, ny = vx * scale, vy * scale
    end_s = dist / art["width"]
    verts = [
        node1["x"] - ny, node1["y"] + nx,
        node1["x"] + ny, node1["y"] - nx,
        node2["x"] + ny, node2["y"] - nx,
        node2["x"] - ny, node2["y"] + nx,
    ]
    out["type"] = "LineConnector"
    out["texCoords"] = [0, 1, 0, 0, end_s, 0, end_s, 1]
    out["vert"] = {"Normal": verts, "Intermediate": verts, "Active": verts}
    return out


def build_arc_pair(
    connector: dict,
    arc_angle: float,
    orbit: int,
    cx: float,
    cy: float,
    angle: float,
    connector_art_sizes: dict[str, dict[str, dict[str, int]]],
) -> list[dict]:
    second = None
    if arc_angle > (math.pi / 2):
        arc_angle /= 2
        second = build_arc(connector, arc_angle, orbit, cx, cy, angle, connector_art_sizes, True)
    first = build_arc(connector, arc_angle, orbit, cx, cy, angle, connector_art_sizes, False)
    return [first, second] if second else [first]


def build_arc(
    connector: dict,
    arc_angle: float,
    orbit: int,
    x_scale: float,
    y_scale: float,
    angle: float,
    connector_art_sizes: dict[str, dict[str, dict[str, int]]],
    mirrored: bool,
) -> dict:
    out = dict(connector)
    out["type"] = f"Orbit{orbit}"
    clip_angle = math.pi / 4 - arc_angle / 2
    p = 1 - max(math.tan(clip_angle), 0)
    angle = angle - clip_angle
    if mirrored:
        angle += arc_angle

    out["vert"] = {}
    for state in ("Normal", "Intermediate", "Active"):
        art = connector_art_sizes.get(out["connectionArt"], connector_art_sizes["Character"]).get(out["type"])
        if not art:
            art = connector_art_sizes["Character"].get(out["type"], {"width": 91, "height": 91})
        size = art["width"]
        ox = size * math.sqrt(2) * math.sin(angle + math.pi / 4)
        oy = size * math.sqrt(2) * -math.cos(angle + math.pi / 4)
        cx = x_scale + ox
        cy = y_scale + oy
        vert = [
            x_scale, y_scale,
            cx + (size * math.sin(angle) - ox) * p,
            cy + (size * -math.cos(angle) - oy) * p,
            cx, cy,
            cx + (size * math.cos(angle) - ox) * p,
            cy + (size * math.sin(angle) - oy) * p,
        ]
        if mirrored:
            vert[2], vert[3], vert[6], vert[7] = vert[6], vert[7], vert[2], vert[3]
        out["vert"][state] = vert
    out["texCoords"] = [1, 1, 0, p, 0, 0, p, 0]
    return out


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
    out_path = Path(output_path)

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
    connector_art_sizes = load_connector_art_sizes(tree_version, out_path)

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
            "angle": angle,
            "x": round(x, 2),
            "y": round(y, 2),
            "out": out_ids,
            "connections": out_connections,
            "in": [],  # filled later
            # Visual fields for DDS sprite rendering
            "activeEffectImage": node.get("activeEffectImage", ""),
            "connectionArt": node.get("connectionArt", ""),
            "nodeOverlay": node.get("nodeOverlay", ""),
            "targetSize": get_node_target_size(node, node_type),
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
    connectors = build_connectors(
        nodes,
        groups,
        orbit_radii,
        tree.get("connectionArt", {}),
        connector_art_sizes,
    )
    print(f"  Connectors: {len(connectors)}")

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
        "connectors": connectors,
        "groups": groups,
        "nodes": nodes,
    }

    # ---- Write ----
    print(f"[gen_tree_data] Writing: {output_path}")
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
