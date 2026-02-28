const PAGE_SIZE = 30;
const META_CACHE_KEY = "steamWishlistCollectionsMetaCacheV4";
const META_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const WISHLIST_ADDED_CACHE_KEY = "steamWishlistAddedMapV3";
const TRACK_FEED_CACHE_KEY = "steamWishlistTrackFeedV1";
const TRACK_FEED_META_KEY = "steamWishlistTrackFeedMetaV1";
const TRACK_FEED_DISMISSED_KEY = "steamWishlistTrackFeedDismissedV1";
const TRACK_FEED_AUTO_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const TRACK_FEED_AUTO_RETRY_INTERVAL_MS = 2 * 60 * 1000;
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
const INBOX_SELECT_VALUE = "__inbox__";
const TRACK_SELECT_VALUE = "__track__";
const BUY_SELECT_VALUE = "__buy__";
const ARCHIVE_SELECT_VALUE = "__archive__";
const OWNED_SELECT_VALUE = "__owned__";
const TRACK_FEED_SELECT_VALUE = "__track_feed__";
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
let sourceMode = "wishlist";
let page = 1;
let searchQuery = "";
let triageFilter = "all";
let onlyUnderTarget = false;
let trackWindowDays = 30;
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
let trackFeedEntries = [];
let trackFeedRefreshing = false;
let trackFeedLastRefreshedAt = 0;
let trackFeedLastAutoRefreshAttemptAt = 0;
let trackFeedDismissedEventIds = new Set();
let lastErrorStatusLogKey = "";
let lastErrorStatusLoggedAt = 0;

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
let keyboardFocusIndex = 0;

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

function getNetworkTelemetryHint() {
  if (!steamFetchUtils || typeof steamFetchUtils.getTelemetrySummary !== "function") {
    return "";
  }
  try {
    const summary = String(steamFetchUtils.getTelemetrySummary(2) || "").trim();
    return summary ? ` | ${summary}` : "";
  } catch {
    return "";
  }
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

function setStatus(text, isError = false, options = {}) {
  const el = document.getElementById("status");
  if (!el) {
    return;
  }
  const withNetworkHint = Boolean(options?.withNetworkHint || isError);
  const suffix = withNetworkHint ? getNetworkTelemetryHint() : "";
  const composedText = `${text}${suffix}`;
  el.textContent = composedText;
  el.style.color = isError ? "#ff9696" : "";

  if (isError) {
    const now = Date.now();
    const key = composedText.slice(0, 400);
    const shouldLog = key && (key !== lastErrorStatusLogKey || (now - lastErrorStatusLoggedAt) > 5000);
    if (shouldLog) {
      lastErrorStatusLogKey = key;
      lastErrorStatusLoggedAt = now;
      browser.runtime.sendMessage({
        type: "append-log-entry",
        level: "warn",
        source: "collections.status",
        message: key
      }).catch(() => {});
    }
  }
}

function setTrackFeedProgress(text) {
  const el = document.getElementById("track-feed-progress");
  if (!el) {
    return;
  }
  const next = String(text || "").trim();
  el.textContent = next;
  const shouldShow = activeCollection === TRACK_FEED_SELECT_VALUE && Boolean(next);
  el.classList.toggle("hidden", !shouldShow);
}

function renderTrackFeedMeta() {
  const progressEl = document.getElementById("track-feed-progress");
  if (!progressEl || activeCollection !== TRACK_FEED_SELECT_VALUE) {
    return;
  }
  if (trackFeedRefreshing) {
    return;
  }
  if (Number(trackFeedLastRefreshedAt || 0) > 0) {
    const ts = new Date(Number(trackFeedLastRefreshedAt)).toLocaleString("pt-BR");
    setTrackFeedProgress(`Last refreshed: ${ts} | events: ${trackFeedEntries.length} | dismissed: ${trackFeedDismissedEventIds.size}`);
    return;
  }
  setTrackFeedProgress(`Track feed not refreshed yet | events: ${trackFeedEntries.length} | dismissed: ${trackFeedDismissedEventIds.size}`);
}

function updateTrackFeedRefreshButtonState() {
  const refreshTrackFeedBtn = document.getElementById("refresh-track-feed-btn");
  const resetTrackFeedDismissedBtn = document.getElementById("reset-track-feed-dismissed-btn");
  if (!refreshTrackFeedBtn) {
    return;
  }
  refreshTrackFeedBtn.disabled = trackFeedRefreshing;
  refreshTrackFeedBtn.textContent = trackFeedRefreshing ? "Refreshing..." : "Refresh track feed";
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

function formatFeedDate(timestampSec) {
  const n = Number(timestampSec || 0);
  if (!Number.isFinite(n) || n <= 0) {
    return "-";
  }
  return new Date(n * 1000).toLocaleString("pt-BR");
}

function deriveBucketFromState(track, buy, owned) {
  if (owned) {
    return "ARCHIVE";
  }
  if (buy >= 2) {
    return "BUY";
  }
  if (buy === 1) {
    return "MAYBE";
  }
  if (track > 0) {
    return "TRACK";
  }
  return "INBOX";
}

function getItemIntentState(appId) {
  const item = state?.items?.[appId] || {};
  const steamWishlisted = Object.prototype.hasOwnProperty.call(wishlistAddedMap || {}, String(appId || ""));
  const buyRaw = Number(item.buy || 0);
  const trackRaw = Number(item.track || 0);
  const rawBuyIntent = String(item.buyIntent || "").trim().toUpperCase();
  const rawTrackIntent = String(item.trackIntent || "").trim().toUpperCase();
  const buyIntent = rawBuyIntent === "BUY" || rawBuyIntent === "MAYBE" || rawBuyIntent === "NONE" || rawBuyIntent === "UNSET"
    ? rawBuyIntent
    : (buyRaw >= 2 ? "BUY" : (buyRaw > 0 ? "MAYBE" : "UNSET"));
  const trackIntent = rawTrackIntent === "ON" || rawTrackIntent === "OFF" || rawTrackIntent === "UNSET"
    ? rawTrackIntent
    : (trackRaw > 0 ? "ON" : "UNSET");
  const track = trackIntent === "ON" ? 1 : (trackIntent === "OFF" ? 0 : (trackRaw > 0 ? 1 : 0));
  const buy = buyIntent === "BUY" ? 2 : (buyIntent === "MAYBE" ? 1 : (buyRaw >= 2 ? 2 : (buyRaw > 0 ? 1 : 0)));
  const muted = Boolean(item.muted);
  const note = String(item.note || "").trim();
  const labels = Array.isArray(item.labels) ? item.labels.map((label) => String(label || "").trim().toLowerCase()).filter(Boolean) : [];
  const owned = labels.includes("owned");
  const bucket = deriveBucketFromState(track, buy, owned);
  const targetPriceCents = Number.isFinite(Number(item.targetPriceCents))
    ? Math.max(0, Math.floor(Number(item.targetPriceCents)))
    : null;
  return {
    track,
    buy,
    trackIntent,
    buyIntent,
    steamWishlisted,
    bucket,
    muted,
    note,
    owned,
    targetPriceCents
  };
}

function parseTrackWindowDays(value) {
  const n = Number(value || 30);
  if (!Number.isFinite(n)) {
    return 30;
  }
  if (n <= 0) {
    return 0;
  }
  if (n <= 7) {
    return 7;
  }
  if (n <= 30) {
    return 30;
  }
  return 30;
}

function isPriceAtOrUnderTarget(meta, targetPriceCents) {
  const targetCents = Number(targetPriceCents || 0);
  if (!(targetCents > 0)) {
    return false;
  }
  const priceLabel = String(meta?.priceText || "").trim().toLowerCase();
  const priceKnown = priceLabel && priceLabel !== "-" && priceLabel !== "not announced";
  const priceCents = Number(meta?.priceFinal || 0);
  return Boolean(priceKnown && Number.isFinite(priceCents) && priceCents <= targetCents);
}

function matchesTriageFilter(appId) {
  const intent = getItemIntentState(appId);
  if (onlyUnderTarget) {
    const targetCents = Number(intent.targetPriceCents || 0);
    const meta = metaCache?.[appId] || {};
    if (!isPriceAtOrUnderTarget(meta, targetCents)) {
      return false;
    }
  }
  const filter = String(triageFilter || "all").toLowerCase();
  if (filter === "all") {
    return true;
  }
  const bucket = String(intent.bucket || "INBOX").toLowerCase();
  if (filter === "track") {
    return bucket === "track";
  }
  if (filter === "buy") {
    return bucket === "buy";
  }
  if (filter === "maybe") {
    return bucket === "maybe";
  }
  if (filter === "archive") {
    return bucket === "archive";
  }
  if (filter === "inbox") {
    return bucket === "inbox";
  }
  return true;
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

function isVirtualCollectionSelection(name) {
  const key = String(name || "").trim();
  return key === INBOX_SELECT_VALUE
    || key === TRACK_SELECT_VALUE
    || key === BUY_SELECT_VALUE
    || key === ARCHIVE_SELECT_VALUE
    || key === OWNED_SELECT_VALUE
    || key === TRACK_FEED_SELECT_VALUE;
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
    releaseYearMax,
    onlyUnderTarget,
    trackWindowDays
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
  onlyUnderTarget = Boolean(data.onlyUnderTarget);
  trackWindowDays = parseTrackWindowDays(data.trackWindowDays);
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

function normalizeFilterSnapshotForCompare(snapshot) {
  const src = snapshot && typeof snapshot === "object" ? snapshot : {};
  const out = { ...src };
  const arrayKeys = [
    "selectedTags",
    "selectedTypes",
    "selectedPlayers",
    "selectedFeatures",
    "selectedHardware",
    "selectedAccessibility",
    "selectedPlatforms",
    "selectedLanguages",
    "selectedFullAudioLanguages",
    "selectedSubtitleLanguages",
    "selectedTechnologies",
    "selectedDevelopers",
    "selectedPublishers"
  ];
  for (const key of arrayKeys) {
    const arr = Array.isArray(out[key]) ? out[key] : [];
    out[key] = Array.from(new Set(arr.map((v) => String(v || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }
  return out;
}

function normalizeDynamicDefinitionForCompare(definition) {
  const def = definition && typeof definition === "object" ? definition : {};
  return {
    baseSource: String(def.baseSource || "wishlist"),
    baseCollection: String(def.baseCollection || ""),
    sortMode: String(def.sortMode || "title"),
    filters: normalizeFilterSnapshotForCompare(def.filters || {})
  };
}

function countActiveFiltersInSnapshot(snapshot) {
  const data = snapshot && typeof snapshot === "object" ? snapshot : {};
  let count = 0;
  const arrayKeys = [
    "selectedTags",
    "selectedTypes",
    "selectedPlayers",
    "selectedFeatures",
    "selectedHardware",
    "selectedAccessibility",
    "selectedPlatforms",
    "selectedLanguages",
    "selectedFullAudioLanguages",
    "selectedSubtitleLanguages",
    "selectedTechnologies",
    "selectedDevelopers",
    "selectedPublishers"
  ];
  for (const key of arrayKeys) {
    const arr = Array.isArray(data[key]) ? data[key] : [];
    count += arr.length;
  }
  if (Number(data.ratingMin || 0) > 0 || Number(data.ratingMax || 100) < 100) {
    count += 1;
  }
  if (Number(data.reviewsMin || 0) > 0 || Number(data.reviewsMax || 999999999) < 999999999) {
    count += 1;
  }
  if (Number(data.discountMin || 0) > 0 || Number(data.discountMax || 100) < 100) {
    count += 1;
  }
  if (Number(data.priceMin || 0) > 0 || Number(data.priceMax || 9999999) < 9999999) {
    count += 1;
  }
  if (Boolean(data.releaseTextEnabled) !== true) {
    count += 1;
  }
  if (Boolean(data.releaseYearRangeEnabled) !== true
    || Number(data.releaseYearMin || RELEASE_YEAR_DEFAULT_MIN) !== RELEASE_YEAR_DEFAULT_MIN
    || Number(data.releaseYearMax || getReleaseYearMaxBound()) !== getReleaseYearMaxBound()
  ) {
    count += 1;
  }
  if (Boolean(data.onlyUnderTarget)) {
    count += 1;
  }
  const trackWindow = parseTrackWindowDays(data.trackWindowDays);
  if (trackWindow !== 30) {
    count += 1;
  }
  return count;
}

function describeDynamicBase(definition) {
  const def = definition && typeof definition === "object" ? definition : {};
  const baseSource = String(def.baseSource || "wishlist");
  if (baseSource === "wishlist") {
    return "Steam wishlist";
  }
  if (baseSource === "all-static") {
    return "All static collections";
  }
  if (baseSource === "static-collection") {
    return `Static: ${String(def.baseCollection || "-")}`;
  }
  return baseSource;
}

function renderDynamicCollectionFormHint() {
  const hintEl = document.getElementById("dynamic-collection-hint");
  if (!hintEl) {
    return;
  }
  const definition = buildDynamicDefinitionFromCurrentView();
  const filtersCount = countActiveFiltersInSnapshot(definition.filters || {});
  const baseLabel = describeDynamicBase(definition);
  const sortLabel = String(sortMode || "title");
  const currentIsDynamic = sourceMode === "collections" && isDynamicCollectionName(activeCollection);
  const currentLabel = currentIsDynamic ? ` | editing: ${activeCollection}` : "";
  hintEl.textContent = `Base: ${baseLabel} | sort: ${sortLabel} | active filters: ${filtersCount}${currentLabel}`;
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

  if (activeCollection === INBOX_SELECT_VALUE) {
    const out = [];
    for (const appId of Object.keys(state.items || {})) {
      const intent = getItemIntentState(appId);
      if (intent.bucket === "INBOX") {
        out.push(appId);
      }
    }
    return out;
  }

  if (activeCollection === TRACK_SELECT_VALUE) {
    const out = [];
    const windowDays = parseTrackWindowDays(trackWindowDays);
    const cutoffMs = windowDays > 0 ? (Date.now() - (windowDays * 24 * 60 * 60 * 1000)) : 0;
    for (const appId of Object.keys(state.items || {})) {
      const intent = getItemIntentState(appId);
      if (intent.track > 0 && !intent.owned) {
        if (cutoffMs > 0) {
          const triagedAt = Number(state?.items?.[appId]?.triagedAt || 0);
          if (!Number.isFinite(triagedAt) || triagedAt < cutoffMs) {
            continue;
          }
        }
        out.push(appId);
      }
    }
    out.sort((a, b) => Number(state?.items?.[b]?.triagedAt || 0) - Number(state?.items?.[a]?.triagedAt || 0));
    return out;
  }

  if (activeCollection === BUY_SELECT_VALUE) {
    const out = [];
    for (const appId of Object.keys(state.items || {})) {
      const intent = getItemIntentState(appId);
      if (!intent.owned && intent.buy > 0) {
        out.push(appId);
      }
    }
    return out;
  }

  if (activeCollection === ARCHIVE_SELECT_VALUE) {
    const out = [];
    for (const appId of Object.keys(state.items || {})) {
      const intent = getItemIntentState(appId);
      if (intent.owned) {
        out.push(appId);
      }
    }
    return out;
  }

  if (activeCollection === OWNED_SELECT_VALUE) {
    const out = [];
    for (const appId of Object.keys(state.items || {})) {
      const intent = getItemIntentState(appId);
      if (intent.owned) {
        out.push(appId);
      }
    }
    return out;
  }

  if (activeCollection === TRACK_FEED_SELECT_VALUE) {
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

function getTrackSourceAppIds() {
  const out = [];
  for (const appId of Object.keys(state?.items || {})) {
    const intent = getItemIntentState(appId);
    if (intent.track > 0 && !intent.owned) {
      out.push(appId);
    }
  }
  return out;
}

async function refreshTrackFeed() {
  if (trackFeedRefreshing) {
    setStatus("Track feed refresh already in progress.");
    return;
  }
  const trackIds = getTrackSourceAppIds();
  if (trackIds.length === 0) {
    setStatus("No tracked items to refresh feed.");
    setTrackFeedProgress("");
    return;
  }
  trackFeedRefreshing = true;
  updateTrackFeedRefreshButtonState();
  try {
    setStatus(`Refreshing Track Feed... 0/${trackIds.length}`);
    setTrackFeedProgress(`Refreshing track feed... 0/${trackIds.length}`);
    const dedupe = new Map();
    const nowSec = Math.floor(Date.now() / 1000);
    const keepSince = nowSec - (60 * 24 * 60 * 60);
    for (const old of trackFeedEntries) {
      if (Number(old?.publishedAt || 0) >= keepSince && old?.eventId) {
        dedupe.set(String(old.eventId), old);
      }
    }

    let done = 0;
    for (const appId of trackIds) {
      try {
        const payload = await fetchSteamJson(
          `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=3&maxlength=280&format=json`
        );
        const items = Array.isArray(payload?.appnews?.newsitems) ? payload.appnews.newsitems : [];
        for (const item of items) {
          const gid = String(item?.gid || "").trim();
          const url = String(item?.url || "").trim();
          const title = String(item?.title || "").trim();
          const publishedAt = Number(item?.date || 0);
          if (!title || !url || !Number.isFinite(publishedAt) || publishedAt <= 0) {
            continue;
          }
          if (publishedAt < keepSince) {
            continue;
          }
          const eventId = gid ? `${appId}:${gid}` : `${appId}:${url}:${publishedAt}`;
          dedupe.set(eventId, {
            eventId,
            appId: String(appId),
            title,
            url,
            author: String(item?.author || "").trim(),
            summary: String(item?.contents || "").replace(/\s+/g, " ").trim().slice(0, 320),
            publishedAt
          });
        }
      } catch {
        // non-fatal per app
      }
      done += 1;
      setStatus(`Refreshing Track Feed... ${done}/${trackIds.length}`);
      setTrackFeedProgress(`Refreshing track feed... ${done}/${trackIds.length}`);
    }

    trackFeedEntries = Array.from(dedupe.values())
      .sort((a, b) => Number(b.publishedAt || 0) - Number(a.publishedAt || 0));
    trackFeedLastRefreshedAt = Date.now();
    await saveTrackFeedCache();
    setStatus(`Track Feed refreshed: ${trackFeedEntries.length} events.`);
    renderTrackFeedMeta();
  } finally {
    trackFeedRefreshing = false;
    updateTrackFeedRefreshButtonState();
  }
}

function maybeAutoRefreshTrackFeed() {
  if (activeCollection !== TRACK_FEED_SELECT_VALUE) {
    return;
  }
  if (trackFeedRefreshing) {
    return;
  }
  const trackIds = getTrackSourceAppIds();
  if (trackIds.length === 0) {
    return;
  }

  const now = Date.now();
  const stale = !(Number(trackFeedLastRefreshedAt || 0) > 0)
    || (now - Number(trackFeedLastRefreshedAt || 0) >= TRACK_FEED_AUTO_REFRESH_INTERVAL_MS);
  const retryWindowOpen = (now - Number(trackFeedLastAutoRefreshAttemptAt || 0)) < TRACK_FEED_AUTO_RETRY_INTERVAL_MS;
  if (!stale || retryWindowOpen) {
    return;
  }

  trackFeedLastAutoRefreshAttemptAt = now;
  setTrackFeedProgress("Auto refreshing stale track feed...");
  refreshTrackFeed()
    .then(() => render())
    .catch(() => {
      setStatus("Auto refresh track feed failed.", true);
    });
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
  wishlistAddedMap = { ...cachedMap };
  if (Object.keys(wishlistAddedMap).length === 0 && cachedOrderedIds.length > 0) {
    const fallbackMap = {};
    for (const appId of cachedOrderedIds) {
      fallbackMap[appId] = 0;
    }
    wishlistAddedMap = fallbackMap;
  }

  try {
    let userdata = null;
    try {
      userdata = await fetchSteamJson("https://store.steampowered.com/dynamicstore/userdata/", {
        credentials: "include",
        cache: "no-store"
      });
    } catch {
      userdata = null;
    }

    let nowIds = Array.isArray(userdata?.rgWishlist)
      ? userdata.rgWishlist.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    let observedSteamId = "";
    if (nowIds.length === 0 || !userdata) {
      try {
        const observed = await browser.runtime.sendMessage({ type: "get-steam-observed-signals" });
        const observedIds = Array.isArray(observed?.wishlistIds)
          ? observed.wishlistIds.map((id) => String(id || "").trim()).filter(Boolean)
          : [];
        if (observedIds.length > 0) {
          nowIds = observedIds;
        }
        if (/^\d{10,20}$/.test(String(observed?.steamId || ""))) {
          observedSteamId = String(observed.steamId);
          if (!wishlistSteamId) {
            wishlistSteamId = observedSteamId;
          }
        }
      } catch {
        // keep other fallbacks below
      }
    }
    wishlistOrderedAppIds = cachedOrderedIds.length > 0 ? [...cachedOrderedIds] : [...nowIds];
    wishlistSortSignature = "";
    wishlistSortOrders = {};
    wishlistSnapshotDay = "";
    wishlistAddedMap = { ...cachedMap };
    if (Object.keys(wishlistAddedMap).length === 0 && wishlistOrderedAppIds.length > 0) {
      const fallbackMap = {};
      for (const appId of wishlistOrderedAppIds) {
        fallbackMap[appId] = 0;
      }
      wishlistAddedMap = fallbackMap;
    }

    // If userdata comes empty, try public wishlist order fallback before giving up.
    if (nowIds.length === 0) {
      let fallbackSteamId = String(
        userdata?.steamid
        || userdata?.strSteamId
        || userdata?.str_steamid
        || userdata?.webapi_token_steamid
        || ""
      ).trim();
      if (!fallbackSteamId) {
        fallbackSteamId = String(effectiveCached.steamId || "").trim();
      }
      if (!fallbackSteamId) {
        fallbackSteamId = await resolveCurrentSteamId().catch(() => "");
      }
      if (fallbackSteamId) {
        const publicIds = await fetchWishlistIdsInPublicOrder(fallbackSteamId).catch(() => []);
        if (publicIds.length > 0) {
          nowIds = publicIds;
          wishlistOrderedAppIds = [...publicIds];
          if (!wishlistSteamId) {
            wishlistSteamId = fallbackSteamId;
          }
          if (Object.keys(wishlistAddedMap).length === 0) {
            const fallbackMap = {};
            for (const appId of publicIds) {
              fallbackMap[appId] = 0;
            }
            wishlistAddedMap = fallbackMap;
          }
        }
      }
    }

    // If we still couldn't load current wishlist, keep existing cache to avoid destructive overwrite.
    if (nowIds.length === 0 && Object.keys(cachedMap).length > 0) {
      if (wishlistOrderedAppIds.length === 0) {
        wishlistOrderedAppIds = cachedOrderedIds.length > 0 ? [...cachedOrderedIds] : Object.keys(cachedMap);
      }
      return;
    }
    if (nowIds.length === 0 && cachedOrderedIds.length === 0) {
      try {
        const syncResult = await browser.runtime.sendMessage({
          type: "sync-wishlist-order-cache",
          force: true
        });
        if (syncResult?.ok) {
          const refreshed = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
          const refreshedCached = refreshed?.[WISHLIST_ADDED_CACHE_KEY] || {};
          const refreshedOrdered = Array.isArray(refreshedCached.orderedAppIds)
            ? refreshedCached.orderedAppIds.map((id) => String(id || "").trim()).filter(Boolean)
            : [];
          if (refreshedOrdered.length > 0) {
            wishlistOrderedAppIds = [...refreshedOrdered];
            wishlistPriorityMap = { ...(refreshedCached.priorityMap || {}) };
            wishlistAddedMap = refreshedCached.map && typeof refreshedCached.map === "object"
              ? { ...refreshedCached.map }
              : {};
            if (Object.keys(wishlistAddedMap).length === 0) {
              const fallbackMap = {};
              for (const appId of refreshedOrdered) {
                fallbackMap[appId] = 0;
              }
              wishlistAddedMap = fallbackMap;
            }
            return;
          }
        }
      } catch {
        // continue with empty fallback below
      }
    }
    if (nowIds.length > 0 && Object.keys(wishlistAddedMap).length === 0) {
      const fallbackMap = {};
      for (const appId of nowIds) {
        fallbackMap[appId] = 0;
      }
      wishlistAddedMap = fallbackMap;
    }

    let steamId = String(
      userdata?.steamid
      || userdata?.strSteamId
      || userdata?.str_steamid
      || userdata?.webapi_token_steamid
      || observedSteamId
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
    if (wishlistOrderedAppIds.length === 0 && Object.keys(wishlistAddedMap || {}).length === 0) {
      setStatus("Could not load wishlist IDs from Steam session.", true, { withNetworkHint: true });
    }
  } catch {
    wishlistAddedMap = { ...cachedMap };
    if (wishlistOrderedAppIds.length === 0) {
      wishlistOrderedAppIds = cachedOrderedIds.length > 0 ? [...cachedOrderedIds] : Object.keys(cachedMap);
    }
    wishlistSortSignature = "";
    wishlistSortOrders = {};
    wishlistSnapshotDay = "";
    if (wishlistOrderedAppIds.length === 0 && Object.keys(wishlistAddedMap || {}).length === 0) {
      setStatus("Could not load wishlist IDs from Steam session.", true, { withNetworkHint: true });
    }
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
  invalidateWishlistPrecomputedSorts();
  await refreshAllFrequencies({ force: true, silentWhenUpToDate: false });
  await render();
  setStatus("Database refreshed.");
}

async function refreshCurrentPageItems() {
  const ids = Array.isArray(currentRenderedPageIds) ? currentRenderedPageIds : [];
  if (ids.length === 0) {
    setStatus("No visible items to refresh.");
    return;
  }

  setStatus(`Refreshing ${ids.length} visible items (Steam + metadata)...`);
  await loadWishlistAddedMap();
  await syncFollowedFromSteam();
  await refreshState();
  await ensureMetaForAppIds(ids, ids.length, true, "Refreshing visible items:");
  invalidateWishlistPrecomputedSorts();
  quickPopulateFiltersFromCache();
  refreshFilterOptionsInBackground();
  await render();
  setStatus("Visible items refreshed.");
}

async function refreshSingleItem(appId) {
  if (!appId) {
    return;
  }
  setStatus(`Refreshing ${appId} (Steam + metadata)...`);
  await loadWishlistAddedMap();
  await syncFollowedFromSteam();
  await refreshState();
  await fetchAppMeta(appId, { force: true });
  invalidateWishlistPrecomputedSorts();
  await render();
  setStatus("Item refreshed.");
}

async function setItemIntent(appId, intentPatch = {}) {
  const id = String(appId || "").trim();
  if (!id) {
    return;
  }
  const titleForPatch = state?.items?.[id]?.title || metaCache?.[id]?.titleText || `App ${id}`;
  const response = await browser.runtime.sendMessage({
    type: "set-item-intent",
    appId: id,
    title: titleForPatch,
    ...intentPatch
  });
  if (!response?.ok) {
    throw new Error(String(response?.error || "Failed to update triage intent."));
  }
  const steamErrors = Array.isArray(response?.steamWrite?.errors)
    ? response.steamWrite.errors.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  if (steamErrors.length > 0) {
    setStatus(`Local state saved, but Steam write failed: ${steamErrors[0]}`, true, { withNetworkHint: true });
  }
  await refreshState();
  await render();
}

function clampFocusIndex(index, length) {
  const size = Math.max(0, Number(length || 0));
  if (size === 0) {
    return 0;
  }
  const n = Number(index || 0);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  if (n >= size) {
    return size - 1;
  }
  return n;
}

function applyKeyboardFocusVisual() {
  const focusId = currentRenderedPageIds[keyboardFocusIndex] || "";
  const allCards = document.querySelectorAll("#cards .card, #cards .line-row");
  for (const node of allCards) {
    node.classList.remove("keyboard-focused");
    if (focusId && String(node.dataset.appId || "") === String(focusId)) {
      node.classList.add("keyboard-focused");
    }
  }
}

function bindKeyboardFocusClickTargets() {
  const allCards = document.querySelectorAll("#cards .card, #cards .line-row");
  for (const node of allCards) {
    node.addEventListener("click", () => {
      const appId = String(node.dataset.appId || "");
      if (!appId) {
        return;
      }
      const nextIndex = currentRenderedPageIds.indexOf(appId);
      if (nextIndex >= 0) {
        keyboardFocusIndex = nextIndex;
        applyKeyboardFocusVisual();
      }
    });
  }
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

async function handleKeyboardTriageIntent(actionKey) {
  const appId = currentRenderedPageIds[keyboardFocusIndex];
  if (!appId) {
    return;
  }
  const currentIntent = getItemIntentState(appId);
  const intentByKey = {
    "1": { track: currentIntent.track > 0 ? 0 : 1 },
    "2": { buy: currentIntent.buy === 1 ? 0 : 1 },
    "3": { buy: currentIntent.buy === 2 ? 0 : 2 },
    "4": { track: 0, buy: 0, owned: true }
  };
  const patch = intentByKey[actionKey];
  if (!patch) {
    return;
  }
  await setItemIntent(appId, patch);
  const nextIntent = getItemIntentState(appId);
  setStatus(`Updated ${appId} -> ${nextIntent.bucket}`);
}

async function handleKeyboardBatchIntent(actionCode) {
  if (!batchMode || batchSelectedIds.size === 0) {
    setStatus("Batch shortcut needs active batch mode with selected items.", true);
    return;
  }
  if (actionCode === "Digit1") {
    await applyBatchIntent(
      { buy: 2 },
      "Selected games set to Buy."
    );
    return;
  }
  if (actionCode === "Digit2") {
    await applyBatchIntent(
      { buy: 1 },
      "Selected games set to Maybe."
    );
    return;
  }
  if (actionCode === "Digit3") {
    await applyBatchIntent(
      { track: 1 },
      "Selected games set to Follow."
    );
    return;
  }
}

function bindKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (!currentRenderedPageIds.length) {
      return;
    }
    if (isEditableTarget(event.target)) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    const key = String(event.key || "").toLowerCase();
    const code = String(event.code || "");
    if (event.shiftKey && (code === "Digit1" || code === "Digit2" || code === "Digit3")) {
      event.preventDefault();
      handleKeyboardBatchIntent(code).catch(() => setStatus("Failed to apply batch shortcut.", true));
      return;
    }
    if (key === "j") {
      event.preventDefault();
      keyboardFocusIndex = clampFocusIndex(keyboardFocusIndex + 1, currentRenderedPageIds.length);
      applyKeyboardFocusVisual();
      return;
    }
    if (key === "k") {
      event.preventDefault();
      keyboardFocusIndex = clampFocusIndex(keyboardFocusIndex - 1, currentRenderedPageIds.length);
      applyKeyboardFocusVisual();
      return;
    }
    if (key === "1" || key === "2" || key === "3" || key === "4") {
      event.preventDefault();
      handleKeyboardTriageIntent(key).catch(() => setStatus("Failed to apply triage shortcut.", true));
    }
  });
}

async function loadMetaCache() {
  await loadGeneralFilterSeedFromJson();
  await loadSteamDbTagSeedFromJson();
  const stored = await browser.storage.local.get(META_CACHE_KEY);
  metaCache = stored[META_CACHE_KEY] || {};
  await loadTrackFeedCache();
}

async function saveMetaCache() {
  await browser.storage.local.set({ [META_CACHE_KEY]: metaCache });
}

async function loadTrackFeedCache() {
  const stored = await browser.storage.local.get([TRACK_FEED_CACHE_KEY, TRACK_FEED_META_KEY, TRACK_FEED_DISMISSED_KEY]);
  const source = Array.isArray(stored?.[TRACK_FEED_CACHE_KEY]) ? stored[TRACK_FEED_CACHE_KEY] : [];
  const out = [];
  const seen = new Set();
  for (const entry of source) {
    const eventId = String(entry?.eventId || "").trim();
    const appId = String(entry?.appId || "").trim();
    const title = String(entry?.title || "").trim();
    const url = String(entry?.url || "").trim();
    const publishedAt = Number(entry?.publishedAt || 0);
    if (!eventId || !appId || !title || !url || !Number.isFinite(publishedAt) || publishedAt <= 0) {
      continue;
    }
    if (seen.has(eventId)) {
      continue;
    }
    seen.add(eventId);
    out.push({
      eventId,
      appId,
      title,
      url,
      author: String(entry?.author || "").trim(),
      summary: String(entry?.summary || "").trim().slice(0, 320),
      publishedAt
    });
  }
  trackFeedEntries = out.sort((a, b) => Number(b.publishedAt || 0) - Number(a.publishedAt || 0));
  trackFeedLastRefreshedAt = Number(stored?.[TRACK_FEED_META_KEY]?.lastRefreshedAt || 0);
  const dismissed = Array.isArray(stored?.[TRACK_FEED_DISMISSED_KEY]) ? stored[TRACK_FEED_DISMISSED_KEY] : [];
  trackFeedDismissedEventIds = new Set(dismissed.map((id) => String(id || "").trim()).filter(Boolean));
}

async function saveTrackFeedCache() {
  await browser.storage.local.set({
    [TRACK_FEED_CACHE_KEY]: trackFeedEntries,
    [TRACK_FEED_META_KEY]: {
      lastRefreshedAt: Number(trackFeedLastRefreshedAt || 0)
    },
    [TRACK_FEED_DISMISSED_KEY]: Array.from(trackFeedDismissedEventIds)
  });
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
  const sourceCounts = Array.isArray(counts) ? counts : [];
  const selectedNames = selectedSet instanceof Set ? Array.from(selectedSet) : [];
  const sourceByName = new Map(sourceCounts.map((item) => [String(item?.name || ""), item]));

  const selectedItems = [];
  for (const name of selectedNames) {
    const normalizedName = String(name || "").trim();
    if (!normalizedName) {
      continue;
    }
    const fromSource = sourceByName.get(normalizedName);
    selectedItems.push(fromSource || { name: normalizedName, count: 0 });
  }

  const remaining = normalizedQuery
    ? sourceCounts.filter((item) => String(item.name || "").toLowerCase().includes(normalizedQuery))
    : sourceCounts;
  const remainingItems = remaining.filter((item) => !selectedSet.has(item.name));
  const filteredCounts = [...selectedItems, ...remainingItems];

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
      renderCheckboxOptions(containerId, counts, selectedSet, query);
      updateFilterSummaryCount(containerId, selectedSet.size);
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

function updateFilterSummaryCount(containerId, selectedCount) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }
  const details = container.closest("details");
  const summary = details?.querySelector("summary");
  if (!summary) {
    return;
  }
  const baseLabel = String(summary.dataset.baseLabel || summary.textContent || "").replace(/\s+\(\d+\)\s*$/, "").trim();
  if (!summary.dataset.baseLabel) {
    summary.dataset.baseLabel = baseLabel;
  }
  summary.textContent = selectedCount > 0 ? `${baseLabel} (${selectedCount})` : baseLabel;
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
  Promise.allSettled([refreshAllFrequencies({ force: false, silentWhenUpToDate: true })]).then(() => {
    if (runId !== filterSyncRunId) {
      return;
    }
    renderTagOptions();
    renderTypeOptions();
    renderExtraFilterOptions();
  });
}

function getFrequencyCacheBucketCaches(storage, bucket) {
  const tagCache = storage?.[TAG_COUNTS_CACHE_KEY] || {};
  const typeCache = storage?.[TYPE_COUNTS_CACHE_KEY] || {};
  const extraCache = storage?.[EXTRA_FILTER_COUNTS_CACHE_KEY] || {};
  return {
    tagCache,
    typeCache,
    extraCache,
    tagBucket: tagCache?.[bucket] || null,
    typeBucket: typeCache?.[bucket] || null,
    extraBucket: extraCache?.[bucket] || null
  };
}

function applyFrequencyBucketsToUi(tagBucket, typeBucket, extraBucket) {
  if (tagBucket && Array.isArray(tagBucket.counts)) {
    tagCounts = tagBucket.counts;
    tagCountsSource = "wishlist-frequency";
  }
  if (typeBucket && Array.isArray(typeBucket.counts)) {
    typeCounts = typeBucket.counts;
  }
  if (extraBucket && extraBucket.day) {
    playerCounts = Array.isArray(extraBucket.playerCounts) ? extraBucket.playerCounts : [];
    featureCounts = Array.isArray(extraBucket.featureCounts) ? extraBucket.featureCounts : [];
    hardwareCounts = Array.isArray(extraBucket.hardwareCounts) ? extraBucket.hardwareCounts : [];
    accessibilityCounts = Array.isArray(extraBucket.accessibilityCounts) ? extraBucket.accessibilityCounts : [];
    platformCounts = Array.isArray(extraBucket.platformCounts) ? extraBucket.platformCounts : [];
    languageCounts = normalizeLanguageCountObjects(extraBucket.languageCounts);
    fullAudioLanguageCounts = normalizeLanguageCountObjects(extraBucket.fullAudioLanguageCounts);
    subtitleLanguageCounts = normalizeLanguageCountObjects(extraBucket.subtitleLanguageCounts);
    technologyCounts = Array.isArray(extraBucket.technologyCounts) ? extraBucket.technologyCounts : [];
    developerCounts = Array.isArray(extraBucket.developerCounts) ? extraBucket.developerCounts : [];
    publisherCounts = Array.isArray(extraBucket.publisherCounts) ? extraBucket.publisherCounts : [];
    releaseYearCounts = mergeReleaseTextCountsWithSeed(
      Array.isArray(extraBucket.releaseYearCounts) ? extraBucket.releaseYearCounts : []
    );
  }
}

async function refreshAllFrequencies(options = {}) {
  const force = Boolean(options?.force);
  const silentWhenUpToDate = Boolean(options?.silentWhenUpToDate);
  const appIds = Object.keys(wishlistAddedMap || {});
  if (appIds.length === 0) {
    return { ok: true, skipped: true, reason: "no-wishlist-items" };
  }

  const bucket = buildTagCacheBucketKey();
  const day = todayKey();
  const storage = await browser.storage.local.get([
    TAG_COUNTS_CACHE_KEY,
    TYPE_COUNTS_CACHE_KEY,
    EXTRA_FILTER_COUNTS_CACHE_KEY
  ]);
  const {
    tagCache,
    typeCache,
    extraCache,
    tagBucket,
    typeBucket,
    extraBucket
  } = getFrequencyCacheBucketCaches(storage, bucket);

  const upToDate = Boolean(
    tagBucket?.day === day
      && typeBucket?.day === day
      && extraBucket?.day === day
  );
  if (!force && upToDate) {
    applyFrequencyBucketsToUi(tagBucket, typeBucket, extraBucket);
    if (!silentWhenUpToDate) {
      setStatus("Frequencies are already up to date for today.");
    }
    return { ok: true, skipped: true, reason: "up-to-date" };
  }

  setStatus("Refreshing frequencies (daily pipeline)...");
  await ensureMetaForAppIds(appIds, 2000, false, "Refreshing frequencies:", false);

  const unknownTypeIds = getUnknownTypeAppIds(appIds);
  if (unknownTypeIds.length > 0) {
    setStatus("Refreshing unresolved app types...");
    await ensureMetaForAppIds(unknownTypeIds, unknownTypeIds.length, true, "Refreshing unresolved types:", false);
  }

  const nextTagCounts = buildTagCountsFromAppIds(appIds);
  const nextTypeCounts = buildTypeCountsFromAppIds(appIds);
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

  if (nextTagCounts.length === 0 && tagBucket?.day && Array.isArray(tagBucket?.counts) && tagBucket.counts.length > 0) {
    applyFrequencyBucketsToUi(tagBucket, typeBucket, extraBucket);
    setStatus("Steam blocked metadata refresh. Keeping previous frequencies.", true);
    return { ok: false, skipped: true, reason: "kept-previous" };
  }

  const nextTagCache = {
    ...tagCache,
    [bucket]: {
      ...(tagBucket || {}),
      day,
      appCount: appIds.length,
      counts: nextTagCounts
    }
  };
  const nextTypeCache = {
    ...typeCache,
    [bucket]: {
      day,
      counts: nextTypeCounts
    }
  };
  const nextExtraBucket = {
    day,
    playerCounts: nextPlayerCounts,
    featureCounts: nextFeatureCounts,
    hardwareCounts: nextHardwareCounts,
    accessibilityCounts: nextAccessibilityCounts,
    platformCounts: nextPlatformCounts,
    languageCounts: nextLanguageCounts,
    fullAudioLanguageCounts: nextFullAudioLanguageCounts,
    subtitleLanguageCounts: nextSubtitleLanguageCounts,
    technologyCounts: nextTechnologyCounts,
    developerCounts: nextDeveloperCounts,
    publisherCounts: nextPublisherCounts,
    releaseYearCounts: nextReleaseYearCounts
  };
  const nextExtraCache = {
    ...extraCache,
    [bucket]: nextExtraBucket
  };

  // Atomic-like commit for frequency caches: only publish when every group is fully computed.
  await browser.storage.local.set({
    [TAG_COUNTS_CACHE_KEY]: nextTagCache,
    [TYPE_COUNTS_CACHE_KEY]: nextTypeCache,
    [EXTRA_FILTER_COUNTS_CACHE_KEY]: nextExtraCache
  });

  applyFrequencyBucketsToUi(nextTagCache[bucket], nextTypeCache[bucket], nextExtraBucket);
  setStatus("Frequencies refreshed.");
  return { ok: true, skipped: false };
}

function renderTagOptions() {
  const optionsEl = document.getElementById("tag-options");
  const showMoreBtn = document.getElementById("tag-show-more-btn");
  if (!optionsEl || !showMoreBtn) {
    return;
  }

  const query = tagSearchQuery.toLowerCase();
  const selectedItems = [];
  const selectedSeen = new Set();
  for (const name of selectedTags) {
    const found = tagCounts.find((item) => item.name === name);
    if (!found) {
      selectedItems.push({ name, count: 0 });
    } else {
      selectedItems.push(found);
    }
    selectedSeen.add(name);
  }
  const filtered = tagCounts.filter((t) => !query || t.name.toLowerCase().includes(query));
  const remaining = filtered.filter((item) => !selectedSeen.has(item.name));
  const ordered = [...selectedItems, ...remaining];
  const visible = ordered.slice(0, tagShowLimit);

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
      renderTagOptions();
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

  showMoreBtn.style.display = ordered.length > tagShowLimit ? "" : "none";
  updateFilterSummaryCount("tag-options", selectedTags.size);
}

function renderTypeOptions() {
  renderCheckboxOptions("type-options", typeCounts, selectedTypes);
  updateFilterSummaryCount("type-options", selectedTypes.size);
}

function renderExtraFilterOptions() {
  renderCheckboxOptions("players-options", playerCounts, selectedPlayers);
  updateFilterSummaryCount("players-options", selectedPlayers.size);
  renderCheckboxOptions("features-options", featureCounts, selectedFeatures);
  updateFilterSummaryCount("features-options", selectedFeatures.size);
  renderCheckboxOptions("hardware-options", hardwareCounts, selectedHardware);
  updateFilterSummaryCount("hardware-options", selectedHardware.size);
  renderCheckboxOptions("accessibility-options", accessibilityCounts, selectedAccessibility);
  updateFilterSummaryCount("accessibility-options", selectedAccessibility.size);
  renderCheckboxOptions("platforms-options", platformCounts, selectedPlatforms);
  updateFilterSummaryCount("platforms-options", selectedPlatforms.size);
  renderCheckboxOptions("languages-options", languageCounts, selectedLanguages, languageSearchQuery);
  updateFilterSummaryCount("languages-options", selectedLanguages.size);
  renderCheckboxOptions("full-audio-languages-options", fullAudioLanguageCounts, selectedFullAudioLanguages, fullAudioLanguageSearchQuery);
  updateFilterSummaryCount("full-audio-languages-options", selectedFullAudioLanguages.size);
  renderCheckboxOptions("subtitle-languages-options", subtitleLanguageCounts, selectedSubtitleLanguages, subtitleLanguageSearchQuery);
  updateFilterSummaryCount("subtitle-languages-options", selectedSubtitleLanguages.size);
  renderCheckboxOptions("technologies-options", technologyCounts, selectedTechnologies, technologySearchQuery);
  updateFilterSummaryCount("technologies-options", selectedTechnologies.size);
  renderCheckboxOptions("developers-options", developerCounts, selectedDevelopers, developerSearchQuery);
  updateFilterSummaryCount("developers-options", selectedDevelopers.size);
  renderCheckboxOptions("publishers-options", publisherCounts, selectedPublishers, publisherSearchQuery);
  updateFilterSummaryCount("publishers-options", selectedPublishers.size);
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
    getNote: (appId) => String(state?.items?.[appId]?.note || ""),
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
    wishlistCount: Math.max(
      wishlistOrderedAppIds.length,
      Object.keys(wishlistAddedMap || {}).length
    ),
    wishlistSelectValue: WISHLIST_SELECT_VALUE,
    inboxSelectValue: INBOX_SELECT_VALUE,
    trackSelectValue: TRACK_SELECT_VALUE,
    buySelectValue: BUY_SELECT_VALUE,
    archiveSelectValue: ARCHIVE_SELECT_VALUE,
    ownedSelectValue: OWNED_SELECT_VALUE,
    trackFeedSelectValue: TRACK_FEED_SELECT_VALUE,
    inboxCount: Object.keys(state?.items || {}).filter((appId) => {
      const intent = getItemIntentState(appId);
      return intent.bucket === "INBOX";
    }).length,
    trackCount: Object.keys(state?.items || {}).filter((appId) => {
      const intent = getItemIntentState(appId);
      return intent.track > 0 && !intent.owned;
    }).length,
    buyCount: Object.keys(state?.items || {}).filter((appId) => {
      const intent = getItemIntentState(appId);
      return !intent.owned && intent.buy > 0;
    }).length,
    archiveCount: Object.keys(state?.items || {}).filter((appId) => {
      const intent = getItemIntentState(appId);
      return intent.owned;
    }).length,
    ownedCount: Object.keys(state?.items || {}).filter((appId) => {
      const intent = getItemIntentState(appId);
      return Boolean(intent.owned);
    }).length,
    trackFeedCount: trackFeedEntries.length,
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
  const allCollectionNames = Array.isArray(options?.allCollectionNames) ? options.allCollectionNames : [];
  const selectedCollectionNames = new Set(Array.isArray(options?.selectedCollectionNames) ? options.selectedCollectionNames : []);
  const onToggleCollection = options?.onToggleCollection || (() => Promise.resolve());
  const onSetIntent = options?.onSetIntent || (() => Promise.resolve());
  const itemIntent = options?.itemIntent && typeof options.itemIntent === "object" ? options.itemIntent : {};
  const noteText = String(itemIntent.note || "");
  const targetPriceCents = Number.isFinite(Number(itemIntent.targetPriceCents))
    ? Math.max(0, Math.floor(Number(itemIntent.targetPriceCents)))
    : null;

  const row = document.createElement("article");
  row.className = "line-row";
  row.dataset.appId = appId;
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

  const collectionsBtn = document.createElement("button");
  collectionsBtn.type = "button";
  collectionsBtn.className = "line-btn line-collections-btn";
  collectionsBtn.textContent = "Collections";
  collectionsBtn.disabled = allCollectionNames.length === 0;
  left.appendChild(collectionsBtn);

  const collectionsDropdown = document.createElement("div");
  collectionsDropdown.className = "collections-dropdown line-collections-dropdown hidden";
  if (allCollectionNames.length === 0) {
    const empty = document.createElement("p");
    empty.className = "collections-dropdown-empty";
    empty.textContent = "No static collections yet.";
    collectionsDropdown.appendChild(empty);
  } else {
    for (const collectionName of allCollectionNames) {
      const rowEl = document.createElement("label");
      rowEl.className = "collection-checkbox-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selectedCollectionNames.has(collectionName);
      checkbox.addEventListener("change", async () => {
        try {
          await onToggleCollection(appId, collectionName, checkbox.checked);
          if (checkbox.checked) {
            selectedCollectionNames.add(collectionName);
          } else {
            selectedCollectionNames.delete(collectionName);
          }
        } catch (error) {
          checkbox.checked = !checkbox.checked;
          setStatus(String(error?.message || "Failed to update collections."), true);
        }
      });

      const nameEl = document.createElement("span");
      nameEl.className = "collection-checkbox-name";
      nameEl.textContent = collectionName;

      rowEl.appendChild(checkbox);
      rowEl.appendChild(nameEl);
      collectionsDropdown.appendChild(rowEl);
    }
  }
  collectionsBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    collectionsDropdown.classList.toggle("hidden");
  });
  collectionsDropdown.addEventListener("click", (event) => event.stopPropagation());
  row.addEventListener("click", () => collectionsDropdown.classList.add("hidden"));
  left.appendChild(collectionsDropdown);

  const wfWrap = document.createElement("div");
  wfWrap.className = "line-workflow-actions";

  const buyBtn = document.createElement("button");
  buyBtn.type = "button";
  buyBtn.className = "line-btn";
  buyBtn.textContent = "Buy";
  buyBtn.addEventListener("click", () => {
    onSetIntent(appId, { buy: itemIntent.buy === 2 ? 0 : 2 })
      .then(() => setStatus(itemIntent.buy === 2 ? "Buy cleared (removed from Steam wishlist)." : "Set to Buy (added to Steam wishlist)."))
      .catch(() => setStatus("Failed to set Buy.", true));
  });

  const maybeBtn = document.createElement("button");
  maybeBtn.type = "button";
  maybeBtn.className = "line-btn";
  maybeBtn.textContent = "Maybe";
  maybeBtn.addEventListener("click", () => {
    onSetIntent(appId, { buy: itemIntent.buy === 1 ? 0 : 1 })
      .then(() => setStatus(itemIntent.buy === 1 ? "Maybe cleared (removed from Steam wishlist)." : "Set to Maybe (added to Steam wishlist)."))
      .catch(() => setStatus("Failed to set Maybe.", true));
  });

  const trackBtn = document.createElement("button");
  trackBtn.type = "button";
  trackBtn.className = "line-btn";
  trackBtn.textContent = itemIntent.track > 0 ? "Unfollow" : "Follow";
  trackBtn.addEventListener("click", () => {
    onSetIntent(appId, { track: itemIntent.track > 0 ? 0 : 1 })
      .then(() => setStatus(itemIntent.track > 0 ? "Untracked (unfollowed on Steam)." : "Tracked (followed on Steam)."))
      .catch(() => setStatus("Failed to toggle track.", true));
  });

  wfWrap.appendChild(buyBtn);
  wfWrap.appendChild(maybeBtn);
  wfWrap.appendChild(trackBtn);

  const targetBtn = document.createElement("button");
  targetBtn.type = "button";
  targetBtn.className = "line-btn";
  targetBtn.textContent = targetPriceCents > 0 ? "Target*" : "Target";
  targetBtn.addEventListener("click", () => {
    const defaultValue = targetPriceCents > 0 ? (targetPriceCents / 100).toFixed(2) : "";
    const raw = window.prompt("Set target price (leave empty to clear):", defaultValue);
    if (raw === null) {
      return;
    }
    const normalized = String(raw || "").trim().replace(",", ".");
    if (!normalized) {
      onSetIntent(appId, { targetPriceCents: null })
        .then(() => setStatus("Target price cleared."))
        .catch(() => setStatus("Failed to clear target price.", true));
      return;
    }
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount < 0) {
      setStatus("Enter a valid target price.", true);
      return;
    }
    const cents = Math.round(amount * 100);
    onSetIntent(appId, { targetPriceCents: cents })
      .then(() => setStatus("Target price saved."))
      .catch(() => setStatus("Failed to save target price.", true));
  });
  wfWrap.appendChild(targetBtn);

  const noteBtn = document.createElement("button");
  noteBtn.type = "button";
  noteBtn.className = "line-btn";
  noteBtn.textContent = noteText ? "Note*" : "Note";
  noteBtn.addEventListener("click", () => {
    const raw = window.prompt("Set note (leave empty to clear):", noteText);
    if (raw === null) {
      return;
    }
    onSetIntent(appId, { note: String(raw || "").slice(0, 600) })
      .then(() => setStatus(raw ? "Note saved." : "Note cleared."))
      .catch(() => setStatus("Failed to update note.", true));
  });
  wfWrap.appendChild(noteBtn);
  left.appendChild(wfWrap);

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
  const targetEl = document.createElement("span");
  targetEl.className = "line-target";
  targetEl.textContent = targetPriceCents > 0 ? `Target: ${(targetPriceCents / 100).toFixed(2)}` : "Target: -";
  right.appendChild(targetEl);
  right.appendChild(discountEl);
  right.appendChild(priceEl);

  row.appendChild(batchWrap);
  row.appendChild(left);
  row.appendChild(center);
  row.appendChild(right);

  return {
    row,
    titleEl,
    reviewEl,
    targetEl,
    priceEl,
    discountEl
  };
}

function renderBatchMenuState() {
  const btn = document.getElementById("batch-menu-btn");
  const collectionSelect = document.getElementById("batch-collection-select");
  const batchHint = document.getElementById("batch-shortcuts-hint");
  if (btn) {
    const count = batchSelectedIds.size;
    btn.textContent = count > 0 ? `Batch (${count})` : "Batch";
    btn.classList.toggle("active", batchMode);
  }
  if (batchHint) {
    const count = batchSelectedIds.size;
    batchHint.textContent = count > 0
      ? `Batch mode active (${count} selected) | Shortcuts: Shift+1 Buy, Shift+2 Maybe, Shift+3 Follow`
      : "Batch mode active | Select cards to use shortcuts: Shift+1 Buy, Shift+2 Maybe, Shift+3 Follow";
    batchHint.classList.toggle("hidden", !batchMode);
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

function renderRadarStats() {
  const el = document.getElementById("radar-stats");
  if (!el) {
    return;
  }
  const ids = Object.keys(state?.items || {});
  let buyRadar = 0;
  let underTarget = 0;
  let owned = 0;
  for (const appId of ids) {
    const intent = getItemIntentState(appId);
    if (!intent.owned && intent.buy > 0) {
      buyRadar += 1;
    }
    if (intent.owned) {
      owned += 1;
    }
    if (isPriceAtOrUnderTarget(metaCache?.[appId] || {}, intent.targetPriceCents)) {
      underTarget += 1;
    }
  }
  el.textContent = `Radar | Buy: ${buyRadar} | Under target: ${underTarget} | Owned: ${owned}`;
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

async function applyBatchIntent(intentPatch, successMessage, requireConfirm = false, confirmMessage = "") {
  if (!batchMode) {
    toggleBatchMode(true);
  }
  if (batchSelectedIds.size === 0) {
    setStatus("Select one or more cards for batch action.", true);
    return;
  }
  if (requireConfirm) {
    const confirmed = window.confirm(confirmMessage || "Apply batch action to selected games?");
    if (!confirmed) {
      return;
    }
  }

  const payload = {
    type: "batch-set-item-intent",
    appIds: Array.from(batchSelectedIds),
    ...intentPatch
  };
  const response = await browser.runtime.sendMessage(payload);
  if (!response?.ok) {
    throw new Error(String(response?.error || "Failed to apply batch intent action."));
  }
  const failures = Array.isArray(response?.steamWriteResults)
    ? response.steamWriteResults.filter((entry) => Array.isArray(entry?.errors) && entry.errors.length > 0)
    : [];

  batchSelectedIds.clear();
  await refreshState();
  await render();
  if (failures.length > 0) {
    const first = failures[0];
    const firstError = String(first?.errors?.[0] || "Steam write failed");
    setStatus(`${successMessage || "Batch action applied."} Steam write failed for ${failures.length} item(s): ${firstError}`, true, { withNetworkHint: true });
  } else {
    setStatus(successMessage || "Batch action applied.");
  }
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

  if (activeCollection === TRACK_FEED_SELECT_VALUE) {
    await renderTrackFeedItems(cardsEl, emptyEl);
    return;
  }

  const sourceIds = getCurrentSourceAppIds();
  if (sourceMode === "wishlist" && sourceIds.length === 0) {
    setStatus("Steam wishlist is empty or unavailable for this session.", true, { withNetworkHint: true });
  }
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

  const appIds = getFilteredAndSorted(sourceIds).filter((appId) => matchesTriageFilter(appId));
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
  keyboardFocusIndex = clampFocusIndex(keyboardFocusIndex, currentRenderedPageIds.length);
  if (!shouldSkipHeavyMetaHydration && (needsMetaForSort || needsMetaForSearch)) {
    setStatus("");
  }
  const rankReadyNow = sourceMode !== "wishlist" || isWishlistRankReady(sourceIds);
  if (sourceMode === "wishlist" && sourceIds.length > 0 && sortMode === "position" && !rankReadyNow) {
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
        itemIntent: getItemIntentState(appId),
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
        allCollectionNames: getStaticCollectionNames(),
        selectedCollectionNames: getCollectionsContainingApp(appId),
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
        maxPositionDigits,
        onSetIntent: (id, intentPatch) => setItemIntent(id, intentPatch),
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
        const intent = getItemIntentState(appId);
        const targetCents = Number(intent.targetPriceCents || 0);
        const hit = isPriceAtOrUnderTarget(meta, targetCents);
        if (line.targetEl) {
          if (targetCents > 0) {
            line.targetEl.textContent = hit
              ? `Target: ${(targetCents / 100).toFixed(2)} (hit)`
              : `Target: ${(targetCents / 100).toFixed(2)}`;
          } else {
            line.targetEl.textContent = "Target: -";
          }
          line.targetEl.classList.toggle("target-hit", hit);
        }
        if (line.row) {
          line.row.classList.toggle("target-hit", hit);
        }
      }).catch(() => {});
    }
    bindKeyboardFocusClickTargets();
    applyKeyboardFocusVisual();
    return;
  }

  for (const appId of pageIds) {
    const hasStateTitle = Boolean(state?.items?.[appId]?.title);
    const title = state?.items?.[appId]?.title || metaCache?.[appId]?.titleText || `App ${appId}`;
    const itemIntent = getItemIntentState(appId);
    const card = cardRenderUtils.createCardNodes({
      template,
      appId,
      title,
      link: getAppLink(appId)
    });
    if (card.cardEl) {
      card.cardEl.dataset.appId = appId;
    }
    cardRenderUtils.fillCardStatic({
      card,
      appId,
      imageUrl: getCardImageUrl(appId),
      wishlistDate: formatUnixDate(wishlistAddedMap[appId]),
      itemIntent
    });
    cardRenderUtils.bindCardActions({
      card,
      appId,
      sourceMode,
      activeCollection,
      itemIntent,
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
      },
      onSetIntent: async (id, intentPatch) => {
        await setItemIntent(id, intentPatch);
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
  bindKeyboardFocusClickTargets();
  applyKeyboardFocusVisual();
}

async function renderTrackFeedItems(cardsEl, emptyEl) {
  const cutoffSec = parseTrackWindowDays(trackWindowDays) > 0
    ? Math.floor(Date.now() / 1000) - (parseTrackWindowDays(trackWindowDays) * 24 * 60 * 60)
    : 0;
  const q = String(searchQuery || "").trim().toLowerCase();
  const entries = trackFeedEntries.filter((entry) => {
    if (trackFeedDismissedEventIds.has(String(entry?.eventId || ""))) {
      return false;
    }
    const appId = String(entry?.appId || "");
    if (!appId) {
      return false;
    }
    const intent = getItemIntentState(appId);
    if (!(intent.track > 0) || intent.owned) {
      return false;
    }
    if (cutoffSec > 0 && Number(entry?.publishedAt || 0) < cutoffSec) {
      return false;
    }
    if (!q) {
      return true;
    }
    const appTitle = String(state?.items?.[appId]?.title || metaCache?.[appId]?.titleText || "");
    const hay = `${entry.title} ${entry.summary || ""} ${appTitle} ${appId}`.toLowerCase();
    return hay.includes(q);
  });

  renderPager(entries.length);
  const start = (page - 1) * PAGE_SIZE;
  const pageEntries = entries.slice(start, start + PAGE_SIZE);
  currentRenderedPageIds = [];
  cardsEl.innerHTML = "";
  cardsEl.classList.remove("batch-mode");
  cardsEl.classList.remove("line-mode");
  emptyEl.classList.toggle("hidden", pageEntries.length > 0);

  for (const entry of pageEntries) {
    const row = document.createElement("article");
    row.className = "feed-row";

    const appId = String(entry.appId || "");
    const title = String(entry.title || "");
    const appTitle = String(state?.items?.[appId]?.title || metaCache?.[appId]?.titleText || `App ${appId}`);

    const head = document.createElement("div");
    head.className = "feed-row-head";
    const link = document.createElement("a");
    link.href = String(entry.url || "#");
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "feed-link";
    link.textContent = title || "(untitled)";
    const meta = document.createElement("span");
    meta.className = "feed-meta";
    meta.textContent = `${appTitle} | ${formatFeedDate(entry.publishedAt)}`;
    head.appendChild(link);
    head.appendChild(meta);

    const summary = document.createElement("p");
    summary.className = "feed-summary";
    summary.textContent = String(entry.summary || "").slice(0, 280) || "-";

    const actions = document.createElement("div");
    actions.className = "feed-actions";
    const intent = getItemIntentState(appId);
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = "Open post";
    openBtn.addEventListener("click", () => window.open(String(entry.url || "#"), "_blank", "noopener"));
    const buyBtn = document.createElement("button");
    buyBtn.type = "button";
    buyBtn.textContent = "Buy";
    buyBtn.addEventListener("click", () => {
      setItemIntent(appId, { buy: intent.buy === 2 ? 0 : 2 }).catch(() => setStatus("Failed to set Buy.", true));
    });
    const maybeBtn = document.createElement("button");
    maybeBtn.type = "button";
    maybeBtn.textContent = "Maybe";
    maybeBtn.addEventListener("click", () => {
      setItemIntent(appId, { buy: intent.buy === 1 ? 0 : 1 }).catch(() => setStatus("Failed to set Maybe.", true));
    });
    const archiveBtn = document.createElement("button");
    archiveBtn.type = "button";
    archiveBtn.textContent = "Archive";
    archiveBtn.addEventListener("click", () => {
      setItemIntent(appId, { track: 0, buy: 0, owned: true }).catch(() => setStatus("Failed to archive item.", true));
    });
    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.textContent = "Dismiss";
    dismissBtn.addEventListener("click", () => {
      const eventId = String(entry?.eventId || "");
      if (!eventId) {
        return;
      }
      trackFeedDismissedEventIds.add(eventId);
      saveTrackFeedCache()
        .then(() => render())
        .catch(() => setStatus("Failed to dismiss feed item.", true));
    });
    actions.appendChild(openBtn);
    actions.appendChild(buyBtn);
    actions.appendChild(maybeBtn);
    actions.appendChild(archiveBtn);
    actions.appendChild(dismissBtn);

    row.appendChild(head);
    row.appendChild(summary);
    row.appendChild(actions);
    cardsEl.appendChild(row);
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
  const definition = buildDynamicDefinitionFromCurrentView();
  const existing = getExistingCollectionNames().includes(name);
  if (existing) {
    if (!isDynamicCollectionName(name)) {
      setStatus(`"${name}" is a static collection. Choose another name for dynamic collection.`, true);
      return;
    }
    const currentDef = normalizeDynamicDefinitionForCompare(state?.dynamicCollections?.[name] || {});
    const nextDef = normalizeDynamicDefinitionForCompare(definition);
    const currentSig = JSON.stringify(currentDef);
    const nextSig = JSON.stringify(nextDef);
    if (currentSig === nextSig) {
      setStatus(`Dynamic collection "${name}" is already up to date.`);
      return;
    }
    const oldFilters = countActiveFiltersInSnapshot(currentDef.filters || {});
    const newFilters = countActiveFiltersInSnapshot(nextDef.filters || {});
    const confirmed = window.confirm(
      `Collection "${name}" exists. Update dynamic definition?\n\n`
      + `base: ${describeDynamicBase(currentDef)} -> ${describeDynamicBase(nextDef)}\n`
      + `sort: ${String(currentDef.sortMode || "-")} -> ${String(nextDef.sortMode || "-")}\n`
      + `active filters: ${oldFilters} -> ${newFilters}`
    );
    if (!confirmed) {
      return;
    }
  }

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
  const triageFilterSelect = document.getElementById("triage-filter-select");
  const underTargetCheckbox = document.getElementById("under-target-checkbox");
  const trackWindowSelect = document.getElementById("track-window-select");
  const refreshTrackFeedBtn = document.getElementById("refresh-track-feed-btn");
  const resetTrackFeedDismissedBtn = document.getElementById("reset-track-feed-dismissed-btn");
  const renameActionBtn = document.getElementById("menu-action-rename");
  const deleteActionBtn = document.getElementById("menu-action-delete");
  const deleteSelect = document.getElementById("delete-collection-select");
  if (sortSelect) {
    sortSelect.value = sortMode;
  }
  if (viewSelect) {
    viewSelect.value = viewMode;
  }
  if (triageFilterSelect) {
    triageFilterSelect.value = triageFilter;
  }
  if (underTargetCheckbox) {
    underTargetCheckbox.checked = onlyUnderTarget;
  }
  if (trackWindowSelect) {
    trackWindowSelect.value = String(parseTrackWindowDays(trackWindowDays));
    trackWindowSelect.classList.toggle("hidden", activeCollection !== TRACK_SELECT_VALUE && activeCollection !== TRACK_FEED_SELECT_VALUE);
  }
  if (refreshTrackFeedBtn) {
    refreshTrackFeedBtn.classList.toggle("hidden", activeCollection !== TRACK_FEED_SELECT_VALUE);
  }
  if (resetTrackFeedDismissedBtn) {
    resetTrackFeedDismissedBtn.classList.toggle("hidden", activeCollection !== TRACK_FEED_SELECT_VALUE);
    resetTrackFeedDismissedBtn.disabled = trackFeedDismissedEventIds.size === 0;
    resetTrackFeedDismissedBtn.textContent = trackFeedDismissedEventIds.size > 0
      ? `Reset dismissed (${trackFeedDismissedEventIds.size})`
      : "Reset dismissed";
  }
  updateTrackFeedRefreshButtonState();
  if (activeCollection !== TRACK_FEED_SELECT_VALUE) {
    setTrackFeedProgress("");
  } else {
    renderTrackFeedMeta();
  }

  renderSortMenu();
  renderViewMenu();
  renderCollectionSelect();
  renderDynamicCollectionFormHint();
  renderBatchMenuState();
  renderRadarStats();
  const canRenameCurrent = sourceMode !== "wishlist"
    && activeCollection !== "__all__"
    && !isVirtualCollectionSelection(activeCollection);
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
  maybeAutoRefreshTrackFeed();
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

function openDynamicCollectionForm() {
  const input = document.getElementById("dynamic-collection-input");
  if (input && sourceMode === "collections" && !isVirtualCollectionSelection(activeCollection) && activeCollection !== "__all__") {
    input.value = String(activeCollection || "");
  }
  renderDynamicCollectionFormHint();
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
  const resolved = actionsUtils.resolveCollectionSelection(
    value,
    WISHLIST_SELECT_VALUE,
    INBOX_SELECT_VALUE,
    TRACK_SELECT_VALUE,
    BUY_SELECT_VALUE,
    ARCHIVE_SELECT_VALUE,
    OWNED_SELECT_VALUE,
    TRACK_FEED_SELECT_VALUE
  );
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
    onDynamicOpen: openDynamicCollectionForm,
    deleteHandler: deleteCollectionByName,
    onError: (message) => setStatus(message, true)
  });
}

function bindBatchControls() {
  const batchBtn = document.getElementById("batch-menu-btn");
  const addActionBtn = document.getElementById("batch-action-add");
  const removeActionBtn = document.getElementById("batch-action-remove");
  const buyActionBtn = document.getElementById("batch-action-buy");
  const maybeActionBtn = document.getElementById("batch-action-maybe");
  const trackActionBtn = document.getElementById("batch-action-track");
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

  buyActionBtn?.addEventListener("click", () => {
    applyBatchIntent(
      { buy: 2 },
      "Selected games set to Buy."
    ).catch(() => setStatus("Failed to apply batch buy.", true));
  });

  maybeActionBtn?.addEventListener("click", () => {
    applyBatchIntent(
      { buy: 1 },
      "Selected games set to Maybe."
    ).catch(() => setStatus("Failed to apply batch maybe.", true));
  });

  trackActionBtn?.addEventListener("click", () => {
    applyBatchIntent(
      { track: 1 },
      "Selected games set to Follow."
    ).catch(() => setStatus("Failed to apply batch follow.", true));
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
      if (activeCollection === TRACK_FEED_SELECT_VALUE) {
        refreshTrackFeed()
          .then(() => render())
          .catch(() => setStatus("Failed to refresh track feed.", true));
        return;
      }
      refreshCurrentPageItems().catch(() => setStatus("Failed to refresh visible items.", true));
    },
    onRefreshTrackFeed: () => {
      refreshTrackFeed()
        .then(() => render())
        .catch(() => setStatus("Failed to refresh track feed.", true));
    },
    onResetTrackFeedDismissed: () => {
      if (trackFeedDismissedEventIds.size === 0) {
        setStatus("No dismissed feed items.");
        return;
      }
      const confirmed = window.confirm(`Reset ${trackFeedDismissedEventIds.size} dismissed feed item(s)?`);
      if (!confirmed) {
        return;
      }
      trackFeedDismissedEventIds.clear();
      saveTrackFeedCache()
        .then(() => render())
        .then(() => setStatus("Dismissed feed items reset."))
        .catch(() => setStatus("Failed to reset dismissed feed items.", true));
    },
    onTriageFilterChange: async (value) => {
      triageFilter = String(value || "all");
      page = 1;
      await renderCards();
    },
    onUnderTargetChange: async (checked) => {
      onlyUnderTarget = Boolean(checked);
      page = 1;
      await renderCards();
    },
    onTrackWindowChange: async (value) => {
      trackWindowDays = parseTrackWindowDays(value);
      page = 1;
      await renderCards();
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
  bindKeyboardShortcuts();
}

async function syncFollowedFromSteam() {
  try {
    const response = await browser.runtime.sendMessage({
      type: "sync-followed-from-steam",
      force: true
    });
    if (!response?.ok) {
      setStatus(String(response?.error || "Failed to import followed apps from Steam."), true, { withNetworkHint: true });
      return;
    }
    if (!response?.skipped && Number(response?.updatedCount || 0) > 0) {
      await refreshState();
      setStatus(`Imported ${response.updatedCount} followed game(s) from Steam.`);
    }
  } catch {
    setStatus("Failed to import followed apps from Steam.", true, { withNetworkHint: true });
  }
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
    sourceMode = "wishlist";
  },
  attachEvents,
  syncFollowedFromSteam,
  quickPopulateFiltersFromCache,
  renderRatingControls,
  render,
  refreshFilterOptionsInBackground,
  refreshWholeDatabase,
  refreshFrequenciesOnly: async () => {
    await refreshAllFrequencies({ force: true, silentWhenUpToDate: false });
    await render();
  }
}).catch((error) => {
  const message = String(error?.message || error || "unknown init error");
  setStatus(`Failed to load collections page: ${message}`, true, { withNetworkHint: true });
});
