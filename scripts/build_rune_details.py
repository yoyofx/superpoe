from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "upstreams" / "PathOfBuilding-PoE2" / "src" / "Data" / "ModRunes.lua"
OUTPUT = ROOT / "public" / "data" / "rune-details.json"
POE2DB_RUNE_PAGES = {
    "zh-rCN": [
        "https://poe2db.tw/cn/Rune",
        "https://poe2db.tw/cn/Soul_Core",
        "https://poe2db.tw/cn/Idol",
        "https://poe2db.tw/cn/Congealed_Mist",
    ],
    "zh-rTW": [
        "https://poe2db.tw/tw/Rune",
        "https://poe2db.tw/tw/Soul_Core",
        "https://poe2db.tw/tw/Idol",
        "https://poe2db.tw/tw/Congealed_Mist",
    ],
}


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


class RuneNameParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.current_href: str | None = None
        self.current_text: list[str] = []
        self.names: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a" and self.current_href is None:
            href = dict(attrs).get("href")
            if href:
                self.current_href = href
                self.current_text = []

    def handle_data(self, data: str) -> None:
        if self.current_href is not None:
            self.current_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or self.current_href is None:
            return
        slug = Path(urlparse(self.current_href).path).name
        label = " ".join("".join(self.current_text).split())
        key = normalize(slug)
        if key and label and len(label) <= 80 and any(ord(char) > 127 for char in label):
            previous = self.names.get(key)
            if previous is None or len(label) < len(previous):
                self.names[key] = label
        self.current_href = None
        self.current_text = []


def load_localized_names() -> dict[str, dict[str, str]]:
    localized: dict[str, dict[str, str]] = {}
    if OUTPUT.is_file():
        try:
            existing = json.loads(OUTPUT.read_text(encoding="utf-8"))
            for key, detail in existing.get("lookup", {}).items():
                if detail.get("localizedNames"):
                    localized[key] = detail["localizedNames"]
        except (OSError, json.JSONDecodeError):
            pass

    for language, urls in POE2DB_RUNE_PAGES.items():
        for url in urls:
            try:
                request = Request(url, headers={"User-Agent": "SuperPoE rune detail pipeline/1.0"})
                with urlopen(request, timeout=30) as response:
                    parser = RuneNameParser()
                    parser.feed(response.read().decode("utf-8", errors="replace"))
                for key, name in parser.names.items():
                    localized.setdefault(key, {})[language] = name
            except (OSError, TimeoutError) as error:
                print(f"[warning] Unable to refresh {language} names from {url}: {error}", file=sys.stderr)
    return localized


def parse_mod_runes(text: str) -> dict[str, object]:
    details: dict[str, dict[str, object]] = {}
    current_name: str | None = None
    current_variant: str | None = None

    for line in text.splitlines():
        item_match = re.match(r'^\t\["((?:\\.|[^"])*)"\]\s*=\s*\{', line)
        if item_match:
            current_name = json.loads(f'"{item_match.group(1)}"')
            current_variant = None
            details[normalize(current_name)] = {"name": current_name, "variants": {}}
            continue

        variant_match = re.match(r'^\t{2}\["((?:\\.|[^"])*)"\]\s*=\s*\{', line)
        if variant_match and current_name:
            current_variant = json.loads(f'"{variant_match.group(1)}"')
            details[normalize(current_name)]["variants"][current_variant] = {"type": "", "stats": []}  # type: ignore[index]
            continue

        if not current_name or not current_variant:
            continue

        type_match = re.match(r'^\t{4}type\s*=\s*"([^"]+)",?', line)
        if type_match:
            details[normalize(current_name)]["variants"][current_variant]["type"] = type_match.group(1)  # type: ignore[index]
            continue

        stat_match = re.match(r'^\t{4}"((?:\\.|[^"])*)",?$', line)
        if stat_match:
            stat = json.loads(f'"{stat_match.group(1)}"')
            details[normalize(current_name)]["variants"][current_variant]["stats"].append(stat)  # type: ignore[index]

    return details


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"Missing PoB rune data: {SOURCE}")
    lookup = parse_mod_runes(SOURCE.read_text(encoding="utf-8", errors="replace"))
    localized = load_localized_names()
    translated = 0
    for key, names in localized.items():
        if key in lookup:
            lookup[key]["localizedNames"] = names  # type: ignore[index]
            translated += 1
    payload = {
        "schemaVersion": 1,
        "source": "upstreams/PathOfBuilding-PoE2/src/Data/ModRunes.lua",
        "lookup": lookup,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] {len(lookup)} definitions, {translated} localized names -> {OUTPUT}")


if __name__ == "__main__":
    main()
