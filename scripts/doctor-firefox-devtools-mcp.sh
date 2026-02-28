#!/usr/bin/env bash
set -euo pipefail

LOG="/tmp/firefox-devtools-mcp.stderr.log"
WRAPPER="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.mcp/firefox-devtools-mcp-wrapper.sh"

echo "[1] codex mcp list"
codex mcp list | sed -n '1,200p'

echo
echo "[2] wrapper exists"
if [[ -x "$WRAPPER" ]]; then
  echo "ok: $WRAPPER"
else
  echo "missing/non-executable: $WRAPPER"
fi

echo
echo "[3] latest log tail"
if [[ -f "$LOG" ]]; then
  tail -n 80 "$LOG"
else
  echo "log not found: $LOG"
fi

echo
echo "[4] active processes"
pgrep -fa firefox-devtools-mcp || echo "none"
