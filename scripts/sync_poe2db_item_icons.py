from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import html
import json
import re
import sys
import time
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = ROOT / "public" / "assets" / "items" / "poe2db"
INDEX_PATH = ROOT / "public" / "data" / "item-icons.json"
POB_BASES_ROOT = ROOT / "upstreams" / "PathOfBuilding-PoE2" / "src" / "Data" / "Bases"
POB_UNIQUES_ROOT = ROOT / "upstreams" / "PathOfBuilding-PoE2" / "src" / "Data" / "Uniques"
POB_RUNES_PATH = ROOT / "upstreams" / "PathOfBuilding-PoE2" / "src" / "Data" / "ModRunes.lua"
SITE_ROOT = "https://poe2db.tw/us/"
CDN_ROOT = "https://cdn.poe2db.tw/image/"
USER_AGENT = "SuperPoE item asset pipeline/1.0 (offline asset sync)"

# Equipment and related build items. Each catalog exposes both unique items and
# base items, which lets normal/rare PoB items fall back to their base icon.
CATEGORIES = (
    "Unique_item",
    "Claws", "Daggers", "Wands", "One_Hand_Swords", "One_Hand_Axes", "One_Hand_Maces",
    "Sceptres", "Spears", "Flails", "Bows", "Staves", "Two_Hand_Swords", "Two_Hand_Axes",
    "Two_Hand_Maces", "Quarterstaves", "Crossbows", "Traps", "Talismans", "Quivers", "Shields",
    "Bucklers", "Foci", "Gloves", "Boots", "Body_Armours", "Helmets", "Amulets", "Rings", "Belts",
    "Jewels", "Flasks", "Charms",
)

# These are PoB-only variants rather than separate tradeable base items. PoE2DB
# has no dedicated page/icon for them, so use the matching visual base type.
FALLBACK_BASE_TYPES = {
    "Energy Blade One Handed": "Shortsword",
    "Energy Blade Two Handed": "Corroded Longsword",
    "Shrine Sceptre (Purity of Fire)": "Shrine Sceptre",
    "Shrine Sceptre (Purity of Cold)": "Shrine Sceptre",
    "Shrine Sceptre (Purity of Lighting)": "Shrine Sceptre",
}


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def fetch(url: str) -> bytes:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,image/avif,image/webp,*/*",
        # The CDN rejects a portion of otherwise-public files without the
        # matching catalogue origin, particularly during a large sync.
        "Referer": SITE_ROOT,
    }
    last_error: HTTPError | URLError | TimeoutError | None = None
    for attempt in range(4):
        try:
            with urlopen(Request(url, headers=headers), timeout=30) as response:
                return response.read()
        except HTTPError as error:
            last_error = error
            if error.code not in (403, 429, 500, 502, 503, 504):
                raise
        except (URLError, TimeoutError) as error:
            last_error = error
        time.sleep(0.4 * (attempt + 1))
    assert last_error is not None
    raise last_error


@dataclass
class Anchor:
    href: str
    text: list[str] = field(default_factory=list)
    images: list[tuple[str, str]] = field(default_factory=list)


class CatalogParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.anchors: list[Anchor] = []
        self._stack: list[Anchor] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "a" and attributes.get("href"):
            self._stack.append(Anchor(attributes["href"]))
        elif tag == "img" and self._stack:
            source = attributes.get("src") or ""
            if source.startswith(CDN_ROOT) and "/2DItems/" in source:
                self._stack[-1].images.append((source, attributes.get("alt") or ""))

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._stack:
            self.anchors.append(self._stack.pop())

    def handle_data(self, data: str) -> None:
        if self._stack:
            self._stack[-1].text.append(data)


def catalog_records(category: str) -> list[dict[str, str]]:
    parser = CatalogParser()
    parser.feed(fetch(urljoin(SITE_ROOT, category)).decode("utf-8", errors="replace"))
    records: list[dict[str, str]] = []
    for anchor in parser.anchors:
        href = urljoin(SITE_ROOT, anchor.href)
        parsed = urlparse(href)
        if parsed.netloc != "poe2db.tw" or not parsed.path.startswith("/us/"):
            continue
        slug = parsed.path.removeprefix("/us/").strip("/")
        if not slug or "/" in slug:
            continue
        label = " ".join("".join(anchor.text).split())
        for source, icon_name in anchor.images:
            records.append({"slug": slug, "name": label, "iconName": icon_name, "source": source})
    return records


def pob_base_names() -> list[str]:
    if not POB_BASES_ROOT.is_dir():
        return []
    names: set[str] = set()
    for path in POB_BASES_ROOT.glob("*.lua"):
        text = path.read_text(encoding="utf-8", errors="replace")
        names.update(re.findall(r'itemBases\["([^"]+)"\]\s*=', text))
    return sorted(names)


def pob_unique_names() -> list[str]:
    return sorted(pob_unique_base_types())


def pob_unique_base_types() -> dict[str, str]:
    if not POB_UNIQUES_ROOT.is_dir():
        return {}
    unique_bases: dict[str, str] = {}
    for path in POB_UNIQUES_ROOT.glob("*.lua"):
        text = path.read_text(encoding="utf-8", errors="replace")
        for name, base_type in re.findall(r'\[\[\s*\r?\n([^\r\n]+)\r?\n([^\r\n]+)', text):
            name, base_type = name.strip(), base_type.strip()
            if name and base_type:
                unique_bases[name] = base_type
    return unique_bases


def pob_rune_names() -> list[str]:
    if not POB_RUNES_PATH.is_file():
        return []
    text = POB_RUNES_PATH.read_text(encoding="utf-8", errors="replace")
    return sorted(set(re.findall(r'^\t\["([^"]+)"\]\s*=\s*\{', text, re.M)))


def detail_record(name: str) -> dict[str, str] | None:
    slug = quote(name.replace(" ", "_"), safe="_'-")
    page = fetch(urljoin(SITE_ROOT, slug)).decode("utf-8", errors="replace")
    image_match = re.search(r'<meta property="og:image" content="([^"]+)"', page, re.I)
    if not image_match:
        return None
    source = html.unescape(image_match.group(1))
    if not source.startswith(CDN_ROOT) or "/2DItems/" not in source:
        return None
    return {
        "slug": slug,
        "name": name,
        "iconName": Path(urlparse(source).path).stem,
        "source": source,
    }


def local_path(source: str) -> Path:
    relative = Path(urlparse(source).path.removeprefix("/image/").lstrip("/"))
    resolved = (OUTPUT_ROOT / relative).resolve()
    resolved.relative_to(OUTPUT_ROOT.resolve())
    return resolved


def download(source: str, dry_run: bool) -> tuple[str, bool]:
    destination = local_path(source)
    relative = destination.relative_to(ROOT / "public").as_posix()
    if destination.exists() and destination.stat().st_size > 0:
        return relative, False
    if dry_run:
        return relative, True
    data = fetch(source)
    if not data:
        raise RuntimeError("empty response")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(destination)
    return relative, True


def aliases(record: dict[str, str]) -> list[str]:
    source_stem = Path(urlparse(record["source"]).path).stem
    values = (
        record["name"], record["slug"].replace("_", " "), record["iconName"], source_stem,
        *record.get("aliases", []),
    )
    return sorted({normalized for value in values if (normalized := normalize(html.unescape(value)))})


def merge_record(records_by_source: dict[str, dict[str, str]], record: dict[str, str]) -> None:
    existing = records_by_source.get(record["source"])
    if not existing:
        records_by_source[record["source"]] = record
        return
    aliases = existing.setdefault("aliases", [])
    for value in (record["name"], record["slug"].replace("_", " "), record["iconName"]):
        if value and value not in aliases:
            aliases.append(value)


def known_aliases(records_by_source: dict[str, dict[str, str]]) -> set[str]:
    return {key for record in records_by_source.values() for key in aliases(record)}


def has_base_fallback(name: str, aliases_by_record: set[str]) -> bool:
    fallback = FALLBACK_BASE_TYPES.get(name)
    return bool(fallback and normalize(fallback) in aliases_by_record)


def main() -> None:
    parser = argparse.ArgumentParser(description="Download PoE2DB equipment icons for offline web use.")
    parser.add_argument("--dry-run", action="store_true", help="Build the index without writing icons or JSON")
    parser.add_argument("--workers", type=int, default=6, help="Concurrent icon downloads (default: 6)")
    parser.add_argument("--category", action="append", choices=CATEGORIES, help="Only sync a category; repeatable")
    parser.add_argument("--append", action="store_true", help="Merge selected categories into the existing local index")
    parser.add_argument("--skip-pob-bases", action="store_true", help="Skip PoB base-type completion (faster, but incomplete)")
    parser.add_argument("--skip-pob-uniques", action="store_true", help="Skip PoB unique-item completion (faster, but incomplete)")
    parser.add_argument("--skip-pob-runes", action="store_true", help="Skip PoB rune and soul-core completion")
    parser.add_argument("--skip-catalogues", action="store_true", help="Reuse the existing index without fetching category pages")
    parser.add_argument("--base-limit", type=int, help="Only resolve this many missing PoB bases; use with --append to resume")
    args = parser.parse_args()

    categories = tuple(args.category) if args.category else CATEGORIES
    fallback_aliases = dict(FALLBACK_BASE_TYPES)
    existing_categories: list[str] = []
    records_by_source: dict[str, dict[str, str]] = {}
    if args.append and INDEX_PATH.is_file():
        existing = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
        existing_categories = [value for value in existing.get("categories", []) if isinstance(value, str)]
        for record in existing.get("items", []):
            if isinstance(record, dict) and isinstance(record.get("source"), str):
                restored = {
                    key: str(record.get(key, "")) for key in ("slug", "name", "iconName", "source")
                }
                restored["aliases"] = [str(value) for value in record.get("aliases", []) if isinstance(value, str)]
                records_by_source[record["source"]] = restored
    failed_catalogues: list[str] = []
    if not args.skip_catalogues:
        for category in categories:
            try:
                category_records = catalog_records(category)
            except (HTTPError, URLError, TimeoutError) as error:
                print(f"[failed] {category}: {error}", file=sys.stderr)
                failed_catalogues.append(category)
                continue
            for record in category_records:
                merge_record(records_by_source, record)
            print(f"[catalog] {category}: {len(category_records)} icon references")
            time.sleep(0.1)

    if failed_catalogues:
        raise SystemExit(f"Catalogue sync failed for: {', '.join(failed_catalogues)}. No files were changed.")
    if not records_by_source:
        raise SystemExit("No PoE2DB item icons were discovered; no files were changed.")

    if not args.skip_pob_bases:
        base_names = pob_base_names()
        record_aliases = known_aliases(records_by_source)
        missing_bases = [
            name for name in base_names
            if normalize(name) not in record_aliases and not has_base_fallback(name, record_aliases)
        ]
        total_missing = len(missing_bases)
        if args.base_limit is not None:
            missing_bases = missing_bases[:max(0, args.base_limit)]
        print(f"[bases] {len(base_names) - total_missing}/{len(base_names)} covered; resolving {len(missing_bases)} of {total_missing} missing detail pages")
        unresolved_bases: list[str] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
            futures = {executor.submit(detail_record, name): name for name in missing_bases}
            for future in concurrent.futures.as_completed(futures):
                name = futures[future]
                try:
                    record = future.result()
                except (HTTPError, URLError, TimeoutError) as error:
                    print(f"[failed] {name}: {error}", file=sys.stderr)
                    unresolved_bases.append(name)
                    continue
                if record:
                    merge_record(records_by_source, record)
                else:
                    unresolved_bases.append(name)
        if unresolved_bases:
            print(f"[warning] No PoE2DB image for {len(unresolved_bases)} PoB bases", file=sys.stderr)

    if not args.skip_pob_uniques:
        unique_base_types = pob_unique_base_types()
        unique_names = sorted(unique_base_types)
        record_aliases = known_aliases(records_by_source)
        missing_uniques = [name for name in unique_names if normalize(name) not in record_aliases]
        print(f"[uniques] {len(unique_names) - len(missing_uniques)}/{len(unique_names)} covered; resolving {len(missing_uniques)} detail pages")
        unresolved_uniques: list[str] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
            futures = {executor.submit(detail_record, name): name for name in missing_uniques}
            for future in concurrent.futures.as_completed(futures):
                name = futures[future]
                try:
                    record = future.result()
                except (HTTPError, URLError, TimeoutError) as error:
                    print(f"[failed] {name}: {error}", file=sys.stderr)
                    unresolved_uniques.append(name)
                    continue
                if record:
                    merge_record(records_by_source, record)
                else:
                    unresolved_uniques.append(name)
        if unresolved_uniques:
            base_aliases = known_aliases(records_by_source)
            for name in unresolved_uniques:
                base_type = unique_base_types.get(name)
                if base_type and normalize(base_type) in base_aliases:
                    fallback_aliases[name] = base_type
            unmatched = [name for name in unresolved_uniques if name not in fallback_aliases]
            if unmatched:
                print(f"[warning] No PoE2DB image or base fallback for {len(unmatched)} PoB uniques", file=sys.stderr)

    if not args.skip_pob_runes:
        rune_names = pob_rune_names()
        record_aliases = known_aliases(records_by_source)
        missing_runes = [name for name in rune_names if normalize(name) not in record_aliases]
        print(f"[runes] {len(rune_names) - len(missing_runes)}/{len(rune_names)} covered; resolving {len(missing_runes)} detail pages")
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
            futures = {executor.submit(detail_record, name): name for name in missing_runes}
            for future in concurrent.futures.as_completed(futures):
                try:
                    record = future.result()
                except (HTTPError, URLError, TimeoutError):
                    continue
                if record:
                    merge_record(records_by_source, record)

    sources = sorted(records_by_source)
    downloaded = 0
    failed: list[str] = []
    local_by_source: dict[str, str] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        future_by_source = {executor.submit(download, source, args.dry_run): source for source in sources}
        for future in concurrent.futures.as_completed(future_by_source):
            source = future_by_source[future]
            try:
                local, was_downloaded = future.result()
                local_by_source[source] = local
                downloaded += int(was_downloaded)
            except (HTTPError, URLError, TimeoutError, OSError, RuntimeError) as error:
                failed.append(f"{source}: {error}")

    items: list[dict[str, object]] = []
    lookup: dict[str, str] = {}
    for source in sources:
        local = local_by_source.get(source)
        if not local:
            continue
        record = records_by_source[source]
        item = {**record, "path": f"/{local}"}
        items.append(item)
        for key in aliases(record):
            lookup.setdefault(key, item["path"])
    for alias, fallback in fallback_aliases.items():
        fallback_path = lookup.get(normalize(fallback))
        if fallback_path:
            lookup.setdefault(normalize(alias), fallback_path)

    manifest = {
        "schemaVersion": 1,
        "source": {"site": SITE_ROOT, "cdn": CDN_ROOT},
        "categories": list(dict.fromkeys([*existing_categories, *categories])),
        "items": items,
        "lookup": lookup,
        "fallbackBaseTypes": fallback_aliases,
        "contentHash": hashlib.sha256("\n".join(local_by_source).encode()).hexdigest(),
    }
    if not args.dry_run:
        INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
        INDEX_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"[done] {len(items)} indexed, {downloaded} downloaded, {len(sources) - len(items)} unavailable")
    if failed:
        print("[warning] Failed downloads:", file=sys.stderr)
        print("\n".join(failed[:20]), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
