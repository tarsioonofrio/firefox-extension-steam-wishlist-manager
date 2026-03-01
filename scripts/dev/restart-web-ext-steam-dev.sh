#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROFILE_NAME="${SWM_FIREFOX_PROFILE_NAME:-steam-dev}"

# Stop previous web-ext sessions for this repository.
pkill -f "web-ext run --source-dir ${REPO_ROOT}" >/dev/null 2>&1 || true
pkill -f "node .*web-ext run --source-dir ${REPO_ROOT}" >/dev/null 2>&1 || true

# Stop Firefox instance tied to the target dev profile.
pkill -f "firefox.*-P ${PROFILE_NAME}.*--no-remote" >/dev/null 2>&1 || true

sleep 1

exec bash "${REPO_ROOT}/scripts/dev/run-web-ext-steam-dev.sh" "$@"
