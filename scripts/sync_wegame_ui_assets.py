from __future__ import annotations

import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "design" / "references" / "wegame-poe2" / "assets"
DESTINATION = ROOT / "public" / "assets" / "ui" / "workbench"

ASSETS = (
    "avatar-bg-DBkVikWt.png",
    "buff-bg-D9XU9Qz5.png",
    "character-bg-Ce3UOQxh.png",
    "empty-bg-Db1Ulifn.png",
    "equip-bg-D8S81SLb.png",
    "equip-msg-bg-ebkz6IIH.png",
    "full-btn-DmL2cWPj.png",
    "gem-box-bg-BYH1JIiN.png",
    "gem-btn-rCLLK3nO.png",
    "line-adorn-DvnAWBwO.png",
    "main-buff-bg-BH5euifF.png",
    "page-bg-21pjpjtV.jpg",
    "profile-line-DRLu6cYR.png",
    "rune-bg-BxzydIwX.png",
    "share-bottom-adorn-DEOhZCVm.png",
    "share-bottom-bg-mMArcq8I.png",
    "share-middle-bg-CvYWVWcU.png",
    "share-top-adorn-BD-e8kpz.png",
    "share-top-bg-D0FOz_Dg.png",
    "skill-bg-D3gsSAqw.png",
    "skill-buff-bg-Bvd0k17P.png",
    "skill-row-bg-Dx4lobaU.png",
    "tab-item-cur-rPEjjreo.png",
    "talent-bg-Z3oOFQFg.png",
)


def main() -> None:
    if not SOURCE.is_dir():
        raise SystemExit(f"Missing WeGame reference assets: {SOURCE}")
    DESTINATION.mkdir(parents=True, exist_ok=True)
    copied = 0
    for name in ASSETS:
        source = SOURCE / name
        if not source.is_file():
            raise SystemExit(f"Missing reference asset: {source}")
        destination = DESTINATION / name
        if not destination.exists() or source.read_bytes() != destination.read_bytes():
            shutil.copy2(source, destination)
            copied += 1
    print(f"[ok] {len(ASSETS)} workbench assets ready, {copied} updated")


if __name__ == "__main__":
    main()
