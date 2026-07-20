#!/usr/bin/env python3
"""Convert PoB TreeData/{version}/tree.lua to tree.json."""

import argparse
import os
import subprocess
import sys
from pathlib import Path


def convert(input_path: Path, output_path: Path) -> None:
    web_dir = Path(__file__).resolve().parent.parent
    lua_path = str(web_dir / "upstreams" / "PathOfBuilding-PoE2" / "runtime" / "lua").replace("\\", "/")
    input_lua = str(input_path).replace("\\", "/")
    output_json = str(output_path).replace("\\", "/")
    lua_script = f"""
package.path = {lua_path!r} .. '/?.lua;' .. package.path
local json = require('dkjson')
local data = dofile({input_lua!r})
local out = assert(io.open({output_json!r}, 'w'))
out:write(json.encode(data))
out:close()
"""
    result = subprocess.run(
        [os.environ.get("LUAJIT_PATH", "luajit"), "-e", lua_script],
        cwd=str(web_dir),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "Lua conversion failed").strip())


def main() -> None:
    ap = argparse.ArgumentParser(description="Convert tree.lua to tree.json")
    ap.add_argument("input")
    ap.add_argument("output")
    args = ap.parse_args()
    convert(Path(args.input).resolve(), Path(args.output).resolve())


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[tree_lua_to_json] {exc}", file=sys.stderr)
        sys.exit(1)
