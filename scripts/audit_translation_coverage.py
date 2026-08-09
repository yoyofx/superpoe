from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LUA = ROOT / "public" / "pob-lua" / "Data" / "StatDescriptions" / "stat_descriptions.lua"
DEFAULT_TRANSLATIONS = ROOT / "public" / "data" / "Translate"
TEXT_PATTERN = re.compile(r'\btext\s*=\s*"((?:\\.|[^"\\])*)"')


def lua_unescape(value: str) -> str:
    # The stat catalog only uses simple escaped quotes/backslashes in text
    # values. Avoid evaluating arbitrary Lua while auditing repository data.
    return value.replace(r"\\", "\\").replace(r'\"', '"')


def load_canonical_stats(lua_path: Path) -> set[str]:
    values: set[str] = set()
    for match in TEXT_PATTERN.finditer(lua_path.read_text(encoding="utf-8")):
        text = lua_unescape(match.group(1)).strip()
        if text:
            values.add(text)
    return values


def load_translations(language_dir: Path) -> tuple[set[str], dict[str, int]]:
    translated: set[str] = set()
    duplicates: dict[str, int] = {}
    for csv_path in sorted(language_dir.glob("*.csv")):
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            for row in csv.reader(handle):
                if len(row) < 2:
                    continue
                english = row[0].strip()
                localized = row[1].strip()
                if not english or not localized or english == localized:
                    continue
                translated.add(english)
                duplicates[english] = duplicates.get(english, 0) + 1
    return translated, {key: count for key, count in duplicates.items() if count > 1}


def audit(language: str, lua_path: Path, translations_root: Path, limit: int) -> int:
    language_dir = translations_root / language
    if not lua_path.is_file():
        raise SystemExit(f"PoB stat catalog not found: {lua_path}")
    if not language_dir.is_dir():
        raise SystemExit(f"Translation directory not found: {language_dir}")

    canonical = load_canonical_stats(lua_path)
    translated, duplicates = load_translations(language_dir)
    missing = sorted(canonical - translated)
    print(f"{language}: {len(canonical) - len(missing)}/{len(canonical)} canonical stat templates covered")
    print(f"{language}: {len(duplicates)} duplicate English keys")
    if missing:
        print(f"Missing templates ({len(missing)}):")
        for value in missing[:limit]:
            print(f"  - {value}")
        if len(missing) > limit:
            print(f"  ... and {len(missing) - limit} more")
    return len(missing)


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit PoB stat templates against localized translation catalogs.")
    parser.add_argument("--language", default="zh-rCN", help="Translation language directory to audit")
    parser.add_argument("--lua", type=Path, default=DEFAULT_LUA)
    parser.add_argument("--translations", type=Path, default=DEFAULT_TRANSLATIONS)
    parser.add_argument("--limit", type=int, default=40, help="Maximum missing templates to print")
    parser.add_argument("--strict", action="store_true", help="Exit with status 1 when any template is missing")
    args = parser.parse_args()
    missing = audit(args.language, args.lua.resolve(), args.translations.resolve(), max(1, args.limit))
    if args.strict and missing:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
