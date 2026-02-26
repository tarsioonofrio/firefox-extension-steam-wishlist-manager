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
    setTimeout,
    clearTimeout
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
    "100": { titleText: "Arc Raiders", tags: ["Shooter"], appType: "Game", discountPercent: 20, releaseUnix: 1704067200 },
    "101": { titleText: "Pragmata", tags: ["Sci-fi"], appType: "Game", discountPercent: 0, releaseUnix: 1735689600 },
    "102": { titleText: "Ghost", tags: ["Action"], appType: "Game", discountPercent: 50, releaseUnix: 1711929600 }
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
    selectedReleaseYears: new Set(["2024"]),
    ratingMin: 0,
    ratingMax: 100,
    reviewsMin: 0,
    reviewsMax: 999999999,
    discountMin: 0,
    discountMax: 100,
    priceMin: 0,
    priceMax: 9999999
  });

  assert.deepEqual(Array.from(result), ["102", "100"]);
}

function main() {
  const context = makeContext();
  loadModule("src/pages/wishlist-rank.js", context);
  loadModule("src/pages/wishlist-sort.js", context);
  loadModule("src/pages/collections-filters.js", context);

  testWishlistRank(context);
  testWishlistSort(context);
  testCollectionsFilters(context);
  console.log("module smoke ok");
}

main();
