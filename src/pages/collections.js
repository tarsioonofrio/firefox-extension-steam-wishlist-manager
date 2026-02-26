const PAGE_SIZE = 30;
const META_CACHE_KEY = "steamWishlistCollectionsMetaCacheV4";
const META_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const WISHLIST_ADDED_CACHE_KEY = "steamWishlistAddedMapV3";
const WISHLIST_FULL_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const WISHLIST_RANK_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const rankUtils = window.SWMWishlistRank;
const WISHLIST_RANK_SOURCE = rankUtils.RANK_SOURCE;
const WISHLIST_RANK_SOURCE_VERSION = rankUtils.RANK_SOURCE_VERSION;
const sortUtils = window.SWMWishlistSort;
const parserUtils = window.SWMMetaParsers;
const filtersUtils = window.SWMCollectionsFilters;
const uiControlsUtils = window.SWMCollectionsUiControls;
const panelsUtils = window.SWMCollectionsPanels;
const rangeControlsUtils = window.SWMCollectionsRangeControls;
const filterStateUtils = window.SWMCollectionsFilterState;
const actionsUtils = window.SWMCollectionsActions;
const crudUtils = window.SWMCollectionsCrud;
const initUtils = window.SWMCollectionsInit;
const selectionBindingsUtils = window.SWMCollectionsSelectionBindings;
const generalBindingsUtils = window.SWMCollectionsGeneralBindings;
const menuBindingsUtils = window.SWMCollectionsMenuBindings;
const cardRenderUtils = window.SWMCollectionsCardRender;
const TAG_COUNTS_CACHE_KEY = "steamWishlistTagCountsCacheV1";
const TAG_SEED_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const TYPE_COUNTS_CACHE_KEY = "steamWishlistTypeCountsCacheV1";
const EXTRA_FILTER_COUNTS_CACHE_KEY = "steamWishlistExtraFilterCountsCacheV2";
const TAG_SHOW_STEP = 12;
const SAFE_FETCH_CONCURRENCY = 4;
const SAFE_FETCH_CONCURRENCY_FORCE = 1;
const SAFE_FETCH_FORCE_BASE_DELAY_MS = 700;
const SAFE_FETCH_FORCE_JITTER_MS = 500;
const WISHLIST_SELECT_VALUE = "__wishlist__";
const RELEASE_YEAR_DEFAULT_MIN = 2010;
const steamFetchUtils = window.SWMSteamFetch;
// Source baseline: SteamDB tags taxonomy (static seed for fast first render).
const FILTER_SEED = {
  tags: [],
  types: ["Game", "DLC", "Demo", "Application", "Music", "Video", "Series", "Tool", "Beta", "Unknown"],
  players: ["Single-player", "Multi-player", "Co-op", "PvP", "Online PvP", "MMO"],
  features: ["Achievements", "Steam Cloud", "Trading Cards", "Leaderboards", "Remote Play Together"],
  hardware: ["Full controller support", "Tracked Controller Support", "VR Supported"],
  accessibility: ["Subtitles", "Full audio", "Captions available"],
  platforms: ["Windows", "macOS", "Linux"],
  languages: ["English", "Portuguese - Brazil", "Spanish - Spain", "French", "German", "Japanese", "Korean", "Russian", "Simplified Chinese", "Traditional Chinese"],
  technologies: ["Steam Cloud", "Steam Workshop", "Valve Anti-Cheat", "Remote Play", "HDR"],
  developers: ["Valve", "CAPCOM Co., Ltd.", "SEGA", "Ubisoft", "Square Enix", "Bandai Namco", "Electronic Arts", "Bethesda", "Larian Studios", "FromSoftware"],
  publishers: ["Valve", "CAPCOM Co., Ltd.", "SEGA", "Ubisoft", "Square Enix", "Bandai Namco", "Electronic Arts", "Bethesda", "Sony Interactive Entertainment"],
  releaseYears: ["2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "2017", "2016", "2015"],
  releaseTexts: ["TBA", "Soon"]
};
const STEAMDB_TAGS_JSON_PATH = "src/data/steamdb-tags-hardcoded.json";
const STEAM_FILTER_SEEDS_JSON_PATH = "src/data/steam-filter-seeds-hardcoded.json";

let state = null;
let activeCollection = "__all__";
let sourceMode = "collections";
let page = 1;
let searchQuery = "";
let sortMode = "position";
let viewMode = "card";

let metaCache = {};
let wishlistAddedMap = {};
let wishlistOrderedAppIds = [];
let wishlistPriorityMap = {};
let wishlistPriorityCachedAt = 0;
let wishlistPriorityLastError = "";
let wishlistPrioritySource = "";
let wishlistPrioritySourceVersion = 0;
let wishlistOrderSyncResult = "";
let wishlistSteamId = "";
let wishlistSortSignature = "";
let wishlistSortOrders = {};
let wishlistSnapshotDay = "";
let wishlistMetaSyncInFlight = false;
let currentRenderedPageIds = [];

let selectedTags = new Set();
let tagSearchQuery = "";
let tagShowLimit = TAG_SHOW_STEP;
let tagCounts = [];
let tagCountsSource = "none";
let steamDbTagSeedNames = null;
let externalFilterSeed = null;
let selectedTypes = new Set();
let typeCounts = [];
let selectedPlayers = new Set();
let playerCounts = [];
let selectedFeatures = new Set();
let featureCounts = [];
let selectedHardware = new Set();
let hardwareCounts = [];
let selectedAccessibility = new Set();
let accessibilityCounts = [];
let selectedPlatforms = new Set();
let platformCounts = [];
let selectedLanguages = new Set();
let languageCounts = [];
let languageSearchQuery = "";
let selectedFullAudioLanguages = new Set();
let fullAudioLanguageCounts = [];
let fullAudioLanguageSearchQuery = "";
let selectedSubtitleLanguages = new Set();
let subtitleLanguageCounts = [];
let subtitleLanguageSearchQuery = "";
let selectedTechnologies = new Set();
let technologyCounts = [];
let technologySearchQuery = "";
let selectedDevelopers = new Set();
let developerCounts = [];
let developerSearchQuery = "";
let selectedPublishers = new Set();
let publisherCounts = [];
let publisherSearchQuery = "";
let releaseTextEnabled = true;
let releaseYearRangeEnabled = true;
let releaseYearMin = RELEASE_YEAR_DEFAULT_MIN;
let releaseYearMax = new Date().getUTCFullYear() + 1;
let releaseYearCounts = [];
let ratingMin = 0;
let ratingMax = 100;
let reviewsMin = 0;
let reviewsMax = 999999999;
let discountMin = 0;
let discountMax = 100;
let priceMin = 0;
let priceMax = 9999999;
let filterSyncRunId = 0;
let batchMode = false;
let batchAddTargetCollection = "";
let batchSelectedIds = new Set();
let dynamicCollectionSizes = {};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function formatCompactCount(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) {
    return "0";
  }
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  }
  return String(n);
}

function parseNonNegativeInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return fallback;
  }
  return Math.floor(n);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSteamJson(url, options = {}) {
  return steamFetchUtils.fetchJson(url, options);
}

async function fetchSteamText(url, options = {}) {
  return steamFetchUtils.fetchText(url, options);
}


async function fetchWishlistSnapshotFromApi(steamId) {
  const sid = String(steamId || "").trim();
  if (!/^\d{10,20}$/.test(sid)) {
    throw new Error("Invalid steamId for wishlist API fetch.");
  }

  const payload = await fetchSteamJson(
    `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${encodeURIComponent(sid)}`,
    {
      credentials: "omit",
      cache: "no-store"
    }
  );
  const rawItems = Array.isArray(payload?.response?.items) ? payload.response.items : [];
  if (rawItems.length === 0) {
    throw new Error("Wishlist API returned no items.");
  }

  const snapshot = rankUtils.normalizeWishlistSnapshotPayload(payload);
  if (!Array.isArray(snapshot.orderedAppIds) || snapshot.orderedAppIds.length === 0) {
    throw new Error("Wishlist API returned no valid appids.");
  }
  return snapshot;
}

function setStatus(text, isError = false) {
  const el = document.getElementById("status");
  if (!el) {
    return;
  }
  el.textContent = text;
  el.style.color = isError ? "#ff9696" : "";
}

function invalidateWishlistPrecomputedSorts() {
  wishlistSortSignature = "";
  wishlistSortOrders = {};
  wishlistSnapshotDay = "";
}

function normalizeCollectionName(name) {
  return String(name || "").replace(/\s+/g, " ").trim().slice(0, 64);
}

function formatUnixDate(timestamp) {
  const n = Number(timestamp || 0);
  if (!Number.isFinite(n) || n <= 0) {
    return "-";
  }
  return new Date(n * 1000).toLocaleDateString("pt-BR");
}

function isWishlistRankReady(appIds = null) {
  return rankUtils.isRankReady(
    {
      prioritySource: wishlistPrioritySource,
      prioritySourceVersion: wishlistPrioritySourceVersion,
      orderedAppIds: wishlistOrderedAppIds,
      priorityMap: wishlistPriorityMap
    },
    Array.isArray(appIds) ? appIds : Object.keys(wishlistAddedMap || {})
  );
}

function getWishlistRankUnavailableReason() {
  return rankUtils.getUnavailableReason({
    prioritySource: wishlistPrioritySource,
    prioritySourceVersion: wishlistPrioritySourceVersion,
    priorityLastError: wishlistPriorityLastError
  });
}

function isDynamicCollectionName(name) {
  const key = String(name || "").trim();
  return Boolean(state?.dynamicCollections?.[key]);
}

function getStaticCollectionNames() {
  return (state?.collectionOrder || []).filter((name) => {
    if (isDynamicCollectionName(name)) {
      return false;
    }
    return Array.isArray(state?.collections?.[name]);
  });
}

function getDynamicCollectionNames() {
  return Object.keys(state?.dynamicCollections || {});
}

function getExistingCollectionNames() {
  return state?.collectionOrder || [];
}

function exportCurrentFilterSnapshot() {
  return {
    selectedTags: Array.from(selectedTags),
    selectedTypes: Array.from(selectedTypes),
    selectedPlayers: Array.from(selectedPlayers),
    selectedFeatures: Array.from(selectedFeatures),
    selectedHardware: Array.from(selectedHardware),
    selectedAccessibility: Array.from(selectedAccessibility),
    selectedPlatforms: Array.from(selectedPlatforms),
    selectedLanguages: Array.from(selectedLanguages),
    selectedFullAudioLanguages: Array.from(selectedFullAudioLanguages),
    selectedSubtitleLanguages: Array.from(selectedSubtitleLanguages),
    selectedTechnologies: Array.from(selectedTechnologies),
    selectedDevelopers: Array.from(selectedDevelopers),
    selectedPublishers: Array.from(selectedPublishers),
    ratingMin,
    ratingMax,
    reviewsMin,
    reviewsMax,
    discountMin,
    discountMax,
    priceMin,
    priceMax,
    releaseTextEnabled,
    releaseYearRangeEnabled,
    releaseYearMin,
    releaseYearMax
  };
}

function applyFilterSnapshot(snapshot) {
  const data = snapshot && typeof snapshot === "object" ? snapshot : {};
  selectedTags = new Set(Array.isArray(data.selectedTags) ? data.selectedTags : []);
  selectedTypes = new Set(Array.isArray(data.selectedTypes) ? data.selectedTypes : []);
  selectedPlayers = new Set(Array.isArray(data.selectedPlayers) ? data.selectedPlayers : []);
  selectedFeatures = new Set(Array.isArray(data.selectedFeatures) ? data.selectedFeatures : []);
  selectedHardware = new Set(Array.isArray(data.selectedHardware) ? data.selectedHardware : []);
  selectedAccessibility = new Set(Array.isArray(data.selectedAccessibility) ? data.selectedAccessibility : []);
  selectedPlatforms = new Set(Array.isArray(data.selectedPlatforms) ? data.selectedPlatforms : []);
  selectedLanguages = new Set(Array.isArray(data.selectedLanguages) ? data.selectedLanguages : []);
  selectedFullAudioLanguages = new Set(Array.isArray(data.selectedFullAudioLanguages) ? data.selectedFullAudioLanguages : []);
  selectedSubtitleLanguages = new Set(Array.isArray(data.selectedSubtitleLanguages) ? data.selectedSubtitleLanguages : []);
  selectedTechnologies = new Set(Array.isArray(data.selectedTechnologies) ? data.selectedTechnologies : []);
  selectedDevelopers = new Set(Array.isArray(data.selectedDevelopers) ? data.selectedDevelopers : []);
  selectedPublishers = new Set(Array.isArray(data.selectedPublishers) ? data.selectedPublishers : []);
  ratingMin = parseNonNegativeInt(data.ratingMin, 0);
  ratingMax = parseNonNegativeInt(data.ratingMax, 100);
  reviewsMin = parseNonNegativeInt(data.reviewsMin, 0);
  reviewsMax = parseNonNegativeInt(data.reviewsMax, 999999999);
  discountMin = parseNonNegativeInt(data.discountMin, 0);
  discountMax = parseNonNegativeInt(data.discountMax, 100);
  priceMin = Number.isFinite(Number(data.priceMin)) ? Number(data.priceMin) : 0;
  priceMax = Number.isFinite(Number(data.priceMax)) ? Number(data.priceMax) : 9999999;
  releaseTextEnabled = Boolean(data.releaseTextEnabled);
  releaseYearRangeEnabled = Boolean(data.releaseYearRangeEnabled);
  releaseYearMin = Number.isFinite(Number(data.releaseYearMin)) ? Number(data.releaseYearMin) : RELEASE_YEAR_DEFAULT_MIN;
  releaseYearMax = Number.isFinite(Number(data.releaseYearMax)) ? Number(data.releaseYearMax) : getReleaseYearMaxBound();
}

function buildDynamicDefinitionFromCurrentView() {
  let baseSource = "wishlist";
  let baseCollection = "";
  if (sourceMode === "wishlist") {
    baseSource = "wishlist";
  } else if (activeCollection === "__all__") {
    baseSource = "all-static";
  } else if (isDynamicCollectionName(activeCollection)) {
    const currentDef = state?.dynamicCollections?.[activeCollection] || {};
    baseSource = String(currentDef.baseSource || "wishlist");
    baseCollection = String(currentDef.baseCollection || "");
  } else {
    baseSource = "static-collection";
    baseCollection = activeCollection;
  }
  return {
    baseSource,
    baseCollection,
    sortMode,
    filters: exportCurrentFilterSnapshot()
  };
}

function getDynamicBaseIds(definition, stack = new Set()) {
  const def = definition && typeof definition === "object" ? definition : {};
  const baseSource = String(def.baseSource || "wishlist");
  const baseCollection = String(def.baseCollection || "").trim();

  if (baseSource === "wishlist") {
    return wishlistOrderedAppIds.length > 0 ? [...wishlistOrderedAppIds] : Object.keys(wishlistAddedMap);
  }

  if (baseSource === "static-collection") {
    return Array.isArray(state?.collections?.[baseCollection]) ? [...state.collections[baseCollection]] : [];
  }

  const all = [];
  for (const name of getStaticCollectionNames()) {
    for (const id of state?.collections?.[name] || []) {
      all.push(id);
    }
  }
  return Array.from(new Set(all));
}

function getDynamicCollectionAppIds(name, stack = new Set()) {
  const collectionName = String(name || "").trim();
  if (!collectionName || stack.has(collectionName)) {
    return [];
  }
  const definition = state?.dynamicCollections?.[collectionName];
  if (!definition) {
    return [];
  }
  const nextStack = new Set(stack);
  nextStack.add(collectionName);
  const baseIds = getDynamicBaseIds(definition, nextStack);
  const previousSortMode = sortMode;
  const previousSourceMode = sourceMode;
  const previousSearchQuery = searchQuery;
  const previousPage = page;
  const previousActiveCollection = activeCollection;
  const previousSnapshot = exportCurrentFilterSnapshot();
  try {
    sourceMode = "collections";
    activeCollection = collectionName;
    sortMode = String(definition.sortMode || "title");
    searchQuery = "";
    page = 1;
    applyFilterSnapshot(definition.filters || {});
    return getFilteredAndSorted(baseIds);
  } finally {
    sortMode = previousSortMode;
    sourceMode = previousSourceMode;
    searchQuery = previousSearchQuery;
    page = previousPage;
    activeCollection = previousActiveCollection;
    applyFilterSnapshot(previousSnapshot);
  }
}

function getCurrentSourceAppIds() {
  if (sourceMode === "wishlist") {
    if (wishlistOrderedAppIds.length > 0) {
      return [...wishlistOrderedAppIds];
    }
    return Object.keys(wishlistAddedMap);
  }

  if (!state) {
    return [];
  }

  if (activeCollection === "__all__") {
    const all = [];
    for (const name of getStaticCollectionNames()) {
      const ids = state.collections?.[name] || [];
      for (const id of ids) {
        all.push(id);
      }
    }
    return Array.from(new Set(all));
  }

  if (isDynamicCollectionName(activeCollection)) {
    return getDynamicCollectionAppIds(activeCollection);
  }

  return [...(state.collections?.[activeCollection] || [])];
}

function hashStringToUint32(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildWishlistSignature(appIds) {
  const ids = Array.isArray(appIds) ? appIds : [];
  let acc = 2166136261;
  for (let index = 0; index < ids.length; index += 1) {
    const appId = ids[index];
    const added = Number(wishlistAddedMap?.[appId] || 0);
    acc ^= hashStringToUint32(`${index}:${appId}:${added}`);
    acc = Math.imul(acc, 16777619);
  }
  return `${ids.length}:${acc >>> 0}`;
}

function getSortContext() {
  return {
    getTitle: (appId) => String(state?.items?.[appId]?.title || metaCache?.[appId]?.titleText || appId),
    getMetaNumber: (appId, key, fallback = 0) => getMetaNumber(appId, key, fallback),
    getMeta: (appId) => metaCache?.[appId] || {},
    wishlistAddedMap,
    wishlistPriorityMap
  };
}

function sortByWishlistPriority(appIds) {
  return sortUtils.sortByWishlistPriority(appIds, wishlistPriorityMap);
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

function buildWishlistSortOrders(appIds) {
  return sortUtils.buildWishlistSortOrders(appIds, getSortContext());
}

function buildTagCacheBucketKey() {
  return "wishlist-all";
}

function getMetaTags(appId) {
  const tags = metaCache[appId]?.tags;
  return Array.isArray(tags) ? tags : [];
}

function getMetaType(appId) {
  const value = metaCache[appId]?.appType;
  return parserUtils.normalizeAppTypeLabel(value);
}

function getMetaNumber(appId, key, fallback = 0) {
  const n = Number(metaCache?.[appId]?.[key]);
  return Number.isFinite(n) ? n : fallback;
}

function getMetaArray(appId, key) {
  const value = metaCache?.[appId]?.[key];
  if (!Array.isArray(value)) {
    return [];
  }
  if (key !== "languages" && key !== "fullAudioLanguages" && key !== "subtitleLanguages") {
    return value;
  }
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    const parts = String(raw || "").split(",");
    for (const part of parts) {
      const name = String(part || "").replace(/\s+/g, " ").trim();
      if (!name) {
        continue;
      }
      const lower = name.toLowerCase();
      if (lower.includes("languages with full audio support")) {
        continue;
      }
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

function getReleaseYearMaxBound() {
  return new Date().getUTCFullYear() + 1;
}

function getReleaseYearMinBound() {
  const knownYears = [];
  for (const appId of Object.keys(metaCache || {})) {
    const info = getReleaseFilterData(appId);
    if (Number.isFinite(info.year) && info.year > 0) {
      knownYears.push(info.year);
    }
  }
  if (knownYears.length === 0) {
    return RELEASE_YEAR_DEFAULT_MIN;
  }
  return Math.min(RELEASE_YEAR_DEFAULT_MIN, ...knownYears);
}

function clampReleaseYearValue(value, fallback, minOverride = null, maxOverride = null) {
  const n = Number(value);
  const min = Number.isFinite(Number(minOverride)) ? Number(minOverride) : getReleaseYearMinBound();
  const max = Number.isFinite(Number(maxOverride)) ? Number(maxOverride) : getReleaseYearMaxBound();
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeReleaseTextFilterValue(raw) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text || text === "-") {
    return "";
  }
  const lower = text.toLowerCase();
  if (
    lower.includes("coming soon")
    || lower === "soon"
    || lower.includes("em breve")
    || lower.includes("breve")
  ) {
    return "Soon";
  }
  if (
    lower.includes("tba")
    || lower.includes("to be announced")
    || lower.includes("a definir")
    || lower.includes("a ser anunciado")
  ) {
    return "TBA";
  }
  // Text toggle should only match non-numeric release labels (e.g., TBA/Soon).
  if (/\d/.test(text)) {
    return "";
  }
  return text;
}

function extractYearFromReleaseText(raw) {
  const text = String(raw || "");
  if (!text) {
    return 0;
  }
  const match = text.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
  if (!match?.[1]) {
    return 0;
  }
  const year = Number(match[1]);
  if (!Number.isFinite(year) || year < RELEASE_YEAR_DEFAULT_MIN || year > getReleaseYearMaxBound()) {
    return 0;
  }
  return year;
}

function getReleaseFilterData(appId) {
  const meta = metaCache?.[appId] || {};
  const unix = Number(meta?.releaseUnix || 0);
  let year = 0;
  if (Number.isFinite(unix) && unix > 0) {
    const y = new Date(unix * 1000).getUTCFullYear();
    if (Number.isFinite(y) && y >= RELEASE_YEAR_DEFAULT_MIN && y <= getReleaseYearMaxBound()) {
      year = y;
    }
  }
  const releaseText = String(meta?.releaseText || "").trim();
  const textLabel = normalizeReleaseTextFilterValue(releaseText);
  if (!year) {
    year = extractYearFromReleaseText(releaseText);
  }
  return {
    year,
    textLabel
  };
}

function normalizeAppTypeLabel(value) {
  return parserUtils.normalizeAppTypeLabel(value);
}

function parseSupportedLanguages(rawHtml) {
  return parserUtils.parseSupportedLanguages(rawHtml);
}

function parseFullAudioLanguages(rawHtml) {
  return parserUtils.parseFullAudioLanguages(rawHtml);
}

function parseLooseInteger(value, fallback = 0) {
  return parserUtils.parseLooseInteger(value, fallback);
}

function extractPriceTextFromDiscountBlock(blockHtml) {
  return parserUtils.extractPriceTextFromDiscountBlock(blockHtml);
}

function isMetaIncomplete(meta) {
  if (!meta) {
    return true;
  }

  const title = String(meta.titleText || "").trim();
  const release = String(meta.releaseText || "").trim();
  const price = String(meta.priceText || "").trim();

  if (!title) {
    return true;
  }

  // Known bad cache state for games where appdetails failed/partial.
  if (release === "-" && price === "-") {
    return true;
  }

  return false;
}

async function resolveSteamIdFromStoreHtml() {
  try {
    const html = await fetchSteamText("https://store.steampowered.com/", {
      credentials: "include",
      cache: "no-store"
    });
    const match = html.match(/g_steamID\s*=\s*"(\d{10,20})"/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

async function fetchAddedTimestampsById(steamId, targetIds) {
  const out = {};
  const remaining = new Set(targetIds);
  if (!steamId || remaining.size === 0) {
    return out;
  }

  for (let pageIndex = 0; pageIndex < 200 && remaining.size > 0; pageIndex += 1) {
    const wishlistPayload = await fetchSteamJson(
      `https://store.steampowered.com/wishlist/profiles/${steamId}/wishlistdata/?p=${pageIndex}`,
      {
        credentials: "include",
        cache: "no-store"
      }
    );
    const entries = Object.entries(wishlistPayload || {});
    if (entries.length === 0) {
      break;
    }

    for (const [appId, value] of entries) {
      if (!remaining.has(appId)) {
        continue;
      }
      const added = Number(value?.added || 0);
      out[appId] = added > 0 ? added : 0;
      remaining.delete(appId);
    }
  }

  return out;
}

async function fetchWishlistIdsInPublicOrder(steamId) {
  const ordered = [];
  const seen = new Set();
  if (!steamId) {
    return ordered;
  }

  for (let pageIndex = 0; pageIndex < 200; pageIndex += 1) {
    const raw = await fetchSteamText(
      `https://store.steampowered.com/wishlist/profiles/${steamId}/wishlistdata/?p=${pageIndex}`,
      {
        credentials: "include",
        cache: "no-store"
      }
    );
    const idsInOrder = extractWishlistAppIdsInTextOrder(raw);
    if (idsInOrder.length === 0) {
      break;
    }
    for (const appId of idsInOrder) {
      if (seen.has(appId)) {
        continue;
      }
      seen.add(appId);
      ordered.push(appId);
    }
  }

  return ordered;
}

async function loadWishlistAddedMap() {
  wishlistOrderSyncResult = "cache-only (sync on wishlist page)";
  const stored = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
  const cached = stored[WISHLIST_ADDED_CACHE_KEY] || {};

  const now = Date.now();
  const effectiveCached = cached;
  const cachedMap = effectiveCached.map || {};
  const cachedOrderedIds = Array.isArray(effectiveCached.orderedAppIds)
    ? effectiveCached.orderedAppIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const cachedPriorityMap = (effectiveCached.priorityMap && typeof effectiveCached.priorityMap === "object")
    ? effectiveCached.priorityMap
    : {};
  wishlistPriorityCachedAt = Number(effectiveCached.priorityCachedAt || 0);
  wishlistPriorityLastError = String(effectiveCached.priorityLastError || "");
  wishlistPrioritySource = String(effectiveCached.prioritySource || "");
  wishlistPrioritySourceVersion = Number(effectiveCached.prioritySourceVersion || 0);
  wishlistSteamId = String(effectiveCached.steamId || "");
  const lastFullSyncAt = Number(effectiveCached.lastFullSyncAt || 0);
  const cachedPrioritySource = String(effectiveCached.prioritySource || "");
  const cachedPrioritySourceVersion = Number(effectiveCached.prioritySourceVersion || 0);
  wishlistPriorityMap = {};
  for (const [appId, priority] of Object.entries(cachedPriorityMap)) {
    const n = Number(priority);
    if (Number.isFinite(n) && n >= 0) {
      wishlistPriorityMap[String(appId)] = n;
    }
  }
  if (Object.keys(wishlistPriorityMap).length === 0 && cachedOrderedIds.length > 0) {
    for (let i = 0; i < cachedOrderedIds.length; i += 1) {
      wishlistPriorityMap[cachedOrderedIds[i]] = i;
    }
  }

  try {
    const userdata = await fetchSteamJson("https://store.steampowered.com/dynamicstore/userdata/", {
      credentials: "include",
      cache: "no-store"
    });
    let nowIds = Array.isArray(userdata?.rgWishlist)
      ? userdata.rgWishlist.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    wishlistOrderedAppIds = cachedOrderedIds.length > 0 ? [...cachedOrderedIds] : [...nowIds];
    wishlistSortSignature = "";
    wishlistSortOrders = {};
    wishlistSnapshotDay = "";
    wishlistAddedMap = { ...cachedMap };

    // If we couldn't load current wishlist, keep existing cache to avoid destructive overwrite.
    if (nowIds.length === 0 && Object.keys(cachedMap).length > 0) {
      if (wishlistOrderedAppIds.length === 0) {
        wishlistOrderedAppIds = cachedOrderedIds.length > 0 ? [...cachedOrderedIds] : Object.keys(cachedMap);
      }
      return;
    }

    let steamId = String(
      userdata?.steamid
      || userdata?.strSteamId
      || userdata?.str_steamid
      || userdata?.webapi_token_steamid
      || ""
    ).trim();
    if (!steamId) {
      steamId = await resolveSteamIdFromStoreHtml();
    }
    if (!steamId) {
      steamId = String(effectiveCached.steamId || "").trim();
    }
    const nowSet = new Set(nowIds);
    const cachedSet = new Set(cachedOrderedIds);
    let wishlistChanged = nowSet.size !== cachedSet.size;
    if (!wishlistChanged) {
      for (const id of nowSet) {
        if (!cachedSet.has(id)) {
          wishlistChanged = true;
          break;
        }
      }
    }

    const cacheHasRank = cachedOrderedIds.length > 0 && Object.keys(wishlistPriorityMap).length > 0;
    const cacheFromCurrentRankApi = cachedPrioritySource === WISHLIST_RANK_SOURCE
      && cachedPrioritySourceVersion === WISHLIST_RANK_SOURCE_VERSION;
    const rankStale = (now - wishlistPriorityCachedAt) >= WISHLIST_RANK_SYNC_INTERVAL_MS;
    const shouldRefreshRank = Boolean(steamId) && (wishlistChanged || !cacheHasRank || rankStale || !cacheFromCurrentRankApi);

    if (shouldRefreshRank) {
      setStatus("Syncing wishlist rank from API...");
      try {
        const snapshot = await fetchWishlistSnapshotFromApi(steamId);
        nowIds = [...snapshot.orderedAppIds];
        wishlistOrderedAppIds = [...snapshot.orderedAppIds];
        wishlistPriorityMap = { ...(snapshot.priorityMap || {}) };
        wishlistAddedMap = { ...(snapshot.addedMap || {}) };

        for (const [appId, rank] of Object.entries(wishlistPriorityMap)) {
          const existing = metaCache[appId] || {};
          metaCache[appId] = {
            ...existing,
            wishlistPriority: Number(rank),
            wishlistAddedAt: Number(wishlistAddedMap[appId] || 0)
          };
        }
        await saveMetaCache();
        await browser.storage.local.set({
          [WISHLIST_ADDED_CACHE_KEY]: {
            cachedAt: now,
            lastFullSyncAt: now,
            orderedAppIds: wishlistOrderedAppIds,
            priorityMap: wishlistPriorityMap,
            priorityCachedAt: now,
            priorityLastError: "",
            prioritySource: WISHLIST_RANK_SOURCE,
            prioritySourceVersion: WISHLIST_RANK_SOURCE_VERSION,
            steamId,
            map: wishlistAddedMap
          }
        });
        wishlistPrioritySource = WISHLIST_RANK_SOURCE;
        wishlistPrioritySourceVersion = WISHLIST_RANK_SOURCE_VERSION;
        setStatus("");
        return;
      } catch (error) {
        wishlistPriorityLastError = String(error?.message || error || "wishlist rank sync failed");
        setStatus(`Wishlist rank sync failed: ${wishlistPriorityLastError}`, true);
      }
    }

    // Keep cache-only state when rank refresh is not needed or fails.
    if (wishlistOrderedAppIds.length === 0) {
      wishlistOrderedAppIds = nowIds.length > 0 ? [...nowIds] : Object.keys(cachedMap);
    }
    await browser.storage.local.set({
      [WISHLIST_ADDED_CACHE_KEY]: {
        ...effectiveCached,
        cachedAt: now,
        steamId: steamId || String(effectiveCached.steamId || ""),
        orderedAppIds: wishlistOrderedAppIds,
        priorityMap: wishlistPriorityMap,
        priorityCachedAt: Number(effectiveCached.priorityCachedAt || 0),
        priorityLastError: wishlistPriorityLastError || String(effectiveCached.priorityLastError || ""),
        prioritySource: String(effectiveCached.prioritySource || ""),
        prioritySourceVersion: Number(effectiveCached.prioritySourceVersion || 0),
        map: wishlistAddedMap
      }
    });
  } catch {
    wishlistAddedMap = { ...cachedMap };
    if (wishlistOrderedAppIds.length === 0) {
      wishlistOrderedAppIds = cachedOrderedIds.length > 0 ? [...cachedOrderedIds] : Object.keys(cachedMap);
    }
    wishlistSortSignature = "";
    wishlistSortOrders = {};
    wishlistSnapshotDay = "";
  }
}

async function resolveCurrentSteamId() {
  const fromRuntimeCache = String(wishlistSteamId || "").trim();
  if (/^\d{10,20}$/.test(fromRuntimeCache)) {
    return fromRuntimeCache;
  }

  try {
    const stored = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
    const cached = stored[WISHLIST_ADDED_CACHE_KEY] || {};
    const fromStorage = String(cached.steamId || "").trim();
    if (/^\d{10,20}$/.test(fromStorage)) {
      return fromStorage;
    }
  } catch {
    // continue fallback chain
  }

  try {
    const wishlistResponse = await fetch("https://store.steampowered.com/wishlist/", {
      cache: "no-store",
      credentials: "include",
      redirect: "follow"
    });
    const redirectedUrl = String(wishlistResponse?.url || "");
    const profileMatch = redirectedUrl.match(/\/wishlist\/profiles\/(\d{10,20})/);
    if (profileMatch?.[1]) {
      return profileMatch[1];
    }
  } catch {
    // fallback below
  }

  try {
    const userdata = await fetchSteamJson("https://store.steampowered.com/dynamicstore/userdata/", {
      credentials: "include",
      cache: "no-store"
    });
    const fromUserData = String(
      userdata?.steamid
      || userdata?.strSteamId
      || userdata?.str_steamid
      || userdata?.webapi_token_steamid
      || ""
    ).trim();
    if (fromUserData) {
      return fromUserData;
    }
  } catch {
    // fallback below
  }

  try {
    const html = await fetchSteamText("https://store.steampowered.com/", {
      credentials: "include",
      cache: "no-store"
    });
    const match = html.match(/g_steamID\s*=\s*"(\d{10,20})"/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function mergeMetaFromWishlistEntry(appId, entry) {
  const existing = metaCache[appId] || {};
  const now = Date.now();

  const name = String(entry?.name || "").trim();
  const releaseString = String(entry?.release_string || "").trim();
  const releaseUnix = Number(entry?.release_date || 0);
  const isFree = Boolean(entry?.is_free_game);
  const reviewPct = Number(entry?.reviews_percent);
  const reviewTotal = parseLooseInteger(entry?.reviews_total, 0);
  const typeRaw = String(entry?.type || "").trim();

  const firstSub = Array.isArray(entry?.subs) ? entry.subs[0] : null;
  const discountPercent = Number(firstSub?.discount_pct || 0);
  const priceFinal = Number(firstSub?.price || 0);
  const blockPriceText = extractPriceTextFromDiscountBlock(firstSub?.discount_block);

  const priceText = isFree
    ? "Free"
    : (blockPriceText || existing.priceText || "-");

  const reviewText = (Number.isFinite(reviewPct) && reviewTotal > 0)
    ? `${Math.round(reviewPct)}% positive (${formatCompactCount(reviewTotal)} reviews)`
    : (existing.reviewText || "No user reviews");

  metaCache[appId] = {
    ...existing,
    cachedAt: now,
    titleText: name || existing.titleText || "",
    priceText,
    priceFinal: Number.isFinite(priceFinal) ? priceFinal : Number(existing.priceFinal || 0),
    discountText: discountPercent > 0 ? `${discountPercent}% off` : (existing.discountText || "-"),
    discountPercent: Number.isFinite(discountPercent) ? discountPercent : Number(existing.discountPercent || 0),
    appTypeRaw: typeRaw || existing.appTypeRaw || "",
    appType: normalizeAppTypeLabel(typeRaw || existing.appTypeRaw || existing.appType || ""),
    reviewPositivePct: Number.isFinite(reviewPct) ? Math.round(reviewPct) : existing.reviewPositivePct,
    reviewTotalVotes: reviewTotal > 0 ? reviewTotal : Number(existing.reviewTotalVotes || 0),
    recommendationsTotal: reviewTotal > 0 ? reviewTotal : Number(existing.recommendationsTotal || 0),
    tags: Array.isArray(existing.tags) ? existing.tags : [],
    players: Array.isArray(existing.players) ? existing.players : [],
    features: Array.isArray(existing.features) ? existing.features : [],
    hardware: Array.isArray(existing.hardware) ? existing.hardware : [],
    accessibility: Array.isArray(existing.accessibility) ? existing.accessibility : [],
    platforms: Array.isArray(existing.platforms) ? existing.platforms : [],
    languages: Array.isArray(existing.languages) ? existing.languages : [],
    fullAudioLanguages: Array.isArray(existing.fullAudioLanguages) ? existing.fullAudioLanguages : [],
    subtitleLanguages: Array.isArray(existing.subtitleLanguages) ? existing.subtitleLanguages : [],
    technologies: Array.isArray(existing.technologies) ? existing.technologies : [],
    developers: Array.isArray(existing.developers) ? existing.developers : [],
    publishers: Array.isArray(existing.publishers) ? existing.publishers : [],
    reviewText,
    releaseUnix: Number.isFinite(releaseUnix) ? releaseUnix : Number(existing.releaseUnix || 0),
    releaseText: releaseString || existing.releaseText || "-"
  };
}

function needsWishlistSnapshotMeta(appId) {
  const meta = metaCache?.[appId] || {};
  const hasTitle = Boolean(String(meta.titleText || "").trim());
  const hasRelease = Number.isFinite(Number(meta.releaseUnix)) && Number(meta.releaseUnix) > 0;
  const hasReview = Number.isFinite(Number(meta.reviewPositivePct));
  const hasPrice = Number.isFinite(Number(meta.priceFinal));
  const hasDiscount = Number.isFinite(Number(meta.discountPercent));
  return !(hasTitle && hasRelease && hasReview && hasPrice && hasDiscount);
}

async function ensureWishlistMetaFromSnapshot(appIds, options = {}) {
  const { background = false } = options;
  if (sourceMode !== "wishlist" || !Array.isArray(appIds) || appIds.length === 0) {
    return;
  }
  const unresolved = new Set(appIds.filter((appId) => needsWishlistSnapshotMeta(appId)));
  if (unresolved.size === 0) {
    if (!background) {
      setStatus("");
    }
    return;
  }

  const steamId = await resolveCurrentSteamId();
  if (!steamId) {
    return;
  }

  const totalNeeded = unresolved.size;
  setStatus(`Loading wishlist snapshot metadata... 0/${totalNeeded} (0%)`);
  let changed = false;
  let pagesScanned = 0;
  let failedPages = 0;
  let consecutiveFailures = 0;

  try {
    for (let pageIndex = 0; pageIndex < 200 && unresolved.size > 0; pageIndex += 1) {
      pagesScanned += 1;
      let payload = null;
      try {
        payload = await fetchSteamJson(
          `https://store.steampowered.com/wishlist/profiles/${steamId}/wishlistdata/?p=${pageIndex}`,
          {
            credentials: "include",
            cache: "no-store"
          }
        );
      } catch {
        failedPages += 1;
        consecutiveFailures += 1;
        const resolved = totalNeeded - unresolved.size;
        const pct = totalNeeded > 0 ? Math.round((resolved / totalNeeded) * 100) : 100;
        setStatus(`Loading wishlist snapshot metadata... ${resolved}/${totalNeeded} (${pct}%) | page ${pageIndex + 1} | failed pages ${failedPages}`);
        if (consecutiveFailures >= 3) {
          break;
        }
        continue;
      }
      consecutiveFailures = 0;
      const entries = Object.entries(payload || {});
      if (entries.length === 0) {
        break;
      }

      for (const [appId, entry] of entries) {
        if (unresolved.has(appId)) {
          mergeMetaFromWishlistEntry(appId, entry);
          unresolved.delete(appId);
          changed = true;
        }
      }

      const resolved = totalNeeded - unresolved.size;
      const pct = totalNeeded > 0 ? Math.round((resolved / totalNeeded) * 100) : 100;
      setStatus(`Loading wishlist snapshot metadata... ${resolved}/${totalNeeded} (${pct}%) | page ${pageIndex + 1} | failed pages ${failedPages}`);
    }

    if (changed) {
      await saveMetaCache();
    }
    if (background) {
      wishlistSnapshotDay = todayKey();
      wishlistSortSignature = "";
      wishlistSortOrders = {};
      const resolvedFinal = totalNeeded - unresolved.size;
      if (resolvedFinal === 0 && failedPages > 0) {
        setStatus(`Wishlist metadata sync paused: Steam blocked snapshot pages (${failedPages} failures).`, true);
      } else {
        setStatus(`Wishlist metadata sync done. ${resolvedFinal}/${totalNeeded} items, pages ${pagesScanned}, failed pages ${failedPages}.`);
      }
    }
  } finally {
    if (!background) {
      setStatus("");
    }
  }
}

function startWishlistMetaSyncInBackground(appIds) {
  if (wishlistMetaSyncInFlight || sourceMode !== "wishlist") {
    return;
  }
  wishlistMetaSyncInFlight = true;
  const ids = Array.isArray(appIds) ? [...appIds] : [];
  ensureWishlistMetaFromSnapshot(ids, { background: true })
    .then(async () => {
      if (sourceMode === "wishlist") {
        await render();
      }
    })
    .catch(() => {
      setStatus("Wishlist metadata sync failed in background.", true);
    })
    .finally(() => {
      wishlistMetaSyncInFlight = false;
    });
}

async function ensureWishlistPrecomputedSorts(appIds) {
  if (sourceMode !== "wishlist" || !Array.isArray(appIds) || appIds.length === 0) {
    return;
  }

  if (Object.keys(wishlistPriorityMap || {}).length === 0 && Array.isArray(wishlistOrderedAppIds) && wishlistOrderedAppIds.length > 0) {
    wishlistPriorityMap = {};
    for (let i = 0; i < wishlistOrderedAppIds.length; i += 1) {
      wishlistPriorityMap[wishlistOrderedAppIds[i]] = i;
    }
  }
  if (wishlistOrderedAppIds.length > 0) {
    wishlistOrderedAppIds = sortByWishlistPriority(appIds);
  }

  const signature = buildWishlistSignature(appIds);
  if (wishlistSortSignature === signature && wishlistSortOrders?.position?.length) {
    return;
  }

  wishlistSortOrders = buildWishlistSortOrders(appIds);
  wishlistSortSignature = signature;
  wishlistSnapshotDay = todayKey();
}

function getAllKnownAppIds() {
  const ids = new Set();
  for (const appId of Object.keys(wishlistAddedMap || {})) {
    ids.add(appId);
  }
  for (const appId of Object.keys(state?.items || {})) {
    ids.add(appId);
  }
  for (const collectionName of state?.collectionOrder || []) {
    for (const appId of state?.collections?.[collectionName] || []) {
      ids.add(appId);
    }
  }
  return Array.from(ids);
}

async function refreshWholeDatabase() {
  const allIds = getAllKnownAppIds();
  if (allIds.length === 0) {
    setStatus("No items to refresh.");
    return;
  }

  setStatus(`Refreshing metadata for ${allIds.length} items...`);
  await ensureMetaForAppIds(allIds, allIds.length, true, "Refreshing full database:");
  await browser.storage.local.remove([TAG_COUNTS_CACHE_KEY, TYPE_COUNTS_CACHE_KEY, EXTRA_FILTER_COUNTS_CACHE_KEY]);
  invalidateWishlistPrecomputedSorts();
  quickPopulateFiltersFromCache();
  refreshFilterOptionsInBackground();
  await render();
  setStatus("Database refreshed. Finalizing filter frequencies in background...");
}

async function refreshCurrentPageItems() {
  const ids = Array.isArray(currentRenderedPageIds) ? currentRenderedPageIds : [];
  if (ids.length === 0) {
    setStatus("No visible items to refresh.");
    return;
  }

  setStatus(`Refreshing ${ids.length} visible items...`);
  await ensureMetaForAppIds(ids, ids.length, true, "Refreshing visible items:");
  await browser.storage.local.remove([TAG_COUNTS_CACHE_KEY, TYPE_COUNTS_CACHE_KEY, EXTRA_FILTER_COUNTS_CACHE_KEY]);
  invalidateWishlistPrecomputedSorts();
  quickPopulateFiltersFromCache();
  refreshFilterOptionsInBackground();
  await render();
  setStatus("Visible items refreshed. Finalizing filter frequencies in background...");
}

async function refreshSingleItem(appId) {
  if (!appId) {
    return;
  }
  setStatus(`Refreshing ${appId}...`);
  await fetchAppMeta(appId, { force: true });
  invalidateWishlistPrecomputedSorts();
  await render();
  setStatus("Item refreshed.");
}

async function loadMetaCache() {
  await loadGeneralFilterSeedFromJson();
  await loadSteamDbTagSeedFromJson();
  const stored = await browser.storage.local.get(META_CACHE_KEY);
  metaCache = stored[META_CACHE_KEY] || {};
}

async function saveMetaCache() {
  await browser.storage.local.set({ [META_CACHE_KEY]: metaCache });
}

function getCardImageUrl(appId) {
  return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_184x69.jpg`;
}

function getCardImageCandidates(appId) {
  const id = String(appId || "");
  const base = `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}`;
  return [
    getCardImageUrl(id),
    `${base}/capsule_231x87.jpg`,
    `${base}/header.jpg`,
    `${base}/capsule_616x353.jpg`,
    `${base}/library_600x900.jpg`,
    `${base}/library_600x900_2x.jpg`
  ];
}

function attachImageFallback(imgEl, candidates) {
  if (!imgEl) {
    return;
  }
  const queue = Array.isArray(candidates)
    ? Array.from(new Set(candidates.filter((url) => String(url || "").trim())))
    : [];
  if (queue.length === 0) {
    return;
  }

  const next = () => {
    const candidate = queue.shift();
    if (!candidate) {
      imgEl.removeAttribute("src");
      imgEl.style.visibility = "hidden";
      return;
    }
    imgEl.src = candidate;
  };

  imgEl.onerror = next;
  next();
}

function getAppLink(appId) {
  return `https://store.steampowered.com/app/${appId}/`;
}

async function fetchAppMeta(appId, options = {}) {
  const force = Boolean(options.force);
  const includeReviews = options.includeReviews !== false;
  const cached = metaCache[appId];
  const now = Date.now();

  if (!force && cached && now - cached.cachedAt < META_CACHE_TTL_MS && !isMetaIncomplete(cached)) {
    return cached;
  }

  async function fetchAppDetailsDataWithFallback() {
    const urls = [
      `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=br&l=en`,
      `https://store.steampowered.com/api/appdetails?appids=${appId}&l=en`,
      `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=br&l=pt-BR`,
      `https://store.steampowered.com/api/appdetails?appids=${appId}`
    ];

    for (const url of urls) {
      try {
        const payload = await fetchSteamJson(url);
        const data = payload?.[appId]?.data;
        if (data) {
          return data;
        }
      } catch {
        // Try next fallback URL.
      }
    }

    return null;
  }

  async function fetchStoreTagsWithFallback() {
    const urls = [
      `https://store.steampowered.com/app/${appId}/?l=en&cc=br`,
      `https://store.steampowered.com/app/${appId}/?l=en`,
      `https://store.steampowered.com/app/${appId}/`
    ];

    for (const url of urls) {
      try {
        const html = await fetchSteamText(url, { credentials: "include", cache: "no-store" });
        const parsed = parserUtils.parseStoreTags(html);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch {
        // Try next fallback URL.
      }
    }

    return [];
  }

  try {
    const requests = [fetchAppDetailsDataWithFallback(), fetchStoreTagsWithFallback()];
    if (includeReviews) {
      requests.push(fetchSteamJson(`https://store.steampowered.com/appreviews/${appId}?json=1&language=all&purchase_type=all&num_per_page=0`));
    }
    const settled = await Promise.allSettled(requests);
    const detailsDataResult = settled[0];
    const storeTagsResult = settled[1];
    const reviewsResult = includeReviews ? settled[2] : null;

    let appData = null;
    if (detailsDataResult.status === "fulfilled") {
      appData = detailsDataResult.value;
    }

    if (!appData) {
      throw new Error("No appdetails payload");
    }

    let storeTags = [];
    if (storeTagsResult && storeTagsResult.status === "fulfilled" && Array.isArray(storeTagsResult.value)) {
      storeTags = storeTagsResult.value;
    }

    let reviewsPayload = null;
    if (reviewsResult && reviewsResult.status === "fulfilled") {
      reviewsPayload = reviewsResult.value;
    }

    const reviewSummary = reviewsPayload?.query_summary || {};

    const genres = Array.isArray(appData?.genres)
      ? appData.genres.map((g) => String(g.description || "").trim()).filter(Boolean)
      : [];
    const categories = Array.isArray(appData?.categories)
      ? appData.categories.map((c) => String(c.description || "").trim()).filter(Boolean)
      : [];
    const tags = Array.from(new Set([...storeTags, ...genres, ...categories])).slice(0, 16);
    const categorySet = new Set(categories.map((c) => c.toLowerCase()));

    const players = categories.filter((label) => {
      const key = label.toLowerCase();
      return key.includes("single-player")
        || key.includes("multi-player")
        || key.includes("co-op")
        || key.includes("pvp")
        || key.includes("mmo")
        || key.includes("shared/split screen");
    });

    const hardware = categories.filter((label) => {
      const key = label.toLowerCase();
      return key.includes("controller")
        || key.includes("vr")
        || key.includes("tracked")
        || key.includes("keyboard");
    });

    const technologies = categories.filter((label) => {
      const key = label.toLowerCase();
      return key.includes("steam cloud")
        || key.includes("steam workshop")
        || key.includes("valve anti-cheat")
        || key.includes("remote play")
        || key.includes("hdr")
        || key.includes("steam timeline")
        || key.includes("steam leaderboard");
    });

    const features = categories.filter((label) => !players.includes(label) && !hardware.includes(label) && !technologies.includes(label));

    const platforms = [];
    if (appData?.platforms?.windows) {
      platforms.push("Windows");
    }
    if (appData?.platforms?.mac) {
      platforms.push("macOS");
    }
    if (appData?.platforms?.linux) {
      platforms.push("Linux");
    }

    const languagesRaw = String(appData?.supported_languages || "");
    const languages = parseSupportedLanguages(languagesRaw);
    const fullAudioLanguages = parseFullAudioLanguages(languagesRaw);
    // Steam appdetails usually doesn't split subtitle-only languages; use available list.
    const subtitleLanguages = [...languages];

    const developers = Array.isArray(appData?.developers)
      ? appData.developers.map((d) => String(d || "").trim()).filter(Boolean)
      : [];
    const publishers = Array.isArray(appData?.publishers)
      ? appData.publishers.map((p) => String(p || "").trim()).filter(Boolean)
      : [];

    const accessibility = [];
    if (categorySet.has("captions available")) {
      accessibility.push("Captions available");
    }
    if (subtitleLanguages.length > 0) {
      accessibility.push("Subtitles");
    }
    if (fullAudioLanguages.length > 0) {
      accessibility.push("Full audio");
    }

    const releaseText = appData?.release_date?.date || (appData?.release_date?.coming_soon ? "Coming soon" : "-");

    const totalPositive = Number(reviewSummary?.total_positive || 0);
    const totalNegative = Number(reviewSummary?.total_negative || 0);
    const totalVotes = totalPositive + totalNegative;
    const positivePct = totalVotes > 0 ? Math.round((totalPositive / totalVotes) * 100) : 0;

    const reviewText = totalVotes > 0
      ? `${positivePct}% positive (${formatCompactCount(totalPositive)}+ / ${formatCompactCount(totalNegative)}-)`
      : "No user reviews";

    let priceText = "-";
    if (appData?.is_free === true) {
      priceText = "Free";
    } else if (appData?.price_overview?.final_formatted) {
      priceText = appData.price_overview.final_formatted;
    } else if (releaseText === "Coming soon") {
      priceText = "Not announced";
    }

    const rawType = String(appData?.type || "").trim();

    const meta = {
      cachedAt: now,
      titleText: String(appData?.name || "").trim(),
      priceText,
      priceFinal: Number(appData?.price_overview?.final || 0),
      discountText: appData?.price_overview?.discount_percent
        ? `${appData.price_overview.discount_percent}% off`
        : "-",
      discountPercent: Number(appData?.price_overview?.discount_percent || 0),
      appTypeRaw: rawType,
      appType: normalizeAppTypeLabel(rawType),
      tags,
      players,
      features,
      hardware,
      accessibility,
      platforms,
      languages,
      fullAudioLanguages,
      subtitleLanguages,
      technologies,
      developers,
      publishers,
      reviewPositivePct: positivePct,
      reviewTotalVotes: totalVotes,
      recommendationsTotal: Number(appData?.recommendations?.total || 0),
      reviewText,
      releaseUnix: Number(appData?.release_date?.steam_release_date || 0),
      releaseText
    };

    metaCache[appId] = meta;
    await saveMetaCache();
    return meta;
  } catch {
    return {
      cachedAt: now,
      titleText: "",
      priceText: "-",
      priceFinal: 0,
      discountText: "-",
      discountPercent: 0,
      appTypeRaw: "",
      appType: "Unknown",
      tags: [],
      players: [],
      features: [],
      hardware: [],
      accessibility: [],
      platforms: [],
      languages: [],
      fullAudioLanguages: [],
      subtitleLanguages: [],
      technologies: [],
      developers: [],
      publishers: [],
      reviewPositivePct: null,
      reviewTotalVotes: 0,
      recommendationsTotal: 0,
      reviewText: "No user reviews",
      releaseUnix: 0,
      releaseText: "-"
    };
  }
}

async function ensureMetaForAppIds(appIds, limit = 400, force = false, progressLabel = "", includeReviews = true) {
  const now = Date.now();
  const missing = [];

  for (const appId of appIds) {
    const cached = metaCache[appId];
    const fresh = cached
      && now - Number(cached.cachedAt || 0) < META_CACHE_TTL_MS
      && !force
      && !isMetaIncomplete(cached);
    if (!fresh) {
      missing.push(appId);
    }
    if (missing.length >= limit) {
      break;
    }
  }

  const concurrency = force ? SAFE_FETCH_CONCURRENCY_FORCE : SAFE_FETCH_CONCURRENCY;
  const total = missing.length;
  if (total === 0) {
    return;
  }

  let cursor = 0;
  let completed = 0;
  let lastProgressAt = 0;

  function updateProgress(forceNow = false) {
    if (!progressLabel) {
      return;
    }
    const nowTs = Date.now();
    if (!forceNow && nowTs - lastProgressAt < 120) {
      return;
    }
    const pct = Math.round((completed / total) * 100);
    setStatus(`${progressLabel} ${completed}/${total} (${pct}%)`);
    lastProgressAt = nowTs;
  }

  updateProgress(true);

  async function worker() {
    while (cursor < missing.length) {
      const idx = cursor;
      cursor += 1;
      await fetchAppMeta(missing[idx], { force, includeReviews });
      completed += 1;
      updateProgress();
      const perItemDelay = force
        ? SAFE_FETCH_FORCE_BASE_DELAY_MS + Math.floor(Math.random() * SAFE_FETCH_FORCE_JITTER_MS)
        : 80 + Math.floor(Math.random() * 100);
      await sleep(perItemDelay);
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  updateProgress(true);
}

function buildTagCountsFromAppIds(appIds) {
  const counts = new Map();

  for (const appId of appIds) {
    const tags = getMetaTags(appId);
    for (const tag of tags) {
      const key = String(tag || "").trim();
      if (!key) {
        continue;
      }
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
}

function buildTypeCountsFromAppIds(appIds) {
  const counts = new Map();

  for (const appId of appIds) {
    const typeName = getMetaType(appId);
    counts.set(typeName, (counts.get(typeName) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
}

function buildArrayFieldCountsFromAppIds(appIds, fieldName) {
  const counts = new Map();
  for (const appId of appIds) {
    for (const raw of getMetaArray(appId, fieldName)) {
      const name = String(raw || "").trim();
      if (!name) {
        continue;
      }
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
}

function normalizeLanguageCountObjects(counts) {
  const source = Array.isArray(counts) ? counts : [];
  const merged = new Map();
  for (const entry of source) {
    const rawName = String(entry?.name || "").trim();
    if (!rawName) {
      continue;
    }
    const count = Number.isFinite(Number(entry?.count)) ? Number(entry.count) : 0;
    const parts = rawName.split(",");
    for (const part of parts) {
      const name = String(part || "").replace(/\s+/g, " ").trim();
      if (!name) {
        continue;
      }
      const lower = name.toLowerCase();
      if (lower.includes("languages with full audio support")) {
        continue;
      }
      merged.set(name, (merged.get(name) || 0) + count);
    }
  }
  return Array.from(merged.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
}

function buildReleaseYearCountsFromAppIds(appIds) {
  const counts = new Map();
  for (const appId of appIds) {
    const info = getReleaseFilterData(appId);
    const key = String(info?.textLabel || "").trim();
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
}

function buildCountsFromNames(values) {
  const counts = new Map();
  for (const raw of values || []) {
    const name = normalizeReleaseTextFilterValue(raw);
    if (!name) {
      continue;
    }
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
}

function mergeReleaseTextCountsWithSeed(dynamicCounts) {
  const seedNames = getSeedList("releaseTexts");
  const normalizedDynamic = [];
  for (const entry of Array.isArray(dynamicCounts) ? dynamicCounts : []) {
    const name = normalizeReleaseTextFilterValue(entry?.name);
    if (!name) {
      continue;
    }
    normalizedDynamic.push({
      name,
      count: Number(entry?.count || 0)
    });
  }

  const mergedMap = new Map();
  for (const entry of normalizedDynamic) {
    mergedMap.set(entry.name, (mergedMap.get(entry.name) || 0) + entry.count);
  }
  for (const seed of seedNames) {
    const name = normalizeReleaseTextFilterValue(seed);
    if (!name) {
      continue;
    }
    if (!mergedMap.has(name)) {
      mergedMap.set(name, 0);
    }
  }

  const seedOrder = new Map();
  seedNames.forEach((name, index) => {
    const key = normalizeReleaseTextFilterValue(name);
    if (key && !seedOrder.has(key)) {
      seedOrder.set(key, index);
    }
  });

  return Array.from(mergedMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      const aSeed = seedOrder.has(a.name);
      const bSeed = seedOrder.has(b.name);
      if (aSeed && bSeed) {
        return seedOrder.get(a.name) - seedOrder.get(b.name);
      }
      if (aSeed !== bSeed) {
        return aSeed ? -1 : 1;
      }
      return b.count - a.count || a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
    });
}

function getUnknownTypeAppIds(appIds) {
  return appIds.filter((appId) => {
    const raw = String(metaCache?.[appId]?.appTypeRaw || "").trim();
    return !raw;
  });
}

async function ensureTagCounts() {
  const appIds = Object.keys(wishlistAddedMap);
  const bucket = buildTagCacheBucketKey();
  const day = todayKey();
  const now = Date.now();

  const storage = await browser.storage.local.get(TAG_COUNTS_CACHE_KEY);
  const cache = storage[TAG_COUNTS_CACHE_KEY] || {};
  const cachedBucket = cache[bucket];

  if (appIds.length === 0) {
    if (cachedBucket && Array.isArray(cachedBucket.counts) && cachedBucket.counts.length > 0) {
      tagCounts = cachedBucket.counts;
    }
    return;
  }

  if (cachedBucket && cachedBucket.day === day && cachedBucket.appCount === appIds.length) {
    tagCounts = Array.isArray(cachedBucket.counts) ? cachedBucket.counts : [];
    tagCountsSource = "wishlist-frequency";
    return;
  }

  const cachedSeedCounts = Array.isArray(cachedBucket?.seedCounts) ? cachedBucket.seedCounts : [];
  const seedIsFresh = Number.isFinite(Number(cachedBucket?.seedFetchedAt))
    && (now - Number(cachedBucket.seedFetchedAt) < TAG_SEED_REFRESH_INTERVAL_MS);

  if (seedIsFresh && cachedSeedCounts.length > 0) {
    tagCounts = cachedSeedCounts;
    tagCountsSource = "popular-seed";
    renderTagOptions();
  } else {
    try {
      const popular = await fetchSteamJson("https://store.steampowered.com/tagdata/populartags/english", {
        credentials: "omit",
        cache: "no-store"
      });
      const seedCounts = Array.isArray(popular)
        ? popular
          .map((entry, index) => {
            const name = String(entry?.name || "").trim();
            if (!name) {
              return null;
            }
            return { name, seedOrder: index };
          })
          .filter(Boolean)
        : [];
      if (seedCounts.length > 0) {
        tagCounts = seedCounts;
        tagCountsSource = "popular-seed";
        renderTagOptions();
        cache[bucket] = {
          ...(cachedBucket || {}),
          seedFetchedAt: now,
          seedCounts
        };
        await browser.storage.local.set({ [TAG_COUNTS_CACHE_KEY]: cache });
      }
    } catch {
      // Keep existing tags if seed endpoint is unavailable.
    }
  }

  setStatus("Recalculating tag frequencies for full wishlist...");
  await ensureMetaForAppIds(appIds, 2000, false, "Recalculating tag frequencies:", false);

  const nextCounts = buildTagCountsFromAppIds(appIds);
  if (nextCounts.length === 0 && cachedBucket && Array.isArray(cachedBucket.counts) && cachedBucket.counts.length > 0) {
    tagCounts = cachedBucket.counts;
    tagCountsSource = "wishlist-frequency";
    setStatus("Steam blocked metadata refresh. Keeping previous tag filters.", true);
    return;
  }
  tagCounts = nextCounts;
  tagCountsSource = "wishlist-frequency";

  cache[bucket] = {
    ...(cachedBucket || {}),
    day,
    appCount: appIds.length,
    counts: tagCounts
  };

  await browser.storage.local.set({ [TAG_COUNTS_CACHE_KEY]: cache });
  setStatus("");
}

async function ensureTypeCounts() {
  const appIds = Object.keys(wishlistAddedMap);
  const bucket = buildTagCacheBucketKey();
  const day = todayKey();

  const storage = await browser.storage.local.get(TYPE_COUNTS_CACHE_KEY);
  const cache = storage[TYPE_COUNTS_CACHE_KEY] || {};
  const cachedBucket = cache[bucket];

  if (appIds.length === 0) {
    if (cachedBucket && Array.isArray(cachedBucket.counts) && cachedBucket.counts.length > 0) {
      typeCounts = cachedBucket.counts;
    }
    return;
  }

  if (cachedBucket && cachedBucket.day === day) {
    typeCounts = Array.isArray(cachedBucket.counts) ? cachedBucket.counts : [];
    return;
  }

  setStatus("Loading full wishlist metadata for type frequencies...");
  await ensureMetaForAppIds(appIds, appIds.length, false, "Loading type frequencies:", false);

  const unknownTypeIds = getUnknownTypeAppIds(appIds);
  if (unknownTypeIds.length > 0) {
    setStatus("Refreshing unresolved app types...");
    await ensureMetaForAppIds(unknownTypeIds, unknownTypeIds.length, true, "Refreshing unresolved types:", false);
  }

  const nextCounts = buildTypeCountsFromAppIds(appIds);
  if (nextCounts.length === 0 && cachedBucket && Array.isArray(cachedBucket.counts) && cachedBucket.counts.length > 0) {
    typeCounts = cachedBucket.counts;
    setStatus("Steam blocked metadata refresh. Keeping previous type filters.", true);
    return;
  }
  typeCounts = nextCounts;

  cache[bucket] = {
    day,
    counts: typeCounts
  };

  await browser.storage.local.set({ [TYPE_COUNTS_CACHE_KEY]: cache });
  setStatus("");
}

async function ensureExtraFilterCounts() {
  const appIds = Object.keys(wishlistAddedMap);
  const bucket = buildTagCacheBucketKey();
  const day = todayKey();

  const storage = await browser.storage.local.get(EXTRA_FILTER_COUNTS_CACHE_KEY);
  const cache = storage[EXTRA_FILTER_COUNTS_CACHE_KEY] || {};
  const cachedBucket = cache[bucket];

  if (appIds.length === 0) {
    if (cachedBucket && cachedBucket.day) {
      playerCounts = Array.isArray(cachedBucket.playerCounts) ? cachedBucket.playerCounts : [];
      featureCounts = Array.isArray(cachedBucket.featureCounts) ? cachedBucket.featureCounts : [];
      hardwareCounts = Array.isArray(cachedBucket.hardwareCounts) ? cachedBucket.hardwareCounts : [];
      accessibilityCounts = Array.isArray(cachedBucket.accessibilityCounts) ? cachedBucket.accessibilityCounts : [];
      platformCounts = Array.isArray(cachedBucket.platformCounts) ? cachedBucket.platformCounts : [];
      languageCounts = normalizeLanguageCountObjects(cachedBucket.languageCounts);
      fullAudioLanguageCounts = normalizeLanguageCountObjects(cachedBucket.fullAudioLanguageCounts);
      subtitleLanguageCounts = normalizeLanguageCountObjects(cachedBucket.subtitleLanguageCounts);
      technologyCounts = Array.isArray(cachedBucket.technologyCounts) ? cachedBucket.technologyCounts : [];
      developerCounts = Array.isArray(cachedBucket.developerCounts) ? cachedBucket.developerCounts : [];
      publisherCounts = Array.isArray(cachedBucket.publisherCounts) ? cachedBucket.publisherCounts : [];
      releaseYearCounts = mergeReleaseTextCountsWithSeed(
        Array.isArray(cachedBucket.releaseYearCounts) ? cachedBucket.releaseYearCounts : []
      );
    }
    return;
  }

  if (cachedBucket && cachedBucket.day === day) {
    playerCounts = Array.isArray(cachedBucket.playerCounts) ? cachedBucket.playerCounts : [];
    featureCounts = Array.isArray(cachedBucket.featureCounts) ? cachedBucket.featureCounts : [];
    hardwareCounts = Array.isArray(cachedBucket.hardwareCounts) ? cachedBucket.hardwareCounts : [];
    accessibilityCounts = Array.isArray(cachedBucket.accessibilityCounts) ? cachedBucket.accessibilityCounts : [];
    platformCounts = Array.isArray(cachedBucket.platformCounts) ? cachedBucket.platformCounts : [];
    languageCounts = normalizeLanguageCountObjects(cachedBucket.languageCounts);
    fullAudioLanguageCounts = normalizeLanguageCountObjects(cachedBucket.fullAudioLanguageCounts);
    subtitleLanguageCounts = normalizeLanguageCountObjects(cachedBucket.subtitleLanguageCounts);
    technologyCounts = Array.isArray(cachedBucket.technologyCounts) ? cachedBucket.technologyCounts : [];
    developerCounts = Array.isArray(cachedBucket.developerCounts) ? cachedBucket.developerCounts : [];
    publisherCounts = Array.isArray(cachedBucket.publisherCounts) ? cachedBucket.publisherCounts : [];
    releaseYearCounts = mergeReleaseTextCountsWithSeed(
      Array.isArray(cachedBucket.releaseYearCounts) ? cachedBucket.releaseYearCounts : []
    );
    return;
  }

  setStatus("Loading metadata for extra filters...");
  await ensureMetaForAppIds(appIds, 2000, false, "Loading extra filters:", false);

  const nextPlayerCounts = buildArrayFieldCountsFromAppIds(appIds, "players");
  const nextFeatureCounts = buildArrayFieldCountsFromAppIds(appIds, "features");
  const nextHardwareCounts = buildArrayFieldCountsFromAppIds(appIds, "hardware");
  const nextAccessibilityCounts = buildArrayFieldCountsFromAppIds(appIds, "accessibility");
  const nextPlatformCounts = buildArrayFieldCountsFromAppIds(appIds, "platforms");
  const nextLanguageCounts = normalizeLanguageCountObjects(buildArrayFieldCountsFromAppIds(appIds, "languages"));
  const nextFullAudioLanguageCounts = normalizeLanguageCountObjects(buildArrayFieldCountsFromAppIds(appIds, "fullAudioLanguages"));
  const nextSubtitleLanguageCounts = normalizeLanguageCountObjects(buildArrayFieldCountsFromAppIds(appIds, "subtitleLanguages"));
  const nextTechnologyCounts = buildArrayFieldCountsFromAppIds(appIds, "technologies");
  const nextDeveloperCounts = buildArrayFieldCountsFromAppIds(appIds, "developers");
  const nextPublisherCounts = buildArrayFieldCountsFromAppIds(appIds, "publishers");
  const nextReleaseYearCounts = mergeReleaseTextCountsWithSeed(buildReleaseYearCountsFromAppIds(appIds));

  const totalNext =
    nextPlayerCounts.length + nextFeatureCounts.length + nextHardwareCounts.length
    + nextAccessibilityCounts.length + nextPlatformCounts.length + nextLanguageCounts.length
    + nextFullAudioLanguageCounts.length + nextSubtitleLanguageCounts.length
    + nextTechnologyCounts.length + nextDeveloperCounts.length + nextPublisherCounts.length
    + nextReleaseYearCounts.length;

  if (totalNext === 0 && cachedBucket && cachedBucket.day) {
    playerCounts = Array.isArray(cachedBucket.playerCounts) ? cachedBucket.playerCounts : [];
    featureCounts = Array.isArray(cachedBucket.featureCounts) ? cachedBucket.featureCounts : [];
    hardwareCounts = Array.isArray(cachedBucket.hardwareCounts) ? cachedBucket.hardwareCounts : [];
    accessibilityCounts = Array.isArray(cachedBucket.accessibilityCounts) ? cachedBucket.accessibilityCounts : [];
    platformCounts = Array.isArray(cachedBucket.platformCounts) ? cachedBucket.platformCounts : [];
    languageCounts = normalizeLanguageCountObjects(cachedBucket.languageCounts);
    fullAudioLanguageCounts = normalizeLanguageCountObjects(cachedBucket.fullAudioLanguageCounts);
    subtitleLanguageCounts = normalizeLanguageCountObjects(cachedBucket.subtitleLanguageCounts);
    technologyCounts = Array.isArray(cachedBucket.technologyCounts) ? cachedBucket.technologyCounts : [];
    developerCounts = Array.isArray(cachedBucket.developerCounts) ? cachedBucket.developerCounts : [];
    publisherCounts = Array.isArray(cachedBucket.publisherCounts) ? cachedBucket.publisherCounts : [];
    releaseYearCounts = mergeReleaseTextCountsWithSeed(
      Array.isArray(cachedBucket.releaseYearCounts) ? cachedBucket.releaseYearCounts : []
    );
    setStatus("Steam blocked metadata refresh. Keeping previous advanced filters.", true);
    return;
  }

  playerCounts = nextPlayerCounts;
  featureCounts = nextFeatureCounts;
  hardwareCounts = nextHardwareCounts;
  accessibilityCounts = nextAccessibilityCounts;
  platformCounts = nextPlatformCounts;
  languageCounts = nextLanguageCounts;
  fullAudioLanguageCounts = nextFullAudioLanguageCounts;
  subtitleLanguageCounts = nextSubtitleLanguageCounts;
  technologyCounts = nextTechnologyCounts;
  developerCounts = nextDeveloperCounts;
  publisherCounts = nextPublisherCounts;
  releaseYearCounts = nextReleaseYearCounts;

  cache[bucket] = {
    day,
    playerCounts,
    featureCounts,
    hardwareCounts,
    accessibilityCounts,
    platformCounts,
    languageCounts,
    fullAudioLanguageCounts,
    subtitleLanguageCounts,
    technologyCounts,
    developerCounts,
    publisherCounts,
    releaseYearCounts
  };
  await browser.storage.local.set({ [EXTRA_FILTER_COUNTS_CACHE_KEY]: cache });
  setStatus("");
}

function renderCheckboxOptions(containerId, counts, selectedSet, query = "") {
  const optionsEl = document.getElementById(containerId);
  if (!optionsEl) {
    return;
  }
  optionsEl.innerHTML = "";

  const normalizedQuery = String(query || "").toLowerCase();
  const filteredCounts = normalizedQuery
    ? counts.filter((item) => String(item.name || "").toLowerCase().includes(normalizedQuery))
    : counts;

  for (const item of filteredCounts) {
    const row = document.createElement("label");
    row.className = "tag-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedSet.has(item.name);
    checkbox.addEventListener("change", async () => {
      if (checkbox.checked) {
        selectedSet.add(item.name);
      } else {
        selectedSet.delete(item.name);
      }
      page = 1;
      await renderCards();
    });

    const name = document.createElement("span");
    name.className = "tag-name";
    name.textContent = item.name;

    const count = document.createElement("span");
    count.className = "tag-count";
    const hasCount = Number.isFinite(Number(item.count)) && Number(item.count) > 0;
    count.textContent = hasCount ? formatCompactCount(item.count) : "";

    row.appendChild(checkbox);
    row.appendChild(name);
    row.appendChild(count);
    optionsEl.appendChild(row);
  }
}

function uniqueSorted(values, compareFn = null) {
  const out = Array.from(new Set(values.filter(Boolean).map((v) => String(v).trim()).filter(Boolean)));
  out.sort(compareFn || ((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" })));
  return out;
}

function namesToCountObjects(values) {
  return uniqueSorted(values).map((name) => ({ name }));
}

function getTagSeedNames() {
  return Array.isArray(steamDbTagSeedNames) && steamDbTagSeedNames.length > 0
    ? steamDbTagSeedNames
    : [];
}

function getSeedList(key) {
  const external = externalFilterSeed?.[key];
  if (Array.isArray(external) && external.length > 0) {
    return external;
  }
  const fallback = FILTER_SEED?.[key];
  return Array.isArray(fallback) ? fallback : [];
}

async function loadSteamDbTagSeedFromJson() {
  if (Array.isArray(steamDbTagSeedNames) && steamDbTagSeedNames.length > 0) {
    return;
  }

  try {
    const url = browser?.runtime?.getURL
      ? browser.runtime.getURL(STEAMDB_TAGS_JSON_PATH)
      : STEAMDB_TAGS_JSON_PATH;
    const payload = await fetchSteamJson(url, { cache: "no-store" });
    const tags = Array.isArray(payload?.tags) ? payload.tags : [];
    const out = [];
    const seen = new Set();
    for (const entry of tags) {
      const name = String(entry?.name || "").trim();
      if (!name || seen.has(name)) {
        continue;
      }
      seen.add(name);
      out.push(name);
    }
    if (out.length > 0) {
      steamDbTagSeedNames = out;
    }
  } catch {
    // Fallback keeps built-in hardcoded tags list.
  }
}

async function loadGeneralFilterSeedFromJson() {
  if (externalFilterSeed) {
    return;
  }
  try {
    const url = browser?.runtime?.getURL
      ? browser.runtime.getURL(STEAM_FILTER_SEEDS_JSON_PATH)
      : STEAM_FILTER_SEEDS_JSON_PATH;
    const payload = await fetchSteamJson(url, { cache: "no-store" });
    const seed = payload?.seed || {};
    const normalize = (items) => Array.isArray(items)
      ? Array.from(new Set(items.map((v) => String(v || "").trim()).filter(Boolean)))
      : [];
    externalFilterSeed = {
      types: normalize(seed.types),
      players: normalize(seed.players),
      features: normalize(seed.features),
      hardware: normalize(seed.hardware),
      accessibility: normalize(seed.accessibility),
      platforms: normalize(seed.platforms),
      languages: normalize(seed.languages),
      technologies: normalize(seed.technologies),
      developers: normalize(seed.developers),
      publishers: normalize(seed.publishers),
      releaseYears: normalize(seed.releaseYears),
      releaseTexts: normalize(seed.releaseTexts)
    };
  } catch {
    // Fallback keeps built-in hardcoded seed.
  }
}

function applyHardcodedFilterSeeds() {
  tagCounts = namesToCountObjects(getTagSeedNames());
  typeCounts = namesToCountObjects(getSeedList("types"));
  playerCounts = namesToCountObjects(getSeedList("players"));
  featureCounts = namesToCountObjects(getSeedList("features"));
  hardwareCounts = namesToCountObjects(getSeedList("hardware"));
  accessibilityCounts = namesToCountObjects(getSeedList("accessibility"));
  platformCounts = namesToCountObjects(getSeedList("platforms"));
  languageCounts = namesToCountObjects(getSeedList("languages"));
  fullAudioLanguageCounts = namesToCountObjects(getSeedList("languages"));
  subtitleLanguageCounts = namesToCountObjects(getSeedList("languages"));
  technologyCounts = namesToCountObjects(getSeedList("technologies"));
  developerCounts = namesToCountObjects(getSeedList("developers"));
  publisherCounts = namesToCountObjects(getSeedList("publishers"));
  releaseYearCounts = mergeReleaseTextCountsWithSeed([]);
  if (tagCountsSource === "none") {
    tagCountsSource = "hardcoded";
  }
}

function mergeSeedWithNames(seedNames, dynamicNames, compareFn = null) {
  const merged = [];
  const seen = new Set();
  const pushName = (raw) => {
    const name = String(raw || "").trim();
    if (!name || seen.has(name)) {
      return;
    }
    seen.add(name);
    merged.push(name);
  };

  const sortedDynamic = uniqueSorted(dynamicNames || [], compareFn);
  for (const name of sortedDynamic) {
    pushName(name);
  }
  for (const name of seedNames || []) {
    pushName(name);
  }
  return merged.map((name) => ({ name }));
}

function mergeOrderedSeedWithNames(seedNames, dynamicNames) {
  const merged = [];
  const seen = new Set();
  const pushName = (raw) => {
    const name = String(raw || "").trim();
    if (!name || seen.has(name)) {
      return;
    }
    seen.add(name);
    merged.push(name);
  };

  for (const name of seedNames || []) {
    pushName(name);
  }
  for (const name of uniqueSorted(dynamicNames || [])) {
    pushName(name);
  }

  return merged.map((name) => ({ name }));
}

function populateGlobalFiltersFromMetaCache() {
  const appIds = Object.keys(metaCache || {});
  if (appIds.length === 0) {
    return;
  }

  const tags = [];
  const types = [];
  const players = [];
  const features = [];
  const hardware = [];
  const accessibility = [];
  const platforms = [];
  const languages = [];
  const fullAudioLanguages = [];
  const subtitleLanguages = [];
  const technologies = [];
  const developers = [];
  const publishers = [];
  const releaseTexts = [];

  for (const appId of appIds) {
    tags.push(...getMetaTags(appId));
    types.push(getMetaType(appId));
    players.push(...getMetaArray(appId, "players"));
    features.push(...getMetaArray(appId, "features"));
    hardware.push(...getMetaArray(appId, "hardware"));
    accessibility.push(...getMetaArray(appId, "accessibility"));
    platforms.push(...getMetaArray(appId, "platforms"));
    languages.push(...getMetaArray(appId, "languages"));
    fullAudioLanguages.push(...getMetaArray(appId, "fullAudioLanguages"));
    subtitleLanguages.push(...getMetaArray(appId, "subtitleLanguages"));
    technologies.push(...getMetaArray(appId, "technologies"));
    developers.push(...getMetaArray(appId, "developers"));
    publishers.push(...getMetaArray(appId, "publishers"));
    const releaseInfo = getReleaseFilterData(appId);
    if (releaseInfo.textLabel) {
      releaseTexts.push(releaseInfo.textLabel);
    }
  }

  if (tagCountsSource !== "popular-seed" && tagCountsSource !== "wishlist-frequency") {
    tagCounts = mergeOrderedSeedWithNames(getTagSeedNames(), tags);
    tagCountsSource = "global-meta";
  }
  typeCounts = mergeSeedWithNames(getSeedList("types"), types);
  playerCounts = mergeSeedWithNames(getSeedList("players"), players);
  featureCounts = mergeSeedWithNames(getSeedList("features"), features);
  hardwareCounts = mergeSeedWithNames(getSeedList("hardware"), hardware);
  accessibilityCounts = mergeSeedWithNames(getSeedList("accessibility"), accessibility);
  platformCounts = mergeSeedWithNames(getSeedList("platforms"), platforms);
  languageCounts = mergeSeedWithNames(getSeedList("languages"), languages);
  fullAudioLanguageCounts = mergeSeedWithNames(getSeedList("languages"), fullAudioLanguages);
  subtitleLanguageCounts = mergeSeedWithNames(getSeedList("languages"), subtitleLanguages);
  technologyCounts = mergeSeedWithNames(getSeedList("technologies"), technologies);
  developerCounts = mergeSeedWithNames(getSeedList("developers"), developers);
  publisherCounts = mergeSeedWithNames(getSeedList("publishers"), publishers);
  releaseYearCounts = mergeReleaseTextCountsWithSeed(buildCountsFromNames(releaseTexts));
}

function quickPopulateFiltersFromCache() {
  applyHardcodedFilterSeeds();
  populateGlobalFiltersFromMetaCache();

  const fromWishlist = Object.keys(wishlistAddedMap || {});
  const appIds = fromWishlist.length > 0 ? fromWishlist : getAllKnownAppIds();
  if (appIds.length === 0) {
    renderTagOptions();
    renderTypeOptions();
    renderExtraFilterOptions();
    return;
  }

  const tags = [];
  const types = [];
  const players = [];
  const features = [];
  const hardware = [];
  const accessibility = [];
  const platforms = [];
  const languages = [];
  const fullAudioLanguages = [];
  const subtitleLanguages = [];
  const technologies = [];
  const developers = [];
  const publishers = [];
  const releaseTexts = [];

  for (const appId of appIds) {
    tags.push(...getMetaTags(appId));
    types.push(getMetaType(appId));
    players.push(...getMetaArray(appId, "players"));
    features.push(...getMetaArray(appId, "features"));
    hardware.push(...getMetaArray(appId, "hardware"));
    accessibility.push(...getMetaArray(appId, "accessibility"));
    platforms.push(...getMetaArray(appId, "platforms"));
    languages.push(...getMetaArray(appId, "languages"));
    fullAudioLanguages.push(...getMetaArray(appId, "fullAudioLanguages"));
    subtitleLanguages.push(...getMetaArray(appId, "subtitleLanguages"));
    technologies.push(...getMetaArray(appId, "technologies"));
    developers.push(...getMetaArray(appId, "developers"));
    publishers.push(...getMetaArray(appId, "publishers"));
    const releaseInfo = getReleaseFilterData(appId);
    if (releaseInfo.textLabel) {
      releaseTexts.push(releaseInfo.textLabel);
    }
  }

  if (tagCountsSource !== "popular-seed" && tagCountsSource !== "wishlist-frequency") {
    tagCounts = mergeOrderedSeedWithNames(getTagSeedNames(), tags);
    tagCountsSource = "wishlist-cache";
  }
  typeCounts = mergeSeedWithNames(getSeedList("types"), types);
  playerCounts = mergeSeedWithNames(getSeedList("players"), players);
  featureCounts = mergeSeedWithNames(getSeedList("features"), features);
  hardwareCounts = mergeSeedWithNames(getSeedList("hardware"), hardware);
  accessibilityCounts = mergeSeedWithNames(getSeedList("accessibility"), accessibility);
  platformCounts = mergeSeedWithNames(getSeedList("platforms"), platforms);
  languageCounts = mergeSeedWithNames(getSeedList("languages"), languages);
  fullAudioLanguageCounts = mergeSeedWithNames(getSeedList("languages"), fullAudioLanguages);
  subtitleLanguageCounts = mergeSeedWithNames(getSeedList("languages"), subtitleLanguages);
  technologyCounts = mergeSeedWithNames(getSeedList("technologies"), technologies);
  developerCounts = mergeSeedWithNames(getSeedList("developers"), developers);
  publisherCounts = mergeSeedWithNames(getSeedList("publishers"), publishers);
  releaseYearCounts = mergeReleaseTextCountsWithSeed(buildCountsFromNames(releaseTexts));

  renderTagOptions();
  renderTypeOptions();
  renderExtraFilterOptions();
}

function refreshFilterOptionsInBackground() {
  const runId = ++filterSyncRunId;
  Promise.allSettled([ensureTagCounts(), ensureTypeCounts(), ensureExtraFilterCounts()]).then(() => {
    if (runId !== filterSyncRunId) {
      return;
    }
    renderTagOptions();
    renderTypeOptions();
    renderExtraFilterOptions();
  });
}

function renderTagOptions() {
  const optionsEl = document.getElementById("tag-options");
  const showMoreBtn = document.getElementById("tag-show-more-btn");
  if (!optionsEl || !showMoreBtn) {
    return;
  }

  const query = tagSearchQuery.toLowerCase();
  const filtered = tagCounts.filter((t) => !query || t.name.toLowerCase().includes(query));
  const visible = filtered.slice(0, tagShowLimit);

  optionsEl.innerHTML = "";

  for (const tag of visible) {
    const row = document.createElement("label");
    row.className = "tag-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedTags.has(tag.name);
    checkbox.addEventListener("change", async () => {
      if (checkbox.checked) {
        selectedTags.add(tag.name);
      } else {
        selectedTags.delete(tag.name);
      }
      page = 1;
      await renderCards();
    });

    const name = document.createElement("span");
    name.className = "tag-name";
    name.textContent = tag.name;

    const count = document.createElement("span");
    count.className = "tag-count";
    const hasCount = Number.isFinite(Number(tag.count)) && Number(tag.count) > 0;
    count.textContent = hasCount ? formatCompactCount(tag.count) : "";

    row.appendChild(checkbox);
    row.appendChild(name);
    row.appendChild(count);
    optionsEl.appendChild(row);
  }

  showMoreBtn.style.display = filtered.length > tagShowLimit ? "" : "none";
}

function renderTypeOptions() {
  renderCheckboxOptions("type-options", typeCounts, selectedTypes);
}

function renderExtraFilterOptions() {
  renderCheckboxOptions("players-options", playerCounts, selectedPlayers);
  renderCheckboxOptions("features-options", featureCounts, selectedFeatures);
  renderCheckboxOptions("hardware-options", hardwareCounts, selectedHardware);
  renderCheckboxOptions("accessibility-options", accessibilityCounts, selectedAccessibility);
  renderCheckboxOptions("platforms-options", platformCounts, selectedPlatforms);
  renderCheckboxOptions("languages-options", languageCounts, selectedLanguages, languageSearchQuery);
  renderCheckboxOptions("full-audio-languages-options", fullAudioLanguageCounts, selectedFullAudioLanguages, fullAudioLanguageSearchQuery);
  renderCheckboxOptions("subtitle-languages-options", subtitleLanguageCounts, selectedSubtitleLanguages, subtitleLanguageSearchQuery);
  renderCheckboxOptions("technologies-options", technologyCounts, selectedTechnologies, technologySearchQuery);
  renderCheckboxOptions("developers-options", developerCounts, selectedDevelopers, developerSearchQuery);
  renderCheckboxOptions("publishers-options", publisherCounts, selectedPublishers, publisherSearchQuery);
}

function getFilteredAndSorted(ids) {
  return filtersUtils.getFilteredAndSorted(ids, getFiltersContext());
}

function getFiltersContext() {
  return {
    searchQuery,
    sourceMode,
    sortMode,
    wishlistSortOrders,
    isWishlistRankReady,
    getSortContext,
    sortUtils,
    sortByWishlistPriority,
    getTitle: (appId) => String(state?.items?.[appId]?.title || metaCache?.[appId]?.titleText || ""),
    getMeta: (appId) => metaCache?.[appId] || {},
    getMetaTags,
    getMetaType,
    getMetaNumber,
    getMetaArray,
    selectedTags,
    selectedTypes,
    selectedPlayers,
    selectedFeatures,
    selectedHardware,
    selectedAccessibility,
    selectedPlatforms,
    selectedLanguages,
    selectedFullAudioLanguages,
    selectedSubtitleLanguages,
    selectedTechnologies,
    selectedDevelopers,
    selectedPublishers,
    releaseTextEnabled,
    getReleaseFilterData,
    releaseYearRangeEnabled,
    releaseYearMin,
    releaseYearMax,
    ratingMin,
    ratingMax,
    reviewsMin,
    reviewsMax,
    discountMin,
    discountMax,
    priceMin,
    priceMax
  };
}

function renderCollectionSelect() {
  dynamicCollectionSizes = {};
  for (const name of state?.collectionOrder || []) {
    if (isDynamicCollectionName(name)) {
      dynamicCollectionSizes[name] = getDynamicCollectionAppIds(name).length;
    } else {
      dynamicCollectionSizes[name] = (state?.collections?.[name] || []).length;
    }
  }
  const result = uiControlsUtils.renderCollectionSelect({
    state,
    sourceMode,
    activeCollection,
    wishlistCount: Object.keys(wishlistAddedMap || {}).length,
    wishlistSelectValue: WISHLIST_SELECT_VALUE,
    collectionSizes: dynamicCollectionSizes,
    dynamicNames: Object.keys(state?.dynamicCollections || {})
  });
  if (result?.activeCollection) {
    activeCollection = result.activeCollection;
  }
}

function renderPager(totalItems) {
  const result = uiControlsUtils.renderPager({
    totalItems,
    page,
    pageSize: PAGE_SIZE
  });
  if (Number.isFinite(Number(result?.page))) {
    page = Number(result.page);
  }
}

function createLineRow(options) {
  const appId = String(options?.appId || "");
  const title = String(options?.title || `App ${appId}`);
  const link = String(options?.link || "#");
  const imageUrl = String(options?.imageUrl || "");
  const reorderEnabled = Boolean(options?.reorderEnabled);
  const itemPosition = Number(options?.itemPosition || 0);
  const totalItems = Number(options?.totalItems || 0);
  const batchModeEnabled = Boolean(options?.batchMode);
  const selectedInBatch = Boolean(options?.selectedInBatch);
  const onBatchSelectionChange = options?.onBatchSelectionChange || (() => {});
  const onMoveUp = options?.onMoveUp || (() => Promise.resolve());
  const onMoveDown = options?.onMoveDown || (() => Promise.resolve());
  const onMoveToPosition = options?.onMoveToPosition || (() => Promise.resolve());
  const setStatus = options?.setStatus || (() => {});
  const maxPositionDigits = Math.max(1, Number(options?.maxPositionDigits || 1));

  const row = document.createElement("article");
  row.className = "line-row";
  if (batchModeEnabled) {
    row.classList.add("line-row-batch");
  }

  const batchWrap = document.createElement("div");
  batchWrap.className = "line-batch";
  const batchCheckbox = document.createElement("input");
  batchCheckbox.type = "checkbox";
  batchCheckbox.className = "line-batch-checkbox";
  batchCheckbox.checked = selectedInBatch;
  batchCheckbox.style.display = batchModeEnabled ? "" : "none";
  batchCheckbox.addEventListener("change", () => {
    onBatchSelectionChange(appId, batchCheckbox.checked);
  });
  batchWrap.appendChild(batchCheckbox);

  const left = document.createElement("div");
  left.className = "line-left";

  const upBtn = document.createElement("button");
  upBtn.type = "button";
  upBtn.className = "line-btn";
  upBtn.textContent = "▲";
  upBtn.disabled = !reorderEnabled || itemPosition <= 1;
  upBtn.addEventListener("click", () => onMoveUp(appId).catch(() => setStatus("Failed to move item up.", true)));

  const downBtn = document.createElement("button");
  downBtn.type = "button";
  downBtn.className = "line-btn";
  downBtn.textContent = "▼";
  downBtn.disabled = !reorderEnabled || itemPosition <= 0 || itemPosition >= totalItems;
  downBtn.addEventListener("click", () => onMoveDown(appId).catch(() => setStatus("Failed to move item down.", true)));

  const posInput = document.createElement("input");
  posInput.type = "number";
  posInput.min = "1";
  posInput.step = "1";
  posInput.className = "line-pos-input";
  posInput.value = itemPosition > 0 ? String(itemPosition) : "";
  posInput.disabled = !reorderEnabled;
  posInput.style.setProperty("--pos-digits", String(maxPositionDigits));
  posInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    const target = Number(posInput.value || 0);
    onMoveToPosition(appId, target).catch(() => setStatus("Failed to move item to position.", true));
  });

  left.appendChild(upBtn);
  left.appendChild(downBtn);
  left.appendChild(posInput);

  const center = document.createElement("div");
  center.className = "line-center";
  const thumbWrap = document.createElement("a");
  thumbWrap.className = "line-thumb";
  thumbWrap.href = link;
  thumbWrap.target = "_blank";
  thumbWrap.rel = "noopener noreferrer";
  const thumbImg = document.createElement("img");
  thumbImg.className = "line-thumb-img";
  thumbImg.alt = title;
  thumbImg.loading = "lazy";
  attachImageFallback(thumbImg, getCardImageCandidates(appId).concat(imageUrl || []));
  thumbWrap.appendChild(thumbImg);
  const titleEl = document.createElement("a");
  titleEl.className = "line-title";
  titleEl.href = link;
  titleEl.target = "_blank";
  titleEl.rel = "noopener noreferrer";
  titleEl.textContent = title;
  const reviewEl = document.createElement("span");
  reviewEl.className = "line-review";
  reviewEl.textContent = "-";
  center.appendChild(thumbWrap);
  center.appendChild(titleEl);
  center.appendChild(reviewEl);

  const right = document.createElement("div");
  right.className = "line-right";
  const priceEl = document.createElement("span");
  priceEl.className = "line-price";
  priceEl.textContent = "-";
  const discountEl = document.createElement("span");
  discountEl.className = "line-discount";
  discountEl.textContent = "-";
  right.appendChild(priceEl);
  right.appendChild(discountEl);

  row.appendChild(batchWrap);
  row.appendChild(left);
  row.appendChild(center);
  row.appendChild(right);

  return {
    row,
    titleEl,
    reviewEl,
    priceEl,
    discountEl
  };
}

function renderBatchMenuState() {
  const btn = document.getElementById("batch-menu-btn");
  const collectionSelect = document.getElementById("batch-collection-select");
  if (btn) {
    const count = batchSelectedIds.size;
    btn.textContent = count > 0 ? `Batch (${count})` : "Batch";
    btn.classList.toggle("active", batchMode);
  }
  if (collectionSelect) {
    const names = getStaticCollectionNames();
    collectionSelect.innerHTML = "";
    for (const name of names) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      collectionSelect.appendChild(option);
    }
    if (!batchAddTargetCollection || !names.includes(batchAddTargetCollection)) {
      batchAddTargetCollection = names[0] || "";
    }
    collectionSelect.value = batchAddTargetCollection;
    collectionSelect.disabled = names.length === 0;
  }
}

function toggleBatchMode(force = null) {
  batchMode = force === null ? !batchMode : Boolean(force);
  if (!batchMode) {
    batchSelectedIds.clear();
  }
  renderBatchMenuState();
}

async function applyBatchAdd() {
  if (!batchMode) {
    toggleBatchMode(true);
  }
  if (batchSelectedIds.size === 0) {
    setStatus("Select one or more cards for batch action.", true);
    return;
  }
  if (!batchAddTargetCollection || !getStaticCollectionNames().includes(batchAddTargetCollection)) {
    setStatus("Choose a valid collection to add.", true);
    return;
  }
  await browser.runtime.sendMessage({
    type: "batch-update-collection",
    mode: "add",
    collectionName: batchAddTargetCollection,
    appIds: Array.from(batchSelectedIds)
  });

  batchSelectedIds.clear();
  await refreshState();
  quickPopulateFiltersFromCache();
  refreshFilterOptionsInBackground();
  await render();
  setStatus("Selected games added to collection.");
}

async function applyBatchRemoveFromCurrentCollection() {
  if (!batchMode) {
    toggleBatchMode(true);
  }
  if (batchSelectedIds.size === 0) {
    setStatus("Select one or more cards for batch action.", true);
    return;
  }
  if (sourceMode !== "collections" || !activeCollection || activeCollection === "__all__" || isDynamicCollectionName(activeCollection)) {
    setStatus("Select a specific collection to remove selected games from it.", true);
    return;
  }
  const confirmed = window.confirm(
    `Tem certeza que quer remover ${batchSelectedIds.size} jogo(s) da coleção atual "${activeCollection}"?`
  );
  if (!confirmed) {
    return;
  }

  await browser.runtime.sendMessage({
    type: "batch-update-collection",
    mode: "remove",
    collectionName: activeCollection,
    appIds: Array.from(batchSelectedIds)
  });

  batchSelectedIds.clear();
  await refreshState();
  quickPopulateFiltersFromCache();
  refreshFilterOptionsInBackground();
  await render();
  setStatus("Selected games removed from current collection.");
}

function getCollectionsContainingApp(appId) {
  const out = [];
  for (const collectionName of Object.keys(state?.collections || {})) {
    const list = state?.collections?.[collectionName] || [];
    if (list.includes(appId)) {
      out.push(collectionName);
    }
  }
  return out;
}

function canManualReorder() {
  return sourceMode === "collections"
    && activeCollection !== "__all__"
    && !isDynamicCollectionName(activeCollection)
    && sortMode === "position"
    && !batchMode;
}

function getActiveCollectionOrder() {
  if (sourceMode !== "collections" || activeCollection === "__all__" || isDynamicCollectionName(activeCollection)) {
    return [];
  }
  return Array.isArray(state?.collections?.[activeCollection]) ? [...state.collections[activeCollection]] : [];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function persistActiveCollectionOrder(nextOrder) {
  if (sourceMode !== "collections" || activeCollection === "__all__" || isDynamicCollectionName(activeCollection)) {
    return;
  }
  await browser.runtime.sendMessage({
    type: "set-collection-items-order",
    collectionName: activeCollection,
    appIds: nextOrder
  });
  await refreshState();
  await render();
}

async function moveCollectionItemByDelta(appId, delta) {
  const order = getActiveCollectionOrder();
  const index = order.indexOf(appId);
  if (index < 0) {
    return;
  }
  const target = clamp(index + delta, 0, order.length - 1);
  if (target === index) {
    return;
  }
  const [item] = order.splice(index, 1);
  order.splice(target, 0, item);
  await persistActiveCollectionOrder(order);
}

async function moveCollectionItemToPosition(appId, targetPositionOneBased) {
  const order = getActiveCollectionOrder();
  const index = order.indexOf(appId);
  if (index < 0) {
    return;
  }
  const targetZero = clamp(Number(targetPositionOneBased || 1) - 1, 0, order.length - 1);
  if (!Number.isFinite(targetZero) || targetZero === index) {
    return;
  }
  const [item] = order.splice(index, 1);
  order.splice(targetZero, 0, item);
  await persistActiveCollectionOrder(order);
}

async function renderCards() {
  const cardsEl = document.getElementById("cards");
  const emptyEl = document.getElementById("empty");
  const template = document.getElementById("card-template");
  if (!cardsEl || !emptyEl || !template) {
    return;
  }

  const sourceIds = getCurrentSourceAppIds();
  const needsMetaForSort = sortMode !== "position";
  const needsMetaForSearch = Boolean(String(searchQuery || "").trim());
  const shouldSkipHeavyMetaHydration = sourceMode === "wishlist";

  if (sourceMode === "wishlist") {
    await ensureWishlistPrecomputedSorts(sourceIds);
  }

  if (!shouldSkipHeavyMetaHydration && (needsMetaForSort || needsMetaForSearch)) {
    setStatus("Loading metadata for sorting/search...");
    try {
      await ensureMetaForAppIds(sourceIds, sourceIds.length, false, "Loading metadata for sorting/search:");
    } catch {
      setStatus("Metadata loading partially failed.", true);
    }
  }

  const appIds = getFilteredAndSorted(sourceIds);
  const manualReorderEnabled = canManualReorder();
  const activeOrder = getActiveCollectionOrder();
  const orderIndex = new Map();
  for (let i = 0; i < activeOrder.length; i += 1) {
    orderIndex.set(activeOrder[i], i + 1);
  }
  renderPager(appIds.length);

  const start = (page - 1) * PAGE_SIZE;
  const pageIds = appIds.slice(start, start + PAGE_SIZE);
  const maxPositionInPage = start + pageIds.length;
  const maxPositionDigits = String(Math.max(1, maxPositionInPage)).length;
  currentRenderedPageIds = [...pageIds];
  if (!shouldSkipHeavyMetaHydration && (needsMetaForSort || needsMetaForSearch)) {
    setStatus("");
  }
  const rankReadyNow = sourceMode !== "wishlist" || isWishlistRankReady(sourceIds);
  if (sourceMode === "wishlist" && sortMode === "position" && !rankReadyNow) {
    setStatus(getWishlistRankUnavailableReason(), true);
  }

  cardsEl.innerHTML = "";
  cardsEl.classList.toggle("batch-mode", batchMode);
  cardsEl.classList.toggle("line-mode", viewMode === "line");
  emptyEl.classList.toggle("hidden", pageIds.length > 0);

  if (viewMode === "line") {
    for (const appId of pageIds) {
      const title = state?.items?.[appId]?.title || metaCache?.[appId]?.titleText || `App ${appId}`;
      const line = createLineRow({
        appId,
        title,
        link: getAppLink(appId),
        imageUrl: getCardImageUrl(appId),
        reorderEnabled: manualReorderEnabled,
        itemPosition: Number(orderIndex.get(appId) || 0),
        totalItems: activeOrder.length,
        batchMode,
        selectedInBatch: batchSelectedIds.has(appId),
        onBatchSelectionChange: (id, checked) => {
          if (checked) {
            batchSelectedIds.add(id);
          } else {
            batchSelectedIds.delete(id);
          }
          renderBatchMenuState();
        },
        onMoveUp: (id) => moveCollectionItemByDelta(id, -1),
        onMoveDown: (id) => moveCollectionItemByDelta(id, 1),
        onMoveToPosition: (id, position) => moveCollectionItemToPosition(id, position),
        maxPositionDigits,
        setStatus
      });
      cardsEl.appendChild(line.row);

      fetchAppMeta(appId).then((meta) => {
        if (line.titleEl && !state?.items?.[appId]?.title && meta.titleText) {
          line.titleEl.textContent = meta.titleText;
        }
        const pct = Number(meta?.reviewPositivePct);
        line.reviewEl.textContent = Number.isFinite(pct) && pct >= 0 ? `${pct}%` : "-";
        line.priceEl.textContent = meta?.priceText || "-";
        line.discountEl.textContent = meta?.discountText || "-";
      }).catch(() => {});
    }
    return;
  }

  for (const appId of pageIds) {
    const hasStateTitle = Boolean(state?.items?.[appId]?.title);
    const title = state?.items?.[appId]?.title || metaCache?.[appId]?.titleText || `App ${appId}`;
    const card = cardRenderUtils.createCardNodes({
      template,
      appId,
      title,
      link: getAppLink(appId)
    });
    cardRenderUtils.fillCardStatic({
      card,
      appId,
      imageUrl: getCardImageUrl(appId),
      wishlistDate: formatUnixDate(wishlistAddedMap[appId])
    });
    cardRenderUtils.bindCardActions({
      card,
      appId,
      sourceMode,
      activeCollection,
      allCollectionNames: getStaticCollectionNames(),
      selectedCollectionNames: getCollectionsContainingApp(appId),
      setStatus,
      confirmFn: (message) => window.confirm(message),
      onRefreshItem: (id) => refreshSingleItem(id),
      onToggleCollection: async (id, collectionName, checked) => {
        const payload = checked
          ? {
            type: "add-item-to-collection",
            appId: id,
            collectionName,
            item: {
              title: state?.items?.[id]?.title || metaCache?.[id]?.titleText || title
            }
          }
          : {
            type: "remove-item-from-collection",
            appId: id,
            collectionName
          };
        const response = await browser.runtime.sendMessage(payload);
        if (!response?.ok) {
          throw new Error(String(response?.error || "Failed to update item collections."));
        }
        await refreshState();
        quickPopulateFiltersFromCache();
        refreshFilterOptionsInBackground();
        await render();
        setStatus(`Collection ${checked ? "added" : "removed"}: ${collectionName}`);
      },
      batchMode,
      isBatchSelected: (id) => batchSelectedIds.has(id),
      onBatchSelectionChange: (id, checked) => {
        if (checked) {
          batchSelectedIds.add(id);
        } else {
          batchSelectedIds.delete(id);
        }
        renderBatchMenuState();
      },
      reorderEnabled: manualReorderEnabled,
      itemPosition: Number(orderIndex.get(appId) || 0),
      totalItems: activeOrder.length,
      maxPositionDigits,
      onMoveUp: (id) => moveCollectionItemByDelta(id, -1),
      onMoveDown: (id) => moveCollectionItemByDelta(id, 1),
      onMoveToPosition: (id, position) => moveCollectionItemToPosition(id, position),
      onRemoveItem: async (id, collectionName) => {
        await browser.runtime.sendMessage({
          type: "remove-item-from-collection",
          appId: id,
          collectionName
        });
        await refreshState();
        quickPopulateFiltersFromCache();
        refreshFilterOptionsInBackground();
        await render();
      }
    });
    cardsEl.appendChild(card.fragment);
    cardRenderUtils.hydrateCardMeta({
      card,
      appId,
      hasStateTitle,
      fetchMeta: (id) => fetchAppMeta(id)
    });
  }
}

async function refreshState() {
  state = await browser.runtime.sendMessage({ type: "get-state" });
}

async function createCollectionByName(rawName) {
  const result = await crudUtils.createCollectionByName({
    rawName,
    normalizeCollectionName,
    setStatus,
    sendMessage: (payload) => browser.runtime.sendMessage(payload),
    refreshState,
    onAfterChange: async () => {
      quickPopulateFiltersFromCache();
      refreshFilterOptionsInBackground();
    }
  });
  if (result?.ok) {
    activeCollection = result.activeCollection ?? activeCollection;
    sourceMode = result.sourceMode ?? sourceMode;
    page = Number.isFinite(Number(result.page)) ? Number(result.page) : page;
  }
  await render();
}

async function createOrUpdateDynamicCollectionByName(rawName) {
  const name = normalizeCollectionName(rawName);
  if (!name) {
    setStatus("Type a dynamic collection name.", true);
    return;
  }
  const existing = getExistingCollectionNames().includes(name);
  if (existing) {
    if (!isDynamicCollectionName(name)) {
      setStatus(`"${name}" is a static collection. Choose another name for dynamic collection.`, true);
      return;
    }
    const confirmed = window.confirm(`Collection "${name}" already exists. Update it as dynamic with current filters and sort?`);
    if (!confirmed) {
      return;
    }
  }

  const definition = buildDynamicDefinitionFromCurrentView();
  await browser.runtime.sendMessage({
    type: "create-or-update-dynamic-collection",
    collectionName: name,
    definition
  });
  await refreshState();
  activeCollection = name;
  sourceMode = "collections";
  page = 1;
  setStatus(`Dynamic collection "${name}" saved.`);
  await render();
}

async function renameActiveCollectionByName(rawName) {
  const result = await crudUtils.renameActiveCollectionByName({
    rawName,
    normalizeCollectionName,
    sourceMode,
    activeCollection,
    setStatus,
    sendMessage: (payload) => browser.runtime.sendMessage(payload),
    refreshState,
    onAfterChange: async () => {
      quickPopulateFiltersFromCache();
      refreshFilterOptionsInBackground();
    }
  });
  if (result?.ok) {
    activeCollection = result.activeCollection ?? activeCollection;
    page = Number.isFinite(Number(result.page)) ? Number(result.page) : page;
  }
  await render();
}

async function deleteCollectionByName(rawName) {
  const result = await crudUtils.deleteCollectionByName({
    rawName,
    normalizeCollectionName,
    activeCollection,
    sourceMode,
    setStatus,
    sendMessage: (payload) => browser.runtime.sendMessage(payload),
    refreshState,
    confirmFn: (message) => window.confirm(message),
    onAfterChange: async () => {
      quickPopulateFiltersFromCache();
      refreshFilterOptionsInBackground();
    }
  });
  if (result?.ok) {
    activeCollection = result.activeCollection ?? activeCollection;
    sourceMode = result.sourceMode ?? sourceMode;
    page = Number.isFinite(Number(result.page)) ? Number(result.page) : page;
  }
  await render();
}

async function render() {
  const sortSelect = document.getElementById("sort-select");
  const viewSelect = document.getElementById("view-select");
  const renameActionBtn = document.getElementById("menu-action-rename");
  const deleteActionBtn = document.getElementById("menu-action-delete");
  const deleteSelect = document.getElementById("delete-collection-select");
  if (sortSelect) {
    sortSelect.value = sortMode;
  }
  if (viewSelect) {
    viewSelect.value = viewMode;
  }

  renderSortMenu();
  renderViewMenu();
  renderCollectionSelect();
  renderBatchMenuState();
  const canRenameCurrent = sourceMode !== "wishlist" && activeCollection !== "__all__";
  if (renameActionBtn) {
    renameActionBtn.disabled = !canRenameCurrent;
  }
  if (deleteActionBtn) {
    deleteActionBtn.disabled = (state?.collectionOrder || []).length === 0;
  }
  if (deleteSelect) {
    deleteSelect.disabled = (state?.collectionOrder || []).length === 0;
  }
  await renderCards();
}

function renderRatingControls() {
  const minBound = getReleaseYearMinBound();
  const maxBound = getReleaseYearMaxBound();
  releaseYearMin = clampReleaseYearValue(releaseYearMin, RELEASE_YEAR_DEFAULT_MIN, minBound, maxBound);
  releaseYearMax = clampReleaseYearValue(releaseYearMax, maxBound, minBound, maxBound);
  if (releaseYearMin > releaseYearMax) {
    releaseYearMin = releaseYearMax;
  }

  rangeControlsUtils.renderRangeControls({
    ratingMin,
    ratingMax,
    reviewsMin,
    reviewsMax,
    discountMin,
    discountMax,
    priceMin,
    priceMax,
    releaseTextEnabled,
    releaseYearRangeEnabled,
    releaseYearMin,
    releaseYearMax,
    releaseYearRangeMinBound: minBound,
    releaseYearRangeMaxBound: maxBound
  });
}

function renderSortMenu() {
  uiControlsUtils.renderSortMenu({ fallbackLabel: "Release Date" });
}

function renderViewMenu() {
  uiControlsUtils.renderViewMenu();
}

function toggleSortMenu(forceOpen = null) {
  panelsUtils.togglePanel("sort-menu-panel", forceOpen);
}

function toggleCollectionSelectMenu(forceOpen = null) {
  panelsUtils.togglePanel("collection-select-panel", forceOpen);
}

function toggleViewMenu(forceOpen = null) {
  panelsUtils.togglePanel("view-menu-panel", forceOpen);
}

function hideCollectionMenuForms() {
  document.getElementById("rename-collection-form")?.classList.add("hidden");
  document.getElementById("create-collection-form")?.classList.add("hidden");
  document.getElementById("dynamic-collection-form")?.classList.add("hidden");
  document.getElementById("delete-collection-form")?.classList.add("hidden");
}

function toggleCollectionMenu(forceOpen = null) {
  panelsUtils.toggleCollectionMenu(forceOpen, { onClose: hideCollectionMenuForms });
}

function clearFilterSearchInputs() {
  const ids = [
    "languages-search-input",
    "full-audio-languages-search-input",
    "subtitle-languages-search-input",
    "technologies-search-input",
    "developers-search-input",
    "publishers-search-input"
  ];
  filterStateUtils.clearSearchInputs(ids);
}

function resetAllFiltersState() {
  const reset = filterStateUtils.resetFilterState({
    tagShowStep: TAG_SHOW_STEP,
    sets: [
      selectedTags,
      selectedTypes,
      selectedPlayers,
      selectedFeatures,
      selectedHardware,
      selectedAccessibility,
      selectedPlatforms,
      selectedLanguages,
      selectedFullAudioLanguages,
      selectedSubtitleLanguages,
      selectedTechnologies,
      selectedDevelopers,
      selectedPublishers
    ]
  });
  languageSearchQuery = reset.languageSearchQuery;
  fullAudioLanguageSearchQuery = reset.fullAudioLanguageSearchQuery;
  subtitleLanguageSearchQuery = reset.subtitleLanguageSearchQuery;
  technologySearchQuery = reset.technologySearchQuery;
  developerSearchQuery = reset.developerSearchQuery;
  publisherSearchQuery = reset.publisherSearchQuery;
  tagSearchQuery = reset.tagSearchQuery;
  tagShowLimit = reset.tagShowLimit;
  releaseTextEnabled = true;
  releaseYearRangeEnabled = true;
  releaseYearMin = RELEASE_YEAR_DEFAULT_MIN;
  releaseYearMax = getReleaseYearMaxBound();
  clearFilterSearchInputs();
}

async function handleCollectionChange(value) {
  const resolved = actionsUtils.resolveCollectionSelection(value, WISHLIST_SELECT_VALUE);
  sourceMode = resolved.sourceMode;
  activeCollection = resolved.activeCollection;
  page = resolved.page;
  batchSelectedIds.clear();

  if (sourceMode !== "wishlist") {
    await browser.runtime.sendMessage({
      type: "set-active-collection",
      activeCollection
    });
  }

  const dynamicDef = sourceMode === "collections" ? state?.dynamicCollections?.[activeCollection] : null;
  if (dynamicDef) {
    applyFilterSnapshot(dynamicDef.filters || {});
    sortMode = String(dynamicDef.sortMode || sortMode || "title");
  } else {
    resetAllFiltersState();
  }
  quickPopulateFiltersFromCache();
  refreshFilterOptionsInBackground();
  await render();
}

async function handleSortChange(value) {
  const resolved = actionsUtils.resolveSortSelection(value, sourceMode, isWishlistRankReady);
  sortMode = resolved.sortMode;
  page = resolved.page;
  if (resolved.statusMessage) {
    setStatus(resolved.statusMessage);
  }
  renderSortMenu();
  await render();
}

function bindCollectionControls() {
  selectionBindingsUtils.bindCollectionControls({
    onCollectionChange: handleCollectionChange,
    closeMenusBeforeOpenCollectionSelect: () => {
      toggleCollectionMenu(false);
      toggleSortMenu(false);
    },
    toggleCollectionSelectMenu: () => toggleCollectionSelectMenu(),
    closeCollectionSelectMenu: () => toggleCollectionSelectMenu(false)
  });
}

function bindSortControls() {
  selectionBindingsUtils.bindSortControls({
    onSortChange: handleSortChange,
    closeMenusBeforeOpenSort: () => {
      toggleCollectionMenu(false);
      toggleCollectionSelectMenu(false);
    },
    toggleSortMenu: () => toggleSortMenu(),
    closeSortMenu: () => toggleSortMenu(false)
  });
}

function bindViewControls() {
  selectionBindingsUtils.bindViewControls({
    onViewChange: async (value) => {
      const candidate = String(value || "card");
      viewMode = candidate === "line" ? "line" : "card";
      page = 1;
      renderViewMenu();
      await render();
    },
    closeMenusBeforeOpenView: () => {
      toggleCollectionMenu(false);
      toggleCollectionSelectMenu(false);
      toggleSortMenu(false);
    },
    toggleViewMenu: () => toggleViewMenu(),
    closeViewMenu: () => toggleViewMenu(false)
  });
}

function bindCollectionMenuControls() {
  menuBindingsUtils.bindCollectionMenuControls({
    hideForms: hideCollectionMenuForms,
    toggleCollectionSelectMenu,
    toggleSortMenu,
    toggleCollectionMenu,
    renameHandler: renameActiveCollectionByName,
    createHandler: createCollectionByName,
    dynamicHandler: createOrUpdateDynamicCollectionByName,
    deleteHandler: deleteCollectionByName,
    onError: (message) => setStatus(message, true)
  });
}

function bindBatchControls() {
  const batchBtn = document.getElementById("batch-menu-btn");
  const addActionBtn = document.getElementById("batch-action-add");
  const removeActionBtn = document.getElementById("batch-action-remove");
  const addForm = document.getElementById("batch-add-form");
  const collectionSelect = document.getElementById("batch-collection-select");
  const addApplyBtn = document.getElementById("batch-add-apply-btn");

  batchBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    const panel = document.getElementById("batch-menu-panel");
    const panelOpen = panel ? !panel.classList.contains("hidden") : false;
    if (batchMode && panelOpen) {
      toggleBatchMode(false);
      panelsUtils.togglePanel("batch-menu-panel", false);
      render().catch(() => setStatus("Failed to exit batch mode.", true));
      return;
    }
    toggleCollectionMenu(false);
    toggleCollectionSelectMenu(false);
    toggleSortMenu(false);
    toggleViewMenu(false);
    toggleBatchMode(true);
    panelsUtils.togglePanel("batch-menu-panel");
    addForm?.classList.add("hidden");
    render().catch(() => setStatus("Failed to enter batch mode.", true));
  });

  addActionBtn?.addEventListener("click", () => {
    addForm?.classList.remove("hidden");
  });

  collectionSelect?.addEventListener("change", () => {
    batchAddTargetCollection = String(collectionSelect.value || "");
    renderBatchMenuState();
  });

  addApplyBtn?.addEventListener("click", () => {
    applyBatchAdd().catch(() => setStatus("Failed to apply batch add.", true));
  });

  removeActionBtn?.addEventListener("click", () => {
    applyBatchRemoveFromCurrentCollection().catch(() => setStatus("Failed to apply batch remove.", true));
  });
}

function bindFilterControls() {
  generalBindingsUtils.bindGeneralControls({
    onSearchInput: async (value) => {
      searchQuery = value;
      page = 1;
      await render();
    },
    onPrevPage: async () => {
      page = Math.max(1, page - 1);
      await renderCards();
    },
    onNextPage: async () => {
      page += 1;
      await renderCards();
    },
    onTagSearchInput: (value) => {
      tagSearchQuery = value;
      tagShowLimit = TAG_SHOW_STEP;
      renderTagOptions();
    },
    onTagShowMore: () => {
      tagShowLimit += TAG_SHOW_STEP;
      renderTagOptions();
    },
    onTextFilterInput: (inputId, value) => {
      if (inputId === "languages-search-input") languageSearchQuery = value;
      if (inputId === "full-audio-languages-search-input") fullAudioLanguageSearchQuery = value;
      if (inputId === "subtitle-languages-search-input") subtitleLanguageSearchQuery = value;
      if (inputId === "technologies-search-input") technologySearchQuery = value;
      if (inputId === "developers-search-input") developerSearchQuery = value;
      if (inputId === "publishers-search-input") publisherSearchQuery = value;
      renderExtraFilterOptions();
    },
    onRefreshPage: () => {
      refreshCurrentPageItems().catch(() => setStatus("Failed to refresh visible items.", true));
    }
  });

  rangeControlsUtils.bindRangeControls({
    onRatingMinInput: async (rawValue) => {
      const next = parseNonNegativeInt(rawValue, ratingMin);
      ratingMin = Math.max(0, Math.min(next, ratingMax));
      renderRatingControls();
      page = 1;
      await renderCards();
    },
    onRatingMaxInput: async (rawValue) => {
      const next = parseNonNegativeInt(rawValue, ratingMax);
      ratingMax = Math.min(100, Math.max(next, ratingMin));
      renderRatingControls();
      page = 1;
      await renderCards();
    },
    onApplyReviews: async (rawMin, rawMax) => {
      const minValue = parseNonNegativeInt(rawMin, 0);
      const maxValue = parseNonNegativeInt(rawMax, 999999999);
      reviewsMin = Math.min(minValue, maxValue);
      reviewsMax = Math.max(minValue, maxValue);
      renderRatingControls();
      page = 1;
      await renderCards();
    },
    onDiscountMinInput: async (rawValue) => {
      const next = parseNonNegativeInt(rawValue, discountMin);
      discountMin = Math.max(0, Math.min(next, discountMax));
      renderRatingControls();
      page = 1;
      await renderCards();
    },
    onDiscountMaxInput: async (rawValue) => {
      const next = parseNonNegativeInt(rawValue, discountMax);
      discountMax = Math.min(100, Math.max(next, discountMin));
      renderRatingControls();
      page = 1;
      await renderCards();
    },
    onApplyPrice: async (rawMin, rawMax) => {
      const minValue = Number(rawMin || 0);
      const maxValue = Number(rawMax || 9999999);
      const normMin = Number.isFinite(minValue) && minValue >= 0 ? minValue : 0;
      const normMax = Number.isFinite(maxValue) && maxValue >= 0 ? maxValue : 9999999;
      priceMin = Math.min(normMin, normMax);
      priceMax = Math.max(normMin, normMax);
      renderRatingControls();
      page = 1;
      await renderCards();
    },
    onReleaseTextToggle: async (enabled) => {
      releaseTextEnabled = Boolean(enabled);
      renderRatingControls();
      page = 1;
      await renderCards();
    },
    onReleaseYearRangeToggle: async (enabled) => {
      releaseYearRangeEnabled = Boolean(enabled);
      renderRatingControls();
      page = 1;
      await renderCards();
    },
    onReleaseYearMinInput: async (rawValue) => {
      const minBound = getReleaseYearMinBound();
      const maxBound = getReleaseYearMaxBound();
      const next = clampReleaseYearValue(rawValue, releaseYearMin, minBound, maxBound);
      releaseYearMin = Math.max(minBound, Math.min(next, releaseYearMax));
      renderRatingControls();
      page = 1;
      await renderCards();
    },
    onReleaseYearMaxInput: async (rawValue) => {
      const minBound = getReleaseYearMinBound();
      const maxBound = getReleaseYearMaxBound();
      const next = clampReleaseYearValue(rawValue, releaseYearMax, minBound, maxBound);
      releaseYearMax = Math.min(maxBound, Math.max(next, releaseYearMin));
      renderRatingControls();
      page = 1;
      await renderCards();
    }
  });
}

function bindGlobalPanelClose() {
  panelsUtils.bindOutsidePanelClose([
    {
      panelId: "collection-menu-panel",
      buttonId: "collection-menu-btn",
      onClose: () => toggleCollectionMenu(false)
    },
    {
      panelId: "sort-menu-panel",
      buttonId: "sort-menu-btn",
      onClose: () => toggleSortMenu(false)
    },
    {
      panelId: "view-menu-panel",
      buttonId: "view-menu-btn",
      onClose: () => toggleViewMenu(false)
    },
    {
      panelId: "collection-select-panel",
      buttonId: "collection-select-btn",
      onClose: () => toggleCollectionSelectMenu(false)
    },
    {
      panelId: "batch-menu-panel",
      buttonId: "batch-menu-btn",
      onClose: () => panelsUtils.togglePanel("batch-menu-panel", false)
    }
  ]);
}

function attachEvents() {
  bindCollectionControls();
  bindSortControls();
  bindViewControls();
  bindCollectionMenuControls();
  bindBatchControls();
  bindFilterControls();
  bindGlobalPanelClose();
}

initUtils.run({
  loadMetaCache,
  loadWishlistAddedMap,
  refreshState: async () => {
    await refreshState();
    return state;
  },
  setActiveCollectionFromState: (nextState) => {
    activeCollection = nextState?.activeCollection || "__all__";
  },
  attachEvents,
  quickPopulateFiltersFromCache,
  renderRatingControls,
  render,
  refreshFilterOptionsInBackground,
  refreshWholeDatabase
}).catch(() => setStatus("Failed to load collections page.", true));
