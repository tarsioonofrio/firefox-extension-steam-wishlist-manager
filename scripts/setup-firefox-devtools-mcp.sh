#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_ROOT="$HOME/.local/share/firefox-devtools-mcp"
WRAPPER_DIR="$REPO_ROOT/.mcp"
WRAPPER="$WRAPPER_DIR/firefox-devtools-mcp-wrapper.sh"
PROFILE_BASE="/tmp/firefox-devtools-mcp"
LOG_FILE="${PROFILE_BASE}.stderr.log"
PROFILE_DIR="${PROFILE_BASE}-profile"
RUNTIME_DIR="${PROFILE_BASE}-runtime"
BIN="$MCP_ROOT/node_modules/.bin/firefox-devtools-mcp"

mkdir -p "$MCP_ROOT" "$WRAPPER_DIR" "$PROFILE_DIR" "$RUNTIME_DIR"

if [[ ! -f "$MCP_ROOT/package.json" ]]; then
  (cd "$MCP_ROOT" && npm init -y >/dev/null)
fi

(cd "$MCP_ROOT" && npm i -D firefox-devtools-mcp)

if [[ ! -x "$BIN" ]]; then
  echo "error: MCP binary not found at $BIN" >&2
  exit 1
fi

cat > "$WRAPPER" <<WRAP
#!/usr/bin/env bash
set -euo pipefail

BASE_TMP="$PROFILE_BASE"
LOG="${PROFILE_BASE}.stderr.log"
PROFILE="${PROFILE_BASE}-profile"
RUNTIME_DIR="${PROFILE_BASE}-runtime"
BIN="$BIN"

mkdir -p "\$PROFILE" "\$RUNTIME_DIR" /tmp
chmod 700 "\$RUNTIME_DIR" || true

export HOME="\${HOME:-$HOME}"
export TMPDIR="/tmp"
export XDG_RUNTIME_DIR="\${XDG_RUNTIME_DIR:-\$RUNTIME_DIR}"

if touch "\$LOG" 2>/dev/null; then
  exec 2> >(tee -a "\$LOG" >&2)
fi

echo "=== \$(date -Is) PID=\$\$ start ===" >&2
echo "BIN=\$BIN" >&2
echo "PROFILE=\$PROFILE" >&2
echo "ENV DISPLAY=\${DISPLAY-} WAYLAND_DISPLAY=\${WAYLAND_DISPLAY-} XDG_RUNTIME_DIR=\${XDG_RUNTIME_DIR-}" >&2

unset SE_DEBUG || true
unset SE_TRACE || true
unset NODE_OPTIONS || true

exec "\$BIN" \\
  --profile-path "\$PROFILE" \\
  --headless \\
  --viewport 1280x720 \\
  --start-url about:blank
WRAP

chmod +x "$WRAPPER"

codex mcp remove firefox-devtools >/dev/null 2>&1 || true
codex mcp add \
  -c 'startup_timeout_sec=30' \
  -c 'tool_timeout_sec=180' \
  firefox-devtools -- "$WRAPPER"

echo "ok: firefox-devtools MCP configured"
echo "wrapper: $WRAPPER"
echo "log: $LOG_FILE"
echo "profile: $PROFILE_DIR"
echo "runtime: $RUNTIME_DIR"
echo
echo "next: restart Codex CLI and run '/mcp' then test list_pages"
