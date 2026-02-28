#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_ROOT="$HOME/.local/share/firefox-devtools-mcp"
WRAPPER_DIR="$REPO_ROOT/.mcp"
WRAPPER_HEADLESS="$WRAPPER_DIR/firefox-devtools-mcp-wrapper-headless.sh"
WRAPPER_HEADFUL="$WRAPPER_DIR/firefox-devtools-mcp-wrapper-headful.sh"
WRAPPER_ACTIVE="$WRAPPER_DIR/firefox-devtools-mcp-wrapper.sh"
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

write_wrapper() {
  local mode="$1"
  local wrapper="$2"
  local headless_flag=""
  if [[ "$mode" == "headless" ]]; then
    headless_flag="--headless"
  fi

  cat > "$wrapper" <<WRAP
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
  $headless_flag \\
  --viewport 1280x720 \\
  --start-url about:blank
WRAP
  chmod +x "$wrapper"
}

write_wrapper headless "$WRAPPER_HEADLESS"
write_wrapper headful "$WRAPPER_HEADFUL"
cp "$WRAPPER_HEADLESS" "$WRAPPER_ACTIVE"
chmod +x "$WRAPPER_ACTIVE"

codex mcp remove firefox-devtools >/dev/null 2>&1 || true
codex mcp add \
  -c 'startup_timeout_sec=30' \
  -c 'tool_timeout_sec=180' \
  firefox-devtools -- "$WRAPPER_ACTIVE"

echo "ok: firefox-devtools MCP configured"
echo "active wrapper: $WRAPPER_ACTIVE (default: headless)"
echo "headless wrapper: $WRAPPER_HEADLESS"
echo "headful wrapper: $WRAPPER_HEADFUL"
echo "log: $LOG_FILE"
echo "profile: $PROFILE_DIR"
echo "runtime: $RUNTIME_DIR"
echo
echo "switch mode:"
echo "  bash scripts/use-firefox-devtools-mcp-headless.sh"
echo "  bash scripts/use-firefox-devtools-mcp-headful.sh"
echo
echo "next: restart Codex CLI and run '/mcp' then test list_pages"
