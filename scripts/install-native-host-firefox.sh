#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_NAME="dev.tarsio.steam_wishlist_manager_bridge"
EXT_ID="steam-wishlist-collections@tarsio.dev"
HOST_PATH="$ROOT_DIR/mcp/native-bridge-host.mjs"
TARGET_DIR="${HOME}/.mozilla/native-messaging-hosts"
TARGET_FILE="${TARGET_DIR}/${HOST_NAME}.json"

mkdir -p "$TARGET_DIR"
chmod +x "$HOST_PATH"

cat > "$TARGET_FILE" <<JSON
{
  "name": "${HOST_NAME}",
  "description": "Steam Wishlist Manager native bridge host",
  "path": "${HOST_PATH}",
  "type": "stdio",
  "allowed_extensions": ["${EXT_ID}"]
}
JSON

echo "Installed native host manifest: $TARGET_FILE"
echo "Host path: $HOST_PATH"
