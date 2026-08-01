from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
POB_DATA = ROOT / "upstreams" / "PathOfBuilding-PoE2" / "src" / "Data"
GEMS_PATH = POB_DATA / "Gems.lua"
SKILLS_ROOT = POB_DATA / "Skills"
SKILL_ICON_INDEX = ROOT / "public" / "data" / "skill-icons.json"
ITEM_ICON_INDEX = ROOT / "public" / "data" / "item-icons.json"
OUTPUT = ROOT / "public" / "data" / "skill-catalog.json"


def normalize(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "", ascii_value.lower())


def lua_string(value: str) -> str:
    return json.loads(f'"{value}"')


def field(block: str, name: str) -> str | None:
    match = re.search(rf'^\s*{re.escape(name)}\s*=\s*"((?:\\.|[^"])*)"', block, re.M)
    return lua_string(match.group(1)) if match else None


def boolean_field(block: str, name: str) -> bool:
    return bool(re.search(rf'^\s*{re.escape(name)}\s*=\s*true\s*,?', block, re.M))


def integer_field(block: str, name: str) -> int | None:
    match = re.search(rf'^\s*{re.escape(name)}\s*=\s*(-?\d+)\s*,?', block, re.M)
    return int(match.group(1)) if match else None


def top_level_blocks(text: str, pattern: str) -> list[tuple[str, str]]:
    starts = list(re.finditer(pattern, text, re.M))
    blocks: list[tuple[str, str]] = []
    for index, match in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(text)
        blocks.append((lua_string(match.group(1)), text[match.end():end]))
    return blocks


def parse_tags(block: str) -> list[str]:
    match = re.search(r'^\s*tags\s*=\s*\{(.*?)^\s*\},', block, re.M | re.S)
    if not match:
        return []
    return sorted(set(re.findall(r'^\s*([a-zA-Z0-9_]+)\s*=\s*true', match.group(1), re.M)))


def related_skill_ids(block: str) -> list[str]:
    values = re.findall(
        r'^\s*(?:additionalGrantedEffectId|additionalStatSet)\d+\s*=\s*"((?:\\.|[^"])*)"',
        block,
        re.M,
    )
    return sorted(set(lua_string(value) for value in values))


def parse_gems() -> list[dict[str, Any]]:
    if not GEMS_PATH.is_file():
        raise SystemExit(f"Missing PoB gem data: {GEMS_PATH}")
    records: list[dict[str, Any]] = []
    text = GEMS_PATH.read_text(encoding="utf-8", errors="replace")
    for metadata_id, block in top_level_blocks(text, r'^\t\["((?:\\.|[^"])*)"\]\s*=\s*\{'):
        name = field(block, "name")
        skill_id = field(block, "grantedEffectId")
        if not name or not skill_id:
            continue
        records.append({
            "metadataId": metadata_id,
            "gameId": field(block, "gameId"),
            "variantId": field(block, "variantId"),
            "skillId": skill_id,
            "relatedSkillIds": related_skill_ids(block),
            "name": name,
            "baseTypeName": field(block, "baseTypeName"),
            "gemType": field(block, "gemType") or "Unknown",
            "gemFamily": field(block, "gemFamily"),
            "tagString": field(block, "tagString") or "",
            "tags": parse_tags(block),
            "tier": integer_field(block, "Tier"),
            "naturalMaxLevel": integer_field(block, "naturalMaxLevel"),
            "requirements": {
                "str": integer_field(block, "reqStr") or 0,
                "dex": integer_field(block, "reqDex") or 0,
                "int": integer_field(block, "reqInt") or 0,
            },
        })
    return records


def parse_skills() -> dict[str, dict[str, Any]]:
    definitions: dict[str, dict[str, Any]] = {}
    for path in sorted(SKILLS_ROOT.glob("*.lua")):
        if path.name == "SkillAssets.lua":
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for skill_id, block in top_level_blocks(text, r'^skills\["((?:\\.|[^"])*)"\]\s*=\s*\{'):
            record = definitions.setdefault(skill_id, {"id": skill_id, "sourceFiles": []})
            record["sourceFiles"].append(path.name)
            for source_key, target_key in (
                ("name", "name"),
                ("baseTypeName", "baseTypeName"),
                ("description", "description"),
                ("icon", "sourceIcon"),
            ):
                value = field(block, source_key)
                if value and not record.get(target_key):
                    record[target_key] = value
            record["support"] = record.get("support", False) or boolean_field(block, "support")
            record["hidden"] = record.get("hidden", False) or boolean_field(block, "hidden")
            record["fromItem"] = record.get("fromItem", False) or boolean_field(block, "fromItem")
            color = integer_field(block, "color")
            if color is not None and "color" not in record:
                record["color"] = color
    return definitions


def load_icon_lookup() -> dict[str, str]:
    lookup: dict[str, str] = {}
    for path in (ITEM_ICON_INDEX, SKILL_ICON_INDEX):
        if not path.is_file():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        lookup.update({str(key): str(value) for key, value in data.get("lookup", {}).items()})
    return lookup


def load_localizations() -> dict[str, dict[str, Any]]:
    if not SKILL_ICON_INDEX.is_file():
        return {}
    data = json.loads(SKILL_ICON_INDEX.read_text(encoding="utf-8"))
    return {
        str(key): value for key, value in data.get("localizations", {}).items()
        if isinstance(value, dict)
    }


def load_poe2db_gems() -> list[dict[str, Any]]:
    if not SKILL_ICON_INDEX.is_file():
        return []
    data = json.loads(SKILL_ICON_INDEX.read_text(encoding="utf-8"))
    return [
        item for item in data.get("items", [])
        if isinstance(item, dict) and item.get("name") and item.get("path")
    ]


def resolve_icon(entry: dict[str, Any], lookup: dict[str, str]) -> str | None:
    values = [
        entry.get("id"),
        *entry.get("gemIds", []),
        *entry.get("gameIds", []),
        *entry.get("variantIds", []),
        entry.get("name"),
        entry.get("baseTypeName"),
        entry.get("sourceIcon"),
    ]
    for value in values:
        if value and (path := lookup.get(normalize(str(value)))):
            return path
    return None


def entry_type(gem_type: str | None, definition: dict[str, Any]) -> str:
    if gem_type == "Support" or definition.get("support"):
        return "support"
    if definition.get("hidden"):
        return "hidden"
    if definition.get("fromItem"):
        return "granted"
    if gem_type:
        return "active"
    return "internal"


def build_catalog() -> dict[str, Any]:
    gems = parse_gems()
    skills = parse_skills()
    icon_lookup = load_icon_lookup()
    localizations = load_localizations()
    poe2db_gems = load_poe2db_gems()
    entries: dict[str, dict[str, Any]] = {}

    for gem in gems:
        skill_id = gem["skillId"]
        definition = skills.get(skill_id, {})
        entry = entries.setdefault(skill_id, {
            "id": skill_id,
            "name": gem["name"],
            "type": entry_type(gem["gemType"], definition),
            "userVisible": True,
            "gemIds": [],
            "gameIds": [],
            "variantIds": [],
            "aliases": [],
            "tags": [],
            "sourceFiles": [],
        })
        entry["gemIds"].append(gem["metadataId"])
        if gem.get("gameId"):
            entry["gameIds"].append(gem["gameId"])
        if gem.get("variantId"):
            entry["variantIds"].append(gem["variantId"])
        entry["aliases"].extend(filter(None, [gem.get("name"), gem.get("baseTypeName"), gem.get("gemFamily")]))
        entry["tags"] = sorted(set([*entry["tags"], *gem["tags"]]))
        entry["baseTypeName"] = entry.get("baseTypeName") or gem.get("baseTypeName")
        entry["gemType"] = gem["gemType"]
        entry["gemFamily"] = gem.get("gemFamily")
        entry["tagString"] = gem.get("tagString")
        entry["tier"] = gem.get("tier")
        entry["naturalMaxLevel"] = gem.get("naturalMaxLevel")
        entry["requirements"] = gem.get("requirements")
        if definition:
            entry["description"] = definition.get("description")
            entry["sourceIcon"] = definition.get("sourceIcon")
            entry["sourceFiles"] = definition.get("sourceFiles", [])
            entry["color"] = definition.get("color")

    for skill_id, definition in skills.items():
        if skill_id in entries:
            continue
        name = definition.get("name") or skill_id
        entries[skill_id] = {
            "id": skill_id,
            "name": name,
            "baseTypeName": definition.get("baseTypeName"),
            "type": entry_type(None, definition),
            "userVisible": bool(definition.get("fromItem") and not definition.get("hidden")),
            "gemIds": [],
            "gameIds": [],
            "variantIds": [],
            "aliases": [name],
            "tags": [],
            "description": definition.get("description"),
            "sourceIcon": definition.get("sourceIcon"),
            "sourceFiles": definition.get("sourceFiles", []),
            "color": definition.get("color"),
        }

    existing_aliases = {
        normalize(str(alias))
        for entry in entries.values()
        for alias in (
            entry.get("id"), entry.get("name"), entry.get("baseTypeName"),
            *entry.get("gemIds", []), *entry.get("gameIds", []),
            *entry.get("variantIds", []), *entry.get("aliases", []),
        )
        if alias
    }
    for gem in poe2db_gems:
        aliases = [
            gem.get("name"), str(gem.get("slug", "")).replace("_", " "),
            gem.get("iconName"), *gem.get("aliases", []),
        ]
        if any(normalize(str(alias)) in existing_aliases for alias in aliases if alias):
            continue
        slug = str(gem.get("slug") or gem["name"])
        skill_id = f"Poe2DB:{slug}"
        localized = localizations.get(normalize(str(gem["name"])), {})
        catalogue = str(gem.get("catalogue", ""))
        is_support = catalogue == "Support_Gems" or "/Support/" in str(gem.get("source", "")) or "/NewSupport/" in str(gem.get("source", ""))
        entries[skill_id] = {
            "id": skill_id,
            "name": gem["name"],
            "type": "support" if is_support else "active",
            "userVisible": True,
            "gemIds": [],
            "gameIds": [],
            "variantIds": [],
            "aliases": sorted(set(filter(None, aliases))),
            "tags": [],
            "description": localized.get("descriptions", {}).get("en"),
            "sourceFiles": [],
            "icon": gem["path"],
            "iconSource": "poe2db",
        }
        existing_aliases.update(normalize(str(alias)) for alias in aliases if alias)

    # Build Planner entries reference BaseItemTypes, so secondary forms of an
    # ascendancy skill must resolve back to the parent virtual gem.
    for gem in gems:
        if "SkillGemAscendancy" not in str(gem.get("metadataId", "")) \
                and "SkillGemAscendancy" not in str(gem.get("gameId", "")):
            continue
        parent_skill_id = str(gem["skillId"])
        for related_skill_id in gem.get("relatedSkillIds", []):
            related_entry = entries.get(related_skill_id)
            if related_entry and not related_entry.get("gemIds") and related_entry.get("type") != "support":
                related_entry["plannerParentSkillId"] = parent_skill_id

    djinn_families = {
        "SandDjinn": "SummonSandDjinnPlayer",
        "WaterDjinn": "SummonWaterDjinnPlayer",
        "FireDjinn": "SummonFireDjinnPlayer",
    }
    for skill_id, entry in entries.items():
        if entry.get("gemIds") or entry.get("type") != "hidden":
            continue
        for family, parent_skill_id in djinn_families.items():
            if family in skill_id:
                entry["plannerParentSkillId"] = parent_skill_id
                break

    for entry in entries.values():
        for key in ("gemIds", "gameIds", "variantIds", "aliases", "tags", "sourceFiles"):
            entry[key] = sorted(set(filter(None, entry.get(key, []))))
        planner_source = entry
        if entry.get("plannerParentSkillId"):
            planner_source = entries.get(str(entry["plannerParentSkillId"]), entry)
        planner_skill_id = next((
            str(value) for value in [*planner_source.get("gameIds", []), *planner_source.get("gemIds", [])]
            if str(value).startswith("Metadata/Items/")
        ), None)
        if planner_skill_id:
            entry["plannerSkillId"] = planner_skill_id
        if entry.get("plannerParentSkillId") or any(
            "SkillGemAscendancy" in str(value)
            for value in [*entry.get("gameIds", []), *entry.get("gemIds", [])]
        ):
            entry["isAscendancySkill"] = True
        icon = resolve_icon(entry, icon_lookup)
        if icon:
            entry["icon"] = icon
            entry["iconSource"] = "poe2db" if "/poe2db/" in icon else "pob"
        else:
            entry["icon"] = None
            entry["iconSource"] = None
        localized = next((
            localizations.get(normalize(str(value)))
            for value in [entry.get("name"), entry.get("baseTypeName"), *entry.get("aliases", [])]
            if value and localizations.get(normalize(str(value)))
        ), None)
        if localized:
            entry["localizedNames"] = localized.get("names", {})
            entry["localizedDescriptions"] = localized.get("descriptions", {})
            entry["localizationSources"] = localized.get("sources", {})

    family_icons: dict[str, tuple[str, str]] = {}
    for skill_id, entry in entries.items():
        family = normalize(entry.get("gemFamily") or "")
        if family and entry.get("icon"):
            family_icons.setdefault(family, (entry["icon"], skill_id))
    for entry in entries.values():
        family = normalize(entry.get("gemFamily") or "")
        if entry["userVisible"] and not entry.get("icon") and family in family_icons:
            entry["icon"], entry["iconFallbackFrom"] = family_icons[family]
            entry["iconSource"] = "family-fallback"

    lookup: dict[str, str] = {}
    for skill_id, entry in entries.items():
        aliases = [
            skill_id,
            entry.get("name"),
            entry.get("baseTypeName"),
            entry.get("sourceIcon"),
            *entry.get("gemIds", []),
            *entry.get("gameIds", []),
            *entry.get("variantIds", []),
            *entry.get("aliases", []),
        ]
        for alias in aliases:
            if alias:
                lookup.setdefault(normalize(str(alias)), skill_id)

    visible = [entry for entry in entries.values() if entry["userVisible"]]
    stats = {
        "entries": len(entries),
        "userVisible": len(visible),
        "userVisibleWithIcon": sum(bool(entry.get("icon")) for entry in visible),
        "userVisibleWithDescription": sum(bool(entry.get("description")) for entry in visible),
        "active": sum(entry["type"] == "active" for entry in visible),
        "support": sum(entry["type"] == "support" for entry in visible),
        "granted": sum(entry["type"] == "granted" for entry in visible),
        "iconFallbacks": sum(entry.get("iconSource") == "family-fallback" for entry in visible),
        "localizedDescriptions": {
            language: sum(bool(entry.get("localizedDescriptions", {}).get(language)) for entry in visible)
            for language in ("zh-rCN", "zh-rTW", "ko-KR")
        },
    }
    return {
        "schemaVersion": 1,
        "source": {
            "gems": "upstreams/PathOfBuilding-PoE2/src/Data/Gems.lua",
            "skills": "upstreams/PathOfBuilding-PoE2/src/Data/Skills/*.lua",
            "icons": ["public/data/skill-icons.json", "public/data/item-icons.json"],
        },
        "stats": stats,
        "entries": dict(sorted(entries.items(), key=lambda item: item[0].lower())),
        "lookup": dict(sorted(lookup.items())),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the canonical PoB skill and support-gem catalog")
    parser.add_argument("--out", type=Path, default=OUTPUT)
    args = parser.parse_args()
    catalog = build_catalog()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    stats = catalog["stats"]
    print(
        f"[ok] {stats['entries']} skills, {stats['userVisible']} user-visible, "
        f"icons {stats['userVisibleWithIcon']}/{stats['userVisible']}, "
        f"descriptions {stats['userVisibleWithDescription']}/{stats['userVisible']} -> {args.out}"
    )


if __name__ == "__main__":
    main()
