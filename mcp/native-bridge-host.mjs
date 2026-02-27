#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SNAPSHOT_PATH = process.env.SWM_NATIVE_BRIDGE_SNAPSHOT_PATH
  ? path.resolve(process.env.SWM_NATIVE_BRIDGE_SNAPSHOT_PATH)
  : path.join(os.tmpdir(), 'steam-wishlist-manager-extension-bridge-snapshot.json');

function sendMessage(obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  try {
    process.stdout.write(header);
    process.stdout.write(json);
  } catch {
    // Browser side closed the pipe; ignore to avoid host crash loop.
  }
}

function writeSnapshot(payload) {
  const dir = path.dirname(SNAPSHOT_PATH);
  mkdirSync(dir, { recursive: true });
  const snapshot = {
    updatedAt: Number(payload?.updatedAt || Date.now()),
    source: String(payload?.source || 'extension'),
    reason: String(payload?.reason || ''),
    schemaVersion: Number(payload?.schemaVersion || 1),
    data: payload?.data && typeof payload.data === 'object' ? payload.data : {}
  };
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
  return snapshot;
}

function getSnapshotMeta() {
  try {
    const raw = readFileSync(SNAPSHOT_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      exists: true,
      updatedAt: Number(parsed?.updatedAt || 0),
      source: String(parsed?.source || ''),
      reason: String(parsed?.reason || '')
    };
  } catch {
    return {
      exists: false,
      updatedAt: 0,
      source: '',
      reason: ''
    };
  }
}

function handle(msg) {
  const type = String(msg?.type || '').trim();
  if (type === 'snapshot') {
    const snapshot = writeSnapshot(msg);
    return {
      ok: true,
      type: 'snapshot-ack',
      updatedAt: snapshot.updatedAt,
      path: SNAPSHOT_PATH
    };
  }
  if (type === 'get-latest-meta') {
    return {
      ok: true,
      type: 'latest-meta',
      ...getSnapshotMeta(),
      path: SNAPSHOT_PATH
    };
  }
  if (type === 'ping') {
    return { ok: true, type: 'pong', ts: Date.now() };
  }
  return {
    ok: false,
    error: 'Unknown message type.'
  };
}

let inputBuffer = Buffer.alloc(0);

function processFrames() {
  while (inputBuffer.length >= 4) {
    const bodyLen = inputBuffer.readUInt32LE(0);
    const frameLen = 4 + bodyLen;
    if (inputBuffer.length < frameLen) {
      return;
    }
    const body = inputBuffer.subarray(4, frameLen).toString('utf8');
    inputBuffer = inputBuffer.subarray(frameLen);
    try {
      const msg = JSON.parse(body);
      sendMessage(handle(msg));
    } catch (error) {
      sendMessage({ ok: false, error: String(error?.message || error || 'native host failure') });
    }
  }
}

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  processFrames();
});

process.stdin.on('error', (error) => {
  sendMessage({ ok: false, error: String(error?.message || error || 'native host stdin error') });
});

process.stdin.on('end', () => {
  clearInterval(keepAliveTimer);
});

process.stdin.resume();
const keepAliveTimer = setInterval(() => {}, 1 << 30);
