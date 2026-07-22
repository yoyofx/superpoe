#!/usr/bin/env bash
# One-click local setup and Electron package build for SuperPoE2 (macOS / Linux).
#
# - Clone or fast-forward update read-only upstreams under upstreams/
# - npm install
# - Optional resource pipeline (public/ is already committed; only when refreshing upstream data)
# - npm run dist:electron
#
# Usage:
#   ./scripts/build-local.sh
#   ./scripts/build-local.sh --skip-upstreams
#   ./scripts/build-local.sh --with-pipeline --tree-version 0_5
#   ./scripts/build-local.sh --skip-package

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SKIP_UPSTREAMS=0
SKIP_INSTALL=0
SKIP_PACKAGE=0
WITH_PIPELINE=0
TREE_VERSION="0_5"

usage() {
  cat <<'EOF'
Usage: ./scripts/build-local.sh [options]

Options:
  --skip-upstreams       Do not clone or update upstreams/
  --skip-install         Skip npm install
  --skip-package         Stop after deps (and optional pipeline)
  --with-pipeline        Run npm run pipeline:all -- <tree-version>
  --tree-version <ver>   Tree version for --with-pipeline (default: 0_5)
  -h, --help             Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-upstreams) SKIP_UPSTREAMS=1; shift ;;
    --skip-install) SKIP_INSTALL=1; shift ;;
    --skip-package) SKIP_PACKAGE=1; shift ;;
    --with-pipeline) WITH_PIPELINE=1; shift ;;
    --tree-version)
      [[ $# -ge 2 ]] || { echo "error: --tree-version requires a value" >&2; exit 2; }
      TREE_VERSION="$2"
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

step() {
  echo ""
  echo "==> $*"
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found in PATH: $1" >&2
    exit 1
  fi
}

ensure_upstream_repo() {
  local url="$1"
  local path="$2"

  if [[ -d "$path/.git" ]]; then
    echo "Updating $path ..."
    if ! git -C "$path" pull --ff-only; then
      echo "error: git pull --ff-only failed for $path (local commits or dirty state?). Resolve manually, then re-run." >&2
      exit 1
    fi
    return
  fi

  if [[ -e "$path" ]]; then
    echo "error: directory exists but is not a git repository: $path. Remove it or init manually." >&2
    exit 1
  fi

  mkdir -p "$(dirname "$path")"
  echo "Cloning $url -> $path ..."
  git clone "$url" "$path"
}

step "SuperPoE2 local build (macOS/Linux)"
echo "Repo root: $ROOT"

need_cmd git
need_cmd npm
need_cmd node

if [[ "$SKIP_UPSTREAMS" -eq 0 ]]; then
  step "Clone / update upstreams (read-only, gitignored)"
  ensure_upstream_repo \
    "https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2.git" \
    "$ROOT/upstreams/PathOfBuilding-PoE2"
  ensure_upstream_repo \
    "https://github.com/Chuanhsing/PoeCharm2.git" \
    "$ROOT/upstreams/PoeCharm2"
else
  step "Skipping upstreams (--skip-upstreams)"
fi

if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  step "npm install"
  npm install
else
  step "Skipping npm install (--skip-install)"
fi

if [[ "$WITH_PIPELINE" -eq 1 ]]; then
  if [[ "$SKIP_UPSTREAMS" -eq 1 ]]; then
    echo "error: --with-pipeline requires upstreams. Remove --skip-upstreams." >&2
    exit 1
  fi
  step "Resource pipeline: npm run pipeline:all -- $TREE_VERSION"
  npm run pipeline:all -- "$TREE_VERSION"
fi

clear_build_artifacts() {
  # electron-builder writes installers to release/; old layouts left win-unpacked* under dist/.
  local path
  for path in "$ROOT/release" "$ROOT/dist/win-unpacked" "$ROOT/dist/win-unpacked.tmp"; do
    if [[ -e "$path" ]]; then
      if rm -rf "$path" 2>/dev/null; then
        echo "Removed $path"
      else
        echo "Warning: could not remove $path. Close SuperPoE2/Electron if running, then delete manually." >&2
      fi
    fi
  done
}

if [[ "$SKIP_PACKAGE" -eq 0 ]]; then
  step "Clear previous package artifacts"
  clear_build_artifacts
  step "Build local Electron package (npm run dist:electron)"
  npm run dist:electron
  echo ""
  echo "Done. Installer artifacts under release/ (or ELECTRON_BUILDER_OUTPUT). Renderer dist/, main dist-electron/."
else
  step "Skipping package (--skip-package)"
  echo "Done (setup only)."
