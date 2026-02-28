#!/usr/bin/env bash
set -euo pipefail

PROFILE_NAME="${SWM_FIREFOX_PROFILE_NAME:-steam-dev}"
PROFILES_INI="${SWM_FIREFOX_PROFILES_INI:-$HOME/.mozilla/firefox/profiles.ini}"

require_cmd() {
  local cmd="$1"
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "ok: $cmd"
  else
    echo "missing: $cmd" >&2
    return 1
  fi
}

echo "[commands]"
require_cmd node
require_cmd npm
require_cmd npx
require_cmd firefox

echo
echo "[files]"
if [[ -f "$PROFILES_INI" ]]; then
  echo "ok: profiles.ini found at $PROFILES_INI"
else
  echo "missing: $PROFILES_INI" >&2
  exit 1
fi

if awk -v target="$PROFILE_NAME" '
  /^\[Profile[0-9]+\]/{in_profile=1;name="";next}
  /^\[/{in_profile=0}
  in_profile && /^Name=/{name=substr($0,6); if (name==target) { found=1 }}
  END{exit found?0:1}
' "$PROFILES_INI"; then
  echo "ok: firefox profile '$PROFILE_NAME' exists"
else
  echo "warn: firefox profile '$PROFILE_NAME' not found in profiles.ini"
fi

echo
echo "[node modules]"
if [[ -d "node_modules/web-ext" || -x "node_modules/.bin/web-ext" ]]; then
  echo "ok: web-ext dependency available locally"
else
  echo "warn: web-ext not found locally (run: npm install)"
fi

echo
echo "environment check completed"
