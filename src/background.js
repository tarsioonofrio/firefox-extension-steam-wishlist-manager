const STORAGE_KEY = "steamWishlistCollectionsState";
const META_CACHE_KEY = "steamWishlistCollectionsMetaCacheV4";
const WISHLIST_ADDED_CACHE_KEY = "steamWishlistAddedMapV3";
const TAG_COUNTS_CACHE_KEY = "steamWishlistTagCountsCacheV1";
const TYPE_COUNTS_CACHE_KEY = "steamWishlistTypeCountsCacheV1";
const MAX_COLLECTION_NAME_LENGTH = 64;
const MAX_COLLECTIONS = 100;
const MAX_ITEMS_PER_COLLECTION = 5000;
const VALID_APP_ID_PATTERN = /^\d{1,10}$/;

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

  const senderUrl = String(sender?.url || "");
  if (!senderUrl) {
    return false;
  }

  if (/^(moz|chrome)-extension:\/\//.test(senderUrl)) {
    return senderId === browser.runtime.id;
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

      case "create-collection": {
        ensureCollection(state, message.collectionName);
        await setState(state);
        return { ok: true, state };
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

      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  })();
});
