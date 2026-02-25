const STORAGE_KEY = "steamWishlistCollectionsState";

const DEFAULT_STATE = {
  collectionOrder: [],
  collections: {},
  items: {},
  activeCollection: "__all__"
};

function normalizeCollectionName(name) {
  return String(name || "").trim();
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
      if (!appId || seenIds.has(appId)) {
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

browser.runtime.onMessage.addListener((message) => {
  return (async () => {
    if (!message || typeof message !== "object") {
      throw new Error("Invalid message.");
    }

    const state = await getState();

    switch (message.type) {
      case "get-state": {
        return state;
      }

      case "set-active-collection": {
        const activeCollection = message.activeCollection || "__all__";
        state.activeCollection = activeCollection;
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

        removeFromAllCollections(state, appId);

        if (position === "start") {
          state.collections[collectionName].unshift(appId);
        } else {
          state.collections[collectionName].push(appId);
        }

        state.items[appId] = {
          appId,
          title: String(item.title || state.items[appId]?.title || "")
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

        await setState(state);
        return { ok: true, state };
      }

      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  })();
});
