#!/usr/bin/env node
import { appendFileSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SNAPSHOT_PATH = process.env.SWM_NATIVE_BRIDGE_SNAPSHOT_PATH
  ? path.resolve(process.env.SWM_NATIVE_BRIDGE_SNAPSHOT_PATH)
  : path.join(os.tmpdir(), 'steam-wishlist-manager-extension-bridge-snapshot.json');
const LOG_BASE_DIR = process.env.SWM_NATIVE_BRIDGE_STATE_DIR
  ? path.resolve(process.env.SWM_NATIVE_BRIDGE_STATE_DIR)
  : path.join(os.homedir(), '.local', 'state', 'steam-wishlist-manager');
const LOG_PATH = process.env.SWM_NATIVE_BRIDGE_LOG_PATH
  ? path.resolve(process.env.SWM_NATIVE_BRIDGE_LOG_PATH)
  : path.join(LOG_BASE_DIR, 'extension-warn-error.log.jsonl');

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

function normalizeLogEntry(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const levelRaw = String(src.level || '').trim().toLowerCase();
  const level = levelRaw === 'error' ? 'error' : (levelRaw === 'warn' || levelRaw === 'warning' ? 'warn' : 'info');
  return {
    id: String(src.id || `log_${Date.now()}`),
    at: Number(src.at || Date.now()),
    level,
    source: String(src.source || 'background').trim().slice(0, 80),
    message: String(src.message || '').trim().slice(0, 400),
    details: src.details && typeof src.details === 'object' ? src.details : null
  };
}

function appendLogEntry(payload) {
  const entry = normalizeLogEntry(payload?.entry);
  if (!(entry.level === 'warn' || entry.level === 'error')) {
    return {
      ok: true,
      type: 'log-entry-ack',
      skipped: true,
      reason: 'non-warning-level',
      path: LOG_PATH
    };
  }
  const dir = path.dirname(LOG_PATH);
  mkdirSync(dir, { recursive: true });
  appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
  return {
    ok: true,
    type: 'log-entry-ack',
    written: true,
    at: entry.at,
    level: entry.level,
    path: LOG_PATH
  };
}

function getLogMeta() {
  try {
    const stat = statSync(LOG_PATH);
    return {
      ok: true,
      type: 'log-meta',
      exists: true,
      path: LOG_PATH,
      size: Number(stat.size || 0),
      updatedAt: Number(stat.mtimeMs || 0)
    };
  } catch {
    return {
      ok: true,
      type: 'log-meta',
      exists: false,
      path: LOG_PATH,
      size: 0,
      updatedAt: 0
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
  if (type === 'log-entry') {
    return appendLogEntry(msg);
  }
  if (type === 'get-log-meta') {
    return getLogMeta();
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
