#!/usr/bin/env bash
set -euo pipefail

EX_USAGE=64
EX_CONFIG=78

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROFILE_NAME="${SWM_FIREFOX_PROFILE_NAME:-steam-dev}"
PROFILES_INI="${SWM_FIREFOX_PROFILES_INI:-$HOME/.mozilla/firefox/profiles.ini}"
FIREFOX_BIN="${FIREFOX_BIN:-firefox}"
LAUNCH_FIREFOX=1
DRY_RUN=0

while (($#)); do
  case "$1" in
    --profile-name)
      PROFILE_NAME="${2:-}"
      shift 2
      ;;
    --profiles-ini)
      PROFILES_INI="${2:-}"
      shift 2
      ;;
    --no-launch)
      LAUNCH_FIREFOX=0
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "error: unknown argument '$1'" >&2
      echo "usage: $0 [--profile-name NAME] [--profiles-ini PATH] [--no-launch] [--dry-run] [-- <web-ext args>]" >&2
      exit "$EX_USAGE"
      ;;
  esac
done

if [[ ! -f "$PROFILES_INI" ]]; then
  echo "error: profiles.ini not found at $PROFILES_INI" >&2
  exit "$EX_CONFIG"
fi

PROFILE_MATCH="$(
  awk -v target="$PROFILE_NAME" '
    BEGIN { in_profile = 0; name = ""; path = ""; rel = "1" }
    /^\[Profile[0-9]+\]/ {
      if (in_profile && name == target) {
        print rel "|" path
        exit
      }
      in_profile = 1
      name = ""
      path = ""
      rel = "1"
      next
    }
    /^\[/ {
      if (in_profile && name == target) {
        print rel "|" path
        exit
      }
      in_profile = 0
      next
    }
    in_profile && /^Name=/ { name = substr($0, 6) }
    in_profile && /^Path=/ { path = substr($0, 6) }
    in_profile && /^IsRelative=/ { rel = substr($0, 12) }
    END {
      if (in_profile && name == target) {
        print rel "|" path
      }
    }
  ' "$PROFILES_INI"
)"

if [[ -z "$PROFILE_MATCH" ]]; then
  echo "error: profile '$PROFILE_NAME' not found in $PROFILES_INI" >&2
  echo "available profiles:" >&2
  awk -F= '/^\[Profile[0-9]+\]/{p=1; next} /^\[/{p=0} p && /^Name=/{print "  - " $2}' "$PROFILES_INI" >&2
  exit "$EX_CONFIG"
fi

PROFILE_IS_RELATIVE="${PROFILE_MATCH%%|*}"
PROFILE_PATH_VALUE="${PROFILE_MATCH#*|}"
PROFILES_DIR="$(cd "$(dirname "$PROFILES_INI")" && pwd)"

if [[ "$PROFILE_IS_RELATIVE" == "1" ]]; then
  FIREFOX_PROFILE_PATH="$PROFILES_DIR/$PROFILE_PATH_VALUE"
else
  FIREFOX_PROFILE_PATH="$PROFILE_PATH_VALUE"
fi

if [[ ! -d "$FIREFOX_PROFILE_PATH" ]]; then
  echo "error: resolved profile path does not exist: $FIREFOX_PROFILE_PATH" >&2
  exit "$EX_CONFIG"
fi

if ((LAUNCH_FIREFOX)); then
  "$FIREFOX_BIN" --new-instance -P "$PROFILE_NAME" --no-remote about:blank >/tmp/firefox-"$PROFILE_NAME".log 2>&1 &
fi

echo "profile: $PROFILE_NAME"
echo "path: $FIREFOX_PROFILE_PATH"
echo "launch_firefox: $LAUNCH_FIREFOX"

if ((DRY_RUN)); then
  echo "dry_run: 1"
  echo "would run: npx web-ext run --source-dir \"$REPO_ROOT\" --target=firefox-desktop --firefox-profile \"$FIREFOX_PROFILE_PATH\" --keep-profile-changes $*"
  exit 0
fi

exec npx web-ext run \
  --source-dir "$REPO_ROOT" \
  --target=firefox-desktop \
  --firefox-profile "$FIREFOX_PROFILE_PATH" \
  --keep-profile-changes \
  "$@"
