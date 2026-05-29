#!/usr/bin/env python3
"""Check local dependencies needed by the resource pipeline."""

import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path


def command_exists(command: str) -> bool:
    return shutil.which(command) is not None


def python_module_exists(module: str) -> bool:
    return importlib.util.find_spec(module) is not None


def check_luajit() -> tuple[bool, str]:
    luajit = os.environ.get("LUAJIT_PATH", "luajit")
    path = shutil.which(luajit) if luajit == "luajit" else luajit
    if not path:
        return False, "LuaJIT not found. Install LuaJIT or set LUAJIT_PATH to luajit.exe."
    try:
        result = subprocess.run(
            [path, "-e", "print(_VERSION)"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return True, f"LuaJIT OK: {path}"
    except Exception:
        pass
    return False, f"LuaJIT exists but failed to run: {path}"


def check_texconv(web_dir: Path) -> tuple[bool, str]:
    candidates = [
        shutil.which("texconv"),
        str(web_dir / "scripts" / "texconv.exe"),
    ]
    found = next((p for p in candidates if p and Path(p).exists()), None)
    if found:
        return True, f"texconv OK: {found}"
    return False, "texconv.exe not found. Required only for old DDS/BC7 versions such as 0_4."


def main() -> int:
    web_dir = Path(__file__).resolve().parents[1]
    checks: list[tuple[str, bool, str]] = []

    checks.append(("Node.js", command_exists("node"), "Node.js not found. Install Node.js 18+." if not command_exists("node") else "Node.js OK"))
    checks.append(("npm", command_exists("npm"), "npm not found. Install Node.js/npm." if not command_exists("npm") else "npm OK"))
    checks.append(("Pillow", python_module_exists("PIL"), "Pillow missing. Run: python -m pip install -r requirements.txt" if not python_module_exists("PIL") else "Pillow OK"))
    checks.append(("zstandard", python_module_exists("zstandard"), "zstandard missing. Run: python -m pip install -r requirements.txt" if not python_module_exists("zstandard") else "zstandard OK"))

    ok, msg = check_luajit()
    checks.append(("LuaJIT", ok, msg))
    ok, msg = check_texconv(web_dir)
    checks.append(("texconv", ok, msg))

    required_failed = False
    for name, ok, msg in checks:
        prefix = "[ok]" if ok else "[missing]"
        print(f"{prefix} {name}: {msg}")
        if name != "texconv" and not ok:
            required_failed = True

    if required_failed:
        print("\nInstall missing required dependencies, then run this check again.")
        return 1

    print("\nRequired pipeline dependencies look ready.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
