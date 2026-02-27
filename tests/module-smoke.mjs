import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();

function loadModule(relPath, context) {
  const absPath = path.join(ROOT, relPath);
  const code = fs.readFileSync(absPath, "utf8");
  vm.runInContext(code, context, { filename: absPath });
}

function makeContext() {
  const context = vm.createContext({
    window: {},
    console,
    URL,
    location: { href: "https://store.steampowered.com/" },
    setTimeout,
    clearTimeout,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" })
  });
  return context;
}

function testWishlistRank(context) {
  const rank = context.window.SWMWishlistRank;
  assert.ok(rank, "SWMWishlistRank should be available");

  const snapshot = rank.normalizeWishlistSnapshotPayload({
    response: {
      items: [
        { appid: 10, priority: 2, date_added: 100 },
        { appid: 11, priority: 0, date_added: 500 },
        { appid: 12, priority: 1, date_added: 200 }
      ]
    }
  });

  assert.deepEqual(Array.from(snapshot.orderedAppIds), ["12", "10", "11"]);
  assert.equal(snapshot.priorityMap["12"], 0);
  assert.equal(snapshot.priorityMap["11"], 2);
}

function testWishlistSort(context) {
  const sort = context.window.SWMWishlistSort;
  assert.ok(sort, "SWMWishlistSort should be available");

  const ids = ["a", "b", "c"];
  const meta = {
    a: { titleText: "Zulu", priceFinal: 5000, priceText: "R$50,00", discountPercent: 10 },
    b: { titleText: "Alpha", priceFinal: 0, priceText: "Free", discountPercent: 0 },
    c: { titleText: "Beta", priceFinal: 2000, priceText: "R$20,00", discountPercent: 30 }
  };

  const byTitle = sort.sortIdsByMode(ids, "title", {
    getTitle: (id) => meta[id].titleText,
    getMeta: (id) => meta[id],
    getMetaNumber: (id, key, fallback = 0) => Number(meta[id]?.[key] ?? fallback),
    wishlistAddedMap: {},
    wishlistPriorityMap: {}
  });
  assert.deepEqual(Array.from(byTitle), ["b", "c", "a"]);

  const byPrice = sort.sortIdsByMode(ids, "price", {
    getTitle: (id) => meta[id].titleText,
    getMeta: (id) => meta[id],
    getMetaNumber: (id, key, fallback = 0) => Number(meta[id]?.[key] ?? fallback),
    wishlistAddedMap: {},
    wishlistPriorityMap: {}
  });
  assert.deepEqual(Array.from(byPrice), ["b", "c", "a"]);
}

function testCollectionsFilters(context) {
  const filters = context.window.SWMCollectionsFilters;
  const sort = context.window.SWMWishlistSort;
  assert.ok(filters, "SWMCollectionsFilters should be available");

  const ids = ["100", "101", "102"];
  const meta = {
    "100": { titleText: "Arc Raiders", tags: ["Shooter"], appType: "Game", discountPercent: 20, releaseUnix: 1704067200, releaseText: "Jan 1, 2024" },
    "101": { titleText: "Pragmata", tags: ["Sci-fi"], appType: "Game", discountPercent: 0, releaseUnix: 0, releaseText: "Coming soon" },
    "102": { titleText: "Ghost", tags: ["Action"], appType: "Game", discountPercent: 50, releaseUnix: 1711929600, releaseText: "Apr 1, 2024" }
  };

  const result = filters.getFilteredAndSorted(ids, {
    searchQuery: "",
    sourceMode: "collections",
    sortMode: "discount",
    wishlistSortOrders: {},
    isWishlistRankReady: () => false,
    getSortContext: () => ({
      getTitle: (id) => meta[id].titleText,
      getMeta: (id) => meta[id],
      getMetaNumber: (id, key, fallback = 0) => Number(meta[id]?.[key] ?? fallback),
      wishlistAddedMap: {},
      wishlistPriorityMap: {}
    }),
    sortUtils: sort,
    sortByWishlistPriority: (list) => list,
    getTitle: (id) => meta[id].titleText,
    getNote: () => "",
    getMeta: (id) => meta[id],
    getMetaTags: (id) => meta[id].tags,
    getMetaType: (id) => meta[id].appType,
    getMetaNumber: (id, key, fallback = 0) => Number(meta[id]?.[key] ?? fallback),
    getMetaArray: () => [],
    selectedTags: new Set(["Action", "Shooter", "Sci-fi"]),
    selectedTypes: new Set(),
    selectedPlayers: new Set(),
    selectedFeatures: new Set(),
    selectedHardware: new Set(),
    selectedAccessibility: new Set(),
    selectedPlatforms: new Set(),
    selectedLanguages: new Set(),
    selectedFullAudioLanguages: new Set(),
    selectedSubtitleLanguages: new Set(),
    selectedTechnologies: new Set(),
    selectedDevelopers: new Set(),
    selectedPublishers: new Set(),
    getReleaseFilterData: (id) => {
      const releaseText = String(meta[id].releaseText || "");
      if (releaseText.toLowerCase().includes("coming soon")) {
        return { year: 0, textLabel: "Soon" };
      }
      const unix = Number(meta[id].releaseUnix || 0);
      const year = unix > 0 ? new Date(unix * 1000).getUTCFullYear() : 0;
      return { year, textLabel: "" };
    },
    releaseTextEnabled: true,
    releaseYearRangeEnabled: false,
    releaseYearMin: 1970,
    releaseYearMax: 2030,
    ratingMin: 0,
    ratingMax: 100,
    reviewsMin: 0,
    reviewsMax: 999999999,
    discountMin: 0,
    discountMax: 100,
    priceMin: 0,
    priceMax: 9999999
  });

  assert.deepEqual(Array.from(result), ["101"]);
}

function testCollectionsFiltersSearchByNote(context) {
  const filters = context.window.SWMCollectionsFilters;
  const sort = context.window.SWMWishlistSort;
  assert.ok(filters, "SWMCollectionsFilters should be available");

  const ids = ["10", "20"];
  const meta = {
    "10": { titleText: "Game A", tags: [], appType: "Game" },
    "20": { titleText: "Game B", tags: [], appType: "Game" }
  };
  const notes = {
    "10": "coop dystopian combat",
    "20": ""
  };

  const result = filters.getFilteredAndSorted(ids, {
    searchQuery: "dystopian",
    sourceMode: "collections",
    sortMode: "title",
    wishlistSortOrders: {},
    isWishlistRankReady: () => false,
    getSortContext: () => ({
      getTitle: (id) => meta[id].titleText,
      getMeta: (id) => meta[id],
      getMetaNumber: () => 0,
      wishlistAddedMap: {},
      wishlistPriorityMap: {}
    }),
    sortUtils: sort,
    sortByWishlistPriority: (list) => list,
    getTitle: (id) => meta[id].titleText,
    getNote: (id) => notes[id] || "",
    getMeta: (id) => meta[id],
    getMetaTags: () => [],
    getMetaType: () => "Game",
    getMetaNumber: () => 0,
    getMetaArray: () => [],
    selectedTags: new Set(),
    selectedTypes: new Set(),
    selectedPlayers: new Set(),
    selectedFeatures: new Set(),
    selectedHardware: new Set(),
    selectedAccessibility: new Set(),
    selectedPlatforms: new Set(),
    selectedLanguages: new Set(),
    selectedFullAudioLanguages: new Set(),
    selectedSubtitleLanguages: new Set(),
    selectedTechnologies: new Set(),
    selectedDevelopers: new Set(),
    selectedPublishers: new Set(),
    getReleaseFilterData: () => ({ year: 2024, textLabel: "" }),
    releaseTextEnabled: false,
    releaseYearRangeEnabled: true,
    releaseYearMin: 2010,
    releaseYearMax: 2030,
    ratingMin: 0,
    ratingMax: 100,
    reviewsMin: 0,
    reviewsMax: 999999999,
    discountMin: 0,
    discountMax: 100,
    priceMin: 0,
    priceMax: 9999999
  });

  assert.deepEqual(Array.from(result), ["10"]);
}

function testLanguageAllMatchFilters(context) {
  const filters = context.window.SWMCollectionsFilters;
  const sort = context.window.SWMWishlistSort;
  assert.ok(filters, "SWMCollectionsFilters should be available");

  const ids = ["1", "2", "3"];
  const meta = {
    "1": { titleText: "A", tags: [], appType: "Game", fullAudioLanguages: ["English", "Japanese"], subtitleLanguages: ["English", "Japanese"] },
    "2": { titleText: "B", tags: [], appType: "Game", fullAudioLanguages: ["English"], subtitleLanguages: ["English", "Japanese"] },
    "3": { titleText: "C", tags: [], appType: "Game", fullAudioLanguages: ["Japanese"], subtitleLanguages: ["Japanese"] }
  };

  const result = filters.getFilteredAndSorted(ids, {
    searchQuery: "",
    sourceMode: "collections",
    sortMode: "title",
    wishlistSortOrders: {},
    isWishlistRankReady: () => false,
    getSortContext: () => ({
      getTitle: (id) => meta[id].titleText,
      getMeta: (id) => meta[id],
      getMetaNumber: () => 0,
      wishlistAddedMap: {},
      wishlistPriorityMap: {}
    }),
    sortUtils: sort,
    sortByWishlistPriority: (list) => list,
    getTitle: (id) => meta[id].titleText,
    getNote: () => "",
    getMeta: (id) => meta[id],
    getMetaTags: () => [],
    getMetaType: () => "Game",
    getMetaNumber: () => 0,
    getMetaArray: (id, key) => Array.isArray(meta[id][key]) ? meta[id][key] : [],
    selectedTags: new Set(),
    selectedTypes: new Set(),
    selectedPlayers: new Set(),
    selectedFeatures: new Set(),
    selectedHardware: new Set(),
    selectedAccessibility: new Set(),
    selectedPlatforms: new Set(),
    selectedLanguages: new Set(),
    selectedFullAudioLanguages: new Set(["English", "Japanese"]),
    selectedSubtitleLanguages: new Set(["English", "Japanese"]),
    selectedTechnologies: new Set(),
    selectedDevelopers: new Set(),
    selectedPublishers: new Set(),
    getReleaseFilterData: () => ({ year: 2024, textLabel: "" }),
    releaseTextEnabled: false,
    releaseYearRangeEnabled: true,
    releaseYearMin: 2010,
    releaseYearMax: 2030,
    ratingMin: 0,
    ratingMax: 100,
    reviewsMin: 0,
    reviewsMax: 999999999,
    discountMin: 0,
    discountMax: 100,
    priceMin: 0,
    priceMax: 9999999
  });

  assert.deepEqual(Array.from(result), ["1"]);
}

function testCollectionsActionsSelection(context) {
  const actions = context.window.SWMCollectionsActions;
  assert.ok(actions, "SWMCollectionsActions should be available");

  const wishlist = actions.resolveCollectionSelection(
    "__wishlist__",
    "__wishlist__",
    "__inbox__",
    "__track__",
    "__buy__",
    "__archive__",
    "__owned__",
    "__track_feed__"
  );
  assert.equal(wishlist.sourceMode, "wishlist");
  assert.equal(wishlist.activeCollection, "__all__");

  const feed = actions.resolveCollectionSelection(
    "__track_feed__",
    "__wishlist__",
    "__inbox__",
    "__track__",
    "__buy__",
    "__archive__",
    "__owned__",
    "__track_feed__"
  );
  assert.equal(feed.sourceMode, "collections");
  assert.equal(feed.activeCollection, "__track_feed__");
}

async function testSteamFetchTelemetry(context) {
  let calls = 0;
  context.fetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 429,
      async json() {
        return {};
      },
      async text() {
        return "";
      }
    };
  };
  const fetchUtils = context.window.SWMSteamFetch;
  assert.ok(fetchUtils, "SWMSteamFetch should be available");
  let threw = false;
  try {
    await fetchUtils.fetchJson("https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=1");
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
  const telemetry = fetchUtils.getTelemetry();
  assert.ok(telemetry.cooldownMsRemaining >= 0);
  assert.ok(Array.isArray(telemetry.endpoints));
  assert.ok(telemetry.endpoints.some((entry) => entry.endpoint === "api:GetWishlist/v1" && entry.fail > 0));
  assert.ok(calls > 1, "fetch should retry on 429");
}

async function main() {
  const context = makeContext();
  loadModule("src/pages/steam-fetch.js", context);
  loadModule("src/pages/wishlist-rank.js", context);
  loadModule("src/pages/wishlist-sort.js", context);
  loadModule("src/pages/collections-filters.js", context);
  loadModule("src/pages/collections-actions.js", context);

  testWishlistRank(context);
  testWishlistSort(context);
  testCollectionsFilters(context);
  testCollectionsFiltersSearchByNote(context);
  testLanguageAllMatchFilters(context);
  testCollectionsActionsSelection(context);
  await testSteamFetchTelemetry(context);
  console.log("module smoke ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
