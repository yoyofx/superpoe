#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$SCRIPT_DIR/Local Storage/leveldb"
APP_ROOT="$HOME/Library/Application Support/SuperPoE2"
LOCAL_STORAGE_ROOT="$APP_ROOT/Local Storage"
TARGET="$LOCAL_STORAGE_ROOT/leveldb"
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
BACKUP="$LOCAL_STORAGE_ROOT/leveldb.backup-$TIMESTAMP"
MOVED_CURRENT_DATA=0

if [[ ! -d "$SOURCE" ]]; then
  echo "Snapshot directory not found: $SOURCE" >&2
  exit 1
fi

if [[ -f "$TARGET/LOCK" ]] && command -v lsof >/dev/null 2>&1 && lsof "$TARGET/LOCK" >/dev/null 2>&1; then
  echo "Close SuperPoE2 before restoring. Its local storage is still in use." >&2
  exit 1
fi

rollback() {
  local status=$?
  if [[ $status -ne 0 ]]; then
    rm -rf -- "$TARGET"
    if [[ $MOVED_CURRENT_DATA -eq 1 && -d "$BACKUP" ]]; then
      mv -- "$BACKUP" "$TARGET"
    fi
  fi
  exit "$status"
}

trap rollback EXIT
mkdir -p -- "$LOCAL_STORAGE_ROOT"

if [[ -d "$TARGET" ]]; then
  mv -- "$TARGET" "$BACKUP"
  MOVED_CURRENT_DATA=1
  echo "Current data backed up to: $BACKUP"
fi

cp -R -- "$SOURCE" "$TARGET"
trap - EXIT

echo "SuperPoE2 local storage restored from: $SOURCE"
echo "Start the desktop application to verify the saved builds."
