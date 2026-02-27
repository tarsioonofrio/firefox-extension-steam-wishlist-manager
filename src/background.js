const STORAGE_KEY = "steamWishlistCollectionsState";
const META_CACHE_KEY = "steamWishlistCollectionsMetaCacheV4";
const WISHLIST_ADDED_CACHE_KEY = "steamWishlistAddedMapV3";
const TAG_COUNTS_CACHE_KEY = "steamWishlistTagCountsCacheV1";
const TYPE_COUNTS_CACHE_KEY = "steamWishlistTypeCountsCacheV1";
const EXTRA_FILTER_COUNTS_CACHE_KEY = "steamWishlistExtraFilterCountsCacheV2";
const FOLLOWED_SYNC_META_KEY = "steamWishlistFollowedSyncMetaV1";
const NATIVE_BRIDGE_HOST_NAME = "dev.tarsio.steam_wishlist_manager_bridge";
const BACKUP_SETTINGS_KEY = "steamWishlistBackupSettingsV1";
const BACKUP_HISTORY_KEY = "steamWishlistBackupHistoryV1";
const BACKUP_ALARM_NAME = "steamWishlistAutoBackup";
const QUEUE_POLICY_KEY = "steamWishlistQueuePolicyV1";
const QUEUE_AUTOMATION_ALARM_NAME = "steamWishlistQueueAutomation";
const BACKUP_SCHEMA_VERSION = 1;
const BACKUP_MAX_HISTORY = 20;
const BACKUP_MIN_INTERVAL_HOURS = 1;
const BACKUP_MAX_INTERVAL_HOURS = 168;
const BACKUP_DATA_KEYS = [
  STORAGE_KEY,
  META_CACHE_KEY,
  WISHLIST_ADDED_CACHE_KEY,
  TAG_COUNTS_CACHE_KEY,
  TYPE_COUNTS_CACHE_KEY,
  EXTRA_FILTER_COUNTS_CACHE_KEY,
  BACKUP_SETTINGS_KEY
];
const NATIVE_BRIDGE_DATA_KEYS = [
  STORAGE_KEY,
  META_CACHE_KEY,
  WISHLIST_ADDED_CACHE_KEY,
  TAG_COUNTS_CACHE_KEY,
  TYPE_COUNTS_CACHE_KEY,
  EXTRA_FILTER_COUNTS_CACHE_KEY,
  BACKUP_SETTINGS_KEY
];
const WISHLIST_ORDER_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const FOLLOWED_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const MAX_COLLECTION_NAME_LENGTH = 64;
const MAX_COLLECTIONS = 100;
const MAX_ITEMS_PER_COLLECTION = 5000;
const VALID_APP_ID_PATTERN = /^\d{1,10}$/;
const VALID_BUCKETS = new Set(["INBOX", "TRACK", "MAYBE", "BUY", "ARCHIVE"]);
const VALID_BUY_INTENTS = new Set(["UNSET", "NONE", "MAYBE", "BUY"]);
const VALID_TRACK_INTENTS = new Set(["UNSET", "OFF", "ON"]);
const STEAM_WRITE_MIN_INTERVAL_MS = 250;
const DEFAULT_QUEUE_DAYS = 30;
const MIN_QUEUE_DAYS = 1;
const MAX_QUEUE_DAYS = 365;
const QUEUE_AUTOMATION_PERIOD_MINUTES = 360;
let backgroundWishlistDomSyncInFlight = false;
let nativeBridgePublishTimer = null;
let steamSessionIdCache = "";
let steamSessionIdCachedAt = 0;
let steamWriteLastAt = 0;

function normalizeBackupSettings(rawSettings) {
  const raw = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  const enabled = Boolean(raw.enabled);
  const intervalHoursRaw = Number(raw.intervalHours);
  const intervalHours = Number.isFinite(intervalHoursRaw)
    ? Math.max(BACKUP_MIN_INTERVAL_HOURS, Math.min(BACKUP_MAX_INTERVAL_HOURS, Math.floor(intervalHoursRaw)))
    : 24;
  return {
    enabled,
    intervalHours
  };
}

function normalizeQueuePolicy(rawPolicy) {
  const raw = rawPolicy && typeof rawPolicy === "object" ? rawPolicy : {};
  const maybeDaysRaw = Number(raw.maybeDays);
  const archiveDaysRaw = Number(raw.archiveDays);
  const maybeDays = Number.isFinite(maybeDaysRaw)
    ? Math.max(MIN_QUEUE_DAYS, Math.min(MAX_QUEUE_DAYS, Math.floor(maybeDaysRaw)))
    : DEFAULT_QUEUE_DAYS;
  const archiveDays = Number.isFinite(archiveDaysRaw)
    ? Math.max(MIN_QUEUE_DAYS, Math.min(MAX_QUEUE_DAYS, Math.floor(archiveDaysRaw)))
    : DEFAULT_QUEUE_DAYS;
  return {
    maybeDays,
    archiveDays
  };
}

async function getQueuePolicy() {
  const stored = await browser.storage.local.get(QUEUE_POLICY_KEY);
  return normalizeQueuePolicy(stored[QUEUE_POLICY_KEY]);
}

async function setQueuePolicy(rawPolicy) {
  const policy = normalizeQueuePolicy(rawPolicy);
  await browser.storage.local.set({ [QUEUE_POLICY_KEY]: policy });
  await scheduleQueueAutomationAlarm();
  return policy;
}

async function scheduleQueueAutomationAlarm() {
  if (!browser?.alarms) {
    return;
  }
  try {
    await browser.alarms.clear(QUEUE_AUTOMATION_ALARM_NAME);
  } catch {
    // ignore
  }
  browser.alarms.create(QUEUE_AUTOMATION_ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: QUEUE_AUTOMATION_PERIOD_MINUTES
  });
}

async function getBackupSettings() {
  const stored = await browser.storage.local.get(BACKUP_SETTINGS_KEY);
  return normalizeBackupSettings(stored[BACKUP_SETTINGS_KEY]);
}

async function setBackupSettings(rawSettings) {
  const settings = normalizeBackupSettings(rawSettings);
  await browser.storage.local.set({ [BACKUP_SETTINGS_KEY]: settings });
  await scheduleBackupAlarm(settings);
  return settings;
}

async function scheduleBackupAlarm(settings) {
  if (!browser?.alarms) {
    return;
  }
  const safeSettings = normalizeBackupSettings(settings);
  try {
    await browser.alarms.clear(BACKUP_ALARM_NAME);
  } catch {
    // ignore
  }
  if (!safeSettings.enabled) {
    return;
  }
  browser.alarms.create(BACKUP_ALARM_NAME, {
    delayInMinutes: safeSettings.intervalHours * 60,
    periodInMinutes: safeSettings.intervalHours * 60
  });
}

function createBackupId() {
  return `bkp_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

async function createBackupSnapshot(reason = "manual") {
  const payload = await browser.storage.local.get(BACKUP_DATA_KEYS);
  const snapshot = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    id: createBackupId(),
    createdAt: Date.now(),
    reason: String(reason || "manual"),
    data: payload
  };
  const stored = await browser.storage.local.get(BACKUP_HISTORY_KEY);
  const history = Array.isArray(stored[BACKUP_HISTORY_KEY]) ? stored[BACKUP_HISTORY_KEY] : [];
  history.unshift(snapshot);
  const trimmed = history.slice(0, BACKUP_MAX_HISTORY);
  await browser.storage.local.set({ [BACKUP_HISTORY_KEY]: trimmed });
  return {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    reason: snapshot.reason
  };
}

async function getBackupSummary() {
  const stored = await browser.storage.local.get([BACKUP_HISTORY_KEY, BACKUP_SETTINGS_KEY]);
  const history = Array.isArray(stored[BACKUP_HISTORY_KEY]) ? stored[BACKUP_HISTORY_KEY] : [];
  const settings = normalizeBackupSettings(stored[BACKUP_SETTINGS_KEY]);
  const latest = history.length > 0 ? history[0] : null;
  return {
    settings,
    count: history.length,
    latest: latest
      ? {
        id: String(latest.id || ""),
        createdAt: Number(latest.createdAt || 0),
        reason: String(latest.reason || "")
      }
      : null
  };
}

const DEFAULT_STATE = {
  collectionOrder: [],
  collections: {},
  dynamicCollections: {},
  items: {},
  activeCollection: "__all__"
};

function normalizeCollectionName(name) {
  const normalized = String(name || "").replace(/\s+/g, " ").trim();
  return normalized.slice(0, MAX_COLLECTION_NAME_LENGTH);
}

function isTrustedSender(sender) {
  const senderId = sender?.id || "";
  if (senderId && senderId !== browser.runtime.id) {
    return false;
  }

  // Allow internal extension calls even when sender.url is omitted.
  if (senderId === browser.runtime.id) {
    return true;
  }

  const senderUrl = String(sender?.url || "");
  if (!senderUrl) {
    return false;
  }

  if (/^(moz|chrome)-extension:\/\//.test(senderUrl)) {
    // Extension pages/scripts may omit sender.id in some Firefox contexts.
    return !senderId || senderId === browser.runtime.id;
  }

  return /^https:\/\/store\.steampowered\.com\/(app|wishlist)\//.test(senderUrl);
}

function validateAppId(appId) {
  if (!VALID_APP_ID_PATTERN.test(appId)) {
    throw new Error("Invalid appId.");
  }
}

function getReferencedAppIds(state) {
  const referenced = new Set();

  for (const collectionName of Object.keys(state.collections || {})) {
    const appIds = state.collections[collectionName] || [];
    for (const appId of appIds) {
      referenced.add(appId);
    }
  }

  return referenced;
}

function cleanupOrphanItems(state) {
  const referenced = getReferencedAppIds(state);

  for (const appId of Object.keys(state.items)) {
    if (!referenced.has(appId) && !hasItemTriageState(state.items[appId])) {
      delete state.items[appId];
    }
  }
}

function clamp01to2(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  if (n <= 0) {
    return 0;
  }
  if (n >= 2) {
    return 2;
  }
  return 1;
}

function normalizeBucket(value, track = 0, buy = 0) {
  const raw = String(value || "").trim().toUpperCase();
  if (VALID_BUCKETS.has(raw)) {
    return raw;
  }
  if (buy > 0) {
    return buy >= 2 ? "BUY" : "MAYBE";
  }
  if (track > 0) {
    return "TRACK";
  }
  return "INBOX";
}

function sanitizeLabels(labels) {
  if (!Array.isArray(labels)) {
    return [];
  }

  const out = [];
  const seen = new Set();
  for (const raw of labels) {
    const text = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 32);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    out.push(text);
  }
  return out.slice(0, 12);
}

function mergeOwnedLabel(labels, owned) {
  const base = sanitizeLabels(labels);
  const withoutOwned = base.filter((label) => label !== "owned");
  if (owned === true) {
    withoutOwned.push("owned");
  }
  return sanitizeLabels(withoutOwned);
}

function normalizeItemRecord(appId, rawItem) {
  const src = rawItem && typeof rawItem === "object" ? rawItem : {};
  const track = clamp01to2(src.track, 0);
  const buy = clamp01to2(src.buy, 0);
  const rawBuyIntent = String(src.buyIntent || "").trim().toUpperCase();
  const rawTrackIntent = String(src.trackIntent || "").trim().toUpperCase();
  const buyIntent = VALID_BUY_INTENTS.has(rawBuyIntent)
    ? rawBuyIntent
    : (buy >= 2 ? "BUY" : (buy === 1 ? "MAYBE" : "UNSET"));
  const trackIntent = VALID_TRACK_INTENTS.has(rawTrackIntent)
    ? rawTrackIntent
    : (track > 0 ? "ON" : "UNSET");
  return {
    appId,
    title: String(src.title || "").slice(0, 200),
    track,
    buy,
    buyIntent,
    trackIntent,
    bucket: normalizeBucket(src.bucket, track, buy),
    note: String(src.note || "").slice(0, 600),
    targetPriceCents: Number.isFinite(Number(src.targetPriceCents))
      ? Math.max(0, Math.floor(Number(src.targetPriceCents)))
      : null,
    muted: Boolean(src.muted),
    labels: sanitizeLabels(src.labels || []),
    triagedAt: Number.isFinite(Number(src.triagedAt)) ? Number(src.triagedAt) : 0,
    maybeQueuedAt: Number.isFinite(Number(src.maybeQueuedAt)) ? Number(src.maybeQueuedAt) : 0,
    archiveQueuedAt: Number.isFinite(Number(src.archiveQueuedAt)) ? Number(src.archiveQueuedAt) : 0,
    archiveLastActivityAt: Number.isFinite(Number(src.archiveLastActivityAt)) ? Number(src.archiveLastActivityAt) : 0
  };
}

function hasItemTriageState(item) {
  if (!item || typeof item !== "object") {
    return false;
  }
  const normalized = normalizeItemRecord(String(item.appId || ""), item);
  return normalized.track > 0
    || normalized.buy > 0
    || normalized.buyIntent !== "UNSET"
    || normalized.trackIntent !== "UNSET"
    || normalized.bucket === "ARCHIVE"
    || Boolean(normalized.note)
    || Number.isFinite(Number(normalized.targetPriceCents))
    || normalized.muted
    || normalized.labels.length > 0;
}

function upsertStateItem(state, appId, patch = {}) {
  const current = state.items?.[appId] || { appId };
  state.items[appId] = normalizeItemRecord(appId, {
    ...current,
    ...patch
  });
}

function sanitizeAppIdList(appIds) {
  if (!Array.isArray(appIds)) {
    return [];
  }

  const out = [];
  const seen = new Set();

  for (const rawAppId of appIds) {
    const appId = String(rawAppId || "").trim();
    if (!appId || seen.has(appId) || !VALID_APP_ID_PATTERN.test(appId)) {
      continue;
    }

    seen.add(appId);
    out.push(appId);
  }

  return out;
}

function normalizeState(rawState) {
  const state = {
    ...DEFAULT_STATE,
    ...(rawState || {})
  };

  if (!Array.isArray(state.collectionOrder)) {
    state.collectionOrder = [];
  }

  if (!state.collections || typeof state.collections !== "object") {
    state.collections = {};
  }

  if (!state.dynamicCollections || typeof state.dynamicCollections !== "object") {
    state.dynamicCollections = {};
  }

  if (!state.items || typeof state.items !== "object") {
    state.items = {};
  }

  const normalizedDynamicCollections = {};
  for (const [rawName, rawDef] of Object.entries(state.dynamicCollections || {})) {
    const name = normalizeCollectionName(rawName);
    if (!name) {
      continue;
    }
    const definition = rawDef && typeof rawDef === "object" ? rawDef : {};
    normalizedDynamicCollections[name] = {
      baseSource: String(definition.baseSource || "wishlist"),
      baseCollection: normalizeCollectionName(definition.baseCollection || ""),
      sortMode: String(definition.sortMode || "title"),
      filters: definition.filters && typeof definition.filters === "object"
        ? definition.filters
        : {},
      capturedAt: Number.isFinite(Number(definition.capturedAt)) ? Number(definition.capturedAt) : Date.now()
    };
  }

  const validCollectionOrder = [];
  const seenCollections = new Set();

  for (const collectionName of state.collectionOrder) {
    const normalized = normalizeCollectionName(collectionName);
    if (!normalized || seenCollections.has(normalized)) {
      continue;
    }
    if (!state.collections[normalized] && !normalizedDynamicCollections[normalized]) {
      continue;
    }
    seenCollections.add(normalized);
    validCollectionOrder.push(normalized);
  }

  const normalizedCollections = {};
  const referencedAppIds = new Set();

  for (const collectionName of validCollectionOrder) {
    if (normalizedDynamicCollections[collectionName]) {
      continue;
    }
    if (!state.collections[collectionName]) {
      continue;
    }
    const rawList = Array.isArray(state.collections[collectionName])
      ? state.collections[collectionName]
      : [];

    const uniqueIds = [];
    const seenIds = new Set();

    for (const rawId of rawList) {
      const appId = String(rawId || "").trim();
      if (!appId || seenIds.has(appId) || !VALID_APP_ID_PATTERN.test(appId)) {
        continue;
      }
      seenIds.add(appId);
      uniqueIds.push(appId);
      referencedAppIds.add(appId);
    }

    normalizedCollections[collectionName] = uniqueIds;
  }

  const normalizedItems = {};
  for (const appId of referencedAppIds) {
    const existing = state.items[appId] || {};
    normalizedItems[appId] = normalizeItemRecord(appId, existing);
  }

  for (const [rawAppId, rawItem] of Object.entries(state.items || {})) {
    const appId = String(rawAppId || "").trim();
    if (!VALID_APP_ID_PATTERN.test(appId) || normalizedItems[appId]) {
      continue;
    }
    const normalized = normalizeItemRecord(appId, rawItem);
    if (hasItemTriageState(normalized)) {
      normalizedItems[appId] = normalized;
    }
  }

  return {
    collectionOrder: validCollectionOrder,
    collections: normalizedCollections,
    dynamicCollections: normalizedDynamicCollections,
    items: normalizedItems,
    activeCollection: String(state.activeCollection || "__all__")
  };
}

async function getState() {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return normalizeState(stored[STORAGE_KEY]);
}

async function setState(state) {
  await browser.storage.local.set({ [STORAGE_KEY]: normalizeState(state) });
  scheduleNativeBridgePublish("set-state");
}

function scheduleNativeBridgePublish(reason = "state-change", delayMs = 500) {
  if (!browser?.runtime?.sendNativeMessage) {
    return;
  }
  if (nativeBridgePublishTimer) {
    clearTimeout(nativeBridgePublishTimer);
  }
  nativeBridgePublishTimer = setTimeout(() => {
    nativeBridgePublishTimer = null;
    publishNativeBridgeSnapshot(reason).catch(() => {});
  }, Math.max(0, Number(delayMs) || 0));
}

async function publishNativeBridgeSnapshot(reason = "manual") {
  if (!browser?.runtime?.sendNativeMessage) {
    return { ok: false, skipped: true, reason: "sendNativeMessage unavailable" };
  }
  const payload = await browser.storage.local.get(NATIVE_BRIDGE_DATA_KEYS);
  const message = {
    type: "snapshot",
    source: "steam-wishlist-manager-extension",
    schemaVersion: 1,
    reason: String(reason || "manual"),
    updatedAt: Date.now(),
    data: payload
  };
  try {
    const response = await browser.runtime.sendNativeMessage(NATIVE_BRIDGE_HOST_NAME, message);
    return {
      ok: true,
      response: response || {}
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || "native bridge publish failed")
    };
  }
}

function ensureCollection(state, name) {
  const normalized = normalizeCollectionName(name);
  if (!normalized) {
    throw new Error("Collection name is required.");
  }
  if (state.dynamicCollections?.[normalized]) {
    throw new Error("A dynamic collection with this name already exists.");
  }

  if (!state.collections[normalized]) {
    if (state.collectionOrder.length >= MAX_COLLECTIONS) {
      throw new Error("Maximum number of collections reached.");
    }
    state.collections[normalized] = [];
  }

  if (!state.collectionOrder.includes(normalized)) {
    state.collectionOrder.push(normalized);
  }

  return normalized;
}

function removeFromAllCollections(state, appId) {
  for (const collectionName of Object.keys(state.collections)) {
    state.collections[collectionName] = state.collections[collectionName].filter(
      (id) => id !== appId
    );
  }
}

function pruneItemsNotInWishlist(state, allowedAppIds) {
  const allowed = new Set(sanitizeAppIdList(allowedAppIds));

  for (const collectionName of Object.keys(state.collections || {})) {
    const current = state.collections[collectionName] || [];
    state.collections[collectionName] = current.filter((appId) => allowed.has(appId));
  }

  cleanupOrphanItems(state);
}

function deleteCollection(state, name) {
  const normalized = normalizeCollectionName(name);
  if (!normalized) {
    return false;
  }

  if (state.dynamicCollections[normalized]) {
    delete state.dynamicCollections[normalized];
    state.collectionOrder = state.collectionOrder.filter((collectionName) => collectionName !== normalized);
    if (state.activeCollection === normalized) {
      state.activeCollection = "__all__";
    }
    return true;
  }

  if (!state.collections[normalized]) {
    return false;
  }

  delete state.collections[normalized];
  state.collectionOrder = state.collectionOrder.filter((collectionName) => collectionName !== normalized);

  if (state.activeCollection === normalized) {
    state.activeCollection = "__all__";
  }

  cleanupOrphanItems(state);
  return true;
}

function renameCollection(state, fromName, toName) {
  const from = normalizeCollectionName(fromName);
  const to = normalizeCollectionName(toName);

  if (!from || (!state.collections[from] && !state.dynamicCollections[from])) {
    throw new Error("Collection not found.");
  }
  if (!to) {
    throw new Error("New collection name is required.");
  }
  if (from === to) {
    return to;
  }
  if (state.collections[to] || state.dynamicCollections[to]) {
    throw new Error("A collection with this name already exists.");
  }

  if (state.collections[from]) {
    state.collections[to] = state.collections[from];
    delete state.collections[from];
  } else {
    state.dynamicCollections[to] = state.dynamicCollections[from];
    delete state.dynamicCollections[from];
  }
  state.collectionOrder = state.collectionOrder.map((name) => (name === from ? to : name));

  if (state.activeCollection === from) {
    state.activeCollection = to;
  }

  return to;
}

function ensureDynamicCollection(state, name, definition) {
  const normalized = normalizeCollectionName(name);
  if (!normalized) {
    throw new Error("Collection name is required.");
  }
  if (state.collections[normalized]) {
    throw new Error("A static collection with this name already exists.");
  }
  const def = definition && typeof definition === "object" ? definition : {};
  state.dynamicCollections[normalized] = {
    baseSource: String(def.baseSource || "wishlist"),
    baseCollection: normalizeCollectionName(def.baseCollection || ""),
    sortMode: String(def.sortMode || "title"),
    filters: def.filters && typeof def.filters === "object" ? def.filters : {},
    capturedAt: Date.now()
  };
  if (!state.collectionOrder.includes(normalized)) {
    state.collectionOrder.push(normalized);
  }
  return normalized;
}

function sanitizeFollowedAppIds(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const appId = String(raw || "").trim();
    if (!VALID_APP_ID_PATTERN.test(appId) || seen.has(appId)) {
      continue;
    }
    seen.add(appId);
    out.push(appId);
  }
  return out;
}

async function syncFollowedAppsFromSteam(state, force = false) {
  const now = Date.now();
  const storedMeta = await browser.storage.local.get(FOLLOWED_SYNC_META_KEY);
  const cachedMeta = storedMeta?.[FOLLOWED_SYNC_META_KEY] || {};
  const lastSyncedAt = Number(cachedMeta.lastSyncedAt || 0);
  if (!force && lastSyncedAt > 0 && (now - lastSyncedAt) < FOLLOWED_SYNC_INTERVAL_MS) {
    return {
      ok: true,
      skipped: true,
      reason: "fresh-cache",
      lastSyncedAt,
      followedCount: Number(cachedMeta.followedCount || 0),
      updatedCount: 0
    };
  }

  let followedIds = [];
  try {
    const params = new URLSearchParams();
    params.set("_", String(Date.now()));
    const userDataResponse = await fetch(`https://store.steampowered.com/dynamicstore/userdata/?${params.toString()}`, {
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "text/html"
      }
    });
    if (!userDataResponse.ok) {
      throw new Error(`Could not read Steam userdata (${userDataResponse.status}).`);
    }
    const userData = await userDataResponse.json();
    if (!userData || typeof userData !== "object" || !Array.isArray(userData.rgFollowedApps)) {
      throw new Error("Steam userdata missing rgFollowedApps.");
    }
    followedIds = sanitizeFollowedAppIds(userData.rgFollowedApps);
  } catch {
    const proxied = await sendMessageToStoreTabWithFallback({
      type: "steam-proxy-read-userdata"
    });
    followedIds = sanitizeFollowedAppIds(proxied?.rgFollowedApps);
    if (followedIds.length === 0) {
      throw new Error("Could not read followed apps from Steam.");
    }
  }
  let updatedCount = 0;

  for (const appId of followedIds) {
    const current = normalizeItemRecord(appId, state.items?.[appId] || {});
    const next = normalizeItemRecord(appId, {
      ...current,
      track: 1,
      trackIntent: "ON",
      bucket: normalizeBucket(current.bucket, 1, current.buy)
    });
    const changed = current.track !== next.track
      || current.trackIntent !== next.trackIntent
      || current.bucket !== next.bucket;
    if (changed) {
      state.items[appId] = next;
      updatedCount += 1;
    }
  }

  await browser.storage.local.set({
    [FOLLOWED_SYNC_META_KEY]: {
      lastSyncedAt: now,
      followedCount: followedIds.length
    }
  });

  return {
    ok: true,
    skipped: false,
    lastSyncedAt: now,
    followedCount: followedIds.length,
    updatedCount
  };
}

function getTrackFeedLatestMap(entries) {
  const latestByApp = new Map();
  const list = Array.isArray(entries) ? entries : [];
  for (const entry of list) {
    const appId = String(entry?.appId || "").trim();
    if (!VALID_APP_ID_PATTERN.test(appId)) {
      continue;
    }
    const tsSec = Number(entry?.publishedAt || 0);
    if (!Number.isFinite(tsSec) || tsSec <= 0) {
      continue;
    }
    const tsMs = tsSec * 1000;
    const prev = latestByApp.get(appId) || 0;
    if (tsMs > prev) {
      latestByApp.set(appId, tsMs);
    }
  }
  return latestByApp;
}

function applyQueueTimersForTransition(previousItem, nextItem, now) {
  const previous = normalizeItemRecord(String(previousItem?.appId || ""), previousItem || {});
  const next = normalizeItemRecord(previous.appId, nextItem || {});
  const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();

  const inMaybeQueue = next.buy === 1 || next.buyIntent === "MAYBE";
  if (inMaybeQueue) {
    next.maybeQueuedAt = previous.maybeQueuedAt > 0 ? previous.maybeQueuedAt : ts;
  } else {
    next.maybeQueuedAt = 0;
  }

  const inArchiveQueue = String(next.bucket || "").toUpperCase() === "ARCHIVE";
  if (inArchiveQueue) {
    next.archiveQueuedAt = previous.archiveQueuedAt > 0 ? previous.archiveQueuedAt : ts;
    next.archiveLastActivityAt = previous.archiveLastActivityAt > 0
      ? previous.archiveLastActivityAt
      : next.archiveQueuedAt;
  } else {
    next.archiveQueuedAt = 0;
    next.archiveLastActivityAt = 0;
  }

  return next;
}

async function performQueueAutomationSweep(force = false) {
  const state = await getState();
  const policy = await getQueuePolicy();
  const now = Date.now();
  const maybeMs = policy.maybeDays * 24 * 60 * 60 * 1000;
  const archiveMs = policy.archiveDays * 24 * 60 * 60 * 1000;

  const storage = await browser.storage.local.get([META_CACHE_KEY, "steamWishlistTrackFeedV1"]);
  const metaCache = storage?.[META_CACHE_KEY] || {};
  const feedEntries = storage?.["steamWishlistTrackFeedV1"] || [];
  const feedLatestByApp = getTrackFeedLatestMap(feedEntries);

  let changed = false;
  let maybeProcessed = 0;
  let archiveProcessed = 0;
  const errors = [];

  for (const appId of Object.keys(state.items || {})) {
    const current = normalizeItemRecord(appId, state.items[appId] || {});
    const next = { ...current };

    if (next.buy === 1 || next.buyIntent === "MAYBE") {
      if (!(next.maybeQueuedAt > 0)) {
        next.maybeQueuedAt = next.triagedAt > 0 ? next.triagedAt : now;
        changed = true;
      }
      const due = (now - Number(next.maybeQueuedAt || 0)) >= maybeMs;
      if (due || force) {
        try {
          await setSteamWishlist(appId, false);
          await setSteamFollow(appId, false);
          next.buy = 0;
          next.track = 0;
          next.buyIntent = "NONE";
          next.trackIntent = "OFF";
          next.bucket = "INBOX";
          next.maybeQueuedAt = 0;
          next.triagedAt = now;
          maybeProcessed += 1;
          changed = true;
        } catch (error) {
          errors.push(`maybe:${appId}:${String(error?.message || error || "failed")}`);
        }
      }
    } else if (next.maybeQueuedAt > 0) {
      next.maybeQueuedAt = 0;
      changed = true;
    }

    if (String(next.bucket || "").toUpperCase() === "ARCHIVE") {
      if (!(next.archiveQueuedAt > 0)) {
        next.archiveQueuedAt = next.triagedAt > 0 ? next.triagedAt : now;
        changed = true;
      }
      let lastActivityAt = Number(next.archiveLastActivityAt || next.archiveQueuedAt || now);
      const discountPercent = Number(metaCache?.[appId]?.discountPercent || 0);
      const hasPromotion = Number.isFinite(discountPercent) && discountPercent > 0;
      const latestFeedAt = Number(feedLatestByApp.get(appId) || 0);
      if (hasPromotion || latestFeedAt > lastActivityAt) {
        lastActivityAt = now;
      }
      if (lastActivityAt !== Number(next.archiveLastActivityAt || 0)) {
        next.archiveLastActivityAt = lastActivityAt;
        changed = true;
      }
      const due = (now - lastActivityAt) >= archiveMs;
      if ((due || force) && !hasPromotion && latestFeedAt <= lastActivityAt) {
        try {
          await setSteamWishlist(appId, false);
          await setSteamFollow(appId, false);
          next.buy = 0;
          next.track = 0;
          next.buyIntent = "NONE";
          next.trackIntent = "OFF";
          next.bucket = "INBOX";
          next.archiveQueuedAt = 0;
          next.archiveLastActivityAt = 0;
          next.triagedAt = now;
          archiveProcessed += 1;
          changed = true;
        } catch (error) {
          errors.push(`archive:${appId}:${String(error?.message || error || "failed")}`);
        }
      }
    } else if (next.archiveQueuedAt > 0 || next.archiveLastActivityAt > 0) {
      next.archiveQueuedAt = 0;
      next.archiveLastActivityAt = 0;
      changed = true;
    }

    state.items[appId] = normalizeItemRecord(appId, next);
  }

  if (changed) {
    await setState(state);
  }

  return {
    ok: true,
    changed,
    maybeProcessed,
    archiveProcessed,
    errors
  };
}

function encodeVarint(value) {
  let n = 0n;
  if (typeof value === "bigint") {
    n = value;
  } else if (typeof value === "string") {
    n = BigInt(value || "0");
  } else {
    n = BigInt(Number(value || 0));
  }
  if (n < 0n) {
    n = 0n;
  }
  const out = [];
  while (n >= 0x80n) {
    out.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  out.push(Number(n));
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function rateLimitSteamWrite() {
  const now = Date.now();
  const waitMs = (steamWriteLastAt + STEAM_WRITE_MIN_INTERVAL_MS) - now;
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  steamWriteLastAt = Date.now();
}

function buildSteamFormData(values) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values || {})) {
    form.append(String(key), String(value ?? ""));
  }
  return form;
}

async function fetchSteamSessionId(force = false) {
  const now = Date.now();
  if (!force && steamSessionIdCache && now - steamSessionIdCachedAt < 10 * 60 * 1000) {
    return steamSessionIdCache;
  }
  await rateLimitSteamWrite();
  const response = await fetch("https://store.steampowered.com/account/preferences", {
    method: "GET",
    credentials: "include",
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Could not load Steam session page (${response.status}).`);
  }
  const html = await response.text();
  const match = html.match(/g_sessionID\s*=\s*"([^"]+)"/i);
  const sessionId = String(match?.[1] || "").trim();
  if (!sessionId) {
    throw new Error("Could not resolve Steam session id.");
  }
  steamSessionIdCache = sessionId;
  steamSessionIdCachedAt = Date.now();
  return sessionId;
}

async function postSteamForm(url, formValues, retryOn401 = true) {
  await rateLimitSteamWrite();
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    body: buildSteamFormData(formValues),
    headers: {
      "X-Requested-With": "SteamWishlistManager"
    }
  });
  if (response.status === 401 && retryOn401) {
    steamSessionIdCache = "";
    steamSessionIdCachedAt = 0;
    const renewed = await fetchSteamSessionId(true);
    const nextValues = { ...formValues, sessionid: renewed };
    return postSteamForm(url, nextValues, false);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Steam write failed (${response.status})${body ? `: ${body.slice(0, 180)}` : ""}`);
  }
  const bodyText = await response.text().catch(() => "");
  let body = null;
  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = bodyText;
    }
  }
  return {
    status: response.status,
    bodyText,
    body
  };
}

async function setSteamWishlist(appId, enabled) {
  try {
    const sessionId = await fetchSteamSessionId(false);
    const url = enabled
      ? "https://store.steampowered.com/api/addtowishlist"
      : "https://store.steampowered.com/api/removefromwishlist";
    const response = await postSteamForm(url, { sessionid: sessionId, appid: appId });
    const body = response?.body;
    const success = body === true
      || body?.success === true
      || Number(body?.success) > 0
      || body?.result === 1;
    if (!success) {
      throw new Error(`Steam wishlist write rejected${response?.bodyText ? `: ${String(response.bodyText).slice(0, 180)}` : ""}`);
    }
  } catch {
    const fallback = await sendMessageToStoreTabWithFallback({
      type: "steam-proxy-write-action",
      action: enabled ? "wishlist-add" : "wishlist-remove",
      appId
    });
    if (!fallback?.ok) {
      throw new Error(`Steam wishlist write rejected (${fallback?.status || 0}).`);
    }
  }
  return { target: "wishlist", enabled: Boolean(enabled), appId };
}

async function setSteamFollow(appId, enabled) {
  try {
    const sessionId = await fetchSteamSessionId(false);
    const payload = {
      sessionid: sessionId,
      appid: appId,
      ...(enabled ? {} : { unfollow: "1" })
    };
    const response = await postSteamForm("https://store.steampowered.com/explore/followgame/", payload);
    const body = response?.body;
    const success = body === true || body?.success === true || Number(body?.success) > 0;
    if (!success) {
      throw new Error(`Steam follow write rejected${response?.bodyText ? `: ${String(response.bodyText).slice(0, 180)}` : ""}`);
    }
  } catch {
    const fallback = await sendMessageToStoreTabWithFallback({
      type: "steam-proxy-write-action",
      action: enabled ? "follow-on" : "follow-off",
      appId
    });
    if (!fallback?.ok) {
      throw new Error(`Steam follow write rejected (${fallback?.status || 0}).`);
    }
  }
  return { target: "follow", enabled: Boolean(enabled), appId };
}

async function syncSteamSignalsForIntentChange(appId, previousIntent, nextIntent) {
  const prev = previousIntent && typeof previousIntent === "object" ? previousIntent : {};
  const next = nextIntent && typeof nextIntent === "object" ? nextIntent : {};
  const prevBuyIntent = String(prev.buyIntent || "UNSET").toUpperCase();
  const nextBuyIntent = String(next.buyIntent || "UNSET").toUpperCase();
  const prevTrackIntent = String(prev.trackIntent || "UNSET").toUpperCase();
  const nextTrackIntent = String(next.trackIntent || "UNSET").toUpperCase();

  const actions = [];
  const prevWishlistDesired = prevBuyIntent === "BUY" || prevBuyIntent === "MAYBE"
    ? true
    : (prevBuyIntent === "NONE" ? false : null);
  const nextWishlistDesired = nextBuyIntent === "BUY" || nextBuyIntent === "MAYBE"
    ? true
    : (nextBuyIntent === "NONE" ? false : null);
  if (prevWishlistDesired !== nextWishlistDesired && nextWishlistDesired !== null) {
    actions.push(() => setSteamWishlist(appId, nextWishlistDesired));
  }
  const prevFollowDesired = prevTrackIntent === "ON"
    ? true
    : (prevTrackIntent === "OFF" ? false : null);
  const nextFollowDesired = nextTrackIntent === "ON"
    ? true
    : (nextTrackIntent === "OFF" ? false : null);
  if (prevFollowDesired !== nextFollowDesired && nextFollowDesired !== null) {
    actions.push(() => setSteamFollow(appId, nextFollowDesired));
  }

  if (actions.length === 0) {
    return { ok: true, changed: false, applied: [] };
  }

  const applied = [];
  const errors = [];
  for (const action of actions) {
    try {
      const result = await action();
      applied.push(result);
    } catch (error) {
      errors.push(String(error?.message || error || "steam sync failed"));
    }
  }

  return {
    ok: errors.length === 0,
    changed: true,
    applied,
    errors
  };
}

function decodeVarint(bytes, startIndex) {
  let value = 0n;
  let shift = 0n;
  let index = startIndex;
  while (index < bytes.length) {
    const b = bytes[index];
    index += 1;
    value |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      return { value, next: index };
    }
    shift += 7n;
  }
  return null;
}

function encodeUtf8(text) {
  return new TextEncoder().encode(String(text || ""));
}

function concatBytes(chunks) {
  const size = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function fieldVarint(field, value) {
  return Uint8Array.from([
    ...encodeVarint((BigInt(field) << 3n) | 0n),
    ...encodeVarint(value)
  ]);
}

function fieldBytes(field, bytes) {
  return concatBytes([
    Uint8Array.from(encodeVarint((BigInt(field) << 3n) | 2n)),
    Uint8Array.from(encodeVarint(bytes.length)),
    bytes
  ]);
}

function toBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function decodeWishlistSortedFilteredItem(bytes) {
  const item = {
    appid: 0,
    priority: null
  };
  let index = 0;
  while (index < bytes.length) {
    const tag = decodeVarint(bytes, index);
    if (!tag) {
      break;
    }
    index = tag.next;
    const field = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x7n);

    if (wireType === 0) {
      const value = decodeVarint(bytes, index);
      if (!value) {
        break;
      }
      index = value.next;
      const n = Number(value.value);
      if (field === 1) {
        item.appid = n;
      } else if (field === 2) {
        item.priority = n;
      }
      continue;
    }

    if (wireType === 2) {
      const len = decodeVarint(bytes, index);
      if (!len) {
        break;
      }
      index = len.next + Number(len.value);
      continue;
    }

    if (wireType === 5) {
      index += 4;
      continue;
    }
    if (wireType === 1) {
      index += 8;
      continue;
    }
    break;
  }
  return item;
}

function decodeWishlistSortedFilteredResponse(bytes) {
  const items = [];
  let index = 0;
  while (index < bytes.length) {
    const tag = decodeVarint(bytes, index);
    if (!tag) {
      break;
    }
    index = tag.next;
    const field = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x7n);

    if (field === 1 && wireType === 2) {
      const len = decodeVarint(bytes, index);
      if (!len) {
        break;
      }
      index = len.next;
      const itemBytes = bytes.subarray(index, index + Number(len.value));
      index += Number(len.value);
      const item = decodeWishlistSortedFilteredItem(itemBytes);
      if (Number.isFinite(item.appid) && item.appid > 0) {
        items.push(item);
      }
      continue;
    }

    if (wireType === 0) {
      const value = decodeVarint(bytes, index);
      if (!value) {
        break;
      }
      index = value.next;
      continue;
    }

    if (wireType === 2) {
      const len = decodeVarint(bytes, index);
      if (!len) {
        break;
      }
      index = len.next + Number(len.value);
      continue;
    }

    if (wireType === 5) {
      index += 4;
      continue;
    }
    if (wireType === 1) {
      index += 8;
      continue;
    }
    break;
  }
  return items;
}

function buildWishlistSortedFilteredRequest(steamId, startIndex = 0, pageSize = 500) {
  const context = concatBytes([
    fieldBytes(1, encodeUtf8("english")),
    fieldBytes(3, encodeUtf8("BR"))
  ]);
  const dataRequest = concatBytes([
    fieldVarint(1, 1),
    fieldVarint(2, 1),
    fieldVarint(3, 1),
    fieldVarint(6, 1),
    fieldVarint(8, 20),
    fieldVarint(9, 1)
  ]);
  const filters = concatBytes([
    fieldVarint(25, 4),
    fieldVarint(25, 3)
  ]);
  return concatBytes([
    fieldVarint(1, steamId),
    fieldBytes(2, context),
    fieldBytes(3, dataRequest),
    fieldBytes(5, filters),
    fieldVarint(6, startIndex),
    fieldVarint(7, pageSize)
  ]);
}

async function syncWishlistOrderCache(force = false) {
  const stored = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
  const cached = stored[WISHLIST_ADDED_CACHE_KEY] || {};
  const now = Date.now();
  const last = Number(cached.priorityCachedAt || 0);
  if (!force && now - last < WISHLIST_ORDER_SYNC_INTERVAL_MS) {
    return { ok: true, skipped: true };
  }

  const userDataResponse = await fetch("https://store.steampowered.com/dynamicstore/userdata/", {
    cache: "no-store",
    credentials: "include"
  });
  if (!userDataResponse.ok) {
    throw new Error(`Failed to fetch userdata (${userDataResponse.status})`);
  }
  const userData = await userDataResponse.json();
  let steamId = String(
    userData?.steamid
    || userData?.strSteamId
    || userData?.str_steamid
    || userData?.webapi_token_steamid
    || ""
  ).trim();
  const wishlistNowIds = Array.isArray(userData?.rgWishlist)
    ? userData.rgWishlist.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const wishlistNowSet = new Set(wishlistNowIds);
  const accessToken = String(
    userData?.webapi_token
    || userData?.webapiToken
    || userData?.webapi_access_token
    || ""
  ).trim();

  if (!steamId) {
    try {
      const wishlistResponse = await fetch("https://store.steampowered.com/wishlist/", {
        cache: "no-store",
        credentials: "include",
        redirect: "follow"
      });
      const redirectedUrl = String(wishlistResponse?.url || "");
      const profileMatch = redirectedUrl.match(/\/wishlist\/profiles\/(\d{10,20})/);
      if (profileMatch?.[1]) {
        steamId = profileMatch[1];
      }
    } catch {
      // fallback below
    }
  }

  if (!steamId) {
    try {
      const storeHtml = await fetch("https://store.steampowered.com/", {
        cache: "no-store",
        credentials: "include"
      }).then((r) => r.text());
      const htmlMatch = storeHtml.match(/g_steamID\s*=\s*"(\d{10,20})"/);
      if (htmlMatch?.[1]) {
        steamId = htmlMatch[1];
      }
    } catch {
      // fallback below
    }
  }

  if (!steamId) {
    steamId = String(cached?.steamId || "").trim();
  }
  if (!steamId) {
    throw new Error("Could not resolve steamid for wishlist order sync.");
  }

  const orderedAppIds = [];
  const priorityMap = {};
  const seen = new Set();
  const pageSize = 500;

  for (let page = 0; page < 20; page += 1) {
    const requestBytes = buildWishlistSortedFilteredRequest(steamId, page * pageSize, pageSize);
    const url = new URL("https://api.steampowered.com/IWishlistService/GetWishlistSortedFiltered/v1");
    url.searchParams.set("origin", "https://store.steampowered.com");
    url.searchParams.set("input_protobuf_encoded", toBase64(requestBytes));
    if (accessToken) {
      url.searchParams.set("access_token", accessToken);
    }

    const response = await fetch(url.toString(), {
      cache: "no-store",
      credentials: "omit"
    });
    if (!response.ok) {
      throw new Error(`Wishlist order request failed (${response.status})`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const items = decodeWishlistSortedFilteredResponse(bytes);
    if (items.length === 0) {
      break;
    }

    for (const item of items) {
      const rawIdNum = Number(item.appid || 0);
      let appId = String(rawIdNum || "").trim();
      if (rawIdNum > 0 && !wishlistNowSet.has(appId) && rawIdNum % 10 === 0) {
        const div10 = String(Math.floor(rawIdNum / 10));
        if (wishlistNowSet.has(div10)) {
          appId = div10;
        }
      }
      if (!appId || seen.has(appId)) {
        continue;
      }
      seen.add(appId);
      orderedAppIds.push(appId);
      priorityMap[appId] = Number.isFinite(item.priority)
        ? Number(item.priority)
        : (orderedAppIds.length - 1);
    }

    if (items.length < pageSize) {
      break;
    }
  }

  if (orderedAppIds.length === 0) {
    throw new Error("Wishlist order response had no items.");
  }

  await browser.storage.local.set({
    [WISHLIST_ADDED_CACHE_KEY]: {
      ...cached,
      orderedAppIds,
      priorityMap,
      priorityCachedAt: now,
      priorityLastError: "",
      steamId
    }
  });

  return { ok: true, updated: orderedAppIds.length, cachedAt: now };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveSteamIdForWishlistSync(cached) {
  let steamId = String(cached?.steamId || "").trim();
  if (/^\d{10,20}$/.test(steamId)) {
    return steamId;
  }

  try {
    const userDataResponse = await fetch("https://store.steampowered.com/dynamicstore/userdata/", {
      cache: "no-store",
      credentials: "include"
    });
    if (userDataResponse.ok) {
      const userData = await userDataResponse.json();
      steamId = String(
        userData?.steamid
        || userData?.strSteamId
        || userData?.str_steamid
        || userData?.webapi_token_steamid
        || ""
      ).trim();
      if (/^\d{10,20}$/.test(steamId)) {
        return steamId;
      }
    }
  } catch {
    // fallback below
  }

  throw new Error("Could not resolve steamid for background wishlist sync.");
}

async function sendMessageToTabWithRetry(tabId, message, retries = 30, delayMs = 500) {
  let lastError = null;
  for (let i = 0; i < retries; i += 1) {
    try {
      return await browser.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      await wait(delayMs);
    }
  }
  throw lastError || new Error("Could not send message to wishlist tab.");
}

async function sendMessageToStoreTabWithFallback(message) {
  const queryUrls = [
    "*://store.steampowered.com/wishlist/*",
    "*://store.steampowered.com/app/*",
    "*://store.steampowered.com/*"
  ];
  let existingTabs = [];
  for (const pattern of queryUrls) {
    const tabs = await browser.tabs.query({ url: pattern });
    if (Array.isArray(tabs) && tabs.length > 0) {
      existingTabs = tabs;
      break;
    }
  }

  let createdTabId = null;
  let targetTabId = Number(existingTabs?.[0]?.id || 0);

  if (!(targetTabId > 0)) {
    const createdTab = await browser.tabs.create({
      url: "https://store.steampowered.com/",
      active: false
    });
    targetTabId = Number(createdTab?.id || 0);
    createdTabId = targetTabId > 0 ? targetTabId : null;
    if (!(targetTabId > 0)) {
      throw new Error("Could not open Store tab for Steam proxy.");
    }
  }

  try {
    return await sendMessageToTabWithRetry(targetTabId, message, 40, 500);
  } finally {
    if (createdTabId) {
      browser.tabs.remove(createdTabId).catch(() => {});
    }
  }
}

async function waitForWishlistTabReady(tabId, timeoutMs = 90000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const tab = await browser.tabs.get(tabId);
      const url = String(tab?.url || "");
      const isWishlistUrl = /^https:\/\/store\.steampowered\.com\/wishlist\/profiles\/\d+\/?/.test(url);
      const isComplete = String(tab?.status || "") === "complete";
      if (isWishlistUrl && isComplete) {
        return tab;
      }
    } catch {
      // Keep polling until timeout.
    }
    await wait(500);
  }
  throw new Error("Wishlist tab did not finish loading in time.");
}

function extractWishlistAppIdsInTextOrder(rawText) {
  const text = String(rawText || "");
  const ids = [];
  const seen = new Set();
  const re = /"(\d+)"\s*:/g;
  let match = null;
  while ((match = re.exec(text)) !== null) {
    const appId = String(match[1] || "").trim();
    if (!appId || seen.has(appId)) {
      continue;
    }
    seen.add(appId);
    ids.push(appId);
  }
  return ids;
}

async function syncWishlistOrderViaPublicWishlistdata(steamId) {
  const orderedAppIds = [];
  const seen = new Set();
  for (let pageIndex = 0; pageIndex < 200; pageIndex += 1) {
    const response = await fetch(
      `https://store.steampowered.com/wishlist/profiles/${steamId}/wishlistdata/?p=${pageIndex}`,
      {
        cache: "no-store",
        credentials: "include"
      }
    );
    if (!response.ok) {
      break;
    }
    const raw = await response.text();
    const idsInOrder = extractWishlistAppIdsInTextOrder(raw);
    if (idsInOrder.length === 0) {
      break;
    }
    for (const appId of idsInOrder) {
      if (seen.has(appId)) {
        continue;
      }
      seen.add(appId);
      orderedAppIds.push(appId);
    }
  }

  if (orderedAppIds.length === 0) {
    throw new Error("Could not load wishlist order from public wishlistdata.");
  }

  const priorityMap = {};
  for (let i = 0; i < orderedAppIds.length; i += 1) {
    priorityMap[orderedAppIds[i]] = i;
  }

  const stored = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
  const cached = stored[WISHLIST_ADDED_CACHE_KEY] || {};
  const now = Date.now();
  await browser.storage.local.set({
    [WISHLIST_ADDED_CACHE_KEY]: {
      ...cached,
      orderedAppIds,
      priorityMap,
      priorityCachedAt: now,
      priorityLastError: "",
      steamId: String(steamId || cached.steamId || "")
    }
  });

  return { ok: true, steamId, updated: orderedAppIds.length, cachedAt: now, mode: "wishlistdata-fallback" };
}

async function syncWishlistOrderViaBackgroundTab(force = false) {
  if (backgroundWishlistDomSyncInFlight) {
    throw new Error("Background wishlist sync already running.");
  }
  backgroundWishlistDomSyncInFlight = true;

  let tabId = null;
  try {
    const stored = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
    const cached = stored[WISHLIST_ADDED_CACHE_KEY] || {};
    const steamId = await resolveSteamIdForWishlistSync(cached);
    const wishlistUrl = `https://store.steampowered.com/wishlist/profiles/${steamId}/`;
    const tab = await browser.tabs.create({
      url: wishlistUrl,
      active: false
    });
    tabId = Number(tab?.id || 0);
    if (!Number.isFinite(tabId) || tabId <= 0) {
      throw new Error("Failed to create background wishlist tab.");
    }
    await waitForWishlistTabReady(tabId, 90000);
    await wait(1500);

    try {
      const result = await sendMessageToTabWithRetry(tabId, {
        type: "sync-wishlist-order-from-dom",
        steamId,
        force: Boolean(force)
      }, 180, 500);

      if (!result?.ok) {
        throw new Error(String(result?.error || "Background DOM sync failed."));
      }

      return {
        ok: true,
        steamId,
        updated: Number(result.updated || 0),
        cachedAt: Number(result.cachedAt || Date.now()),
        mode: "dom"
      };
    } catch {
      return syncWishlistOrderViaPublicWishlistdata(steamId);
    }
  } finally {
    backgroundWishlistDomSyncInFlight = false;
    if (tabId) {
      browser.tabs.remove(tabId).catch(() => {});
    }
  }
}

browser.runtime.onMessage.addListener((message, sender) => {
  return (async () => {
    if (!message || typeof message !== "object") {
      throw new Error("Invalid message.");
    }

    if (!isTrustedSender(sender)) {
      throw new Error("Untrusted message sender.");
    }

    const state = await getState();

    switch (message.type) {
      case "get-state": {
        return state;
      }

      case "set-active-collection": {
        const activeCollection = normalizeCollectionName(message.activeCollection || "") || "__all__";
        const isValid =
          activeCollection === "__all__" || state.collectionOrder.includes(activeCollection);

        state.activeCollection = isValid ? activeCollection : "__all__";
        await setState(state);
        return { ok: true };
      }

      case "add-or-move-item": {
        const appId = String(message.appId || "").trim();
        const position = message.position === "start" ? "start" : "end";
        const item = message.item || {};
        const collectionName = ensureCollection(state, message.collectionName);

        if (!appId) {
          throw new Error("appId is required.");
        }
        validateAppId(appId);

        removeFromAllCollections(state, appId);

        if (position === "start") {
          state.collections[collectionName].unshift(appId);
        } else {
          state.collections[collectionName].push(appId);
        }

        if (state.collections[collectionName].length > MAX_ITEMS_PER_COLLECTION) {
          state.collections[collectionName] = state.collections[collectionName].slice(0, MAX_ITEMS_PER_COLLECTION);
        }

        upsertStateItem(state, appId, {
          title: String(item.title || state.items[appId]?.title || "").slice(0, 200)
        });

        await setState(state);
        return { ok: true, state };
      }

      case "add-item-to-collection": {
        const appId = String(message.appId || "").trim();
        const item = message.item || {};
        const collectionName = ensureCollection(state, message.collectionName);

        if (!appId) {
          throw new Error("appId is required.");
        }
        validateAppId(appId);

        const list = Array.isArray(state.collections[collectionName]) ? state.collections[collectionName] : [];
        if (!list.includes(appId)) {
          list.push(appId);
        }
        if (list.length > MAX_ITEMS_PER_COLLECTION) {
          state.collections[collectionName] = list.slice(0, MAX_ITEMS_PER_COLLECTION);
        } else {
          state.collections[collectionName] = list;
        }

        upsertStateItem(state, appId, {
          title: String(item.title || state.items[appId]?.title || "").slice(0, 200)
        });

        await setState(state);
        return { ok: true, state };
      }

      case "remove-item-from-collection": {
        const appId = String(message.appId || "").trim();
        const collectionName = normalizeCollectionName(message.collectionName);

        if (!state.collections[collectionName]) {
          return { ok: true, state };
        }

        state.collections[collectionName] = state.collections[collectionName].filter(
          (id) => id !== appId
        );

        cleanupOrphanItems(state);
        await setState(state);
        return { ok: true, state };
      }

      case "remove-item-everywhere": {
        const appId = String(message.appId || "").trim();
        if (!appId) {
          throw new Error("appId is required.");
        }
        validateAppId(appId);

        removeFromAllCollections(state, appId);
        cleanupOrphanItems(state);

        await setState(state);
        return { ok: true, state };
      }

      case "set-item-collections": {
        const appId = String(message.appId || "").trim();
        if (!appId) {
          throw new Error("appId is required.");
        }
        validateAppId(appId);

        const requestedCollectionNames = Array.isArray(message.collectionNames)
          ? message.collectionNames.map((name) => normalizeCollectionName(name)).filter(Boolean)
          : [];
        const selectedCollectionNames = [];
        const seen = new Set();
        for (const collectionName of requestedCollectionNames) {
          if (!collectionName || seen.has(collectionName)) {
            continue;
          }
          seen.add(collectionName);
          if (state.dynamicCollections?.[collectionName]) {
            continue;
          }
          if (!state.collections?.[collectionName]) {
            ensureCollection(state, collectionName);
          }
          selectedCollectionNames.push(collectionName);
        }
        const selectedSet = new Set(selectedCollectionNames);

        for (const collectionName of Object.keys(state.collections || {})) {
          const list = state.collections[collectionName] || [];
          const hasItem = list.includes(appId);
          const shouldHave = selectedSet.has(collectionName);
          if (shouldHave && !hasItem) {
            list.push(appId);
          }
          if (!shouldHave && hasItem) {
            state.collections[collectionName] = list.filter((id) => id !== appId);
          } else {
            state.collections[collectionName] = list;
          }
        }

        if (selectedCollectionNames.length > 0) {
          const item = message.item || {};
          upsertStateItem(state, appId, {
            title: String(item.title || state.items[appId]?.title || "").slice(0, 200)
          });
        } else {
          cleanupOrphanItems(state);
        }

        await setState(state);
        return { ok: true, state, selectedCollectionNames };
      }

      case "set-item-intent": {
        const appId = String(message.appId || "").trim();
        if (!appId) {
          throw new Error("appId is required.");
        }
        validateAppId(appId);

        const current = normalizeItemRecord(appId, state.items?.[appId] || {});
        const nextTrack = message.track === undefined ? current.track : clamp01to2(message.track, current.track);
        const nextBuy = message.buy === undefined ? current.buy : clamp01to2(message.buy, current.buy);
        const nextTrackIntent = message.trackIntent !== undefined
          ? (VALID_TRACK_INTENTS.has(String(message.trackIntent || "").toUpperCase())
            ? String(message.trackIntent || "").toUpperCase()
            : current.trackIntent)
          : (message.track === undefined
            ? current.trackIntent
            : (nextTrack > 0 ? "ON" : "OFF"));
        const nextBuyIntent = message.buyIntent !== undefined
          ? (VALID_BUY_INTENTS.has(String(message.buyIntent || "").toUpperCase())
            ? String(message.buyIntent || "").toUpperCase()
            : current.buyIntent)
          : (message.buy === undefined
            ? current.buyIntent
            : (nextBuy >= 2 ? "BUY" : (nextBuy === 1 ? "MAYBE" : "NONE")));
        const nextBucket = normalizeBucket(
          message.bucket === undefined ? current.bucket : message.bucket,
          nextTrack,
          nextBuy
        );
        const nextNote = message.note === undefined ? current.note : String(message.note || "").slice(0, 600);
        const nextTargetPrice = message.targetPriceCents === undefined
          ? current.targetPriceCents
          : (Number.isFinite(Number(message.targetPriceCents))
            ? Math.max(0, Math.floor(Number(message.targetPriceCents)))
            : null);
        const nextMuted = message.muted === undefined ? current.muted : Boolean(message.muted);
        let nextLabels = message.labels === undefined ? current.labels : sanitizeLabels(message.labels);
        if (message.owned !== undefined) {
          nextLabels = mergeOwnedLabel(nextLabels, Boolean(message.owned));
        }

        const previousItem = current;
        const nextWithQueueTimers = applyQueueTimersForTransition(previousItem, {
          appId,
          title: String(message.title || current.title || "").slice(0, 200),
          track: nextTrack,
          buy: nextBuy,
          trackIntent: nextTrackIntent,
          buyIntent: nextBuyIntent,
          bucket: nextBucket,
          note: nextNote,
          targetPriceCents: nextTargetPrice,
          muted: nextMuted,
          labels: nextLabels,
          triagedAt: Date.now()
        }, Date.now());
        upsertStateItem(state, appId, nextWithQueueTimers);

        await setState(state);
        let steamWrite = null;
        if (message.syncSteam !== false && message.owned === undefined) {
          steamWrite = await syncSteamSignalsForIntentChange(appId, previousItem, state.items[appId]);
        }
        return { ok: true, item: state.items[appId], state, steamWrite };
      }

      case "batch-update-collection": {
        const mode = String(message.mode || "add") === "remove" ? "remove" : "add";
        const collectionName = normalizeCollectionName(message.collectionName || "");
        if (!collectionName || !state.collections[collectionName]) {
          throw new Error("Target collection not found.");
        }

        const appIds = sanitizeAppIdList(message.appIds);
        if (appIds.length === 0) {
          return { ok: true, updated: 0, state };
        }

        const set = new Set(state.collections[collectionName] || []);
        if (mode === "add") {
          for (const appId of appIds) {
            set.add(appId);
            upsertStateItem(state, appId, {
              title: String(state.items[appId]?.title || "").slice(0, 200)
            });
          }
        } else {
          for (const appId of appIds) {
            set.delete(appId);
          }
        }

        state.collections[collectionName] = Array.from(set).slice(0, MAX_ITEMS_PER_COLLECTION);
        cleanupOrphanItems(state);
        await setState(state);
        return { ok: true, updated: appIds.length, state };
      }

      case "batch-set-item-intent": {
        const appIds = sanitizeAppIdList(message.appIds);
        if (appIds.length === 0) {
          return { ok: true, updated: 0, state };
        }

        const ts = Date.now();
        const hasOwnedPatch = message.owned !== undefined;
        const ownedPatch = Boolean(message.owned);
        const steamWriteResults = [];
        for (const appId of appIds) {
          const current = normalizeItemRecord(appId, state.items?.[appId] || {});
          const nextTrack = message.track === undefined ? current.track : clamp01to2(message.track, current.track);
          const nextBuy = message.buy === undefined ? current.buy : clamp01to2(message.buy, current.buy);
          const nextTrackIntent = message.trackIntent !== undefined
            ? (VALID_TRACK_INTENTS.has(String(message.trackIntent || "").toUpperCase())
              ? String(message.trackIntent || "").toUpperCase()
              : current.trackIntent)
            : (message.track === undefined
              ? current.trackIntent
              : (nextTrack > 0 ? "ON" : "OFF"));
          const nextBuyIntent = message.buyIntent !== undefined
            ? (VALID_BUY_INTENTS.has(String(message.buyIntent || "").toUpperCase())
              ? String(message.buyIntent || "").toUpperCase()
              : current.buyIntent)
            : (message.buy === undefined
              ? current.buyIntent
              : (nextBuy >= 2 ? "BUY" : (nextBuy === 1 ? "MAYBE" : "NONE")));
          const nextBucket = normalizeBucket(
            message.bucket === undefined ? current.bucket : message.bucket,
            nextTrack,
            nextBuy
          );
          const nextMuted = message.muted === undefined ? current.muted : Boolean(message.muted);

          const nextLabels = hasOwnedPatch
            ? mergeOwnedLabel(current.labels, ownedPatch)
            : current.labels;

          const previousItem = current;
          const nextWithQueueTimers = applyQueueTimersForTransition(previousItem, {
            appId,
            title: String(message.title || current.title || "").slice(0, 200),
            track: nextTrack,
            buy: nextBuy,
            trackIntent: nextTrackIntent,
            buyIntent: nextBuyIntent,
            bucket: nextBucket,
            note: current.note,
            targetPriceCents: current.targetPriceCents,
            muted: nextMuted,
            labels: nextLabels,
            triagedAt: ts
          }, ts);
          upsertStateItem(state, appId, nextWithQueueTimers);

          if (message.syncSteam !== false && message.owned === undefined) {
            const steamWrite = await syncSteamSignalsForIntentChange(appId, previousItem, state.items[appId]);
            steamWriteResults.push({
              appId,
              ...steamWrite
            });
          }
        }

        await setState(state);
        return { ok: true, updated: appIds.length, state, steamWriteResults };
      }

      case "set-collection-items-order": {
        const collectionName = normalizeCollectionName(message.collectionName || "");
        if (!collectionName || !state.collections[collectionName]) {
          throw new Error("Collection not found.");
        }

        const nextOrder = sanitizeAppIdList(message.appIds);
        const current = state.collections[collectionName] || [];
        if (nextOrder.length !== current.length) {
          throw new Error("Invalid collection order payload length.");
        }

        const currentSet = new Set(current);
        for (const appId of nextOrder) {
          if (!currentSet.has(appId)) {
            throw new Error("Invalid collection order payload items.");
          }
        }

        state.collections[collectionName] = nextOrder;
        await setState(state);
        return { ok: true, state };
      }

      case "create-collection": {
        ensureCollection(state, message.collectionName);
        await setState(state);
        return { ok: true, state };
      }

      case "create-or-update-dynamic-collection": {
        const collectionName = ensureDynamicCollection(state, message.collectionName, message.definition);
        await setState(state);
        return { ok: true, collectionName, state };
      }

      case "rename-collection": {
        const newName = renameCollection(state, message.fromName, message.toName);
        await setState(state);
        return { ok: true, newName, state };
      }

      case "delete-collection": {
        const deleted = deleteCollection(state, message.collectionName);
        await setState(state);
        return { ok: true, deleted, state };
      }

      case "prune-items-not-in-wishlist": {
        pruneItemsNotInWishlist(state, message.appIds);
        await setState(state);
        return { ok: true, state };
      }

      case "invalidate-caches": {
        await browser.storage.local.remove([
          META_CACHE_KEY,
          WISHLIST_ADDED_CACHE_KEY,
          TAG_COUNTS_CACHE_KEY,
          TYPE_COUNTS_CACHE_KEY,
          EXTRA_FILTER_COUNTS_CACHE_KEY
        ]);
        scheduleNativeBridgePublish("invalidate-caches");
        return { ok: true };
      }

      case "create-backup-snapshot": {
        const meta = await createBackupSnapshot(String(message.reason || "manual"));
        scheduleNativeBridgePublish("create-backup-snapshot");
        return { ok: true, backup: meta };
      }

      case "get-backup-summary": {
        const summary = await getBackupSummary();
        return { ok: true, summary };
      }

      case "set-backup-settings": {
        const settings = await setBackupSettings(message.settings || {});
        scheduleNativeBridgePublish("set-backup-settings");
        return { ok: true, settings };
      }

      case "get-queue-policy": {
        const policy = await getQueuePolicy();
        return { ok: true, policy };
      }

      case "set-queue-policy": {
        const policy = await setQueuePolicy(message.policy || {});
        scheduleNativeBridgePublish("set-queue-policy");
        return { ok: true, policy };
      }

      case "run-queue-automation-now": {
        const result = await performQueueAutomationSweep(Boolean(message.force));
        return { ok: true, ...result };
      }

      case "apply-backup-settings": {
        const settings = await getBackupSettings();
        await scheduleBackupAlarm(settings);
        return { ok: true, settings };
      }

      case "clear-all-data": {
        await browser.storage.local.clear();
        scheduleNativeBridgePublish("clear-all-data");
        return { ok: true };
      }

      case "set-wishlist-steamid": {
        const steamId = String(message.steamId || "").trim();
        if (!/^\d{10,20}$/.test(steamId)) {
          throw new Error("Invalid steamId.");
        }
        const stored = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
        const cached = stored[WISHLIST_ADDED_CACHE_KEY] || {};
        await browser.storage.local.set({
          [WISHLIST_ADDED_CACHE_KEY]: {
            ...cached,
            steamId
          }
        });
        scheduleNativeBridgePublish("set-wishlist-steamid");
        try {
          await syncWishlistOrderCache(true);
        } catch {
          // non-fatal: collections page will retry and surface debug info
        }
        return { ok: true, steamId };
      }

      case "sync-wishlist-order-cache": {
        try {
          const result = await syncWishlistOrderCache(Boolean(message.force));
          scheduleNativeBridgePublish("sync-wishlist-order-cache");
          return result;
        } catch (error) {
          const stored = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
          const cached = stored[WISHLIST_ADDED_CACHE_KEY] || {};
          await browser.storage.local.set({
            [WISHLIST_ADDED_CACHE_KEY]: {
              ...cached,
              priorityLastError: String(error?.message || error || "unknown sync error")
            }
          });
          scheduleNativeBridgePublish("sync-wishlist-order-cache-error");
          return { ok: false, error: String(error?.message || error || "unknown sync error") };
        }
      }

      case "sync-wishlist-order-via-background-tab": {
        try {
          const result = await syncWishlistOrderViaBackgroundTab(Boolean(message.force));
          scheduleNativeBridgePublish("sync-wishlist-order-via-background-tab");
          return result;
        } catch (error) {
          const stored = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
          const cached = stored[WISHLIST_ADDED_CACHE_KEY] || {};
          await browser.storage.local.set({
            [WISHLIST_ADDED_CACHE_KEY]: {
              ...cached,
              priorityLastError: String(error?.message || error || "background wishlist sync failed")
            }
          });
          scheduleNativeBridgePublish("sync-wishlist-order-via-background-tab-error");
          return { ok: false, error: String(error?.message || error || "background wishlist sync failed") };
        }
      }

      case "publish-native-bridge-snapshot": {
        const result = await publishNativeBridgeSnapshot(String(message.reason || "manual"));
        return { ok: Boolean(result?.ok), ...result };
      }

      case "sync-followed-from-steam": {
        const result = await syncFollowedAppsFromSteam(state, Boolean(message.force));
        if (!result.skipped && result.updatedCount > 0) {
          await setState(state);
        }
        return result;
      }

      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  })();
});

if (browser?.alarms?.onAlarm) {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (!alarm) {
      return;
    }
    if (alarm.name === BACKUP_ALARM_NAME) {
      createBackupSnapshot("auto").catch(() => {});
      return;
    }
    if (alarm.name === QUEUE_AUTOMATION_ALARM_NAME) {
      performQueueAutomationSweep(false).catch(() => {});
    }
  });
}

async function initializeBackupScheduler() {
  try {
    const settings = await getBackupSettings();
    await scheduleBackupAlarm(settings);
  } catch {
    // ignore
  }
}

async function initializeQueueAutomationScheduler() {
  try {
    await getQueuePolicy();
    await scheduleQueueAutomationAlarm();
  } catch {
    // ignore
  }
}

browser.runtime.onInstalled?.addListener(() => {
  initializeBackupScheduler().catch(() => {});
  initializeQueueAutomationScheduler().catch(() => {});
  scheduleNativeBridgePublish("on-installed", 1500);
});

browser.runtime.onStartup?.addListener(() => {
  initializeBackupScheduler().catch(() => {});
  initializeQueueAutomationScheduler().catch(() => {});
  scheduleNativeBridgePublish("on-startup", 1500);
});

initializeBackupScheduler().catch(() => {});
initializeQueueAutomationScheduler().catch(() => {});
scheduleNativeBridgePublish("background-init", 3000);
