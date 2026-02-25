const STORAGE_KEY = "steamWishlistCollectionsState";

const DEFAULT_STATE = {
  collectionOrder: [],
  collections: {},
  items: {},
  activeCollection: "__all__"
};

async function getState() {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return {
    ...DEFAULT_STATE,
    ...(stored[STORAGE_KEY] || {})
  };
}

async function setState(state) {
  await browser.storage.local.set({ [STORAGE_KEY]: state });
}

function normalizeCollectionName(name) {
  return String(name || "").trim();
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
          title: item.title || state.items[appId]?.title || "",
          url: item.url || state.items[appId]?.url || "",
          updatedAt: Date.now()
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
