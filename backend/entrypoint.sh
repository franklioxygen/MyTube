#!/bin/bash
set -Eeuo pipefail

DATA_DIR="${MYTUBE_DATA_DIR:-/app/data}"
UPLOADS_DIR="${MYTUBE_UPLOADS_DIR:-/app/uploads}"
HOME_DIR="${DATA_DIR}/.home"
TARGET_UID="${PUID:-1000}"
TARGET_GID="${PGID:-1000}"
AUTO_FIX_PERMISSIONS="${MYTUBE_AUTO_FIX_PERMISSIONS:-1}"

log() {
  printf '[mytube-entrypoint] %s\n' "$*"
}

die() {
  log "ERROR: $*"
  exit 1
}

require_numeric() {
  local label="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    die "$label must be a numeric uid/gid value, got '$value'."
  fi
}

is_truthy() {
  case "${1,,}" in
    1|true|yes|on) return 0 ;;
    0|false|no|off) return 1 ;;
    *) die "MYTUBE_AUTO_FIX_PERMISSIONS must be one of: 1, 0, true, false, yes, no, on, off." ;;
  esac
}

path_owner() {
  stat -c '%u:%g' "$1" 2>/dev/null || true
}

reconcile_path_if_needed() {
  local path="$1"
  local recursive="${2:-0}"
  local current_owner

  if [ ! -e "$path" ]; then
    return 0
  fi

  current_owner="$(path_owner "$path")"
  if [ "$current_owner" = "${TARGET_UID}:${TARGET_GID}" ]; then
    return 0
  fi

  log "Reconciling ownership for $path (${current_owner:-unknown} -> ${TARGET_UID}:${TARGET_GID})"

  if [ "$recursive" = "1" ]; then
    if ! chown -R "${TARGET_UID}:${TARGET_GID}" "$path"; then
      log "Unable to recursively chown $path. A writable-path check will run before startup."
    fi
    return 0
  fi

  if ! chown "${TARGET_UID}:${TARGET_GID}" "$path"; then
    log "Unable to chown $path. A writable-path check will run before startup."
  fi
}

ensure_writable_as_target() {
  local path="$1"
  local label="$2"

  if ! gosu "${TARGET_UID}:${TARGET_GID}" test -w "$path"; then
    die "$label is not writable for uid/gid ${TARGET_UID}:${TARGET_GID}: $path. If this is a bind mount, either set PUID/PGID to match the host ownership or run 'chown -R ${TARGET_UID}:${TARGET_GID} <host-data-dir> <host-uploads-dir>'."
  fi
}

prepare_runtime_layout() {
  mkdir -p \
    "$DATA_DIR" \
    "$UPLOADS_DIR" \
    "$UPLOADS_DIR/videos" \
    "$UPLOADS_DIR/images" \
    "$UPLOADS_DIR/images-small" \
    "$UPLOADS_DIR/subtitles" \
    "$UPLOADS_DIR/avatars" \
    "$UPLOADS_DIR/cloud-thumbnail-cache" \
    "$HOME_DIR"
}

require_numeric "PUID" "$TARGET_UID"
require_numeric "PGID" "$TARGET_GID"

if [ "$(id -u)" = "0" ]; then
  prepare_runtime_layout

  if is_truthy "$AUTO_FIX_PERMISSIONS"; then
    # Reconcile top-level directories recursively first. Individual paths below
    # are a deliberate fallback: if the recursive pass partially fails (e.g. a
    # single inaccessible file), the targeted calls may still fix the critical
    # paths needed for startup.
    reconcile_path_if_needed "$DATA_DIR" 1
    reconcile_path_if_needed "$DATA_DIR/mytube.db"
    reconcile_path_if_needed "$UPLOADS_DIR" 1
    reconcile_path_if_needed "$UPLOADS_DIR/images-small" 1
    reconcile_path_if_needed "$UPLOADS_DIR/videos" 1
    reconcile_path_if_needed "$UPLOADS_DIR/images" 1
    reconcile_path_if_needed "$UPLOADS_DIR/subtitles" 1
    reconcile_path_if_needed "$UPLOADS_DIR/avatars" 1
    reconcile_path_if_needed "$UPLOADS_DIR/cloud-thumbnail-cache" 1
  else
    log "Skipping automatic permission reconciliation because MYTUBE_AUTO_FIX_PERMISSIONS=${AUTO_FIX_PERMISSIONS}"
  fi

  export HOME="$HOME_DIR"

  ensure_writable_as_target "$DATA_DIR" "Data directory"
  ensure_writable_as_target "$UPLOADS_DIR" "Uploads directory"
  ensure_writable_as_target "$HOME_DIR" "Runtime home directory"

  if [ -e "$DATA_DIR/mytube.db" ]; then
    ensure_writable_as_target "$DATA_DIR/mytube.db" "SQLite database file"
  fi

  # Ensure /etc/passwd and /etc/group contain entries for PUID/PGID so that
  # child processes (npm, git, yt-dlp) do not warn about unknown uid/gid.
  if ! getent group "$TARGET_GID" > /dev/null 2>&1; then
    groupadd -g "$TARGET_GID" -o mytube 2>/dev/null || true
  fi
  if ! getent passwd "$TARGET_UID" > /dev/null 2>&1; then
    useradd -u "$TARGET_UID" -g "$TARGET_GID" -o -s /sbin/nologin -M -d "$HOME_DIR" mytube 2>/dev/null || true
  fi

  log "Starting MyTube as uid/gid ${TARGET_UID}:${TARGET_GID}"
  exec gosu "${TARGET_UID}:${TARGET_GID}" "$@"
fi

export HOME="${HOME:-$HOME_DIR}"
log "Entrypoint is running as uid/gid $(id -u):$(id -g); skipping permission reconciliation."
exec "$@"
