#!/usr/bin/env bash
set -euo pipefail

echo "[session]"
echo "XDG_SESSION_TYPE=${XDG_SESSION_TYPE-}"
echo

echo "[display vars]"
echo "DISPLAY=${DISPLAY-}"
echo "WAYLAND_DISPLAY=${WAYLAND_DISPLAY-}"
echo "XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR-}"
echo

echo "[paths]"
echo "HOME=${HOME-}"
echo "TMPDIR=${TMPDIR-}"
echo

echo "[runtime dir check]"
if [[ -n "${XDG_RUNTIME_DIR-}" ]]; then
  if [[ -d "$XDG_RUNTIME_DIR" ]]; then
    echo "ok: runtime dir exists"
    ls -ld "$XDG_RUNTIME_DIR" || true
  else
    echo "warn: XDG_RUNTIME_DIR is set but directory does not exist"
  fi
else
  echo "warn: XDG_RUNTIME_DIR is empty"
fi
echo

echo "[wayland socket check]"
if [[ -n "${XDG_RUNTIME_DIR-}" && -n "${WAYLAND_DISPLAY-}" ]]; then
  if [[ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]]; then
    echo "ok: wayland socket exists at $XDG_RUNTIME_DIR/$WAYLAND_DISPLAY"
  else
    echo "warn: wayland socket not found at $XDG_RUNTIME_DIR/$WAYLAND_DISPLAY"
  fi
else
  echo "info: WAYLAND_DISPLAY or XDG_RUNTIME_DIR missing"
fi
echo

echo "[x11 check]"
if [[ -n "${DISPLAY-}" ]]; then
  echo "info: DISPLAY is set"
  command -v xset >/dev/null 2>&1 && xset q >/dev/null 2>&1 && echo "ok: X11 appears reachable" || echo "warn: X11 may be unreachable from this shell"
else
  echo "info: DISPLAY is empty"
fi
