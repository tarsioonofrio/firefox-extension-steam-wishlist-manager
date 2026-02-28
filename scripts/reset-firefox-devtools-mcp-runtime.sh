#!/usr/bin/env bash
set -euo pipefail

pkill -f firefox-devtools-mcp || true
pkill -f "/tmp/firefox-devtools-mcp-profile" || true
pkill -f "playwright.*--browser firefox" || true

sleep 1

echo "remaining firefox-devtools processes:"
pgrep -fa firefox-devtools-mcp || echo "none"

echo "remaining profile-bound firefox processes:"
pgrep -fa "/tmp/firefox-devtools-mcp-profile" || echo "none"
