import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.SWM_MCP_DB_PATH
  ? path.resolve(process.env.SWM_MCP_DB_PATH)
  : path.join(__dirname, "data", "state.json");
const NATIVE_BRIDGE_SNAPSHOT_PATH = process.env.SWM_NATIVE_BRIDGE_SNAPSHOT_PATH
  ? path.resolve(process.env.SWM_NATIVE_BRIDGE_SNAPSHOT_PATH)
  : path.join(__dirname, "data", "extension-bridge-snapshot.json");

const APP_ID_RE = /^\d{1,10}$/;
const STEAM_ID_RE = /^\d{5,20}$/;
const MAX_COLLECTION_NAME_LENGTH = 64;
const MAX_ITEMS_PER_COLLECTION = 5000;
const EXTENSION_STATE_KEY = "steamWishlistCollectionsState";
const EXTENSION_META_CACHE_KEY = "steamWishlistCollectionsMetaCacheV4";
const EXTENSION_WISHLIST_CACHE_KEY = "steamWishlistAddedMapV3";
const EXTENSION_TAG_COUNTS_KEY = "steamWishlistTagCountsCacheV1";
const EXTENSION_TYPE_COUNTS_KEY = "steamWishlistTypeCountsCacheV1";
const EXTENSION_EXTRA_COUNTS_KEY = "steamWishlistExtraFilterCountsCacheV2";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const CODEX_MODEL = process.env.SWM_CODEX_MODEL || "gpt-5.1-codex-mini";
const STEAM_LANG = process.env.SWM_STEAM_LANG || "english";
const STEAM_CC = process.env.SWM_STEAM_CC || "us";

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;
const REQUEST_DELAY_MS = Number(process.env.SWM_REQUEST_DELAY_MS || 250);

const DEFAULT_STATE = {
  version: 2,
  collections: {},
  dynamicCollections: {},
  items: {},
  extensionCaches: {
    wishlistAdded: {},
    metaCache: {},
    tagCounts: {},
    typeCounts: {},
    extraCounts: {},
    importedAt: 0
  },
  extensionSyncRequest: {
    requestedAt: 0,
    scopes: [],
    reason: "",
    fulfilledAt: 0
  },
  wishlistRank: {
    steamId: "",
    orderedAppIds: [],
    priorityByAppId: {},
    dateAddedByAppId: {},
    totalCount: 0,
    syncedAt: 0,
    lastError: ""
  },
  wishlistData: {
    steamId: "",
    byAppId: {},
    pagesFetched: 0,
    lastPageFetched: -1,
    syncedAt: 0,
    lastError: ""
  },
  appdetails: {
    byAppId: {},
    syncedAt: 0,
    lastError: ""
  },
  frequencies: {
    tags: {},
    type: {},
    languages: {},
    fullAudioLanguages: {},
    platforms: {},
    features: {},
    developers: {},
    publishers: {},
    releaseYears: {},
    syncedAt: 0,
    source: ""
  },
  syncStatus: {
    phase: "idle",
    done: 0,
    total: 0,
    progress: 0,
    updatedAt: 0,
    lastError: "",
    lastPipelineAt: 0,
    lastCompletedStep: "",
    lastPipelineParams: null,
    lastPipelineReport: []
  },
  updatedAt: Date.now()
};

function normalizeCollectionName(name) {
  return String(name || "").replace(/\s+/g, " ").trim().slice(0, MAX_COLLECTION_NAME_LENGTH);
}

function validateAppId(appId) {
  const id = String(appId || "").trim();
  if (!APP_ID_RE.test(id)) {
    throw new Error("Invalid appId.");
  }
  return id;
}

function validateSteamId(steamId) {
  const value = String(steamId || "").trim();
  if (!STEAM_ID_RE.test(value)) {
    throw new Error("Invalid steamId.");
  }
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function now() {
  return Date.now();
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value, max = 300) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function ensureStringArray(input, max = 200) {
  if (!Array.isArray(input)) {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const value of input) {
    const text = cleanText(value, 120);
    if (!text) {
      continue;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(text);
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

function parseLanguages(raw) {
  if (!raw) {
    return [];
  }
  const text = String(raw)
    .replace(/<br\s*\/?>/gi, ",")
    .replace(/<[^>]*>/g, "")
    .replace(/\(full audio\)/gi, "")
    .replace(/\*/g, "")
    .trim();
  return ensureStringArray(text.split(",").map((v) => v.trim()), 80);
}

function parseReleaseYear(rawReleaseDate) {
  const value = cleanText(rawReleaseDate, 80);
  if (!value) {
    return "";
  }
  const yearMatch = value.match(/(19\d{2}|20\d{2}|21\d{2})/);
  if (yearMatch) {
    return yearMatch[1];
  }
  if (/^[a-z\s]+$/i.test(value)) {
    return value.toUpperCase();
  }
  return "";
}

function parseWishlistDataPrice(entry) {
  if (!isObject(entry)) {
    return null;
  }
  const finalPrice = Number(entry.final_price);
  const discount = Number(entry.discount_pct);
  if (Number.isFinite(finalPrice) || Number.isFinite(discount)) {
    return {
      finalPriceCents: Number.isFinite(finalPrice) ? finalPrice : null,
      discountPercent: Number.isFinite(discount) ? discount : null,
      currency: cleanText(entry.currency || "", 12)
    };
  }
  if (Array.isArray(entry.subs) && entry.subs[0] && isObject(entry.subs[0])) {
    const sub = entry.subs[0];
    const subFinal = Number(sub.price || sub.final_price);
    const subDiscount = Number(sub.discount_pct || sub.discount_percent);
    return {
      finalPriceCents: Number.isFinite(subFinal) ? subFinal : null,
      discountPercent: Number.isFinite(subDiscount) ? subDiscount : null,
      currency: cleanText(sub.currency || entry.currency || "", 12)
    };
  }
  return null;
}

function sanitizeItem(id, rawItem) {
  const appId = validateAppId(id);
  const src = isObject(rawItem) ? rawItem : {};
  return {
    appId,
    title: cleanText(src.title || src.name || "", 180),
    type: cleanText(src.type || "", 64),
    releaseDate: cleanText(src.releaseDate || src.release_date || "", 80),
    releaseYear: cleanText(src.releaseYear || "", 20),
    wishlistDateAdded: Number.isFinite(Number(src.wishlistDateAdded)) ? Number(src.wishlistDateAdded) : null,
    discountPercent: Number.isFinite(Number(src.discountPercent)) ? Number(src.discountPercent) : null,
    finalPriceCents: Number.isFinite(Number(src.finalPriceCents)) ? Number(src.finalPriceCents) : null,
    initialPriceCents: Number.isFinite(Number(src.initialPriceCents)) ? Number(src.initialPriceCents) : null,
    currency: cleanText(src.currency || "", 12),
    reviewPercent: Number.isFinite(Number(src.reviewPercent)) ? Number(src.reviewPercent) : null,
    reviewTotal: Number.isFinite(Number(src.reviewTotal)) ? Number(src.reviewTotal) : null,
    reviewSummary: cleanText(src.reviewSummary || "", 120),
    tags: ensureStringArray(src.tags || [], 120),
    features: ensureStringArray(src.features || [], 120),
    languages: ensureStringArray(src.languages || [], 80),
    fullAudioLanguages: ensureStringArray(src.fullAudioLanguages || [], 80),
    developers: ensureStringArray(src.developers || [], 40),
    publishers: ensureStringArray(src.publishers || [], 40),
    platforms: ensureStringArray(src.platforms || [], 10),
    headerImage: cleanText(src.headerImage || "", 300),
    capsuleImage: cleanText(src.capsuleImage || "", 300),
    updatedAt: Number.isFinite(Number(src.updatedAt)) ? Number(src.updatedAt) : now()
  };
}

function normalizeFrequencyMap(input) {
  if (!isObject(input)) {
    return {};
  }
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    const text = cleanText(key, 120);
    const count = Number(value);
    if (!text || !Number.isFinite(count) || count <= 0) {
      continue;
    }
    out[text] = Math.floor(count);
  }
  return out;
}

function normalizeState(raw) {
  const src = isObject(raw) ? raw : {};
  const state = {
    ...DEFAULT_STATE,
    ...src
  };

  if (!isObject(state.collections)) {
    state.collections = {};
  }
  if (!isObject(state.dynamicCollections)) {
    state.dynamicCollections = {};
  }
  if (!isObject(state.items)) {
    state.items = {};
  }

  const nextCollections = {};
  for (const [rawName, rawList] of Object.entries(state.collections)) {
    const name = normalizeCollectionName(rawName);
    if (!name || Array.isArray(state.dynamicCollections?.[name])) {
      continue;
    }
    const ids = Array.isArray(rawList)
      ? Array.from(new Set(rawList.map((v) => String(v || "").trim()).filter((v) => APP_ID_RE.test(v))))
      : [];
    nextCollections[name] = ids.slice(0, MAX_ITEMS_PER_COLLECTION);
  }
  state.collections = nextCollections;

  const nextDynamic = {};
  for (const [rawName, rawDef] of Object.entries(state.dynamicCollections)) {
    const name = normalizeCollectionName(rawName);
    if (!name || state.collections[name]) {
      continue;
    }
    const def = isObject(rawDef) ? rawDef : {};
    nextDynamic[name] = {
      baseSource: cleanText(def.baseSource || "wishlist", 40),
      baseCollection: normalizeCollectionName(def.baseCollection || ""),
      sortMode: cleanText(def.sortMode || "title", 40),
      filters: isObject(def.filters) ? def.filters : {},
      capturedAt: Number.isFinite(Number(def.capturedAt)) ? Number(def.capturedAt) : now()
    };
  }
  state.dynamicCollections = nextDynamic;

  const nextItems = {};
  for (const [rawId, rawItem] of Object.entries(state.items)) {
    const id = String(rawId || "").trim();
    if (!APP_ID_RE.test(id)) {
      continue;
    }
    nextItems[id] = sanitizeItem(id, rawItem);
  }
  state.items = nextItems;

  const extensionCaches = isObject(state.extensionCaches) ? state.extensionCaches : {};
  state.extensionCaches = {
    wishlistAdded: isObject(extensionCaches.wishlistAdded) ? extensionCaches.wishlistAdded : {},
    metaCache: isObject(extensionCaches.metaCache) ? extensionCaches.metaCache : {},
    tagCounts: isObject(extensionCaches.tagCounts) ? extensionCaches.tagCounts : {},
    typeCounts: isObject(extensionCaches.typeCounts) ? extensionCaches.typeCounts : {},
    extraCounts: isObject(extensionCaches.extraCounts) ? extensionCaches.extraCounts : {},
    importedAt: Number.isFinite(Number(extensionCaches.importedAt)) ? Number(extensionCaches.importedAt) : 0
  };

  const extensionSyncRequest = isObject(state.extensionSyncRequest) ? state.extensionSyncRequest : {};
  state.extensionSyncRequest = {
    requestedAt: Number.isFinite(Number(extensionSyncRequest.requestedAt)) ? Number(extensionSyncRequest.requestedAt) : 0,
    scopes: Array.isArray(extensionSyncRequest.scopes)
      ? extensionSyncRequest.scopes.map((v) => cleanText(v, 64)).filter(Boolean).slice(0, 20)
      : [],
    reason: cleanText(extensionSyncRequest.reason || "", 240),
    fulfilledAt: Number.isFinite(Number(extensionSyncRequest.fulfilledAt)) ? Number(extensionSyncRequest.fulfilledAt) : 0
  };

  const rank = isObject(state.wishlistRank) ? state.wishlistRank : {};
  const orderedAppIds = Array.isArray(rank.orderedAppIds)
    ? rank.orderedAppIds.map((id) => String(id || "").trim()).filter((id) => APP_ID_RE.test(id))
    : [];
  const priorityByAppId = {};
  if (isObject(rank.priorityByAppId)) {
    for (const [id, value] of Object.entries(rank.priorityByAppId)) {
      if (!APP_ID_RE.test(id)) {
        continue;
      }
      const priority = Number(value);
      if (Number.isFinite(priority)) {
        priorityByAppId[id] = priority;
      }
    }
  }
  const dateAddedByAppId = {};
  if (isObject(rank.dateAddedByAppId)) {
    for (const [id, value] of Object.entries(rank.dateAddedByAppId)) {
      if (!APP_ID_RE.test(id)) {
        continue;
      }
      const ts = Number(value);
      if (Number.isFinite(ts) && ts > 0) {
        dateAddedByAppId[id] = ts;
      }
    }
  }

  state.wishlistRank = {
    steamId: STEAM_ID_RE.test(String(rank.steamId || "")) ? String(rank.steamId) : "",
    orderedAppIds,
    priorityByAppId,
    dateAddedByAppId,
    totalCount: Number.isFinite(Number(rank.totalCount)) ? Number(rank.totalCount) : orderedAppIds.length,
    syncedAt: Number.isFinite(Number(rank.syncedAt)) ? Number(rank.syncedAt) : 0,
    lastError: cleanText(rank.lastError || "", 240)
  };

  const wishlistData = isObject(state.wishlistData) ? state.wishlistData : {};
  const wishlistDataByAppId = {};
  if (isObject(wishlistData.byAppId)) {
    for (const [id, rawEntry] of Object.entries(wishlistData.byAppId)) {
      if (!APP_ID_RE.test(id) || !isObject(rawEntry)) {
        continue;
      }
      wishlistDataByAppId[id] = {
        appId: id,
        name: cleanText(rawEntry.name || "", 180),
        releaseDate: cleanText(rawEntry.releaseDate || "", 80),
        reviewSummary: cleanText(rawEntry.reviewSummary || "", 120),
        reviewPercent: Number.isFinite(Number(rawEntry.reviewPercent)) ? Number(rawEntry.reviewPercent) : null,
        reviewTotal: Number.isFinite(Number(rawEntry.reviewTotal)) ? Number(rawEntry.reviewTotal) : null,
        discountPercent: Number.isFinite(Number(rawEntry.discountPercent)) ? Number(rawEntry.discountPercent) : null,
        finalPriceCents: Number.isFinite(Number(rawEntry.finalPriceCents)) ? Number(rawEntry.finalPriceCents) : null,
        currency: cleanText(rawEntry.currency || "", 12),
        tags: ensureStringArray(rawEntry.tags || [], 120),
        headerImage: cleanText(rawEntry.headerImage || "", 300),
        updatedAt: Number.isFinite(Number(rawEntry.updatedAt)) ? Number(rawEntry.updatedAt) : 0
      };
    }
  }

  state.wishlistData = {
    steamId: STEAM_ID_RE.test(String(wishlistData.steamId || "")) ? String(wishlistData.steamId) : "",
    byAppId: wishlistDataByAppId,
    pagesFetched: Number.isFinite(Number(wishlistData.pagesFetched)) ? Number(wishlistData.pagesFetched) : 0,
    lastPageFetched: Number.isFinite(Number(wishlistData.lastPageFetched)) ? Number(wishlistData.lastPageFetched) : -1,
    syncedAt: Number.isFinite(Number(wishlistData.syncedAt)) ? Number(wishlistData.syncedAt) : 0,
    lastError: cleanText(wishlistData.lastError || "", 240)
  };

  const appdetails = isObject(state.appdetails) ? state.appdetails : {};
  const appdetailsByAppId = {};
  if (isObject(appdetails.byAppId)) {
    for (const [id, rawEntry] of Object.entries(appdetails.byAppId)) {
      if (!APP_ID_RE.test(id) || !isObject(rawEntry)) {
        continue;
      }
      appdetailsByAppId[id] = {
        appId: id,
        data: isObject(rawEntry.data) ? rawEntry.data : {},
        fetchedAt: Number.isFinite(Number(rawEntry.fetchedAt)) ? Number(rawEntry.fetchedAt) : 0,
        error: cleanText(rawEntry.error || "", 240)
      };
    }
  }
  state.appdetails = {
    byAppId: appdetailsByAppId,
    syncedAt: Number.isFinite(Number(appdetails.syncedAt)) ? Number(appdetails.syncedAt) : 0,
    lastError: cleanText(appdetails.lastError || "", 240)
  };

  const frequencies = isObject(state.frequencies) ? state.frequencies : {};
  state.frequencies = {
    tags: normalizeFrequencyMap(frequencies.tags),
    type: normalizeFrequencyMap(frequencies.type),
    languages: normalizeFrequencyMap(frequencies.languages),
    fullAudioLanguages: normalizeFrequencyMap(frequencies.fullAudioLanguages),
    platforms: normalizeFrequencyMap(frequencies.platforms),
    features: normalizeFrequencyMap(frequencies.features),
    developers: normalizeFrequencyMap(frequencies.developers),
    publishers: normalizeFrequencyMap(frequencies.publishers),
    releaseYears: normalizeFrequencyMap(frequencies.releaseYears),
    syncedAt: Number.isFinite(Number(frequencies.syncedAt)) ? Number(frequencies.syncedAt) : 0,
    source: cleanText(frequencies.source || "", 80)
  };

  const syncStatus = isObject(state.syncStatus) ? state.syncStatus : {};
  state.syncStatus = {
    phase: cleanText(syncStatus.phase || "idle", 80),
    done: Number.isFinite(Number(syncStatus.done)) ? Number(syncStatus.done) : 0,
    total: Number.isFinite(Number(syncStatus.total)) ? Number(syncStatus.total) : 0,
    progress: Number.isFinite(Number(syncStatus.progress)) ? Number(syncStatus.progress) : 0,
    updatedAt: Number.isFinite(Number(syncStatus.updatedAt)) ? Number(syncStatus.updatedAt) : 0,
    lastError: cleanText(syncStatus.lastError || "", 240),
    lastPipelineAt: Number.isFinite(Number(syncStatus.lastPipelineAt)) ? Number(syncStatus.lastPipelineAt) : 0,
    lastCompletedStep: cleanText(syncStatus.lastCompletedStep || "", 120),
    lastPipelineParams: isObject(syncStatus.lastPipelineParams) ? syncStatus.lastPipelineParams : null,
    lastPipelineReport: Array.isArray(syncStatus.lastPipelineReport) ? syncStatus.lastPipelineReport.slice(0, 50) : []
  };

  state.updatedAt = now();
  return state;
}

function toNormalizedStateFromExtensionState(rawState) {
  const src = isObject(rawState) ? rawState : {};
  return normalizeState({
    version: 2,
    collections: src.collections || {},
    dynamicCollections: src.dynamicCollections || {},
    items: src.items || {},
    updatedAt: now()
  });
}

function mergeStates(baseState, incomingState) {
  const base = normalizeState(baseState);
  const incoming = normalizeState(incomingState);
  const out = normalizeState(base);

  for (const [name, ids] of Object.entries(incoming.collections || {})) {
    const existing = Array.isArray(out.collections[name]) ? out.collections[name] : [];
    const merged = Array.from(new Set([...existing, ...ids]));
    out.collections[name] = merged.slice(0, MAX_ITEMS_PER_COLLECTION);
  }

  for (const [name, def] of Object.entries(incoming.dynamicCollections || {})) {
    out.dynamicCollections[name] = {
      baseSource: String(def?.baseSource || "wishlist"),
      baseCollection: normalizeCollectionName(def?.baseCollection || ""),
      sortMode: String(def?.sortMode || "title"),
      filters: isObject(def?.filters) ? def.filters : {},
      capturedAt: Number.isFinite(Number(def?.capturedAt)) ? Number(def.capturedAt) : now()
    };
  }

  for (const [appId, item] of Object.entries(incoming.items || {})) {
    if (!APP_ID_RE.test(String(appId || ""))) {
      continue;
    }
    const current = out.items?.[appId] || { appId: String(appId) };
    out.items[appId] = sanitizeItem(appId, { ...current, ...item });
  }

  if (incoming.wishlistRank?.orderedAppIds?.length) {
    out.wishlistRank = { ...out.wishlistRank, ...incoming.wishlistRank };
  }

  if (incoming.wishlistData?.syncedAt) {
    out.wishlistData = {
      ...out.wishlistData,
      ...incoming.wishlistData,
      byAppId: {
        ...(out.wishlistData?.byAppId || {}),
        ...(incoming.wishlistData?.byAppId || {})
      }
    };
  }

  if (incoming.appdetails?.syncedAt) {
    out.appdetails = {
      ...out.appdetails,
      ...incoming.appdetails,
      byAppId: {
        ...(out.appdetails?.byAppId || {}),
        ...(incoming.appdetails?.byAppId || {})
      }
    };
  }

  if (incoming.frequencies?.syncedAt) {
    out.frequencies = {
      ...out.frequencies,
      ...incoming.frequencies
    };
  }

  return normalizeState(out);
}

function parseBackupJsonToExtensionState(inputJson) {
  const parsed = JSON.parse(String(inputJson || "{}"));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid backup payload.");
  }
  const data = parsed?.data;
  if (!data || typeof data !== "object") {
    throw new Error("Backup payload missing data field.");
  }
  const extensionState = data[EXTENSION_STATE_KEY];
  if (!extensionState || typeof extensionState !== "object") {
    throw new Error(`Backup payload missing ${EXTENSION_STATE_KEY}.`);
  }
  return extensionState;
}

function parseBackupJsonToAllData(inputJson) {
  const parsed = JSON.parse(String(inputJson || "{}"));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid backup payload.");
  }
  const data = parsed?.data;
  if (!data || typeof data !== "object") {
    throw new Error("Backup payload missing data field.");
  }
  return data;
}

function setExtensionCachesFromAllData(state, allData, importedAt = now()) {
  const data = isObject(allData) ? allData : {};
  state.extensionCaches = {
    wishlistAdded: isObject(data[EXTENSION_WISHLIST_CACHE_KEY]) ? data[EXTENSION_WISHLIST_CACHE_KEY] : {},
    metaCache: isObject(data[EXTENSION_META_CACHE_KEY]) ? data[EXTENSION_META_CACHE_KEY] : {},
    tagCounts: isObject(data[EXTENSION_TAG_COUNTS_KEY]) ? data[EXTENSION_TAG_COUNTS_KEY] : {},
    typeCounts: isObject(data[EXTENSION_TYPE_COUNTS_KEY]) ? data[EXTENSION_TYPE_COUNTS_KEY] : {},
    extraCounts: isObject(data[EXTENSION_EXTRA_COUNTS_KEY]) ? data[EXTENSION_EXTRA_COUNTS_KEY] : {},
    importedAt: Number.isFinite(Number(importedAt)) ? Number(importedAt) : now()
  };
  state.extensionSyncRequest.fulfilledAt = state.extensionCaches.importedAt;
  return state;
}

async function hydrateFromNativeBridgeIfNewer() {
  let bridge = null;
  try {
    const raw = await readFile(NATIVE_BRIDGE_SNAPSHOT_PATH, "utf8");
    bridge = JSON.parse(raw);
  } catch {
    return { hydrated: false, reason: "bridge snapshot not found" };
  }

  const allData = isObject(bridge?.data) ? bridge.data : null;
  if (!allData) {
    return { hydrated: false, reason: "bridge snapshot has no data" };
  }
  const bridgeUpdatedAt = Number(bridge?.updatedAt || 0);
  const state = await readState();
  const importedAt = Number(state.extensionCaches?.importedAt || 0);
  if (Number.isFinite(bridgeUpdatedAt) && bridgeUpdatedAt > 0 && importedAt >= bridgeUpdatedAt) {
    return { hydrated: false, reason: "state already up to date" };
  }

  setExtensionCachesFromAllData(state, allData, bridgeUpdatedAt || now());
  applyExtensionCachesToState(state);
  await writeState(state);
  return {
    hydrated: true,
    importedAt: state.extensionCaches.importedAt
  };
}

function normalizeCountListToMap(list) {
  const map = {};
  if (!Array.isArray(list)) {
    return map;
  }
  for (const row of list) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const name = cleanText(row.name || row.label || "", 120);
    const count = Number(row.count || 0);
    if (!name || !Number.isFinite(count) || count <= 0) {
      continue;
    }
    map[name] = Math.floor(count);
  }
  return map;
}

function chooseLatestBucket(cacheObj) {
  if (!isObject(cacheObj)) {
    return null;
  }
  let best = null;
  let bestTs = -1;
  for (const value of Object.values(cacheObj)) {
    if (!isObject(value)) {
      continue;
    }
    const ts = Number(value.seedFetchedAt || 0);
    const day = Number(String(value.day || "").replaceAll("-", ""));
    const rank = Number.isFinite(ts) && ts > 0 ? ts : (Number.isFinite(day) ? day : 0);
    if (rank > bestTs) {
      bestTs = rank;
      best = value;
    }
  }
  return best;
}

function applyExtensionCachesToState(state) {
  const caches = state.extensionCaches || {};
  const wishlist = isObject(caches.wishlistAdded) ? caches.wishlistAdded : {};
  const ordered = Array.isArray(wishlist.orderedAppIds)
    ? wishlist.orderedAppIds.map((id) => String(id || "").trim()).filter((id) => APP_ID_RE.test(id))
    : [];
  const priorityMap = isObject(wishlist.priorityMap) ? wishlist.priorityMap : {};
  const addedMap = isObject(wishlist.map) ? wishlist.map : {};

  if (ordered.length > 0) {
    const normalizedPriorityMap = {};
    for (const id of ordered) {
      const n = Number(priorityMap[id]);
      normalizedPriorityMap[id] = Number.isFinite(n) ? n : (ordered.indexOf(id) + 1);
    }
    const normalizedAddedMap = {};
    for (const [id, value] of Object.entries(addedMap)) {
      if (!APP_ID_RE.test(id)) {
        continue;
      }
      const ts = Number(value);
      if (Number.isFinite(ts) && ts > 0) {
        normalizedAddedMap[id] = ts;
      }
    }
    state.wishlistRank = {
      steamId: STEAM_ID_RE.test(String(wishlist.steamId || "")) ? String(wishlist.steamId) : String(state.wishlistRank.steamId || ""),
      orderedAppIds: ordered,
      priorityByAppId: normalizedPriorityMap,
      dateAddedByAppId: normalizedAddedMap,
      totalCount: ordered.length,
      syncedAt: Number.isFinite(Number(wishlist.priorityCachedAt)) ? Number(wishlist.priorityCachedAt) : now(),
      lastError: cleanText(wishlist.priorityLastError || "", 240)
    };
  }

  const metaCache = isObject(caches.metaCache) ? caches.metaCache : {};
  let mergedMeta = 0;
  for (const [appId, rawMeta] of Object.entries(metaCache)) {
    if (!APP_ID_RE.test(appId) || !isObject(rawMeta)) {
      continue;
    }
    mergeItemPatch(state, appId, {
      title: cleanText(rawMeta.title || rawMeta.name || "", 180),
      type: cleanText(rawMeta.appType || rawMeta.type || "", 64),
      releaseDate: cleanText(rawMeta.releaseDate || rawMeta.releaseDateRaw || "", 80),
      releaseYear: parseReleaseYear(rawMeta.releaseDate || rawMeta.releaseDateRaw || ""),
      discountPercent: Number.isFinite(Number(rawMeta.discountPercent)) ? Number(rawMeta.discountPercent) : null,
      finalPriceCents: Number.isFinite(Number(rawMeta.priceFinalCents)) ? Number(rawMeta.priceFinalCents) : null,
      initialPriceCents: Number.isFinite(Number(rawMeta.priceInitialCents)) ? Number(rawMeta.priceInitialCents) : null,
      reviewPercent: Number.isFinite(Number(rawMeta.reviewPercent)) ? Number(rawMeta.reviewPercent) : null,
      reviewTotal: Number.isFinite(Number(rawMeta.reviewTotal)) ? Number(rawMeta.reviewTotal) : null,
      reviewSummary: cleanText(rawMeta.reviewSummary || "", 120),
      tags: ensureStringArray(rawMeta.tags || [], 120),
      features: ensureStringArray(rawMeta.features || [], 120),
      languages: ensureStringArray(rawMeta.languages || [], 80),
      fullAudioLanguages: ensureStringArray(rawMeta.fullAudioLanguages || [], 80),
      developers: ensureStringArray(rawMeta.developers || [], 40),
      publishers: ensureStringArray(rawMeta.publishers || [], 40),
      platforms: ensureStringArray(rawMeta.platforms || [], 10),
      headerImage: cleanText(rawMeta.imageUrl || rawMeta.headerImage || "", 300)
    });
    mergedMeta += 1;
  }

  state.wishlistData.byAppId = {};
  for (const appId of state.wishlistRank.orderedAppIds || []) {
    const item = state.items?.[appId];
    if (!item) {
      continue;
    }
    state.wishlistData.byAppId[appId] = {
      appId,
      name: cleanText(item.title || "", 180),
      releaseDate: cleanText(item.releaseDate || "", 80),
      reviewSummary: cleanText(item.reviewSummary || "", 120),
      reviewPercent: Number.isFinite(Number(item.reviewPercent)) ? Number(item.reviewPercent) : null,
      reviewTotal: Number.isFinite(Number(item.reviewTotal)) ? Number(item.reviewTotal) : null,
      discountPercent: Number.isFinite(Number(item.discountPercent)) ? Number(item.discountPercent) : null,
      finalPriceCents: Number.isFinite(Number(item.finalPriceCents)) ? Number(item.finalPriceCents) : null,
      currency: cleanText(item.currency || "", 12),
      tags: ensureStringArray(item.tags || [], 120),
      headerImage: cleanText(item.headerImage || "", 300),
      updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : now()
    };
  }
  state.wishlistData.steamId = state.wishlistRank.steamId;
  state.wishlistData.pagesFetched = 0;
  state.wishlistData.lastPageFetched = -1;
  state.wishlistData.syncedAt = now();
  state.wishlistData.lastError = "";

  const tagBucket = chooseLatestBucket(caches.tagCounts);
  const typeBucket = chooseLatestBucket(caches.typeCounts);
  const extraBucket = chooseLatestBucket(caches.extraCounts);
  state.frequencies = {
    tags: normalizeCountListToMap(tagBucket?.counts || []),
    type: normalizeCountListToMap(typeBucket?.counts || []),
    languages: normalizeCountListToMap(extraBucket?.languageCounts || []),
    fullAudioLanguages: normalizeCountListToMap(extraBucket?.fullAudioLanguageCounts || []),
    platforms: normalizeCountListToMap(extraBucket?.platformCounts || []),
    features: normalizeCountListToMap(extraBucket?.featureCounts || []),
    developers: normalizeCountListToMap(extraBucket?.developerCounts || []),
    publishers: normalizeCountListToMap(extraBucket?.publisherCounts || []),
    releaseYears: normalizeCountListToMap(extraBucket?.releaseYearCounts || []),
    syncedAt: now(),
    source: "extension-caches"
  };

  return {
    rankCount: state.wishlistRank.orderedAppIds.length,
    mergedMeta
  };
}

function requestExtensionSync(state, scopes, reason) {
  const requestedScopes = Array.isArray(scopes)
    ? scopes.map((v) => cleanText(v, 64)).filter(Boolean)
    : [];
  state.extensionSyncRequest = {
    requestedAt: now(),
    scopes: requestedScopes,
    reason: cleanText(reason || "", 240),
    fulfilledAt: Number(state.extensionCaches?.importedAt || 0)
  };
  state.syncStatus.lastError = "";
  state.syncStatus.phase = "awaiting_extension_sync";
  state.syncStatus.updatedAt = now();
  return {
    requiresExtensionSync: true,
    requestedAt: state.extensionSyncRequest.requestedAt,
    scopes: requestedScopes,
    reason: state.extensionSyncRequest.reason,
    guidance: "Update data in extension (Collections/Configurations), export backup JSON, then import via swm_import_extension_backup_file/json."
  };
}

function buildGamesCatalog(state) {
  const ids = new Set();
  for (const appIds of Object.values(state.collections || {})) {
    for (const appId of appIds || []) {
      ids.add(String(appId));
    }
  }
  for (const appId of Object.keys(state.items || {})) {
    ids.add(String(appId));
  }
  for (const appId of state.wishlistRank?.orderedAppIds || []) {
    if (APP_ID_RE.test(String(appId))) {
      ids.add(String(appId));
    }
  }
  const out = [];
  for (const appId of ids) {
    out.push({
      appId,
      title: String(state.items?.[appId]?.title || "")
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, "pt-BR", { sensitivity: "base" }));
}

function parseJsonFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    throw new Error("Empty model response.");
  }
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error("Model response is not valid JSON.");
  }
}

async function queryCodexForGames({ query, limit, catalog }) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const safeLimit = Math.max(1, Math.min(100, Number(limit || 20)));
  const compactCatalog = (Array.isArray(catalog) ? catalog : []).map((item) => ({
    appId: String(item.appId || ""),
    title: String(item.title || "")
  }));

  const systemPrompt = [
    "You are a game-list assistant for a Steam wishlist manager.",
    "Given a user query and a catalog of games, select the most relevant appIds.",
    "Return STRICT JSON only with this shape:",
    "{\"appIds\":[\"123\"],\"suggestedCollectionName\":\"name\",\"reason\":\"short\"}",
    "Rules:",
    "- appIds must come only from provided catalog.",
    "- limit number of appIds to requested limit.",
    "- keep reason concise (<= 200 chars)."
  ].join("\n");

  const userPrompt = JSON.stringify({
    query: String(query || ""),
    limit: safeLimit,
    catalog: compactCatalog
  });

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: CODEX_MODEL,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI error (${response.status}): ${errText.slice(0, 300)}`);
  }

  const payload = await response.json();
  const outputText = String(payload?.output_text || "").trim();
  const parsed = parseJsonFromText(outputText);
  const catalogSet = new Set(compactCatalog.map((item) => item.appId));
  const appIds = Array.isArray(parsed?.appIds)
    ? Array.from(new Set(parsed.appIds.map((id) => String(id || "").trim()).filter((id) => catalogSet.has(id))))
    : [];

  return {
    appIds: appIds.slice(0, safeLimit),
    suggestedCollectionName: String(parsed?.suggestedCollectionName || "Codex Results").trim().slice(0, 64),
    reason: String(parsed?.reason || "").trim().slice(0, 200),
    model: CODEX_MODEL
  };
}

async function ensureDbDir() {
  await mkdir(path.dirname(DB_PATH), { recursive: true });
}

async function readState() {
  await ensureDbDir();
  try {
    const raw = await readFile(DB_PATH, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return normalizeState(DEFAULT_STATE);
  }
}

async function writeState(state) {
  await ensureDbDir();
  const normalized = normalizeState(state);
  await writeFile(DB_PATH, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

async function withState(mutator) {
  const state = await readState();
  const result = await mutator(state);
  const next = await writeState(state);
  return { next, result };
}

async function updateSyncStatus(state, patch) {
  const done = Number.isFinite(Number(patch.done)) ? Number(patch.done) : Number(state.syncStatus.done || 0);
  const total = Number.isFinite(Number(patch.total)) ? Number(patch.total) : Number(state.syncStatus.total || 0);
  state.syncStatus = {
    ...state.syncStatus,
    ...patch,
    done,
    total,
    progress: total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0,
    updatedAt: now()
  };
}

async function fetchJsonWithRetry(url, options = {}, onAttempt = null) {
  assertNetworkAccessAllowed();
  let lastError = null;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      if (typeof onAttempt === "function") {
        await onAttempt(attempt);
      }
      const response = await fetch(url, options);
      if (!response.ok) {
        const bodyText = await response.text();
        const err = new Error(`Request failed (${response.status})`);
        err.status = response.status;
        err.body = bodyText.slice(0, 500);
        if (response.status === 403 || response.status === 429) {
          throw err;
        }
        lastError = err;
      } else {
        return await response.json();
      }
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      if (status === 403 || status === 429) {
        throw error;
      }
    }
    if (attempt < RETRY_ATTEMPTS) {
      await sleep(RETRY_BASE_MS * attempt);
    }
  }
  throw lastError || new Error("Request failed.");
}

async function fetchJsonViaCurl(url, options = {}) {
  assertNetworkAccessAllowed();
  const escapedUrl = String(url).replace(/"/g, '\\"');
  const parts = ["curl", "-L", "-s", "--max-time", "30"];
  const headers = isObject(options?.headers) ? options.headers : {};
  for (const [key, value] of Object.entries(headers)) {
    const escapedHeader = `${String(key)}: ${String(value)}`.replace(/"/g, '\\"');
    parts.push("-H", `"${escapedHeader}"`);
  }
  parts.push(`"${escapedUrl}"`);
  const cmd = parts.join(" ");

  const { stdout } = await execFileAsync("bash", ["-lc", cmd], {
    maxBuffer: 8 * 1024 * 1024
  });
  return JSON.parse(String(stdout || "{}"));
}

async function fetchJsonSmart(url, options = {}, onAttempt = null) {
  assertNetworkAccessAllowed();
  try {
    return await fetchJsonWithRetry(url, options, onAttempt);
  } catch (error) {
    const message = String(error?.message || "");
    if (!/fetch failed|network|ENOTFOUND|ECONNREFUSED|ECONNRESET/i.test(message)) {
      throw error;
    }
    return fetchJsonViaCurl(url, options);
  }
}

function computeWishlistOrder(items) {
  const rows = [];
  for (const raw of Array.isArray(items) ? items : []) {
    if (!isObject(raw)) {
      continue;
    }
    const appId = String(raw.appid || raw.appId || "").trim();
    if (!APP_ID_RE.test(appId)) {
      continue;
    }
    const priority = Number(raw.priority);
    const dateAdded = Number(raw.date_added || raw.dateAdded || 0);
    rows.push({
      appId,
      priority: Number.isFinite(priority) ? priority : Number.MAX_SAFE_INTEGER,
      dateAdded: Number.isFinite(dateAdded) ? dateAdded : 0
    });
  }

  rows.sort((a, b) => {
    const aZero = a.priority === 0;
    const bZero = b.priority === 0;
    if (aZero !== bZero) {
      return aZero ? 1 : -1;
    }
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    if (a.dateAdded !== b.dateAdded) {
      return b.dateAdded - a.dateAdded;
    }
    return Number(a.appId) - Number(b.appId);
  });

  const orderedAppIds = rows.map((row) => row.appId);
  const priorityByAppId = {};
  const dateAddedByAppId = {};
  for (const row of rows) {
    priorityByAppId[row.appId] = row.priority;
    if (row.dateAdded > 0) {
      dateAddedByAppId[row.appId] = row.dateAdded;
    }
  }
  return { orderedAppIds, priorityByAppId, dateAddedByAppId, totalCount: rows.length };
}

async function fetchWishlistRankPages(steamId, setProgress) {
  const perPage = 1000;
  const maxPages = 50;
  let start = 0;
  let totalCount = null;
  const outItems = [];

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL("https://api.steampowered.com/IWishlistService/GetWishlist/v1/");
    url.searchParams.set("steamid", steamId);
    url.searchParams.set("count", String(perPage));
    url.searchParams.set("start", String(start));

    const payload = await fetchJsonSmart(url.toString());
    const response = isObject(payload?.response) ? payload.response : payload;
    const rows = Array.isArray(response?.items) ? response.items : [];
    const pageTotal = Number(response?.total_count);
    if (Number.isFinite(pageTotal) && pageTotal >= 0) {
      totalCount = pageTotal;
    }

    outItems.push(...rows);
    start += rows.length;

    if (typeof setProgress === "function") {
      setProgress(start, totalCount || start);
    }

    if (rows.length === 0) {
      break;
    }

    if (totalCount !== null && start >= totalCount) {
      break;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  return outItems;
}

function extractWishlistDataEntries(payload) {
  if (!isObject(payload)) {
    return [];
  }
  const out = [];
  for (const [key, value] of Object.entries(payload)) {
    if (!APP_ID_RE.test(String(key || "")) || !isObject(value)) {
      continue;
    }
    out.push({ appId: String(key), data: value });
  }
  return out;
}

function mergeItemPatch(state, appId, patch) {
  const current = state.items?.[appId] || { appId };
  state.items[appId] = sanitizeItem(appId, {
    ...current,
    ...patch,
    appId,
    updatedAt: now()
  });
}

async function refreshWishlistData(state, steamId, maxPages, onPage) {
  const byAppId = {};
  let pagesFetched = 0;
  let lastPageFetched = -1;

  for (let page = 0; page < maxPages; page += 1) {
    const url = `https://store.steampowered.com/wishlist/profiles/${steamId}/wishlistdata/?p=${page}`;
    const payload = await fetchJsonSmart(url, {
      headers: {
        Accept: "application/json"
      }
    });

    const entries = extractWishlistDataEntries(payload);
    pagesFetched += 1;
    lastPageFetched = page;

    if (typeof onPage === "function") {
      onPage(page + 1, maxPages, entries.length);
    }

    if (entries.length === 0) {
      break;
    }

    for (const entry of entries) {
      const appId = entry.appId;
      const data = entry.data;
      const price = parseWishlistDataPrice(data);
      const reviewPercent = Number(data.review_score);
      const reviewTotal = Number(data.total_reviews);
      const record = {
        appId,
        name: cleanText(data.name || "", 180),
        releaseDate: cleanText(data.release_string || data.release_date || "", 80),
        reviewSummary: cleanText(data.review_desc || "", 120),
        reviewPercent: Number.isFinite(reviewPercent) ? reviewPercent : null,
        reviewTotal: Number.isFinite(reviewTotal) ? reviewTotal : null,
        discountPercent: Number.isFinite(Number(price?.discountPercent)) ? Number(price.discountPercent) : null,
        finalPriceCents: Number.isFinite(Number(price?.finalPriceCents)) ? Number(price.finalPriceCents) : null,
        currency: cleanText(price?.currency || "", 12),
        tags: ensureStringArray(data.tags || [], 120),
        headerImage: cleanText(data.capsule || data.header_image || "", 300),
        updatedAt: now()
      };
      byAppId[appId] = record;

      mergeItemPatch(state, appId, {
        title: record.name,
        releaseDate: record.releaseDate,
        releaseYear: parseReleaseYear(record.releaseDate),
        reviewSummary: record.reviewSummary,
        reviewPercent: record.reviewPercent,
        reviewTotal: record.reviewTotal,
        discountPercent: record.discountPercent,
        finalPriceCents: record.finalPriceCents,
        currency: record.currency,
        tags: record.tags,
        headerImage: record.headerImage
      });
    }

    await sleep(REQUEST_DELAY_MS);
  }

  return { byAppId, pagesFetched, lastPageFetched };
}

function parseAppdetailsPayload(appId, payload) {
  const root = isObject(payload?.[appId]) ? payload[appId] : payload;
  const success = Boolean(root?.success);
  const data = isObject(root?.data) ? root.data : null;
  if (!success || !data) {
    return null;
  }

  const genres = Array.isArray(data.genres) ? data.genres.map((x) => cleanText(x?.description || "", 80)).filter(Boolean) : [];
  const categories = Array.isArray(data.categories)
    ? data.categories.map((x) => cleanText(x?.description || "", 80)).filter(Boolean)
    : [];
  const languages = parseLanguages(data.supported_languages || "");
  const fullAudioLanguages = ensureStringArray(data.full_audio_languages || [], 80);
  const releaseDate = cleanText(data?.release_date?.date || "", 80);
  const priceOverview = isObject(data.price_overview) ? data.price_overview : {};

  const platforms = [];
  if (isObject(data.platforms)) {
    for (const key of ["windows", "mac", "linux"]) {
      if (data.platforms[key]) {
        platforms.push(key);
      }
    }
  }

  return {
    appId,
    title: cleanText(data.name || "", 180),
    type: cleanText(data.type || "", 64),
    tags: ensureStringArray(genres, 120),
    features: ensureStringArray(categories, 120),
    languages,
    fullAudioLanguages,
    releaseDate,
    releaseYear: parseReleaseYear(releaseDate),
    developers: ensureStringArray(data.developers || [], 40),
    publishers: ensureStringArray(data.publishers || [], 40),
    platforms: ensureStringArray(platforms, 10),
    headerImage: cleanText(data.header_image || "", 300),
    capsuleImage: cleanText(data.capsule_image || "", 300),
    isFree: Boolean(data.is_free),
    discountPercent: Number.isFinite(Number(priceOverview.discount_percent)) ? Number(priceOverview.discount_percent) : null,
    finalPriceCents: Number.isFinite(Number(priceOverview.final)) ? Number(priceOverview.final) : null,
    initialPriceCents: Number.isFinite(Number(priceOverview.initial)) ? Number(priceOverview.initial) : null,
    currency: cleanText(priceOverview.currency || "", 12)
  };
}

function collectTargetAppIds(state, source = "wishlist-rank") {
  const ids = new Set();
  if (source === "wishlist-rank" || source === "all-known") {
    for (const id of state.wishlistRank?.orderedAppIds || []) {
      if (APP_ID_RE.test(String(id || ""))) {
        ids.add(String(id));
      }
    }
  }
  if (source === "items" || source === "all-known") {
    for (const id of Object.keys(state.items || {})) {
      if (APP_ID_RE.test(String(id || ""))) {
        ids.add(String(id));
      }
    }
  }
  for (const appIds of Object.values(state.collections || {})) {
    for (const id of appIds || []) {
      if (APP_ID_RE.test(String(id || ""))) {
        ids.add(String(id));
      }
    }
  }
  return Array.from(ids);
}

function addCount(map, key) {
  const label = cleanText(key, 120);
  if (!label) {
    return;
  }
  map[label] = (map[label] || 0) + 1;
}

function sortedFrequencyMap(map) {
  return Object.fromEntries(
    Object.entries(map)
      .sort((a, b) => {
        if (b[1] !== a[1]) {
          return b[1] - a[1];
        }
        return a[0].localeCompare(b[0], "en", { sensitivity: "base" });
      })
  );
}

function computeFrequenciesFromIds(state, appIds) {
  const tags = {};
  const type = {};
  const languages = {};
  const fullAudioLanguages = {};
  const platforms = {};
  const features = {};
  const developers = {};
  const publishers = {};
  const releaseYears = {};

  for (const appId of appIds) {
    const item = isObject(state.items?.[appId]) ? state.items[appId] : {};

    for (const tag of item.tags || []) {
      addCount(tags, tag);
    }
    for (const feature of item.features || []) {
      addCount(features, feature);
    }
    for (const lang of item.languages || []) {
      addCount(languages, lang);
    }
    for (const lang of item.fullAudioLanguages || []) {
      addCount(fullAudioLanguages, lang);
    }
    for (const platform of item.platforms || []) {
      addCount(platforms, platform);
    }
    for (const dev of item.developers || []) {
      addCount(developers, dev);
    }
    for (const pub of item.publishers || []) {
      addCount(publishers, pub);
    }
    if (item.type) {
      addCount(type, item.type);
    }

    const releaseYear = parseReleaseYear(item.releaseYear || item.releaseDate || "");
    if (releaseYear) {
      addCount(releaseYears, releaseYear);
    }
  }

  return {
    tags: sortedFrequencyMap(tags),
    type: sortedFrequencyMap(type),
    languages: sortedFrequencyMap(languages),
    fullAudioLanguages: sortedFrequencyMap(fullAudioLanguages),
    platforms: sortedFrequencyMap(platforms),
    features: sortedFrequencyMap(features),
    developers: sortedFrequencyMap(developers),
    publishers: sortedFrequencyMap(publishers),
    releaseYears: sortedFrequencyMap(releaseYears)
  };
}

const mcp = new McpServer({
  name: "steam-wishlist-manager-mcp",
  version: "0.2.0"
});

const toolHandlers = new Map();
const toolSchemas = new Map();
const NETWORK_ALLOWED_TOOLS = new Set([
  "swm_refresh_wishlist_rank",
  "swm_refresh_wishlist_data",
  "swm_refresh_appdetails",
  "swm_refresh_frequencies",
  "swm_refresh_all",
  "swm_refresh_all_resume"
]);
let activeToolName = "";

function assertNetworkAccessAllowed() {
  if (!NETWORK_ALLOWED_TOOLS.has(String(activeToolName || ""))) {
    throw new Error(`Network access is not allowed for tool: ${String(activeToolName || "unknown")}`);
  }
}

function registerTool(name, config, handler) {
  const wrappedHandler = async (args) => {
    const previous = activeToolName;
    activeToolName = String(name || "");
    try {
      await hydrateFromNativeBridgeIfNewer();
      return await handler(args);
    } finally {
      activeToolName = previous;
    }
  };
  toolHandlers.set(name, wrappedHandler);
  toolSchemas.set(name, config?.inputSchema || {});
  return mcp.registerTool(name, config, wrappedHandler);
}

registerTool(
  "swm_list_collections",
  {
    description: "List static and/or dynamic collections.",
    inputSchema: {
      source: z.enum(["all", "static", "dynamic"]).default("all")
    }
  },
  async ({ source }) => {
    const state = await readState();
    const staticNames = Object.keys(state.collections).sort();
    const dynamicNames = Object.keys(state.dynamicCollections).sort();
    const out = [];

    if (source === "all" || source === "static") {
      for (const name of staticNames) {
        out.push({
          name,
          type: "static",
          count: (state.collections[name] || []).length
        });
      }
    }
    if (source === "all" || source === "dynamic") {
      for (const name of dynamicNames) {
        out.push({
          name,
          type: "dynamic",
          count: 0,
          definition: state.dynamicCollections[name]
        });
      }
    }

    return {
      content: [{ type: "text", text: `Collections: ${out.length}` }],
      structuredContent: { collections: out }
    };
  }
);

registerTool(
  "swm_create_static_collection",
  {
    description: "Create a static collection.",
    inputSchema: {
      collectionName: z.string().min(1)
    }
  },
  async ({ collectionName }) => {
    const name = normalizeCollectionName(collectionName);
    if (!name) {
      throw new Error("Collection name is required.");
    }
    await withState((state) => {
      if (state.dynamicCollections[name]) {
        throw new Error("A dynamic collection with this name already exists.");
      }
      if (!state.collections[name]) {
        state.collections[name] = [];
      }
    });
    return {
      content: [{ type: "text", text: `Static collection created: ${name}` }],
      structuredContent: { collectionName: name }
    };
  }
);

registerTool(
  "swm_create_or_update_dynamic_collection",
  {
    description: "Create or update a dynamic collection definition.",
    inputSchema: {
      collectionName: z.string().min(1),
      baseSource: z.enum(["wishlist", "all-static", "static-collection"]).default("wishlist"),
      baseCollection: z.string().optional(),
      sortMode: z.string().default("title"),
      filters: z.string().optional()
    }
  },
  async ({ collectionName, baseSource, baseCollection, sortMode, filters }) => {
    const name = normalizeCollectionName(collectionName);
    if (!name) {
      throw new Error("Collection name is required.");
    }
    const parsedFilters = filters ? JSON.parse(filters) : {};
    await withState((state) => {
      if (state.collections[name]) {
        throw new Error("A static collection with this name already exists.");
      }
      state.dynamicCollections[name] = {
        baseSource,
        baseCollection: normalizeCollectionName(baseCollection || ""),
        sortMode: String(sortMode || "title"),
        filters: isObject(parsedFilters) ? parsedFilters : {},
        capturedAt: now()
      };
    });
    return {
      content: [{ type: "text", text: `Dynamic collection saved: ${name}` }],
      structuredContent: { collectionName: name }
    };
  }
);

registerTool(
  "swm_add_item_to_collection",
  {
    description: "Add one app to a static collection without removing from others.",
    inputSchema: {
      collectionName: z.string().min(1),
      appId: z.string().regex(APP_ID_RE),
      title: z.string().optional()
    }
  },
  async ({ collectionName, appId, title }) => {
    const name = normalizeCollectionName(collectionName);
    const id = validateAppId(appId);
    await withState((state) => {
      if (state.dynamicCollections[name]) {
        throw new Error("Cannot add items to a dynamic collection.");
      }
      if (!state.collections[name]) {
        state.collections[name] = [];
      }
      if (!state.collections[name].includes(id)) {
        state.collections[name].push(id);
      }
      if (state.collections[name].length > MAX_ITEMS_PER_COLLECTION) {
        state.collections[name] = state.collections[name].slice(0, MAX_ITEMS_PER_COLLECTION);
      }
      mergeItemPatch(state, id, {
        title: String(title || state.items?.[id]?.title || "")
      });
    });

    return {
      content: [{ type: "text", text: `Added app ${id} to ${name}` }],
      structuredContent: { collectionName: name, appId: id }
    };
  }
);

registerTool(
  "swm_remove_item_from_collection",
  {
    description: "Remove one app from a static collection.",
    inputSchema: {
      collectionName: z.string().min(1),
      appId: z.string().regex(APP_ID_RE)
    }
  },
  async ({ collectionName, appId }) => {
    const name = normalizeCollectionName(collectionName);
    const id = validateAppId(appId);
    await withState((state) => {
      if (state.dynamicCollections[name]) {
        throw new Error("Cannot remove items from a dynamic collection.");
      }
      if (!state.collections[name]) {
        return;
      }
      state.collections[name] = state.collections[name].filter((value) => value !== id);
    });

    return {
      content: [{ type: "text", text: `Removed app ${id} from ${name}` }],
      structuredContent: { collectionName: name, appId: id }
    };
  }
);

registerTool(
  "swm_get_collection_items",
  {
    description: "Get items from a static collection.",
    inputSchema: {
      collectionName: z.string().min(1),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(500).default(100)
    }
  },
  async ({ collectionName, offset, limit }) => {
    const name = normalizeCollectionName(collectionName);
    const state = await readState();
    const ids = state.collections[name];
    if (!Array.isArray(ids)) {
      throw new Error("Static collection not found.");
    }
    const slice = ids.slice(offset, offset + limit);
    const items = slice.map((appId) => ({
      appId,
      title: String(state.items?.[appId]?.title || "")
    }));
    return {
      content: [{ type: "text", text: `Items: ${items.length} (from ${ids.length})` }],
      structuredContent: { collectionName: name, total: ids.length, offset, limit, items }
    };
  }
);

registerTool(
  "swm_import_extension_backup_json",
  {
    description: "Import extension backup JSON payload into MCP DB. Use mode=replace to fully replace or mode=merge to merge incrementally.",
    inputSchema: {
      backupJson: z.string().min(2),
      mode: z.enum(["replace", "merge"]).default("replace")
    }
  },
  async ({ backupJson, mode }) => {
    const allData = parseBackupJsonToAllData(backupJson);
    const extensionState = parseBackupJsonToExtensionState(backupJson);
    const incoming = toNormalizedStateFromExtensionState(extensionState);
    let nextState = null;

    if (mode === "replace") {
      nextState = await writeState(incoming);
    } else {
      const current = await readState();
      nextState = await writeState(mergeStates(current, incoming));
    }

    setExtensionCachesFromAllData(nextState, allData, now());
    applyExtensionCachesToState(nextState);
    nextState = await writeState(nextState);

    return {
      content: [{ type: "text", text: `Backup imported (${mode}).` }],
      structuredContent: {
        mode,
        collections: Object.keys(nextState.collections || {}).length,
        dynamicCollections: Object.keys(nextState.dynamicCollections || {}).length,
        items: Object.keys(nextState.items || {}).length
      }
    };
  }
);

registerTool(
  "swm_import_extension_backup_file",
  {
    description: "Import extension backup JSON file from disk into MCP DB.",
    inputSchema: {
      backupFilePath: z.string().min(1),
      mode: z.enum(["replace", "merge"]).default("replace")
    }
  },
  async ({ backupFilePath, mode }) => {
    const filePath = path.resolve(String(backupFilePath || ""));
    const jsonText = await readFile(filePath, "utf8");
    const allData = parseBackupJsonToAllData(jsonText);
    const extensionState = parseBackupJsonToExtensionState(jsonText);
    const incoming = toNormalizedStateFromExtensionState(extensionState);
    let nextState = null;
    if (mode === "replace") {
      nextState = await writeState(incoming);
    } else {
      const current = await readState();
      nextState = await writeState(mergeStates(current, incoming));
    }

    setExtensionCachesFromAllData(nextState, allData, now());
    applyExtensionCachesToState(nextState);
    nextState = await writeState(nextState);

    return {
      content: [{ type: "text", text: `Backup file imported (${mode}): ${filePath}` }],
      structuredContent: {
        mode,
        backupFilePath: filePath,
        collections: Object.keys(nextState.collections || {}).length,
        dynamicCollections: Object.keys(nextState.dynamicCollections || {}).length,
        items: Object.keys(nextState.items || {}).length
      }
    };
  }
);

registerTool(
  "swm_sync_extension_state_incremental",
  {
    description: "Incrementally sync extension state JSON object (steamWishlistCollectionsState) into MCP DB.",
    inputSchema: {
      extensionStateJson: z.string().min(2)
    }
  },
  async ({ extensionStateJson }) => {
    const parsed = JSON.parse(String(extensionStateJson || "{}"));
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid extension state payload.");
    }
    const incoming = toNormalizedStateFromExtensionState(parsed);
    const current = await readState();
    const nextState = await writeState(mergeStates(current, incoming));
    return {
      content: [{ type: "text", text: "Incremental sync applied." }],
      structuredContent: {
        collections: Object.keys(nextState.collections || {}).length,
        dynamicCollections: Object.keys(nextState.dynamicCollections || {}).length,
        items: Object.keys(nextState.items || {}).length
      }
    };
  }
);

registerTool(
  "swm_query_games_with_codex",
  {
    description: "Use Codex to answer a natural-language query over local game catalog and return matching appIds.",
    inputSchema: {
      query: z.string().min(2),
      limit: z.number().int().min(1).max(100).default(20)
    }
  },
  async ({ query, limit }) => {
    const state = await readState();
    const catalog = buildGamesCatalog(state);
    if (catalog.length === 0) {
      throw new Error("Catalog is empty. Import extension backup first.");
    }
    const result = await queryCodexForGames({ query, limit, catalog });
    return {
      content: [{ type: "text", text: `Codex selected ${result.appIds.length} games.` }],
      structuredContent: {
        query: String(query),
        ...result
      }
    };
  }
);

registerTool(
  "swm_refresh_wishlist_rank",
  {
    description: "Refresh wishlist rank from extension caches first (fallback to Steam API only if needed).",
    inputSchema: {
      steamId: z.string().regex(STEAM_ID_RE),
      force: z.boolean().default(false)
    }
  },
  async ({ steamId, force }) => {
    const sid = validateSteamId(steamId);
    const state = await readState();
    const extWishlist = isObject(state.extensionCaches?.wishlistAdded) ? state.extensionCaches.wishlistAdded : {};
    const extHasRank = Array.isArray(extWishlist.orderedAppIds) && extWishlist.orderedAppIds.length > 0;
    if (extHasRank && (!force || state.wishlistRank.totalCount === 0)) {
      extWishlist.steamId = sid;
      const applied = applyExtensionCachesToState(state);
      state.wishlistRank.steamId = sid;
      state.wishlistRank.lastError = "";
      await updateSyncStatus(state, {
        phase: "idle",
        done: applied.rankCount,
        total: applied.rankCount,
        lastError: ""
      });
      await writeState(state);
      return {
        content: [{ type: "text", text: `Wishlist rank refreshed from extension cache: ${applied.rankCount} items.` }],
        structuredContent: {
          steamId: sid,
          source: "extension-cache",
          totalCount: applied.rankCount,
          first10: state.wishlistRank.orderedAppIds.slice(0, 10),
          syncedAt: state.wishlistRank.syncedAt
        }
      };
    }

    const ageMs = now() - Number(state.wishlistRank?.syncedAt || 0);
    if (!force && state.wishlistRank?.steamId === sid && ageMs < 24 * 60 * 60 * 1000 && state.wishlistRank.orderedAppIds.length > 0) {
      return {
        content: [{ type: "text", text: "Wishlist rank is fresh; skipped refresh." }],
        structuredContent: {
          skipped: true,
          syncedAt: state.wishlistRank.syncedAt,
          totalCount: state.wishlistRank.totalCount
        }
      };
    }
    const request = requestExtensionSync(state, ["wishlist-rank"], "Missing/old wishlist rank cache in MCP DB.");
    await writeState(state);
    return {
      content: [{ type: "text", text: "Rank refresh requires extension sync." }],
      structuredContent: {
        steamId: sid,
        source: "extension-required",
        ...request
      }
    };
  }
);

registerTool(
  "swm_refresh_wishlist_data",
  {
    description: "Refresh wishlist metadata from extension caches first (fallback to Steam endpoint only if needed).",
    inputSchema: {
      steamId: z.string().regex(STEAM_ID_RE),
      maxPages: z.number().int().min(1).max(500).default(60),
      force: z.boolean().default(false)
    }
  },
  async ({ steamId, maxPages, force }) => {
    const sid = validateSteamId(steamId);
    const state = await readState();
    const hasExtensionMeta = isObject(state.extensionCaches?.metaCache) && Object.keys(state.extensionCaches.metaCache).length > 0;
    if (hasExtensionMeta && (!force || Object.keys(state.wishlistData.byAppId || {}).length === 0)) {
      if (isObject(state.extensionCaches.wishlistAdded)) {
        state.extensionCaches.wishlistAdded.steamId = sid;
      }
      const applied = applyExtensionCachesToState(state);
      state.wishlistData.steamId = sid;
      await updateSyncStatus(state, {
        phase: "idle",
        done: Object.keys(state.wishlistData.byAppId || {}).length,
        total: Object.keys(state.wishlistData.byAppId || {}).length,
        lastError: ""
      });
      await writeState(state);
      return {
        content: [{ type: "text", text: `Wishlist data refreshed from extension cache: ${Object.keys(state.wishlistData.byAppId || {}).length} apps.` }],
        structuredContent: {
          steamId: sid,
          source: "extension-cache",
          appCount: Object.keys(state.wishlistData.byAppId || {}).length,
          mergedMeta: applied.mergedMeta,
          syncedAt: state.wishlistData.syncedAt
        }
      };
    }
    const ageMs = now() - Number(state.wishlistData?.syncedAt || 0);
    if (!force && state.wishlistData?.steamId === sid && ageMs < 24 * 60 * 60 * 1000 && Object.keys(state.wishlistData.byAppId || {}).length > 0) {
      return {
        content: [{ type: "text", text: "Wishlist data is fresh; skipped refresh." }],
        structuredContent: {
          skipped: true,
          syncedAt: state.wishlistData.syncedAt,
          appCount: Object.keys(state.wishlistData.byAppId || {}).length
        }
      };
    }
    const request = requestExtensionSync(
      state,
      ["wishlist-data", "meta-cache"],
      `Missing/old wishlist metadata cache in MCP DB (maxPages requested: ${Number(maxPages || 0)}).`
    );
    await writeState(state);
    return {
      content: [{ type: "text", text: "Wishlist data refresh requires extension sync." }],
      structuredContent: {
        steamId: sid,
        source: "extension-required",
        ...request
      }
    };
  }
);

registerTool(
  "swm_refresh_appdetails",
  {
    description: "Refresh appdetails from extension meta cache first (fallback to Steam appdetails only if needed).",
    inputSchema: {
      source: z.enum(["wishlist-rank", "items", "all-known"]).default("wishlist-rank"),
      appIdsCsv: z.string().optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(1000).default(200),
      onlyMissing: z.boolean().default(true)
    }
  },
  async ({ source, appIdsCsv, offset, limit, onlyMissing }) => {
    const state = await readState();
    const hasExtensionMeta = isObject(state.extensionCaches?.metaCache) && Object.keys(state.extensionCaches.metaCache).length > 0;
    if (hasExtensionMeta) {
      const applied = applyExtensionCachesToState(state);
      state.appdetails.syncedAt = now();
      state.appdetails.lastError = "";
      await updateSyncStatus(state, {
        phase: "idle",
        done: applied.mergedMeta,
        total: applied.mergedMeta,
        lastError: ""
      });
      await writeState(state);
      return {
        content: [{ type: "text", text: `Appdetails refreshed from extension cache: ${applied.mergedMeta} apps.` }],
        structuredContent: {
          source: "extension-cache",
          updated: applied.mergedMeta,
          failed: 0,
          total: applied.mergedMeta,
          syncedAt: state.appdetails.syncedAt
        }
      };
    }
    const request = requestExtensionSync(
      state,
      ["meta-cache", "appdetails"],
      `Missing extension meta cache for appdetails refresh (source=${source}, offset=${offset}, limit=${limit}, onlyMissing=${Boolean(onlyMissing)}).`
    );
    await writeState(state);
    return {
      content: [{ type: "text", text: "Appdetails refresh requires extension sync." }],
      structuredContent: {
        source: "extension-required",
        requestedSource: source,
        appIdsCsv: cleanText(appIdsCsv || "", 500),
        offset,
        limit,
        onlyMissing: Boolean(onlyMissing),
        ...request
      }
    };
  }
);

registerTool(
  "swm_refresh_frequencies",
  {
    description: "Recompute frequencies using extension cache seeds when present, otherwise from item metadata.",
    inputSchema: {
      source: z.enum(["wishlist-rank", "items", "all-known"]).default("wishlist-rank")
    }
  },
  async ({ source }) => {
    const state = await readState();
    const hasExtensionCounts =
      (isObject(state.extensionCaches?.tagCounts) && Object.keys(state.extensionCaches.tagCounts).length > 0) ||
      (isObject(state.extensionCaches?.typeCounts) && Object.keys(state.extensionCaches.typeCounts).length > 0) ||
      (isObject(state.extensionCaches?.extraCounts) && Object.keys(state.extensionCaches.extraCounts).length > 0);
    if (hasExtensionCounts) {
      applyExtensionCachesToState(state);
      state.frequencies.syncedAt = now();
      state.frequencies.source = "extension-caches";
      await updateSyncStatus(state, {
        phase: "idle",
        done: 1,
        total: 1,
        lastError: ""
      });
      await writeState(state);
      return {
        content: [{ type: "text", text: "Frequencies loaded from extension caches." }],
        structuredContent: {
          source: "extension-caches",
          syncedAt: state.frequencies.syncedAt,
          bucketSizes: {
            tags: Object.keys(state.frequencies.tags).length,
            type: Object.keys(state.frequencies.type).length,
            languages: Object.keys(state.frequencies.languages).length,
            fullAudioLanguages: Object.keys(state.frequencies.fullAudioLanguages).length,
            platforms: Object.keys(state.frequencies.platforms).length,
            features: Object.keys(state.frequencies.features).length,
            developers: Object.keys(state.frequencies.developers).length,
            publishers: Object.keys(state.frequencies.publishers).length,
            releaseYears: Object.keys(state.frequencies.releaseYears).length
          }
        }
      };
    }
    const request = requestExtensionSync(
      state,
      ["tag-counts", "type-counts", "extra-filter-counts"],
      `Missing extension frequency caches (source=${source}).`
    );
    await writeState(state);
    return {
      content: [{ type: "text", text: "Frequencies refresh requires extension sync." }],
      structuredContent: {
        source: "extension-required",
        requestedSource: source,
        ...request
      }
    };
  }
);

registerTool(
  "swm_get_sync_status",
  {
    description: "Get latest sync status and high-level cache timestamps.",
    inputSchema: {}
  },
  async () => {
    const state = await readState();
    return {
      content: [{ type: "text", text: `Sync phase: ${state.syncStatus.phase}` }],
      structuredContent: {
        syncStatus: state.syncStatus,
        wishlistRankSyncedAt: state.wishlistRank.syncedAt,
        wishlistDataSyncedAt: state.wishlistData.syncedAt,
        appdetailsSyncedAt: state.appdetails.syncedAt,
        frequenciesSyncedAt: state.frequencies.syncedAt
      }
    };
  }
);

registerTool(
  "swm_get_wishlist_snapshot",
  {
    description: "Get consolidated snapshot for UI consumption (rank + items + frequencies).",
    inputSchema: {
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(500).default(100)
    }
  },
  async ({ offset, limit }) => {
    const state = await readState();
    const rankIds = state.wishlistRank?.orderedAppIds || [];
    const fallbackIds = Object.keys(state.items || {}).sort((a, b) => {
      const ta = cleanText(state.items?.[a]?.title || "", 180);
      const tb = cleanText(state.items?.[b]?.title || "", 180);
      return ta.localeCompare(tb, "en", { sensitivity: "base" });
    });

    const orderedIds = rankIds.length > 0 ? rankIds : fallbackIds;
    const pageIds = orderedIds.slice(offset, offset + limit);
    const rows = pageIds.map((appId) => ({
      appId,
      priority: state.wishlistRank?.priorityByAppId?.[appId] ?? null,
      dateAdded: state.wishlistRank?.dateAddedByAppId?.[appId] ?? null,
      item: state.items?.[appId] || null
    }));

    return {
      content: [{ type: "text", text: `Snapshot rows: ${rows.length}/${orderedIds.length}` }],
      structuredContent: {
        total: orderedIds.length,
        offset,
        limit,
        rows,
        frequencies: state.frequencies,
        syncStatus: state.syncStatus
      }
    };
  }
);

async function runRefreshAllPipeline({
  steamId,
  rankForce = false,
  wishlistDataForce = false,
  appdetailsSource = "wishlist-rank",
  appdetailsOnlyMissing = true,
  appdetailsLimit = 1000,
  wishlistDataMaxPages = 60,
  continueOnError = true
}) {
  const sid = validateSteamId(steamId);
  const report = [];
  const pipelineParams = {
    steamId: sid,
    rankForce: Boolean(rankForce),
    wishlistDataForce: Boolean(wishlistDataForce),
    appdetailsSource: String(appdetailsSource || "wishlist-rank"),
    appdetailsOnlyMissing: Boolean(appdetailsOnlyMissing),
    appdetailsLimit: Number(appdetailsLimit) || 1000,
    wishlistDataMaxPages: Number(wishlistDataMaxPages) || 60,
    continueOnError: Boolean(continueOnError)
  };

  const persistPipelineMeta = async (step = "") => {
    const live = await readState();
    live.syncStatus.lastPipelineAt = now();
    live.syncStatus.lastCompletedStep = step;
    live.syncStatus.lastPipelineParams = pipelineParams;
    live.syncStatus.lastPipelineReport = report.slice(-20);
    await writeState(live);
  };

  await persistPipelineMeta("");

  const runStep = async (stepName, toolName, args) => {
    try {
      const handler = toolHandlers.get(toolName);
      if (typeof handler !== "function") {
        throw new Error(`Tool handler not found: ${toolName}`);
      }
      const result = await handler(args || {});
      report.push({ step: stepName, ok: true, result: result?.structuredContent ?? result });
      await persistPipelineMeta(stepName);
      return result;
    } catch (error) {
      const message = cleanText(error?.message || `${stepName} failed`, 240);
      report.push({ step: stepName, ok: false, error: message });
      await persistPipelineMeta(stepName);
      if (!continueOnError) {
        throw error;
      }
      return null;
    }
  };

  await runStep("wishlist-rank", "swm_refresh_wishlist_rank", { steamId: sid, force: rankForce });
  await runStep("wishlist-data", "swm_refresh_wishlist_data", { steamId: sid, maxPages: wishlistDataMaxPages, force: wishlistDataForce });
  await runStep("appdetails", "swm_refresh_appdetails", {
    source: appdetailsSource,
    offset: 0,
    limit: appdetailsLimit,
    onlyMissing: appdetailsOnlyMissing
  });
  await runStep("frequencies", "swm_refresh_frequencies", { source: "wishlist-rank" });

  const finalState = await readState();
  await updateSyncStatus(finalState, {
    phase: "idle",
    lastError: continueOnError ? "" : finalState.syncStatus.lastError
  });
  finalState.syncStatus.lastPipelineAt = now();
  finalState.syncStatus.lastPipelineParams = pipelineParams;
  finalState.syncStatus.lastPipelineReport = report.slice(-20);
  await writeState(finalState);

  const failedSteps = report.filter((step) => !step.ok).length;
  const requiresExtensionSync = report.some((step) => step?.result?.requiresExtensionSync);
  return {
    content: [{ type: "text", text: `Refresh pipeline finished. steps=${report.length}, failed=${failedSteps}` }],
    structuredContent: {
      steamId: sid,
      report,
      failedSteps,
      requiresExtensionSync,
      syncStatus: finalState.syncStatus
    }
  };
}

registerTool(
  "swm_refresh_all",
  {
    description: "Run full refresh pipeline: wishlist rank -> wishlist data -> appdetails -> frequencies.",
    inputSchema: {
      steamId: z.string().regex(STEAM_ID_RE),
      rankForce: z.boolean().default(false),
      wishlistDataForce: z.boolean().default(false),
      appdetailsSource: z.enum(["wishlist-rank", "items", "all-known"]).default("wishlist-rank"),
      appdetailsOnlyMissing: z.boolean().default(true),
      appdetailsLimit: z.number().int().min(1).max(3000).default(1000),
      wishlistDataMaxPages: z.number().int().min(1).max(500).default(60),
      continueOnError: z.boolean().default(true)
    }
  },
  async ({
    steamId,
    rankForce,
    wishlistDataForce,
    appdetailsSource,
    appdetailsOnlyMissing,
    appdetailsLimit,
    wishlistDataMaxPages,
    continueOnError
  }) => {
    return runRefreshAllPipeline({
      steamId,
      rankForce,
      wishlistDataForce,
      appdetailsSource,
      appdetailsOnlyMissing,
      appdetailsLimit,
      wishlistDataMaxPages,
      continueOnError
    });
  }
);

registerTool(
  "swm_refresh_all_resume",
  {
    description: "Resume last refresh pipeline using saved parameters from previous run.",
    inputSchema: {
      continueOnError: z.boolean().optional()
    }
  },
  async ({ continueOnError }) => {
    const state = await readState();
    const params = isObject(state.syncStatus?.lastPipelineParams) ? { ...state.syncStatus.lastPipelineParams } : null;
    if (!params || !params.steamId) {
      throw new Error("No previous refresh pipeline parameters found.");
    }
    if (typeof continueOnError === "boolean") {
      params.continueOnError = continueOnError;
    }
    return runRefreshAllPipeline(params);
  }
);

registerTool(
  "swm_refresh_all_status_verbose",
  {
    description: "Get verbose refresh-all status for UI dashboards.",
    inputSchema: {
      maxReportItems: z.number().int().min(1).max(50).default(20)
    }
  },
  async ({ maxReportItems }) => {
    const state = await readState();
    const sync = state.syncStatus || {};
    const report = Array.isArray(sync.lastPipelineReport) ? sync.lastPipelineReport.slice(-maxReportItems) : [];
    const lastSuccess = report.findLast ? report.findLast((step) => step && step.ok) : [...report].reverse().find((step) => step && step.ok);
    const lastFailure = report.findLast ? report.findLast((step) => step && !step.ok) : [...report].reverse().find((step) => step && !step.ok);
    const hasRun = Number(sync.lastPipelineAt || 0) > 0;
    const lastRunAt = Number(sync.lastPipelineAt || 0) || null;
    const ageMs = lastRunAt ? Math.max(0, now() - lastRunAt) : null;

    const summary = {
      phase: cleanText(sync.phase || "idle", 80),
      progress: Number(sync.progress || 0),
      done: Number(sync.done || 0),
      total: Number(sync.total || 0),
      running: cleanText(sync.phase || "idle", 80) !== "idle",
      hasRun,
      lastRunAt,
      lastRunAgeMs: ageMs,
      lastCompletedStep: cleanText(sync.lastCompletedStep || "", 120),
      lastError: cleanText(sync.lastError || "", 240),
      lastSuccessStep: cleanText(lastSuccess?.step || "", 120),
      lastFailureStep: cleanText(lastFailure?.step || "", 120),
      wishlistRankSyncedAt: Number(state.wishlistRank?.syncedAt || 0) || null,
      wishlistDataSyncedAt: Number(state.wishlistData?.syncedAt || 0) || null,
      appdetailsSyncedAt: Number(state.appdetails?.syncedAt || 0) || null,
      frequenciesSyncedAt: Number(state.frequencies?.syncedAt || 0) || null,
      cachedCounts: {
        rankItems: Number(state.wishlistRank?.totalCount || 0),
        wishlistDataItems: Object.keys(state.wishlistData?.byAppId || {}).length,
        appdetailsItems: Object.keys(state.appdetails?.byAppId || {}).length,
        items: Object.keys(state.items || {}).length
      }
    };

    return {
      content: [
        {
          type: "text",
          text: `Refresh status: phase=${summary.phase}, progress=${summary.progress}% (${summary.done}/${summary.total})`
        }
      ],
      structuredContent: {
        summary,
        lastPipelineParams: isObject(sync.lastPipelineParams) ? sync.lastPipelineParams : null,
        report
      }
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

async function runCliMode(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  if (args.includes("--list-tools")) {
    const tools = Array.from(toolHandlers.keys()).sort();
    console.log(JSON.stringify({ tools }, null, 2));
    return;
  }

  const runIdx = args.indexOf("--run-tool");
  if (runIdx >= 0) {
    const name = String(args[runIdx + 1] || "").trim();
    const rawArgs = String(args[runIdx + 2] || "{}");
    if (!name) {
      throw new Error("Missing tool name after --run-tool.");
    }
    const handler = toolHandlers.get(name);
    if (!handler) {
      throw new Error(`Tool not found: ${name}`);
    }
    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(rawArgs);
    } catch {
      throw new Error("Invalid JSON args for --run-tool.");
    }
    const schema = z.object(toolSchemas.get(name) || {}).passthrough();
    const validatedArgs = schema.parse(parsedArgs || {});
    const result = await handler(validatedArgs);
    console.log(JSON.stringify(result?.structuredContent ?? result ?? {}, null, 2));
    return;
  }

  console.log(
    [
      "Steam Wishlist Manager MCP",
      "Usage:",
      "  node mcp/server.mjs --list-tools",
      "  node mcp/server.mjs --run-tool <tool-name> '{\"arg\":\"value\"}'"
    ].join("\n")
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const argv = process.argv.slice(2);
  const isCliMode = argv.includes("--list-tools") || argv.includes("--run-tool");
  const runner = isCliMode ? runCliMode(argv) : main();
  runner.catch((error) => {
    console.error("MCP server error:", error);
    process.exit(1);
  });
}

export {
  normalizeState,
  mergeStates,
  computeWishlistOrder,
  parseReleaseYear,
  computeFrequenciesFromIds,
  collectTargetAppIds
};
