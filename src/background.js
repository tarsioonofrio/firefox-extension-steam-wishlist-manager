const STORAGE_KEY = "steamWishlistCollectionsState";
const META_CACHE_KEY = "steamWishlistCollectionsMetaCacheV4";
const WISHLIST_ADDED_CACHE_KEY = "steamWishlistAddedMapV3";
const TAG_COUNTS_CACHE_KEY = "steamWishlistTagCountsCacheV1";
const TYPE_COUNTS_CACHE_KEY = "steamWishlistTypeCountsCacheV1";
const WISHLIST_ORDER_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const MAX_COLLECTION_NAME_LENGTH = 64;
const MAX_COLLECTIONS = 100;
const MAX_ITEMS_PER_COLLECTION = 5000;
const VALID_APP_ID_PATTERN = /^\d{1,10}$/;
let backgroundWishlistDomSyncInFlight = false;

const DEFAULT_STATE = {
  collectionOrder: [],
  collections: {},
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

  for (const collectionName of state.collectionOrder) {
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
    if (!referenced.has(appId)) {
      delete state.items[appId];
    }
  }
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

  if (!state.items || typeof state.items !== "object") {
    state.items = {};
  }

  const validCollectionOrder = [];
  const seenCollections = new Set();

  for (const collectionName of state.collectionOrder) {
    const normalized = normalizeCollectionName(collectionName);
    if (!normalized || seenCollections.has(normalized)) {
      continue;
    }
    seenCollections.add(normalized);
    validCollectionOrder.push(normalized);
  }

  const normalizedCollections = {};
  const referencedAppIds = new Set();

  for (const collectionName of validCollectionOrder) {
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
    normalizedItems[appId] = {
      appId,
      title: String(existing.title || "")
    };
  }

  return {
    collectionOrder: validCollectionOrder,
    collections: normalizedCollections,
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
}

function ensureCollection(state, name) {
  const normalized = normalizeCollectionName(name);
  if (!normalized) {
    throw new Error("Collection name is required.");
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

  for (const collectionName of state.collectionOrder) {
    const current = state.collections[collectionName] || [];
    state.collections[collectionName] = current.filter((appId) => allowed.has(appId));
  }

  cleanupOrphanItems(state);
}

function deleteCollection(state, name) {
  const normalized = normalizeCollectionName(name);
  if (!normalized || !state.collections[normalized]) {
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

  if (!from || !state.collections[from]) {
    throw new Error("Collection not found.");
  }
  if (!to) {
    throw new Error("New collection name is required.");
  }
  if (from === to) {
    return to;
  }
  if (state.collections[to]) {
    throw new Error("A collection with this name already exists.");
  }

  state.collections[to] = state.collections[from];
  delete state.collections[from];
  state.collectionOrder = state.collectionOrder.map((name) => (name === from ? to : name));

  if (state.activeCollection === from) {
    state.activeCollection = to;
  }

  return to;
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

        state.items[appId] = {
          appId,
          title: String(item.title || state.items[appId]?.title || "").slice(0, 200)
        };

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

        const selectedCollectionNames = Array.isArray(message.collectionNames)
          ? message.collectionNames.map((name) => normalizeCollectionName(name)).filter(Boolean)
          : [];
        const selectedSet = new Set(selectedCollectionNames);

        for (const collectionName of state.collectionOrder) {
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
          state.items[appId] = {
            appId,
            title: String(item.title || state.items[appId]?.title || "").slice(0, 200)
          };
        } else {
          cleanupOrphanItems(state);
        }

        await setState(state);
        return { ok: true, state };
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
            state.items[appId] = {
              appId,
              title: String(state.items[appId]?.title || "").slice(0, 200)
            };
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
          TYPE_COUNTS_CACHE_KEY
        ]);
        return { ok: true };
      }

      case "clear-all-data": {
        await browser.storage.local.clear();
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
        try {
          await syncWishlistOrderCache(true);
        } catch {
          // non-fatal: collections page will retry and surface debug info
        }
        return { ok: true, steamId };
      }

      case "sync-wishlist-order-cache": {
        try {
          return await syncWishlistOrderCache(Boolean(message.force));
        } catch (error) {
          const stored = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
          const cached = stored[WISHLIST_ADDED_CACHE_KEY] || {};
          await browser.storage.local.set({
            [WISHLIST_ADDED_CACHE_KEY]: {
              ...cached,
              priorityLastError: String(error?.message || error || "unknown sync error")
            }
          });
          return { ok: false, error: String(error?.message || error || "unknown sync error") };
        }
      }

      case "sync-wishlist-order-via-background-tab": {
        try {
          return await syncWishlistOrderViaBackgroundTab(Boolean(message.force));
        } catch (error) {
          const stored = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
          const cached = stored[WISHLIST_ADDED_CACHE_KEY] || {};
          await browser.storage.local.set({
            [WISHLIST_ADDED_CACHE_KEY]: {
              ...cached,
              priorityLastError: String(error?.message || error || "background wishlist sync failed")
            }
          });
          return { ok: false, error: String(error?.message || error || "background wishlist sync failed") };
        }
      }

      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  })();
});
