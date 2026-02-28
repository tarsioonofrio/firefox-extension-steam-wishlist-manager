#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_FILE="/tmp/swm-native-host-reply.bin"

node - <<'NODE' | node "$ROOT_DIR/mcp/native-bridge-host.mjs" > "$OUT_FILE"
const body = Buffer.from(JSON.stringify({ type: 'ping' }), 'utf8');
const header = Buffer.alloc(4);
header.writeUInt32LE(body.length, 0);
process.stdout.write(header);
process.stdout.write(body);
NODE

node - <<'NODE'
const fs = require('node:fs');
const out = fs.readFileSync('/tmp/swm-native-host-reply.bin');
if (out.length < 4) {
  throw new Error('Invalid Native Messaging response (missing header).');
}
const len = out.readUInt32LE(0);
if (out.length < 4 + len) {
  throw new Error('Invalid Native Messaging response (truncated body).');
}
const msg = JSON.parse(out.subarray(4, 4 + len).toString('utf8'));
console.log(JSON.stringify({ ok: true, hostReply: msg }, null, 2));
NODE
