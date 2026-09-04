#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${SUPERPOE_APP_DIR:-/home/ubuntu/superpoe}"
BIN_PATH="${SUPERPOE_BIN:-$APP_DIR/superpoe-server-linux}"
ENV_FILE="${SUPERPOE_ENV_FILE:-/home/ubuntu/.config/superpoe/server.env}"
PID_FILE="${SUPERPOE_PID_FILE:-$APP_DIR/superpoe-server.pid}"
LOG_FILE="${SUPERPOE_LOG_FILE:-$APP_DIR/superpoe-server.log}"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*" | tee -a "$LOG_FILE"
}

on_error() {
  local status=$?
  log "startup script error line=$1 status=$status command=$2" >&2 || true
  exit "$status"
}

trap 'on_error "$LINENO" "$BASH_COMMAND"' ERR

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo: sudo $0" >&2
  exit 1
fi

log "stage=begin app_dir=$APP_DIR binary=$BIN_PATH env_file=$ENV_FILE pid_file=$PID_FILE log_file=$LOG_FILE"

for required in "$BIN_PATH" "$ENV_FILE"; do
  if [[ ! -f "$required" ]]; then
    echo "Missing required file: $required" >&2
    exit 1
  fi
done

set -a
source "$ENV_FILE"
set +a

log "stage=environment_loaded server_addr=${SUPERPOE_SERVER_ADDR:-127.0.0.1:8787}"

HEALTH_URL="${SUPERPOE_HEALTH_URL:-}"
if [[ -z "$HEALTH_URL" ]]; then
  server_addr="${SUPERPOE_SERVER_ADDR:-127.0.0.1:8787}"
  health_port="${server_addr##*:}"
  if [[ "$health_port" == "$server_addr" || -z "$health_port" ]]; then
    health_port="8787"
  fi
  HEALTH_URL="http://127.0.0.1:${health_port}/api/health"
fi
log "stage=health_target url=$HEALTH_URL"

if ! chmod 0755 "$BIN_PATH"; then
  log "stage=permission_failed binary=$BIN_PATH" >&2
  exit 1
fi
if [[ ! -x "$BIN_PATH" ]]; then
  log "stage=permission_failed_after_update binary=$BIN_PATH" >&2
  exit 1
fi
log "stage=binary_ready mode=0755 binary=$BIN_PATH"
binary_hash="$(sha256sum "$BIN_PATH")"
log "stage=binary_hash $binary_hash"
if command -v file >/dev/null 2>&1; then
  log "stage=binary_info $(file -b "$BIN_PATH")"
fi

if [[ -s "$PID_FILE" ]]; then
  old_pid=""
  read -r old_pid < "$PID_FILE" || true
  log "stage=pid_file old_pid=${old_pid:-invalid}"
  if [[ "$old_pid" =~ ^[0-9]+$ ]] && kill -0 "$old_pid" 2>/dev/null; then
    log "stage=stopping old_pid=$old_pid"
    kill "$old_pid"
    for _ in {1..50}; do
      if ! kill -0 "$old_pid" 2>/dev/null; then
        break
      fi
      sleep 0.1
    done
    if kill -0 "$old_pid" 2>/dev/null; then
      log "stage=stop_failed old_pid=$old_pid timeout=5s" >&2
      exit 1
    fi
    log "stage=stopped old_pid=$old_pid"
  else
    log "stage=stale_pid_file old_pid=${old_pid:-invalid}"
  fi
else
  log "stage=no_pid_file"
fi
rm -f "$PID_FILE"

log "stage=starting binary=$BIN_PATH"

cd "$APP_DIR"
nohup "$BIN_PATH" serve >> "$LOG_FILE" 2>&1 < /dev/null &
new_pid=$!
printf '%s\n' "$new_pid" > "$PID_FILE"
log "stage=process_started new_pid=$new_pid"

for _ in {1..50}; do
  if kill -0 "$new_pid" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

if ! kill -0 "$new_pid" 2>/dev/null; then
  log "stage=process_exited_before_health new_pid=$new_pid" >&2
  log "stage=recent_log_begin" >&2
  tail -n 50 "$LOG_FILE" >&2 || true
  log "stage=recent_log_end" >&2
  exit 1
fi

health_response=""
health_ok=false
health_attempt=0
for _ in {1..50}; do
  health_attempt=$((health_attempt + 1))
  if ! kill -0 "$new_pid" 2>/dev/null; then
    log "stage=process_exited_during_health new_pid=$new_pid attempt=$health_attempt" >&2
    break
  fi
  if health_response="$(curl --fail --silent --show-error --max-time 2 "$HEALTH_URL" 2>&1)" && grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' <<< "$health_response"; then
    health_ok=true
    log "stage=health_passed attempt=$health_attempt response=$health_response"
    break
  fi
  compact_health_response="${health_response//$'\n'/ }"
  compact_health_response="${compact_health_response//$'\r'/ }"
  case "$health_attempt" in
    1|5|10|20|30|40|50)
      log "stage=health_pending attempt=$health_attempt response=$compact_health_response"
      ;;
  esac
  sleep 0.1
done

if [[ "$health_ok" != true ]]; then
  log "stage=health_failed url=$HEALTH_URL attempts=$health_attempt" >&2
  if [[ -n "$health_response" ]]; then
    log "stage=health_last_response response=$compact_health_response" >&2
  fi
  log "stage=process_status" >&2
  ps -fp "$new_pid" 2>&1 | tee -a "$LOG_FILE" >&2 || true
  log "stage=listening_sockets" >&2
  ss -ltnp 2>&1 | tee -a "$LOG_FILE" >&2 || true
  kill "$new_pid" 2>/dev/null || true
  for _ in {1..50}; do
    if ! kill -0 "$new_pid" 2>/dev/null; then
      break
    fi
    sleep 0.1
  done
  rm -f "$PID_FILE"
  log "stage=failed_process_cleaned new_pid=$new_pid" >&2
  log "stage=recent_log_begin" >&2
  tail -n 50 "$LOG_FILE" >&2 || true
  log "stage=recent_log_end" >&2
  exit 1
fi

log "stage=ready pid=$new_pid binary=$BIN_PATH"
log "stage=health url=$HEALTH_URL response=$health_response"
log "stage=log_file path=$LOG_FILE"
