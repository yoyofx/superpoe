# PoB2 Web Tree ¡ª Resource Pipeline Scripts

This directory contains all preprocessing scripts that convert PoB2 game data
into web-ready assets served via Vite from `public/`.

## Quick Start

```bash
cd web

# Run full pipeline (tree data + orbit PNGs + connector textures)
npm run pipeline:all

# Or run individual steps:
npm run pipeline:tree        # tree.json ¡ú tree-web-0_4.json
npm run pipeline:orbit       # Copy orbit PNG sprites
npm run pipeline:ui          # Copy UI assets
npm run pipeline:connectors  # DDS ¡ú connector WebP
npm run pipeline:dds         # Full DDS ¡ú WebP (icons + frames + effects)
```

## Script Reference

### `gen_tree_data.py`

Converts `upstreams/PathOfBuilding-PoE2/src/TreeData/{version}/tree.json` into `public/data/tree-web-{version}.json`.

**What it does:**
- Computes Cartesian (x,y) coordinates from polar group+orbit system
- Expands bidirectional connections (in + out edges)
- Classifies node types (Normal/Notable/Keystone/ClassStart/AscendClassStart/...)
- Extracts class/ascendancy background data for center display
- Computes `startNodeId` for each class (for BGTreeActive rotation)
- Strips unused fields for smaller payload

**Usage:**
```bash
python scripts/gen_tree_data.py              # default: 0_4
python scripts/gen_tree_data.py 0_1          # specific version
python scripts/gen_tree_data.py 0_5          # new game version
```

### `copy_orbit_png.py`

Copies orbit sprite PNGs from `upstreams/PathOfBuilding-PoE2/src/TreeData/{version}/` to `public/assets/orbit/{version}/`.

Orbit sprites are pre-rendered ring textures used as decorative backgrounds behind
Notable/Keystone nodes.

**Usage:**
```bash
python scripts/copy_orbit_png.py             # default: 0_4
python scripts/copy_orbit_png.py 0_5         # new version
```

### `copy_ui_assets.py`

Copies UI-related PNGs from `upstreams/PathOfBuilding-PoE2/src/Assets/` to `public/assets/ui/`.

Includes ring.png, small_ring.png, ShadedOuterRing.png, etc.

**Usage:**
```bash
python scripts/copy_ui_assets.py
```

### `dds_to_webp.py`

Decodes DDS (DirectDraw Surface) texture files into WebP images for web rendering.

Handles:
- BC1 (DXT1) ¡ª pure Python decoder
- BC7 ¡ª requires `texconv.exe` (DirectXTex)
- RGBA uncompressed

Outputs to `public/assets/dds/{version}/` organized by:
- `icons/` ¡ª node skill icons
- `frames/` ¡ª overlay frame sprites
- `effects/` ¡ª active glow effects
- `backgrounds/` ¡ª ascendancy/class background art
- `connectors/` ¡ª line connector textures

**Usage:**
```bash
python scripts/dds_to_webp.py                # Full pipeline
python scripts/dds_to_webp.py --connectors-only  # Connector textures only
```

### `parse_ddscoords.py`

Parses `upstreams/PathOfBuilding-PoE2/src/TreeData/{version}/tree.lua` to extract DDS sprite coordinates.

**Usage:**
```bash
python scripts/parse_ddscoords.py
```

### `extract_game_assets.py`

Bridge script for extracting DDS files from game installation.

**Usage:**
```bash
python scripts/extract_game_assets.py --game-dir <path_to_poe2>
```

## Adding a New Game Version (e.g., 0_5)

When GGG releases a new patch with updated tree data:

1. Pull the latest `upstreams/PathOfBuilding-PoE2/` from the PoB2 community repo:
   ```bash
   git -C upstreams/PathOfBuilding-PoE2 pull
   ```

2. Run the full pipeline for the new version:
   ```bash
   cd web
   python scripts/gen_tree_data.py 0_5
   python scripts/copy_orbit_png.py 0_5
   python scripts/dds_to_webp.py   # (will auto-detect all versions)
   ```

3. Update `web/src/store/treeStore.ts` to load the new tree-web-0_5.json

## Dependencies

| Tool | Version | Purpose |
|------|---------|---------|
| Python | ¡Ý 3.8 | All preprocessing scripts |
| texconv.exe | DirectXTex | BC7 DDS decoding (Windows) |
| Node.js | ¡Ý 18 | npm run pipeline commands |

## Output Structure

```
web/public/
©À©¤©¤ data/
©¦   ©¸©¤©¤ tree-web-0_4.json          # Processed tree data
©À©¤©¤ assets/
©¦   ©À©¤©¤ orbit/0_4/                 # Orbit ring PNGs
©¦   ©À©¤©¤ ui/                        # UI PNGs (ring.png, etc.)
©¦   ©À©¤©¤ connectors/0_4/            # Connector texture WebPs (90 files)
©¦   ©¸©¤©¤ dds/0_4/
©¦       ©À©¤©¤ icons/                 # Node skill icons (~531 WebPs)
©¦       ©À©¤©¤ frames/                # Overlay frame sprites
©¦       ©À©¤©¤ effects/               # Active glow effects
©¦       ©¸©¤©¤ backgrounds/           # Class/ascendancy art
```
