import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const ROOT = process.cwd();

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function createStorage(initialData = {}) {
  const data = { ...initialData };
  return {
    async get(keys) {
      if (typeof keys === "string") {
        return { [keys]: data[keys] };
      }
      if (Array.isArray(keys)) {
        const out = {};
        for (const key of keys) {
          out[key] = data[key];
        }
        return out;
      }
      if (keys && typeof keys === "object") {
        const out = {};
        for (const [key, fallback] of Object.entries(keys)) {
          out[key] = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback;
        }
        return out;
      }
      return { ...data };
    },
    async set(patch) {
      Object.assign(data, patch || {});
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) {
        delete data[key];
      }
    },
    _dump() {
      return { ...data };
    }
  };
}

function createRuntime(state) {
  return {
    async sendMessage(message) {
      const type = String(message?.type || "");
      if (type === "get-state") {
        return JSON.parse(JSON.stringify(state));
      }
      if (type === "set-active-collection") {
        state.activeCollection = String(message?.activeCollection || "__all__");
        return { ok: true };
      }
      if (type === "remove-item-from-collection") {
        const collectionName = String(message?.collectionName || "");
        const appId = String(message?.appId || "");
        const list = Array.isArray(state.collections?.[collectionName]) ? state.collections[collectionName] : [];
        state.collections[collectionName] = list.filter((id) => String(id) !== appId);
        if (state.items?.[appId]) {
          delete state.items[appId];
        }
        return { ok: true };
      }
      if (type === "add-collection") {
        const name = String(message?.name || "").trim();
        if (!name) {
          return { ok: false };
        }
        if (!Array.isArray(state.collectionOrder)) {
          state.collectionOrder = [];
        }
        if (!state.collections) {
          state.collections = {};
        }
        if (!state.collectionOrder.includes(name)) {
          state.collectionOrder.push(name);
        }
        if (!Array.isArray(state.collections[name])) {
          state.collections[name] = [];
        }
        return { ok: true };
      }
      if (type === "rename-collection") {
        const oldName = String(message?.oldName || "");
        const newName = String(message?.newName || "");
        if (!state.collections?.[oldName] || !newName) {
          return { ok: false };
        }
        state.collections[newName] = state.collections[oldName];
        delete state.collections[oldName];
        state.collectionOrder = (state.collectionOrder || []).map((name) => name === oldName ? newName : name);
        if (state.activeCollection === oldName) {
          state.activeCollection = newName;
        }
        return { ok: true };
      }
      if (type === "delete-collection") {
        const name = String(message?.name || "");
        delete state.collections[name];
        state.collectionOrder = (state.collectionOrder || []).filter((entry) => entry !== name);
        if (state.activeCollection === name) {
          state.activeCollection = "__all__";
        }
        return { ok: true };
      }
      return { ok: true };
    }
  };
}

function createFetchMock() {
  return async (url) => {
    const href = String(url || "");
    if (href.includes("/dynamicstore/userdata/")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            steamid: "76561198056792268",
            rgWishlist: [730, 570]
          };
        },
        async text() {
          return "";
        }
      };
    }

    if (href.includes("/api/appdetails")) {
      const appIdMatch = href.match(/appids=(\d+)/);
      const appId = appIdMatch?.[1] || "0";
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            [appId]: {
              success: true,
              data: {
                name: appId === "730" ? "Counter-Strike 2" : "Dota 2",
                type: "game",
                genres: [{ description: "Action" }, { description: "Multiplayer" }],
                release_date: { date: "21 Aug, 2012" },
                recommendations: { total: appId === "730" ? 1234567 : 2345678 },
                required_age: 0,
                categories: [{ description: "Multi-player" }],
                platforms: { windows: true, mac: true, linux: true },
                developers: ["Valve"],
                publishers: ["Valve"],
                price_overview: {
                  final: appId === "730" ? 0 : 2999,
                  discount_percent: appId === "730" ? 0 : 10,
                  final_formatted: appId === "730" ? "Free" : "R$ 29,99"
                },
                header_image: "https://cdn.example.invalid/header.jpg",
                supported_languages: "English, Portuguese - Brazil"
              }
            }
          };
        },
        async text() {
          return "";
        }
      };
    }

    if (href.includes("/appreviews/")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            query_summary: {
              total_positive: 1200000,
              total_negative: 200000
            }
          };
        },
        async text() {
          return "";
        }
      };
    }

    throw new Error(`Unexpected fetch URL in e2e smoke: ${href}`);
  };
}

function loadScript(context, relPath) {
  vm.runInContext(read(relPath), context, { filename: relPath });
}

async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("waitFor timeout");
}

async function main() {
  const html = read("src/pages/collections.html");
  const dom = new JSDOM(html, {
    url: "moz-extension://test/src/pages/collections.html",
    pretendToBeVisual: true
  });

  const initialState = {
    activeCollection: "favorites",
    collectionOrder: ["favorites"],
    collections: {
      favorites: ["730", "570"]
    },
    items: {
      "730": { title: "Counter-Strike 2" },
      "570": { title: "Dota 2" }
    }
  };

  const now = Date.now();
  const storage = createStorage({
    steamWishlistCollectionsMetaCacheV4: {
      "730": {
        titleText: "Counter-Strike 2",
        priceText: "Free",
        discountText: "0%",
        releaseText: "21/08/2012",
        tags: ["Action", "Multiplayer"]
      },
      "570": {
        titleText: "Dota 2",
        priceText: "R$ 29,99",
        discountText: "10%",
        releaseText: "09/07/2013",
        tags: ["Action", "MOBA"]
      }
    },
    steamWishlistAddedMapV3: {
      cachedAt: now,
      lastFullSyncAt: now,
      orderedAppIds: ["730", "570"],
      priorityMap: { "730": 0, "570": 1 },
      priorityCachedAt: now,
      priorityLastError: "",
      prioritySource: "wishlist-api-v1",
      prioritySourceVersion: 3,
      steamId: "76561198056792268",
      map: { "730": 1710000000, "570": 1700000000 }
    }
  });

  const browser = {
    storage: { local: storage },
    runtime: createRuntime(initialState)
  };

  const context = vm.createContext({
    window: dom.window,
    document: dom.window.document,
    console,
    browser,
    fetch: createFetchMock(),
    URL: dom.window.URL,
    URLSearchParams: dom.window.URLSearchParams,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    CustomEvent: dom.window.CustomEvent,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    Node: dom.window.Node,
    navigator: dom.window.navigator,
    location: dom.window.location,
    history: dom.window.history,
    performance: dom.window.performance,
    setTimeout,
    clearTimeout
  });

  dom.window.browser = browser;
  dom.window.fetch = context.fetch;
  dom.window.confirm = () => true;

  const scripts = [
    "src/pages/steam-fetch.js",
    "src/pages/wishlist-rank.js",
    "src/pages/wishlist-sort.js",
    "src/pages/meta-parsers.js",
    "src/pages/collections-filters.js",
    "src/pages/collections-ui-controls.js",
    "src/pages/collections-panels.js",
    "src/pages/collections-range-controls.js",
    "src/pages/collections-filter-state.js",
    "src/pages/collections-actions.js",
    "src/pages/collections-crud.js",
    "src/pages/collections-init.js",
    "src/pages/collections-selection-bindings.js",
    "src/pages/collections-general-bindings.js",
    "src/pages/collections-menu-bindings.js",
    "src/pages/collections-card-render.js",
    "src/pages/collections.js"
  ];

  for (const script of scripts) {
    loadScript(context, script);
  }

  try {
    await waitFor(() => dom.window.document.querySelectorAll("#cards .card").length === 2);
  } catch (error) {
    const statusText = dom.window.document.getElementById("status")?.textContent || "-";
    const pageInfo = dom.window.document.getElementById("page-info")?.textContent || "-";
    const cardsNow = dom.window.document.querySelectorAll("#cards .card").length;
    console.error(`e2e debug | status=${statusText} | page=${pageInfo} | cards=${cardsNow}`);
    throw error;
  }

  const collectionSelect = dom.window.document.getElementById("collection-select");
  assert.equal(collectionSelect?.value, "favorites");
  assert.ok(Array.from(collectionSelect?.options || []).some((opt) => opt.value === "__wishlist__"));

  const firstTitle = dom.window.document.querySelector("#cards .card .title")?.textContent || "";
  assert.equal(firstTitle, "Counter-Strike 2");

  const firstRemoveBtn = dom.window.document.querySelector("#cards .card .remove-btn");
  firstRemoveBtn?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

  await waitFor(() => dom.window.document.querySelectorAll("#cards .card").length === 1);

  collectionSelect.value = "__wishlist__";
  collectionSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

  await waitFor(() => {
    const btn = dom.window.document.querySelector("#cards .card .remove-btn");
    return btn && dom.window.getComputedStyle(btn).display === "none";
  });

  const cardsAfterWishlist = dom.window.document.querySelectorAll("#cards .card");
  assert.equal(cardsAfterWishlist.length, 2);

  console.log("e2e smoke ok");
}

main();
