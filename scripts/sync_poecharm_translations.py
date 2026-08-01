from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "upstreams" / "PoeCharm2"
TARGET_ROOT = ROOT / "public" / "data" / "Translate"
SUPPORTED_LANGUAGES = ("zh-rCN", "zh-rTW", "ko-KR")

# Tree files come first so a tree-specific translation wins over a generic
# historical entry when the same English source text exists in multiple files.
FILE_PRIORITY = (
    "tree_dn.csv",
    "tree_sd.csv",
    "tree_rt.csv",
    "passiveTree.csv",
    "statDescriptions.csv",
    "GUI.csv",
)


def git_value(source: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(source), *args],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return result.stdout.strip() or None


def ordered_csv_files(source_dir: Path) -> list[Path]:
    files = [path for path in source_dir.iterdir() if path.is_file() and path.suffix.lower() == ".csv"]
    priority = {name: index for index, name in enumerate(FILE_PRIORITY)}
    return sorted(files, key=lambda path: (priority.get(path.name, len(priority)), path.name.lower()))


def validate_target(target: Path) -> None:
    target.resolve().relative_to(TARGET_ROOT.resolve())


def sync_language(source_dir: Path, target_dir: Path, dry_run: bool) -> list[str]:
    files = ordered_csv_files(source_dir)
    if not files:
        raise RuntimeError(f"No CSV files found in {source_dir}")

    validate_target(target_dir)
    if not dry_run:
        if target_dir.exists():
            shutil.rmtree(target_dir)
        target_dir.mkdir(parents=True, exist_ok=True)
        for source in files:
            shutil.copy2(source, target_dir / source.name)

    return [path.name for path in files]


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync PoeCharm2 translation assets for the web app.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="PoeCharm2 repository root")
    parser.add_argument("--dry-run", action="store_true", help="Validate and print the planned sync without writing files")
    args = parser.parse_args()

    source = args.source.resolve()
    translate_root = source / "Data" / "Translate"
    if not translate_root.is_dir():
        raise SystemExit(
            f"PoeCharm2 translations were not found at {translate_root}. "
            "Clone the upstream repository into upstreams/PoeCharm2/ or pass --source."
        )

    languages: dict[str, list[str]] = {}
    for language in SUPPORTED_LANGUAGES:
        source_dir = translate_root / language
        if not source_dir.is_dir():
            raise SystemExit(f"Required PoeCharm2 language directory is missing: {source_dir}")
        files = sync_language(source_dir, TARGET_ROOT / language, args.dry_run)
        languages[language] = files
        print(f"{language}: {len(files)} CSV files")

    manifest = {
        "schemaVersion": 1,
        "source": {
            "repository": git_value(source, "config", "--get", "remote.origin.url"),
            "commit": git_value(source, "rev-parse", "HEAD"),
            "path": "Data/Translate",
        },
        "languages": languages,
    }
    if not args.dry_run:
        TARGET_ROOT.mkdir(parents=True, exist_ok=True)
        (TARGET_ROOT / "translation-files.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print("Translation manifest: ready" if not args.dry_run else "Translation manifest: validated")


if __name__ == "__main__":
    main()
