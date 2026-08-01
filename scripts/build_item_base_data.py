#!/usr/bin/env python3
"""Build the browser-side subset of PoB item base data.

The source remains the upstream generated Lua tables. The browser only needs
primitive fields used to reproduce the item detail header; it never executes
these Lua files at runtime.
"""

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "upstreams" / "PathOfBuilding-PoE2" / "src" / "Data" / "Bases"
OUTPUT = ROOT / "public" / "data" / "item-bases.json"


def balanced_table(text: str, start: int) -> str:
    depth = 0
    quote = None
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in ('"', "'"):
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start:index + 1]
    raise ValueError("unterminated Lua table")


def string_field(block: str, name: str):
    match = re.search(rf"\b{name}\s*=\s*\"([^\"]*)\"", block)
    return match.group(1) if match else None


def number_fields(block: str, section: str):
    marker = re.search(rf"\b{section}\s*=\s*\{{", block)
    if not marker:
        return None
    table = balanced_table(block, marker.end() - 1)
    values = {}
    for key, value in re.findall(r"\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)", table):
        number = float(value)
        values[key] = int(number) if number.is_integer() else number
    return values or None


def main():
    if not SOURCE.is_dir():
        raise SystemExit(f"missing PoB item bases: {SOURCE}")

    bases = {}
    pattern = re.compile(r'itemBases\["([^"]+)"\]\s*=\s*\{')
    for path in sorted(SOURCE.glob("*.lua")):
        text = path.read_text(encoding="utf-8")
        for match in pattern.finditer(text):
            block = balanced_table(text, match.end() - 1)
            entry = {
                "type": string_field(block, "type"),
                "subType": string_field(block, "subType"),
                "weapon": number_fields(block, "weapon"),
                "armour": number_fields(block, "armour"),
                "flask": number_fields(block, "flask"),
                "charm": number_fields(block, "charm"),
                "requirements": number_fields(block, "req"),
            }
            bases[match.group(1)] = {key: value for key, value in entry.items() if value is not None}

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({"bases": bases}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  [ok] {len(bases)} item bases -> {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
