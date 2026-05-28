#!/usr/bin/env python3
"""
DDS Pipeline: zstd decompress + DDS parse + BC1/BC7 decode + WebP export
Generates sprites for PoB2 web passive tree from game DDS assets.
"""
import zstandard as zstd
import struct
import os
import sys
import json
import re
from pathlib import Path
from PIL import Image
from io import BytesIO
import subprocess
import tempfile
import shutil
from parse_ddscoords import parse_ddscoords

# === BC1 (DXT1) Decoder (Pure Python) ===

def decode_bc1_block(block_data, offset):
    """Decode a single 4x4 BC1 block. Returns 16 RGBA tuples."""
    color0 = struct.unpack_from('<H', block_data, offset)[0]
    color1 = struct.unpack_from('<H', block_data, offset + 2)[0]
    codes = struct.unpack_from('<I', block_data, offset + 4)[0]
    
    # Decode RGB565
    def rgb565(c):
        r = ((c >> 11) & 0x1F) * 255 // 31
        g = ((c >> 5) & 0x3F) * 255 // 63
        b = (c & 0x1F) * 255 // 31
        return (r, g, b)
    
    c0 = rgb565(color0)
    c1 = rgb565(color1)
    
    pixels = []
    for i in range(16):
        code = (codes >> (i * 2)) & 3
        if code == 0:
            pixels.append((*c0, 255))
        elif code == 1:
            pixels.append((*c1, 255))
        elif code == 2:
            if color0 > color1:
                r = (2 * c0[0] + c1[0]) // 3
                g = (2 * c0[1] + c1[1]) // 3
                b = (2 * c0[2] + c1[2]) // 3
                pixels.append((r, g, b, 255))
            else:
                r = (c0[0] + c1[0]) // 2
                g = (c0[1] + c1[1]) // 2
                b = (c0[2] + c1[2]) // 2
                pixels.append((r, g, b, 255))
        else:
            if color0 > color1:
                r = (c0[0] + 2 * c1[0]) // 3
                g = (c0[1] + 2 * c1[1]) // 3
                b = (c0[2] + 2 * c1[2]) // 3
                pixels.append((r, g, b, 255))
            else:
                pixels.append((0, 0, 0, 0))
    
    return pixels

def decode_bc1(width, height, data, offset=0):
    """Decode full BC1 image. Returns RGBA pixel list (row-major)."""
    blocks_x = (width + 3) // 4
    blocks_y = (height + 3) // 4
    
    # Build full image pixel buffer
    img = bytearray(width * height * 4)
    
    for by in range(blocks_y):
        for bx in range(blocks_x):
            block_idx = by * blocks_x + bx
            pixels = decode_bc1_block(data, offset + block_idx * 8)
            
            for py in range(4):
                for px in range(4):
                    pixel_x = bx * 4 + px
                    pixel_y = by * 4 + py
                    if pixel_x < width and pixel_y < height:
                        idx = (pixel_y * width + pixel_x) * 4
                        rgba = pixels[py * 4 + px]
                        img[idx:idx+4] = bytes(rgba)
    
    return bytes(img)


# === DDS Parser ===

def parse_dds_header(data):
    """Parse DDS header, return dict with format info."""
    magic = struct.unpack_from('<I', data, 0)[0]
    if magic != 0x20534444:
        return None
    
    hdr = {
        'width': struct.unpack_from('<I', data, 16)[0],
        'height': struct.unpack_from('<I', data, 12)[0],
        'mipmaps': struct.unpack_from('<I', data, 28)[0],
        'pf_fourcc': struct.unpack_from('<I', data, 84)[0],
        'fmt': 'unknown',
        'array_size': 1,
        'data_start': 128,
        'frame_bytes': 0,
    }
    
    if hdr['pf_fourcc'] == 0x30315844:  # DX10
        dxgi_fmt = struct.unpack_from('<I', data, 128)[0]
        hdr['array_size'] = struct.unpack_from('<I', data, 140)[0]
        hdr['data_start'] = 148
        
        fmt_map = {71: 'BC1', 74: 'BC2', 77: 'BC3', 80: 'BC4',
                   83: 'BC5', 95: 'BC6H', 98: 'BC7', 28: 'RGBA8'}
        hdr['fmt'] = fmt_map.get(dxgi_fmt, f'DXGI_{dxgi_fmt}')
    elif hdr['pf_fourcc'] == 0x31545844:  # DXT1
        hdr['fmt'] = 'BC1'
    elif hdr['pf_fourcc'] == 0x32545844:  # DXT2
        hdr['fmt'] = 'BC2'
    elif hdr['pf_fourcc'] == 0x33545844:  # DXT3
        hdr['fmt'] = 'BC2'
    elif hdr['pf_fourcc'] == 0x34545844:  # DXT4
        hdr['fmt'] = 'BC3'
    elif hdr['pf_fourcc'] == 0x35545844:  # DXT5
        hdr['fmt'] = 'BC3'
    
    # Calculate bytes per frame (with mipmaps)
    total_block_bytes = 0
    w, h = hdr['width'], hdr['height']
    for _ in range(max(hdr['mipmaps'], 1)):
        if hdr['fmt'] == 'RGBA8':
            total_block_bytes += w * h * 4  # raw RGBA pixels
        else:
            block_bytes = 8 if hdr['fmt'] in ('BC1',) else 16
            bw = (w + 3) // 4
            bh = (h + 3) // 4
            total_block_bytes += bw * bh * block_bytes
        if w == 1 and h == 1:
            break
        w = max(1, w // 2)
        h = max(1, h // 2)
    
    hdr['frame_bytes'] = total_block_bytes
    return hdr


def extract_frame_mip0(hdr, raw_data, frame_idx):
    """Extract only mip0 (highest resolution) from a frame.
    frame_idx is 1-based (Lua ddsCoords convention), converted to 0-based internally.
    """
    w, h = hdr['width'], hdr['height']
    if hdr['fmt'] == 'RGBA8':
        mip0_bytes = w * h * 4  # raw RGBA pixels
    else:
        block_bytes = 8 if hdr['fmt'] in ('BC1',) else 16
        bw = (w + 3) // 4
        bh = (h + 3) // 4
        mip0_bytes = bw * bh * block_bytes
    
    offset = hdr['data_start'] + (frame_idx - 1) * hdr['frame_bytes']
    if offset + mip0_bytes > len(raw_data):
        return None  # out of bounds
    return raw_data[offset:offset + mip0_bytes]


# === BC7 Decoder (via texconv) ===

def _find_texconv():
    """Find texconv.exe on PATH or in common locations."""
    # Check PATH
    path = shutil.which('texconv')
    if path:
        return path
    # Check common locations
    candidates = [
        'texconv.exe',
        os.path.expandvars(r'%USERPROFILE%\.cargo\bin\texconv.exe'),
        os.path.join(os.path.dirname(__file__), 'texconv.exe'),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return None


def decode_bc7_texconv(width, height, raw_data):
    """Decode BC7 data by writing temp DDS + texconv -> PNG -> read back.
    raw_data should be the full frame data (all mipmaps) with a proper DDS
    header already prepended, just with array_size patched to 1.
    """
    texconv = _find_texconv()
    if not texconv:
        return None
    
    # Build a full DDS: copy header from original file, append frame's mipmap data
    # raw_data already has header + frame data
    dds_data = raw_data  # Expect header + frame mipmaps
    
    with tempfile.TemporaryDirectory() as tmpdir:
        dds_path = os.path.join(tmpdir, 'temp.dds')
        with open(dds_path, 'wb') as f:
            f.write(dds_data)
        
        result = subprocess.run(
            [texconv, '-ft', 'png', '-o', tmpdir, '-y', '-nologo', dds_path],
            capture_output=True, timeout=30
        )
        
        if result.returncode != 0:
            return None
        
        png_path = os.path.join(tmpdir, 'temp.png')
        if os.path.exists(png_path):
            img = Image.open(png_path)
            # Crop to mip0 only: texconv may include mipmaps in output
            if img.width != width or img.height != height:
                img = img.crop((0, 0, width, height))
            return img.copy()
    
    return None


def build_bc7_frame_dds(original_raw, data_start, frame_idx, frame_bytes):
    """Build a single-frame DDS from texture array.
    Copies original DDS header, appends frame's mipmap data, patches array_size=1.
    frame_idx is 1-based (Lua ddsCoords convention).
    Returns bytes of complete DDS file.
    """
    frame_offset = data_start + (frame_idx - 1) * frame_bytes
    frame_data = original_raw[frame_offset:frame_offset + frame_bytes]
    
    # Copy header from original
    dds_data = bytearray(original_raw[:data_start]) + frame_data
    
    # Patch array_size in DX10 header at offset 140 to 1
    struct.pack_into('<I', dds_data, 140, 1)
    
    return bytes(dds_data)


# === Main Pipeline ===

class DDSPipeline:
    def __init__(self, tree_data_dir, output_dir, version='0_4'):
        self.tree_data_dir = Path(tree_data_dir)
        self.output_dir = Path(output_dir) / version
        self.version = version
        self.dctx = zstd.ZstdDecompressor()
        self.stats = {'total': 0, 'success': 0, 'failed': 0}
        self.sprite_index = {}  # asset_name -> {file, x, y, w, h}
        self.texconv = _find_texconv()
    
    def log(self, msg):
        print(f"  {msg}")
    
    def run(self):
        """Run the full pipeline."""
        print(f"\n=== DDS Pipeline v{self.version} ===")
        
        # Step 1: Parse tree.lua ddsCoords
        self.log("Step 1: Parsing ddsCoords from tree.lua...")
        lua_path = str(self.tree_data_dir / 'tree.lua')
        coords = parse_ddscoords(lua_path)
        self.log(f"  Found {len(coords)} DDS files, {sum(len(v) for v in coords.values())} total sprites")
        
        # Step 2: Process each DDS file
        self.log(f"Step 2: Processing {len(coords)} DDS files...")
        os.makedirs(self.output_dir / 'icons', exist_ok=True)
        os.makedirs(self.output_dir / 'frames', exist_ok=True)
        os.makedirs(self.output_dir / 'effects', exist_ok=True)
        os.makedirs(self.output_dir / 'backgrounds', exist_ok=True)
        
        dds_handles = {}  # filename -> {raw, hdr}
        
        for dds_file, asset_map in coords.items():
            fpath = self.tree_data_dir / dds_file
            if not fpath.exists():
                self.log(f"  WARNING: {dds_file} not found, skipping {len(asset_map)} assets")
                self.stats['failed'] += len(asset_map)
                continue
            
            # Load and decompress
            self.stats['total'] += len(asset_map)
            try:
                with open(fpath, 'rb') as f:
                    compressed = f.read()
                raw = self.dctx.decompress(compressed)
                hdr = parse_dds_header(raw)
                if hdr is None:
                    self.log(f"  ERROR: {dds_file} is not valid DDS")
                    self.stats['failed'] += len(asset_map)
                    continue
                
                dds_handles[dds_file] = (raw, hdr)
            except Exception as e:
                self.log(f"  ERROR loading {dds_file}: {e}")
                self.stats['failed'] += len(asset_map)
                continue
            
            # Determine category
            fbase = os.path.basename(dds_file)
            if 'skills-' in fbase:
                category = 'icons'
            elif 'skills_' in fbase or 'legion_' in fbase:
                category = 'icons'
            elif 'ascendancy' in fbase or 'background' in fbase or 'group-background' in fbase:
                category = 'backgrounds'
            elif 'effect' in fbase or 'mastery' in fbase:
                category = 'effects'
            else:
                category = 'frames'
            
            # Process each asset in this sheet
            for asset_name, frame_idx in asset_map.items():
                safe_name = self._safe_filename(asset_name)
                out_path = self.output_dir / category / f"{safe_name}.webp"
                
                # Skip if already exists (cache)
                if out_path.exists():
                    self.sprite_index[asset_name] = {
                        'file': f"assets/dds/{self.version}/{category}/{safe_name}.webp",
                        'w': hdr['width'], 'h': hdr['height']
                    }
                    self.stats['success'] += 1
                    continue
                
                try:
                    if hdr['fmt'] == 'BC1':
                        # Pure Python BC1 decode
                        mip0 = extract_frame_mip0(hdr, raw, frame_idx)
                        if mip0 is None or len(mip0) == 0:
                            self.stats['failed'] += 1
                            continue
                        rgba = decode_bc1(hdr['width'], hdr['height'], mip0)
                        img = Image.frombytes('RGBA', (hdr['width'], hdr['height']), rgba)
                    elif hdr['fmt'] in ('BC7', 'BC2', 'BC3'):
                        # Try texconv with full frame DDS (header + mipmaps)
                        if self.texconv:
                            dds_data = build_bc7_frame_dds(raw, hdr['data_start'], frame_idx, hdr['frame_bytes'])
                            img = decode_bc7_texconv(hdr['width'], hdr['height'], dds_data)
                        else:
                            img = None
                        
                        if img is None:
                            self.stats['failed'] += 1
                            continue
                    elif hdr['fmt'] == 'RGBA8':
                        # Raw RGBA pixels
                        mip0 = extract_frame_mip0(hdr, raw, frame_idx)
                        if mip0 is None or len(mip0) == 0:
                            self.stats['failed'] += 1
                            continue
                        img = Image.frombytes('RGBA', (hdr['width'], hdr['height']), mip0)
                    else:
                        self.log(f"  Unknown format {hdr['fmt']} for {dds_file}")
                        self.stats['failed'] += 1
                        continue
                    
                    out_path.parent.mkdir(parents=True, exist_ok=True)
                    img.save(str(out_path), 'WEBP', quality=85)
                    self.sprite_index[asset_name] = {
                        'file': f"assets/dds/{self.version}/{category}/{safe_name}.webp",
                        'w': hdr['width'], 'h': hdr['height']
                    }
                    self.stats['success'] += 1
                    
                except Exception as e:
                    self.log(f"  ERROR decoding {asset_name}[{frame_idx}] from {dds_file}: {e}")
                    self.stats['failed'] += 1
        
        # Step 3: Save sprite index
        self.log("Step 3: Saving sprite-index.json...")
        index_path = self.output_dir / 'sprite-index.json'
        with open(index_path, 'w', encoding='utf-8') as f:
            json.dump(self.sprite_index, f, ensure_ascii=False, indent=2)
        
        # Summary
        print(f"\n=== Pipeline Complete ===")
        print(f"  Total: {self.stats['total']}, Success: {self.stats['success']}, Failed: {self.stats['failed']}")
        if self.texconv:
            print(f"  texconv: {self.texconv}")
        else:
            print(f"  texconv: NOT FOUND (BC7 files skipped)")
        print(f"  Output: {self.output_dir}")
    
    def _safe_filename(self, name):
        safe = name.replace('Art/2DArt/', '').replace('/', '_')
        if safe.endswith('.dds'):
            safe = safe[:-4]
        safe = ''.join(c if c.isalnum() or c in '_-.()' else '_' for c in safe)
        if len(safe) > 120:
            safe = safe[:60] + '___' + safe[-60:]
        return safe
    #
    # NOTE: Old parser methods removed; use parse_ddscoords module instead.
    #
    def _parse_lua_table(self, content, start):
        """Simple Lua table parser for ddsCoords structure."""
        # Skip opening brace
        pos = start
        while pos < len(content) and content[pos] in ' \t\n\r':
            pos += 1
        if pos < len(content) and content[pos] == '{':
            pos += 1
        
        result = {}
        brace_depth = 1
        
        while pos < len(content) and brace_depth > 0:
            c = content[pos]
            if c == '{':
                brace_depth += 1
                pos += 1
            elif c == '}':
                brace_depth -= 1
                pos += 1
            elif c == '[':
                # Key: ["name"] = value
                end_key = content.index(']', pos)
                key = content[pos+2:end_key-1] if content[pos+1] == '"' else content[pos+1:end_key]
                pos = end_key + 1
                # Skip = and whitespace
                while pos < len(content) and content[pos] in ' \t=\n\r':
                    pos += 1
                # Value: number or nested table
                if pos < len(content) and content[pos] == '{':
                    # Nested table: {name = idx, ...}
                    nested = self._parse_nested_asset_table(content, pos)
                    for nk, nv in nested:
                        result[key] = (nk, nv)
                    pos = content.index('}', pos) + 1
                    # Skip comma
                    while pos < len(content) and content[pos] in ' \t,\n\r':
                        pos += 1
                else:
                    pos += 1
            elif c == '"' or c == "'" or ('a' <= c.lower() <= 'z') or ('A' <= c <= 'Z'):
                # Key without brackets: name = value
                # Find end of key
                end = pos
                while end < len(content) and content[end] not in ' \t=\n\r':
                    end += 1
                key = content[pos:end]
                pos = end
                # Skip = and whitespace
                while pos < len(content) and content[pos] in ' \t=\n\r':
                    pos += 1
                if pos < len(content) and content[pos] == '=':
                    pos += 1
                while pos < len(content) and content[pos] in ' \t\n\r':
                    pos += 1
                
                if pos < len(content) and content[pos] == '{':
                    nested = self._parse_nested_asset_table(content, pos)
                    for nk, nv in nested:
                        result[key] = (nk, nv)
                    pos = content.index('}', pos) + 1
                    while pos < len(content) and content[pos] in ' \t,\n\r':
                        pos += 1
                else:
                    # Number value
                    end = pos
                    while end < len(content) and content[end] in '0123456789':
                        end += 1
                    val = int(content[pos:end])
                    result[key] = val
                    pos = end
                    while pos < len(content) and content[pos] in ' \t,\n\r':
                        pos += 1
            else:
                pos += 1
        
        # Convert result: if filename maps to list of tuples, convert to dict
        final = {}
        for filename, value in result.items():
            if isinstance(value, list):
                final[filename] = dict(value)
            else:
                # Single value - this shouldn't happen for ddsCoords
                pass
        
        return final
    
    def _parse_nested_asset_table(self, content, pos):
        """Parse {name1=idx1, name2=idx2, ...} and return [(name, idx), ...]."""
        result = []
        depth = 1
        pos = pos + 1  # skip opening {
        
        while pos < len(content) and depth > 0:
            c = content[pos]
            if c == '{':
                depth += 1
                pos += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    break
                pos += 1
            elif c == '[':
                # ["name"] = idx
                end_key = content.index(']', pos)
                key = content[pos+2:end_key-1] if content[pos+1] == '"' else content[pos+1:end_key]
                pos = end_key + 1
                while pos < len(content) and content[pos] in ' \t=\n\r':
                    pos += 1
                end = pos
                while end < len(content) and content[end] in '0123456789':
                    end += 1
                val = int(content[pos:end])
                result.append((key, val))
                pos = end
                while pos < len(content) and content[pos] in ' \t,\n\r':
                    pos += 1
            elif c == '"' or c == "'":
                # "name" or 'name' = idx
                quote = c
                end = pos + 1
                while end < len(content) and content[end] != quote:
                    end += 1
                key = content[pos+1:end]
                pos = end + 1
                while pos < len(content) and content[pos] in ' \t=\n\r':
                    pos += 1
                end = pos
                while end < len(content) and content[end] in '0123456789':
                    end += 1
                val = int(content[pos:end])
                result.append((key, val))
                pos = end
                while pos < len(content) and content[pos] in ' \t,\n\r':
                    pos += 1
            elif ('a' <= c.lower() <= 'z') or ('A' <= c <= 'Z'):
                # abc = idx (unquoted key)
                end = pos
                while end < len(content) and content[end] not in ' \t=\n\r':
                    end += 1
                key = content[pos:end]
                pos = end
                while pos < len(content) and content[pos] in ' \t=\n\r':
                    pos += 1
                if pos < len(content) and content[pos] == '=':
                    pos += 1
                while pos < len(content) and content[pos] in ' \t\n\r':
                    pos += 1
                end = pos
                while end < len(content) and content[end] in '0123456789':
                    end += 1
                if end > pos:
                    val = int(content[pos:end])
                    result.append((key, val))
                    pos = end
                while pos < len(content) and content[pos] in ' \t,\n\r':
                    pos += 1
            else:
                pos += 1
        
        return result
    
    def _safe_filename(self, name):
        """Convert asset path to safe filename."""
        # Replace / with _, remove extension
        safe = name.replace('Art/2DArt/', '').replace('/', '_')
        # Remove .dds extension if present
        if safe.endswith('.dds'):
            safe = safe[:-4]
        # Remove invalid chars
        safe = ''.join(c if c.isalnum() or c in '_-.()' else '_' for c in safe)
        # Truncate long names
        if len(safe) > 120:
            safe = safe[:60] + '___' + safe[-60:]
        return safe


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser(description='DDS to WebP Pipeline')
    ap.add_argument('--tree-data', default='sources/src/TreeData/0_4',
                    help='Path to TreeData directory (contains tree.lua + .dds.zst files)')
    ap.add_argument('--output', default='public/assets/dds',
                    help='Output directory for generated sprites')
    ap.add_argument('--version', default='0_4',
                    help='Tree version (0_1, 0_4, etc.)')
    args = ap.parse_args()
    
    pipeline = DDSPipeline(args.tree_data, args.output, args.version)
    pipeline.run()
