#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$REPO_ROOT/.mcp/firefox-devtools-mcp-wrapper-headful.sh"
DST="$REPO_ROOT/.mcp/firefox-devtools-mcp-wrapper.sh"

if [[ ! -x "$SRC" ]]; then
  echo "missing: $SRC" >&2
  echo "run: bash scripts/mcp/setup-firefox-devtools-mcp.sh" >&2
  exit 1
fi

cp "$SRC" "$DST"
chmod +x "$DST"

codex mcp remove firefox-devtools >/dev/null 2>&1 || true
codex mcp add \
  -c 'startup_timeout_sec=30' \
  -c 'tool_timeout_sec=180' \
  firefox-devtools -- "$DST"

echo "ok: firefox-devtools set to HEADFUL (normal window)"
echo "restart Codex CLI to reload MCP process"
