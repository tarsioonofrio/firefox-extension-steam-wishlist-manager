#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "Starting Firefox (steam-dev) with extension loaded via web-ext..."
exec bash scripts/dev/run-web-ext-steam-dev.sh "$@"
