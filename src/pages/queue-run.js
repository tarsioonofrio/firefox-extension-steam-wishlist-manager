const WISHLIST_ADDED_CACHE_KEY = "steamWishlistAddedMapV3";
const QUEUE_COLLECTION_KEY = "swmQueueCollectionV2";
const QUEUE_STATE_KEY = "swmQueueStateV2";
const QUEUE_INDEX_KEY = "swmQueueIndexV2";
const QUEUE_LEFT_WIDTH_KEY = "swmQueueLeftWidthV1";
const QUEUE_META_CACHE_KEY = "steamWishlistQueueMetaCacheV1";
const QUEUE_MEDIA_CACHE_KEY = "steamWishlistQueueMediaCacheV1";
const COLLECTIONS_META_CACHE_KEY = "steamWishlistCollectionsMetaCacheV4";
const QUEUE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const steamFetchUtils = window.SWMSteamFetch || {};
const PAGE_PATH = String(window.location.pathname || "").toLowerCase();
const PAGE_MODE = PAGE_PATH.endsWith("/queue-run.html")
  ? "run"
  : (PAGE_PATH.endsWith("/queue-setup.html") ? "setup" : "setup");

let state = null;
let wishlistOrderedIds = [];
let queueIds = [];
let queueIndex = 0;
let currentQueueConfig = { collection: "__all__", list: "inbox" };
let mediaState = { index: 0, items: [] };
let mediaSeq = 0;
const metaCache = new Map();
const mediaCache = new Map();
let collectionsMetaCache = {};

const QUEUE_FILTERS_STATE_KEY = "swmQueueFiltersV1";
const TAG_SHOW_STEP = 12;
const EXTRA_SHOW_STEP = 12;
const OPEN_ENDED_MAX_VALUE = 999999999;
const collectionsFiltersUtils = window.SWMCollectionsFilters || null;
const EXTRA_FILTER_CONFIGS = [
  { key: "types", label: "Type", placeholder: "Search types..." },
  { key: "players", label: "Number of Players", placeholder: "Search players..." },
  { key: "features", label: "Features", placeholder: "Search features..." },
  { key: "hardware", label: "Hardware & Controllers", placeholder: "Search hardware..." },
  { key: "accessibility", label: "Accessibility", placeholder: "Search accessibility..." },
  { key: "platforms", label: "Platforms", placeholder: "Search platforms..." },
  { key: "languages", label: "Languages", placeholder: "Search languages..." },
  { key: "fullAudioLanguages", label: "Languages with Full Audio", placeholder: "Search full audio languages..." },
  { key: "subtitleLanguages", label: "Languages with Subtitles", placeholder: "Search subtitle languages..." },
  { key: "technologies", label: "Technologies", placeholder: "Search technologies..." },
  { key: "developers", label: "Developers", placeholder: "Search developers..." },
  { key: "publishers", label: "Publishers", placeholder: "Search publishers..." }
];

let selectedTags = new Set();
let tagSearchQuery = "";
let tagShowLimit = TAG_SHOW_STEP;
let tagCounts = [];

let selectedExtraFilters = Object.fromEntries(EXTRA_FILTER_CONFIGS.map((cfg) => [cfg.key, new Set()]));
let extraFilterCounts = Object.fromEntries(EXTRA_FILTER_CONFIGS.map((cfg) => [cfg.key, []]));
let extraFilterSearchQuery = Object.fromEntries(EXTRA_FILTER_CONFIGS.map((cfg) => [cfg.key, ""]));
let extraFilterShowLimit = Object.fromEntries(EXTRA_FILTER_CONFIGS.map((cfg) => [cfg.key, EXTRA_SHOW_STEP]));

let ratingMin = 0;
let ratingMax = 100;
let reviewsMin = 0;
let reviewsMax = OPEN_ENDED_MAX_VALUE;
let priceMin = 0;
let priceMax = OPEN_ENDED_MAX_VALUE;
let discountMin = 0;
let discountMax = 100;
let releaseTextEnabled = true;
let releaseYearRangeEnabled = true;
let releaseYearMin = 1970;
let releaseYearMax = new Date().getUTCFullYear() + 1;

function mapToObject(map) {
  const out = {};
  for (const [key, value] of map.entries()) {
    out[key] = value;
  }
  return out;
}

function isFreshCache(cachedAt) {
  const n = Number(cachedAt || 0);
  return Number.isFinite(n) && n > 0 && (Date.now() - n) < QUEUE_CACHE_TTL_MS;
}

async function loadQueueCaches() {
  try {
    const stored = await browser.storage.local.get([QUEUE_META_CACHE_KEY, QUEUE_MEDIA_CACHE_KEY]);
    const metaObject = stored?.[QUEUE_META_CACHE_KEY];
    const mediaObject = stored?.[QUEUE_MEDIA_CACHE_KEY];
    if (metaObject && typeof metaObject === "object") {
      for (const [appId, value] of Object.entries(metaObject)) {
        if (!appId || !value || typeof value !== "object") {
          continue;
        }
        metaCache.set(appId, value);
      }
    }
    if (mediaObject && typeof mediaObject === "object") {
      for (const [appId, value] of Object.entries(mediaObject)) {
        if (!appId || !value || typeof value !== "object") {
          continue;
        }
        mediaCache.set(appId, value);
      }
    }
  } catch {
    // noop
  }
}

async function loadCollectionsMetaCache() {
  try {
    const stored = await browser.storage.local.get(COLLECTIONS_META_CACHE_KEY);
    const raw = stored?.[COLLECTIONS_META_CACHE_KEY];
    collectionsMetaCache = raw && typeof raw === "object" ? raw : {};
  } catch {
    collectionsMetaCache = {};
  }
}

async function persistMetaCache() {
  try {
    await browser.storage.local.set({
      [QUEUE_META_CACHE_KEY]: mapToObject(metaCache)
    });
  } catch {
    // noop
  }
}

async function persistMediaCache() {
  try {
    await browser.storage.local.set({
      [QUEUE_MEDIA_CACHE_KEY]: mapToObject(mediaCache)
    });
  } catch {
    // noop
  }
}

function setStatus(message, isError = false) {
  const el = document.getElementById("status");
  if (!el) {
    return;
  }
  el.textContent = String(message || "");
  el.style.color = isError ? "#ff9696" : "#9db5c9";
}

function normalizeName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeNameLower(value) {
  return normalizeName(value).toLowerCase();
}

function parseReleaseYear(meta) {
  const releaseUnix = Number(meta?.releaseUnix || 0);
  if (Number.isFinite(releaseUnix) && releaseUnix > 0) {
    return new Date(releaseUnix * 1000).getUTCFullYear();
  }
  const releaseText = String(meta?.releaseText || "");
  const match = releaseText.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
  return match?.[1] ? Number(match[1]) : 0;
}

function getMergedMeta(appId) {
  const collectionsMeta = collectionsMetaCache?.[appId] && typeof collectionsMetaCache[appId] === "object"
    ? collectionsMetaCache[appId]
    : {};
  const queueMeta = metaCache.get(appId) || {};

  const merged = { ...queueMeta, ...collectionsMeta };
  if (!Array.isArray(merged.tags) || merged.tags.length === 0) {
    merged.tags = Array.isArray(queueMeta.tags) ? queueMeta.tags : [];
  }
  if (!Number.isFinite(Number(merged.reviewPositivePct))) {
    const reviewText = String(queueMeta.reviewText || "");
    const pctMatch = reviewText.match(/^(\d{1,3})%/);
    merged.reviewPositivePct = pctMatch?.[1] ? Number(pctMatch[1]) : -1;
  }
  if (!Number.isFinite(Number(merged.reviewTotalVotes))) {
    const reviewText = String(queueMeta.reviewText || "");
    const votesMatch = reviewText.match(/\((\d[\d,.]*)\s+reviews\)/i);
    const rawVotes = String(votesMatch?.[1] || "").replace(/[^\d]/g, "");
    merged.reviewTotalVotes = rawVotes ? Number(rawVotes) : 0;
  }
  if (!Number.isFinite(Number(merged.discountPercent))) {
    const discountText = String(queueMeta.discountText || "");
    const discMatch = discountText.match(/(\d{1,3})\s*%/);
    merged.discountPercent = discMatch?.[1] ? Number(discMatch[1]) : 0;
  }
  if (!Number.isFinite(Number(merged.priceFinal))) {
    merged.priceFinal = 0;
  }
  if (!merged.releaseText) {
    merged.releaseText = String(queueMeta.releaseText || "-");
  }
  if (!Number.isFinite(Number(merged.releaseUnix))) {
    merged.releaseUnix = 0;
  }
  return merged;
}

function getMetaNumberForFilters(appId, key, fallback = 0) {
  const n = Number(getMergedMeta(appId)?.[key]);
  return Number.isFinite(n) ? n : fallback;
}

function getMetaArrayForFilters(appId, key) {
  const value = getMergedMeta(appId)?.[key];
  return Array.isArray(value)
    ? value.map((entry) => normalizeName(entry)).filter(Boolean)
    : [];
}

function getMetaTagsForFilters(appId) {
  return getMetaArrayForFilters(appId, "tags");
}

function countValuesByKey(appIds, key) {
  const counts = new Map();
  for (const appId of appIds) {
    const values = new Set(getMetaArrayForFilters(appId, key));
    for (const value of values) {
      counts.set(value, Number(counts.get(value) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
}

function countTags(appIds) {
  const counts = new Map();
  for (const appId of appIds) {
    const tags = new Set(getMetaTagsForFilters(appId));
    for (const tag of tags) {
      counts.set(tag, Number(counts.get(tag) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
}

function getReleaseYearBounds(appIds) {
  let min = Number.MAX_SAFE_INTEGER;
  let max = 0;
  for (const appId of appIds) {
    const year = parseReleaseYear(getMergedMeta(appId));
    if (!Number.isFinite(year) || year <= 0) {
      continue;
    }
    min = Math.min(min, year);
    max = Math.max(max, year);
  }
  const fallbackMax = new Date().getUTCFullYear() + 1;
  const safeMin = min === Number.MAX_SAFE_INTEGER ? 1970 : min;
  const safeMax = max > 0 ? max : fallbackMax;
  return {
    min: safeMin,
    max: Math.max(safeMin, safeMax)
  };
}

function isQueueRunning() {
  return PAGE_MODE === "run";
}

function persistQueueFiltersState() {
  try {
    const payload = {
      selectedTags: Array.from(selectedTags),
      tagSearchQuery,
      tagShowLimit,
      selectedExtraFilters: Object.fromEntries(EXTRA_FILTER_CONFIGS.map((cfg) => [cfg.key, Array.from(selectedExtraFilters[cfg.key] || [])])),
      extraFilterSearchQuery,
      extraFilterShowLimit,
      ratingMin,
      ratingMax,
      reviewsMin,
      reviewsMax,
      priceMin,
      priceMax,
      discountMin,
      discountMax,
      releaseTextEnabled,
      releaseYearRangeEnabled,
      releaseYearMin,
      releaseYearMax
    };
    localStorage.setItem(QUEUE_FILTERS_STATE_KEY, JSON.stringify(payload));
  } catch {
    // noop
  }
}

function hydrateQueueFiltersState() {
  try {
    const raw = localStorage.getItem(QUEUE_FILTERS_STATE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    selectedTags = new Set(Array.isArray(parsed?.selectedTags) ? parsed.selectedTags.map(normalizeName).filter(Boolean) : []);
    tagSearchQuery = String(parsed?.tagSearchQuery || "");
    tagShowLimit = Math.max(TAG_SHOW_STEP, Number(parsed?.tagShowLimit || TAG_SHOW_STEP));

    const selected = parsed?.selectedExtraFilters && typeof parsed.selectedExtraFilters === "object"
      ? parsed.selectedExtraFilters
      : {};
    for (const cfg of EXTRA_FILTER_CONFIGS) {
      selectedExtraFilters[cfg.key] = new Set(
        (Array.isArray(selected[cfg.key]) ? selected[cfg.key] : [])
          .map(normalizeName)
          .filter(Boolean)
      );
      extraFilterSearchQuery[cfg.key] = String(parsed?.extraFilterSearchQuery?.[cfg.key] || "");
      extraFilterShowLimit[cfg.key] = Math.max(EXTRA_SHOW_STEP, Number(parsed?.extraFilterShowLimit?.[cfg.key] || EXTRA_SHOW_STEP));
    }

    const toNum = (value, fallback) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };
    ratingMin = Math.max(0, Math.min(100, toNum(parsed?.ratingMin, 0)));
    ratingMax = Math.max(ratingMin, Math.min(100, toNum(parsed?.ratingMax, 100)));
    reviewsMin = Math.max(0, toNum(parsed?.reviewsMin, 0));
    reviewsMax = Math.max(reviewsMin, toNum(parsed?.reviewsMax, OPEN_ENDED_MAX_VALUE));
    priceMin = Math.max(0, toNum(parsed?.priceMin, 0));
    priceMax = Math.max(priceMin, toNum(parsed?.priceMax, OPEN_ENDED_MAX_VALUE));
    discountMin = Math.max(0, Math.min(100, toNum(parsed?.discountMin, 0)));
    discountMax = Math.max(discountMin, Math.min(100, toNum(parsed?.discountMax, 100)));
    releaseTextEnabled = parsed?.releaseTextEnabled !== false;
    releaseYearRangeEnabled = parsed?.releaseYearRangeEnabled !== false;
    releaseYearMin = Math.max(1970, Math.floor(toNum(parsed?.releaseYearMin, 1970)));
    releaseYearMax = Math.max(releaseYearMin, Math.floor(toNum(parsed?.releaseYearMax, new Date().getUTCFullYear() + 1)));
  } catch {
    // noop
  }
}

function buildCollectionsFilterContext() {
  const selected = selectedExtraFilters;
  return {
    sourceMode: "collections",
    sortMode: "title",
    selectedTags,
    selectedTypes: selected.types || new Set(),
    selectedPlayers: selected.players || new Set(),
    selectedFeatures: selected.features || new Set(),
    selectedHardware: selected.hardware || new Set(),
    selectedAccessibility: selected.accessibility || new Set(),
    selectedPlatforms: selected.platforms || new Set(),
    selectedLanguages: selected.languages || new Set(),
    selectedFullAudioLanguages: selected.fullAudioLanguages || new Set(),
    selectedSubtitleLanguages: selected.subtitleLanguages || new Set(),
    selectedTechnologies: selected.technologies || new Set(),
    selectedDevelopers: selected.developers || new Set(),
    selectedPublishers: selected.publishers || new Set(),
    releaseTextEnabled,
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
    priceMax,
    getMeta: getMergedMeta,
    getMetaTags: getMetaTagsForFilters,
    getMetaType: (appId) => String(getMergedMeta(appId)?.appType || "Unknown"),
    getMetaNumber: getMetaNumberForFilters,
    getMetaArray: getMetaArrayForFilters,
    getReleaseFilterData: (appId) => {
      const meta = getMergedMeta(appId);
      const releaseText = normalizeName(meta?.releaseText);
      const lower = releaseText.toLowerCase();
      let textLabel = "";
      if (releaseText && releaseText !== "-") {
        if (lower.includes("coming soon") || lower === "soon") {
          textLabel = "Soon";
        } else if (lower.includes("tba") || lower.includes("to be announced")) {
          textLabel = "TBA";
        } else {
          textLabel = releaseText;
        }
      }
      return { year: parseReleaseYear(meta), textLabel };
    }
  };
}

function applyAdvancedFilters(appIds) {
  if (!collectionsFiltersUtils?.getFilteredAndSorted) {
    return Array.isArray(appIds) ? appIds : [];
  }
  return collectionsFiltersUtils.getFilteredAndSorted(appIds, buildCollectionsFilterContext());
}

function shuffleIds(ids) {
  const out = Array.isArray(ids) ? [...ids] : [];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function getIntent(appId) {
  const item = state?.items?.[appId] || {};
  const rawTrackIntent = String(item.trackIntent || "").trim().toUpperCase();
  const rawBuyIntent = String(item.buyIntent || "").trim().toUpperCase();
  const track = rawTrackIntent === "ON" ? 1 : (rawTrackIntent === "OFF" ? 0 : (Number(item.track || 0) > 0 ? 1 : 0));
  const buyRaw = Number(item.buy || 0);
  const buy = rawBuyIntent === "BUY"
    ? 2
    : (rawBuyIntent === "MAYBE" ? 1 : (buyRaw >= 2 ? 2 : (buyRaw > 0 ? 1 : 0)));
  const labels = Array.isArray(item.labels) ? item.labels.map((x) => String(x || "").toLowerCase()) : [];
  return {
    track,
    buy,
    buyIntent: rawBuyIntent || "UNSET",
    trackIntent: rawTrackIntent || "UNSET",
    bucket: String(item.bucket || "").trim().toUpperCase(),
    steamWishlistedObserved: Boolean(item.steamWishlistedObserved),
    steamFollowedObserved: Boolean(item.steamFollowedObserved),
    owned: labels.includes("owned"),
    targetPriceCents: Number.isFinite(Number(item.targetPriceCents)) ? Number(item.targetPriceCents) : null
  };
}

function matchesListFilter(appId, listFilter) {
  const intent = getIntent(appId);
  switch (String(listFilter || "inbox")) {
    case "inbox":
      return !intent.owned
        && intent.steamWishlistedObserved
        && !intent.steamFollowedObserved
        && intent.buy <= 0
        && String(intent.bucket || "").toUpperCase() === "INBOX";
    case "wishlist":
      return !intent.owned && intent.steamWishlistedObserved;
    case "follow":
      return !intent.owned && intent.steamFollowedObserved;
    case "confirm":
      return !intent.owned && intent.buy === 2;
    case "wf":
      return !intent.owned && (intent.steamWishlistedObserved || intent.steamFollowedObserved);
    case "cf":
      return !intent.owned && (intent.buy === 2 || intent.steamFollowedObserved);
    default:
      return false;
  }
}

function getCollectionSelection() {
  const collectionEl = document.getElementById("collection-select");
  return String(collectionEl?.value || currentQueueConfig.collection || "__all__");
}

function getListSelection() {
  const listEl = document.getElementById("list-select");
  return String(listEl?.value || currentQueueConfig.list || "inbox");
}

function parseQueueRunQuery() {
  const params = new URLSearchParams(window.location.search || "");
  const run = PAGE_MODE === "run" || params.get("run") === "1";
  const listRaw = String(params.get("list") || "").trim().toLowerCase();
  const collectionRaw = String(params.get("collection") || "").trim();
  const validLists = new Set(["inbox", "wishlist", "follow", "confirm", "wf", "cf"]);
  return {
    run,
    list: validLists.has(listRaw) ? listRaw : "inbox",
    collection: collectionRaw || "__all__"
  };
}

function openQueueRunWindow(listFilter, collection) {
  const url = new URL(browser.runtime.getURL("src/pages/queue-run.html"));
  url.searchParams.set("list", String(listFilter || "inbox"));
  url.searchParams.set("collection", String(collection || "__all__"));
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

function persistUiState() {
  try {
    localStorage.setItem(QUEUE_COLLECTION_KEY, currentQueueConfig.collection);
    localStorage.setItem(QUEUE_STATE_KEY, currentQueueConfig.list);
    localStorage.setItem(QUEUE_INDEX_KEY, String(queueIndex));
  } catch {
    // noop
  }
}

function applyQueueLeftWidth(widthPx) {
  const queueBody = document.querySelector(".queue-body");
  const leftCol = document.querySelector(".queue-left");
  if (!queueBody || !leftCol) {
    return false;
  }
  const bodyWidth = queueBody.getBoundingClientRect().width || 0;
  if (!(bodyWidth > 0)) {
    return false;
  }
  const minLeft = 260;
  const maxLeft = Math.max(minLeft, Math.floor(bodyWidth - 360));
  const next = Math.max(minLeft, Math.min(maxLeft, Math.floor(Number(widthPx) || 0)));
  queueBody.style.setProperty("--queue-left-width", `${next}px`);
  return true;
}

function hydrateQueueLeftWidth() {
  try {
    const raw = Number(localStorage.getItem(QUEUE_LEFT_WIDTH_KEY) || 0);
    if (Number.isFinite(raw) && raw > 0) {
      const applied = applyQueueLeftWidth(raw);
      if (!applied) {
        requestAnimationFrame(() => {
          applyQueueLeftWidth(raw);
        });
      }
    }
  } catch {
    // noop
  }
}

function hydrateUiState() {
  try {
    const listValue = String(localStorage.getItem(QUEUE_STATE_KEY) || "inbox");
    const collection = String(localStorage.getItem(QUEUE_COLLECTION_KEY) || "__all__");
    const index = Number(localStorage.getItem(QUEUE_INDEX_KEY) || 0);
    const listEl = document.getElementById("list-select");
    const collectionEl = document.getElementById("collection-select");
    if (listEl) {
      listEl.value = listValue;
    }
    populateCollectionSelect(listValue);
    if (collectionEl) {
      collectionEl.value = collection;
    }
    if (Number.isFinite(index) && index >= 0) {
      queueIndex = Math.floor(index);
    }
    currentQueueConfig = { collection, list: listValue };
  } catch {
    // noop
  }
}

async function loadState() {
  state = await browser.runtime.sendMessage({ type: "get-state" });
}

async function loadWishlistOrder() {
  const stored = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
  const ordered = stored?.[WISHLIST_ADDED_CACHE_KEY]?.orderedAppIds;
  wishlistOrderedIds = Array.isArray(ordered) ? ordered.map((id) => String(id || "").trim()).filter(Boolean) : [];
  if (wishlistOrderedIds.length > 0) {
    return;
  }
  try {
    const fetchJson = steamFetchUtils.fetchJson || ((url, options = {}) => fetch(url, options).then((r) => r.json()));
    const userdata = await fetchJson("https://store.steampowered.com/dynamicstore/userdata/", {
      credentials: "include",
      cache: "no-store"
    });
    wishlistOrderedIds = Array.isArray(userdata?.rgWishlist)
      ? userdata.rgWishlist.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
  } catch {
    wishlistOrderedIds = [];
  }
}

function populateCollectionSelect(listFilter = getListSelection()) {
  const el = document.getElementById("collection-select");
  if (!el) {
    return;
  }
  const selectedValue = String(el.value || "__all__");
  const listLabel = String(listFilter || "inbox").toUpperCase();
  const options = [
    { value: "__all__", label: `All (${listLabel})` }
  ];
  for (const name of Array.isArray(state?.collectionOrder) ? state.collectionOrder : []) {
    const isDynamic = Boolean(state?.dynamicCollections?.[name]);
    options.push({
      value: String(name),
      label: isDynamic ? `${String(name)} [dynamic]` : String(name)
    });
  }
  el.innerHTML = "";
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    el.appendChild(node);
  }
  el.value = options.some((x) => x.value === selectedValue) ? selectedValue : "__all__";
}

function resolveBaseIdsByCollection(collection, listFilter = "inbox") {
  if (collection === "__all__") {
    if (listFilter === "wishlist" && wishlistOrderedIds.length > 0) {
      return wishlistOrderedIds;
    }
    return Object.keys(state?.items || {});
  }
  if (state?.dynamicCollections?.[collection]) {
    return getDynamicCollectionIds(collection, listFilter);
  }
  return Array.isArray(state?.collections?.[collection]) ? state.collections[collection] : [];
}

function getDynamicCollectionBaseIds(definition, listFilter) {
  const def = definition && typeof definition === "object" ? definition : {};
  const baseSource = String(def.baseSource || "wishlist");
  const baseCollection = String(def.baseCollection || "").trim();
  if (baseSource === "wishlist") {
    if (wishlistOrderedIds.length > 0) {
      return [...wishlistOrderedIds];
    }
    return Object.keys(state?.items || {});
  }
  if (baseSource === "all-items") {
    return Object.keys(state?.items || {});
  }
  if (baseSource === "all-static") {
    const out = [];
    for (const name of Array.isArray(state?.collectionOrder) ? state.collectionOrder : []) {
      if (state?.dynamicCollections?.[name]) {
        continue;
      }
      for (const appId of (state?.collections?.[name] || [])) {
        out.push(String(appId || "").trim());
      }
    }
    return Array.from(new Set(out));
  }
  if (baseSource === "static-collection") {
    return Array.isArray(state?.collections?.[baseCollection]) ? state.collections[baseCollection] : [];
  }
  return resolveBaseIdsByCollection("__all__", listFilter);
}

function getDynamicCollectionIds(collection, listFilter = "inbox") {
  const definition = state?.dynamicCollections?.[collection];
  const baseIds = getDynamicCollectionBaseIds(definition, listFilter);
  const filters = definition?.filters && typeof definition.filters === "object" ? definition.filters : {};
  const selectedTags = new Set(Array.isArray(filters.selectedTags) ? filters.selectedTags.map((x) => String(x || "").trim()).filter(Boolean) : []);
  const selectedTypes = new Set(Array.isArray(filters.selectedTypes) ? filters.selectedTypes.map((x) => String(x || "").trim()).filter(Boolean) : []);
  const out = [];
  const seen = new Set();
  for (const rawId of baseIds) {
    const appId = String(rawId || "").trim();
    if (!appId || seen.has(appId)) {
      continue;
    }
    seen.add(appId);
    const meta = collectionsMetaCache?.[appId] && typeof collectionsMetaCache[appId] === "object"
      ? collectionsMetaCache[appId]
      : {};
    if (selectedTags.size > 0) {
      const tags = Array.isArray(meta?.tags) ? meta.tags.map((t) => String(t || "").trim()).filter(Boolean) : [];
      if (!tags.some((tag) => selectedTags.has(tag))) {
        continue;
      }
    }
    if (selectedTypes.size > 0) {
      const appType = String(meta?.appType || "").trim();
      if (!selectedTypes.has(appType)) {
        continue;
      }
    }
    out.push(appId);
  }
  return out;
}

function getQueueBaseIds(collection, listFilter) {
  const base = resolveBaseIdsByCollection(collection, listFilter);
  const deduped = [];
  const seen = new Set();
  for (const rawId of base) {
    const appId = String(rawId || "").trim();
    if (!appId || seen.has(appId)) {
      continue;
    }
    if (!matchesListFilter(appId, listFilter)) {
      continue;
    }
    deduped.push(appId);
    seen.add(appId);
  }
  return deduped;
}

function buildQueueIds(collection, listFilter) {
  const deduped = getFilteredIds(collection, listFilter);
  queueIds = shuffleIds(deduped);
  queueIndex = queueIds.length > 0 ? Math.min(queueIndex, queueIds.length - 1) : 0;
  currentQueueConfig = { collection, list: listFilter };
  persistUiState();
}

function getFilteredIds(collection, listFilter) {
  const deduped = getQueueBaseIds(collection, listFilter);
  return applyAdvancedFilters(deduped);
}

function reconcileQueueIds(collection, listFilter, currentAppId = "") {
  const allowedIds = getFilteredIds(collection, listFilter);
  const allowedSet = new Set(allowedIds);
  const orderedExisting = queueIds.filter((appId) => allowedSet.has(appId));
  const existingSet = new Set(orderedExisting);
  const missing = allowedIds.filter((appId) => !existingSet.has(appId));
  const nextQueueIds = orderedExisting.concat(shuffleIds(missing));
  queueIds = nextQueueIds;
  if (queueIds.length === 0) {
    queueIndex = 0;
  } else if (currentAppId && queueIds.includes(currentAppId)) {
    queueIndex = queueIds.indexOf(currentAppId);
  } else {
    queueIndex = Math.max(0, Math.min(queueIndex, queueIds.length - 1));
  }
}

function updateAdvancedFilterLabels() {
  const ratingMinLabel = document.getElementById("queue-rating-min-label");
  const ratingMaxLabel = document.getElementById("queue-rating-max-label");
  if (ratingMinLabel) {
    ratingMinLabel.textContent = `${Math.round(ratingMin)}%`;
  }
  if (ratingMaxLabel) {
    ratingMaxLabel.textContent = `${Math.round(ratingMax)}%`;
  }

  const discountMinLabel = document.getElementById("queue-discount-min-label");
  const discountMaxLabel = document.getElementById("queue-discount-max-label");
  if (discountMinLabel) {
    discountMinLabel.textContent = `${Math.round(discountMin)}%`;
  }
  if (discountMaxLabel) {
    discountMaxLabel.textContent = `${Math.round(discountMax)}%`;
  }

  const releaseYearMinLabel = document.getElementById("queue-release-year-min-label");
  const releaseYearMaxLabel = document.getElementById("queue-release-year-max-label");
  if (releaseYearMinLabel) {
    releaseYearMinLabel.textContent = String(Math.round(releaseYearMin));
  }
  if (releaseYearMaxLabel) {
    releaseYearMaxLabel.textContent = String(Math.round(releaseYearMax));
  }

  const releaseYearPanel = document.getElementById("queue-release-year-range-panel");
  if (releaseYearPanel) {
    releaseYearPanel.classList.toggle("disabled", !releaseYearRangeEnabled);
  }
}

function applyAdvancedFiltersToInputs() {
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) {
      el.value = value;
    }
  };
  const setChecked = (id, checked) => {
    const el = document.getElementById(id);
    if (el) {
      el.checked = Boolean(checked);
    }
  };

  setValue("queue-rating-min-range", String(ratingMin));
  setValue("queue-rating-max-range", String(ratingMax));
  setValue("queue-reviews-min-input", String(reviewsMin));
  setValue("queue-reviews-max-input", reviewsMax >= OPEN_ENDED_MAX_VALUE ? "" : String(reviewsMax));
  setValue("queue-price-min-input", String(priceMin));
  setValue("queue-price-max-input", priceMax >= OPEN_ENDED_MAX_VALUE ? "" : String(priceMax));
  setValue("queue-discount-min-range", String(discountMin));
  setValue("queue-discount-max-range", String(discountMax));
  setChecked("queue-release-text-enabled", releaseTextEnabled);
  setChecked("queue-release-year-range-enabled", releaseYearRangeEnabled);

  const minRange = document.getElementById("queue-release-year-min-range");
  const maxRange = document.getElementById("queue-release-year-max-range");
  if (minRange) {
    minRange.value = String(releaseYearMin);
    minRange.disabled = !releaseYearRangeEnabled;
  }
  if (maxRange) {
    maxRange.value = String(releaseYearMax);
    maxRange.disabled = !releaseYearRangeEnabled;
  }

  const tagSearchInput = document.getElementById("queue-tag-search-input");
  if (tagSearchInput) {
    tagSearchInput.value = tagSearchQuery;
  }
  for (const cfg of EXTRA_FILTER_CONFIGS) {
    const searchInput = document.getElementById(`queue-${cfg.key}-search`);
    if (searchInput) {
      searchInput.value = String(extraFilterSearchQuery[cfg.key] || "");
    }
  }
  updateAdvancedFilterLabels();
}

function renderTagOptions() {
  const optionsEl = document.getElementById("queue-tag-options");
  const showMoreBtn = document.getElementById("queue-tag-show-more-btn");
  if (!optionsEl || !showMoreBtn) {
    return;
  }
  const query = normalizeNameLower(tagSearchQuery);
  const selectedRows = [];
  const selectedSeen = new Set();
  for (const tagName of selectedTags) {
    const found = tagCounts.find((item) => normalizeName(item.name) === tagName);
    selectedRows.push(found || { name: tagName, count: 0 });
    selectedSeen.add(tagName);
  }
  const filtered = tagCounts.filter((item) => !query || normalizeNameLower(item.name).includes(query));
  const remaining = filtered.filter((item) => !selectedSeen.has(normalizeName(item.name)));
  const ordered = [...selectedRows, ...remaining];
  const visible = ordered.slice(0, tagShowLimit);

  optionsEl.innerHTML = "";
  for (const item of visible) {
    const tagName = normalizeName(item?.name);
    if (!tagName) {
      continue;
    }
    const row = document.createElement("label");
    row.className = "tag-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedTags.has(tagName);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedTags.add(tagName);
      } else {
        selectedTags.delete(tagName);
      }
      persistQueueFiltersState();
      renderTagOptions();
      applyFiltersToQueueView().catch((error) => setStatus(String(error?.message || error || "Could not apply filters."), true));
    });
    const name = document.createElement("span");
    name.className = "tag-name";
    name.textContent = tagName;
    const count = document.createElement("span");
    count.className = "tag-count";
    count.textContent = Number(item?.count || 0) > 0 ? String(item.count) : "";
    row.appendChild(checkbox);
    row.appendChild(name);
    row.appendChild(count);
    optionsEl.appendChild(row);
  }
  showMoreBtn.style.display = ordered.length > tagShowLimit ? "" : "none";
}

function renderExtraFilterOptions(key) {
  const optionsEl = document.getElementById(`queue-${key}-options`);
  const showMoreBtn = document.getElementById(`queue-${key}-show-more`);
  if (!optionsEl || !showMoreBtn) {
    return;
  }
  const selected = selectedExtraFilters[key] || new Set();
  const counts = Array.isArray(extraFilterCounts[key]) ? extraFilterCounts[key] : [];
  const query = normalizeNameLower(extraFilterSearchQuery[key] || "");

  const selectedRows = [];
  const selectedSeen = new Set();
  for (const value of selected) {
    const found = counts.find((item) => normalizeName(item?.name) === value);
    selectedRows.push(found || { name: value, count: 0 });
    selectedSeen.add(value);
  }
  const filtered = counts.filter((item) => !query || normalizeNameLower(item?.name).includes(query));
  const remaining = filtered.filter((item) => !selectedSeen.has(normalizeName(item?.name)));
  const ordered = [...selectedRows, ...remaining];
  const visible = ordered.slice(0, Number(extraFilterShowLimit[key] || EXTRA_SHOW_STEP));

  optionsEl.innerHTML = "";
  for (const item of visible) {
    const value = normalizeName(item?.name);
    if (!value) {
      continue;
    }
    const row = document.createElement("label");
    row.className = "tag-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected.has(value);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selected.add(value);
      } else {
        selected.delete(value);
      }
      selectedExtraFilters[key] = selected;
      persistQueueFiltersState();
      renderExtraFilterOptions(key);
      applyFiltersToQueueView().catch((error) => setStatus(String(error?.message || error || "Could not apply filters."), true));
    });
    const name = document.createElement("span");
    name.className = "tag-name";
    name.textContent = value;
    const count = document.createElement("span");
    count.className = "tag-count";
    count.textContent = Number(item?.count || 0) > 0 ? String(item.count) : "";
    row.appendChild(checkbox);
    row.appendChild(name);
    row.appendChild(count);
    optionsEl.appendChild(row);
  }

  showMoreBtn.style.display = ordered.length > Number(extraFilterShowLimit[key] || EXTRA_SHOW_STEP) ? "" : "none";
}

function ensureExtraFilterUi() {
  const root = document.getElementById("queue-extra-filters-root");
  if (!root || root.dataset.ready === "1") {
    return;
  }
  for (const cfg of EXTRA_FILTER_CONFIGS) {
    const block = document.createElement("div");
    block.className = "extra-filter-block";

    const title = document.createElement("div");
    title.className = "extra-filter-title";
    title.textContent = cfg.label;

    const search = document.createElement("input");
    search.type = "search";
    search.id = `queue-${cfg.key}-search`;
    search.placeholder = cfg.placeholder;
    search.addEventListener("input", (event) => {
      extraFilterSearchQuery[cfg.key] = String(event?.target?.value || "").slice(0, 80);
      extraFilterShowLimit[cfg.key] = EXTRA_SHOW_STEP;
      persistQueueFiltersState();
      renderExtraFilterOptions(cfg.key);
    });

    const options = document.createElement("div");
    options.id = `queue-${cfg.key}-options`;
    options.className = "tag-options";

    const showMore = document.createElement("button");
    showMore.type = "button";
    showMore.id = `queue-${cfg.key}-show-more`;
    showMore.className = "small-btn";
    showMore.textContent = "Show more";
    showMore.addEventListener("click", () => {
      extraFilterShowLimit[cfg.key] = Number(extraFilterShowLimit[cfg.key] || EXTRA_SHOW_STEP) + EXTRA_SHOW_STEP;
      persistQueueFiltersState();
      renderExtraFilterOptions(cfg.key);
    });

    block.appendChild(title);
    block.appendChild(search);
    block.appendChild(options);
    block.appendChild(showMore);
    root.appendChild(block);
  }
  root.dataset.ready = "1";
}

function refreshFilterOptionsForSelection() {
  const listFilter = getListSelection();
  const collection = getCollectionSelection();
  const baseIds = getQueueBaseIds(collection, listFilter);

  tagCounts = countTags(baseIds);
  for (const cfg of EXTRA_FILTER_CONFIGS) {
    extraFilterCounts[cfg.key] = countValuesByKey(baseIds, cfg.key);
  }

  const bounds = getReleaseYearBounds(baseIds);
  releaseYearMin = Math.max(bounds.min, Math.min(releaseYearMin, bounds.max));
  releaseYearMax = Math.max(releaseYearMin, Math.min(releaseYearMax, bounds.max));

  const minRange = document.getElementById("queue-release-year-min-range");
  const maxRange = document.getElementById("queue-release-year-max-range");
  if (minRange) {
    minRange.min = String(bounds.min);
    minRange.max = String(bounds.max);
  }
  if (maxRange) {
    maxRange.min = String(bounds.min);
    maxRange.max = String(bounds.max);
  }

  renderTagOptions();
  for (const cfg of EXTRA_FILTER_CONFIGS) {
    renderExtraFilterOptions(cfg.key);
  }
  updateAdvancedFilterLabels();
}

async function applyFiltersToQueueView() {
  const listFilter = getListSelection();
  const collection = getCollectionSelection();
  if (isQueueRunning()) {
    const currentAppId = queueIds[queueIndex] || "";
    reconcileQueueIds(collection, listFilter, currentAppId);
    await renderCurrent();
    return;
  }
  const previewCount = getFilteredIds(collection, listFilter).length;
  setStatus(`Choose list and collection, then click Go. Preview: ${previewCount} game(s).`);
}

async function fetchMeta(appId) {
  const cachedMeta = metaCache.get(appId);
  if (cachedMeta && isFreshCache(cachedMeta.cachedAt)) {
    return cachedMeta;
  }
  const now = Date.now();
  const fallback = {
    cachedAt: now,
    titleText: "",
    capsuleImage: "",
    shortDescription: "",
    releaseText: "-",
    reviewText: "No user reviews",
    priceText: "-",
    discountText: "-",
    tags: [],
    hasDemo: false,
    demoAppId: ""
  };
  try {
    const fetchJson = steamFetchUtils.fetchJson || ((url, options = {}) => fetch(url, options).then((r) => r.json()));
    const payload = await fetchJson(
      `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&cc=br&l=en`,
      { cache: "no-store", credentials: "include" }
    );
    const appData = payload?.[appId]?.data || null;
    if (!appData) {
      if (cachedMeta) {
        return cachedMeta;
      }
      metaCache.set(appId, fallback);
      await persistMetaCache();
      return fallback;
    }
    const reviewPayload = await fetchJson(
      `https://store.steampowered.com/appreviews/${encodeURIComponent(appId)}?json=1&language=all&purchase_type=all&num_per_page=0`,
      { cache: "no-store" }
    ).catch(() => ({}));
    const summary = reviewPayload?.query_summary || {};
    const totalPositive = Number(summary?.total_positive || 0);
    const totalNegative = Number(summary?.total_negative || 0);
    const totalVotes = totalPositive + totalNegative;
    const positivePct = totalVotes > 0 ? Math.round((totalPositive / totalVotes) * 100) : 0;
    const genres = Array.isArray(appData?.genres) ? appData.genres.map((x) => String(x?.description || "").trim()).filter(Boolean) : [];
    const categories = Array.isArray(appData?.categories) ? appData.categories.map((x) => String(x?.description || "").trim()).filter(Boolean) : [];
    const meta = {
      cachedAt: now,
      titleText: String(appData?.name || "").trim(),
      capsuleImage: String(appData?.capsule_imagev5 || appData?.capsule_image || appData?.header_image || "").trim(),
      shortDescription: String(appData?.short_description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
      releaseText: String(appData?.release_date?.date || (appData?.release_date?.coming_soon ? "Coming soon" : "-")),
      reviewText: totalVotes > 0 ? `${positivePct}% positive (${totalVotes} reviews)` : "No user reviews",
      priceText: appData?.is_free === true
        ? "Free"
        : (String(appData?.price_overview?.final_formatted || "").trim() || (appData?.release_date?.coming_soon ? "Not announced" : "-")),
      discountText: Number(appData?.price_overview?.discount_percent || 0) > 0
        ? `${Number(appData.price_overview.discount_percent)}% off`
        : "-",
      tags: Array.from(new Set([...genres, ...categories])).slice(0, 12),
      hasDemo: Array.isArray(appData?.demos) && appData.demos.length > 0,
      demoAppId: String(appData?.demos?.[0]?.appid || "").trim()
    };
    metaCache.set(appId, meta);
    await persistMetaCache();
    return meta;
  } catch {
    if (cachedMeta) {
      return cachedMeta;
    }
    metaCache.set(appId, fallback);
    await persistMetaCache();
    return fallback;
  }
}

async function fetchMedia(appId) {
  const cachedMedia = mediaCache.get(appId);
  if (cachedMedia && isFreshCache(cachedMedia.cachedAt)) {
    return {
      videos: Array.isArray(cachedMedia.videos) ? cachedMedia.videos : [],
      images: Array.isArray(cachedMedia.images) ? cachedMedia.images : []
    };
  }
  const now = Date.now();
  const fetchJson = steamFetchUtils.fetchJson || ((url, options = {}) => fetch(url, options).then((r) => r.json()));
  const fetchText = steamFetchUtils.fetchText || ((url, options = {}) => fetch(url, options).then((r) => r.text()));
  const normalizeMediaUrl = (rawUrl) => {
    const url = String(rawUrl || "")
      .trim()
      .replace(/\\u0026/gi, "&")
      .replace(/\\x26/gi, "&")
      .replace(/\\u002f/gi, "/")
      .replace(/&amp;/gi, "&")
      .replace(/\\\//g, "/");
    if (!url) {
      return "";
    }
    if (url.startsWith("//")) {
      return `https:${url}`;
    }
    return url;
  };
  const parseStoreMediaFromHtml = (htmlText) => {
    const doc = new DOMParser().parseFromString(String(htmlText || ""), "text/html");
    const videos = [];
    const images = [];
    const seenVideos = new Set();
    const seenImages = new Set();
    const movieNodes = doc.querySelectorAll(".highlight_movie, [id^='highlight_movie_']");
    for (const movie of movieNodes) {
      const sourceNodes = movie.querySelectorAll("video source, source");
      const sourceCandidates = [
        movie.getAttribute("data-mp4-source"),
        movie.getAttribute("data-webm-source"),
        ...(Array.from(sourceNodes).map((node) => node.getAttribute("src")))
      ];
      let mediaUrl = "";
      for (const candidate of sourceCandidates) {
        const normalized = normalizeMediaUrl(candidate);
        if (!normalized) {
          continue;
        }
        mediaUrl = normalized;
        break;
      }
      if (!mediaUrl || seenVideos.has(mediaUrl)) {
        continue;
      }
      seenVideos.add(mediaUrl);
      const posterEl = movie.querySelector("img");
      const posterUrl = normalizeMediaUrl(
        movie.getAttribute("data-poster")
        || posterEl?.getAttribute("src")
        || posterEl?.getAttribute("data-src")
      );
      videos.push({ url: mediaUrl, posterUrl });
    }
    const directVideoMatches = Array.from(
      String(htmlText || "").matchAll(/https?:\\?\/\\?\/[^"'\\\s<>()]+?\.(?:mp4|webm)(?:\?[^"'\\\s<>()]*)?/gi)
    );
    for (const match of directVideoMatches) {
      const mediaUrl = normalizeMediaUrl(String(match?.[0] || "").replace(/\\\//g, "/"));
      if (!mediaUrl || seenVideos.has(mediaUrl)) {
        continue;
      }
      seenVideos.add(mediaUrl);
      videos.push({ url: mediaUrl, posterUrl: "" });
    }
    const imageNodes = doc.querySelectorAll(
      ".highlight_strip_screenshot img, .highlight_screenshot_link img, [id^='thumb_screenshot_'] img"
    );
    for (const img of imageNodes) {
      const imageUrl = normalizeMediaUrl(img.getAttribute("src") || img.getAttribute("data-src"));
      if (!imageUrl || seenImages.has(imageUrl)) {
        continue;
      }
      seenImages.add(imageUrl);
      images.push(imageUrl);
    }
    return { videos, images };
  };
  try {
    const payload = await fetchJson(
      `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&l=english&filters=movies,screenshots`,
      { cache: "no-store", credentials: "include" }
    );
    const appData = payload?.[appId]?.data || {};
    const videos = [];
    for (const movie of Array.isArray(appData?.movies) ? appData.movies : []) {
      const src = String(
        movie?.mp4?.max
        || movie?.mp4?.["480"]
        || movie?.webm?.max
        || movie?.webm?.["480"]
        || ""
      ).trim();
      if (!src) {
        continue;
      }
      videos.push({
        url: src,
        posterUrl: String(movie?.thumbnail || movie?.highlight_thumbnail || "").trim()
      });
    }
    const images = [];
    for (const shot of Array.isArray(appData?.screenshots) ? appData.screenshots : []) {
      const src = String(shot?.path_full || shot?.path_thumbnail || "").trim();
      if (!src) {
        continue;
      }
      images.push(src);
    }
    if (videos.length === 0) {
      try {
        const html = await fetchText(
          `https://store.steampowered.com/app/${encodeURIComponent(appId)}/?l=english`,
          { cache: "no-store", credentials: "include" }
        );
        const parsed = parseStoreMediaFromHtml(html);
        if (parsed.videos.length > 0) {
          const media = {
            videos: parsed.videos,
            images: images.length > 0 ? images : parsed.images
          };
          mediaCache.set(appId, { ...media, cachedAt: now });
          await persistMediaCache();
          return media;
        }
        if (images.length === 0 && parsed.images.length > 0) {
          const media = { videos: [], images: parsed.images };
          mediaCache.set(appId, { ...media, cachedAt: now });
          await persistMediaCache();
          return media;
        }
      } catch {
        // keep appdetails result
      }
    }
    const media = { videos, images };
    mediaCache.set(appId, { ...media, cachedAt: now });
    await persistMediaCache();
    return media;
  } catch {
    try {
      const html = await fetchText(
        `https://store.steampowered.com/app/${encodeURIComponent(appId)}/?l=english`,
        { cache: "no-store", credentials: "include" }
      );
      const media = parseStoreMediaFromHtml(html);
      mediaCache.set(appId, { ...media, cachedAt: now });
      await persistMediaCache();
      return media;
    } catch {
      if (cachedMedia) {
        return {
          videos: Array.isArray(cachedMedia.videos) ? cachedMedia.videos : [],
          images: Array.isArray(cachedMedia.images) ? cachedMedia.images : []
        };
      }
      const media = { videos: [], images: [] };
      mediaCache.set(appId, { ...media, cachedAt: now });
      await persistMediaCache();
      return media;
    }
  }
}

function renderMedia() {
  const videoEl = document.getElementById("media-video");
  const imageEl = document.getElementById("media-image");
  const countEl = document.getElementById("media-count");
  const prevBtn = document.getElementById("media-prev-btn");
  const nextBtn = document.getElementById("media-next-btn");
  const list = Array.isArray(mediaState.items) ? mediaState.items : [];
  const total = Array.isArray(list) ? list.length : 0;
  if (total === 0) {
    videoEl?.pause();
    if (videoEl) {
      videoEl.classList.add("hidden");
      videoEl.removeAttribute("src");
      videoEl.load();
    }
    if (imageEl) {
      imageEl.classList.add("hidden");
      imageEl.removeAttribute("src");
    }
    if (countEl) {
      countEl.textContent = "0/0";
    }
    if (prevBtn) {
      prevBtn.disabled = true;
    }
    if (nextBtn) {
      nextBtn.disabled = true;
    }
    return;
  }

  mediaState.index = Math.max(0, Math.min(total - 1, Number(mediaState.index || 0)));
  if (countEl) {
    countEl.textContent = `${mediaState.index + 1}/${total}`;
  }
  if (prevBtn) {
    prevBtn.disabled = total < 2;
  }
  if (nextBtn) {
    nextBtn.disabled = total < 2;
  }
  const current = list[mediaState.index] || {};
  if (current.type === "video") {
    const video = current || {};
    if (imageEl) {
      imageEl.classList.add("hidden");
      imageEl.removeAttribute("src");
    }
    if (videoEl) {
      videoEl.classList.remove("hidden");
      videoEl.src = String(video.url || "");
      videoEl.poster = String(video.posterUrl || "");
      videoEl.loop = total <= 1;
      videoEl.play().catch(() => {});
    }
  } else {
    videoEl?.pause();
    if (videoEl) {
      videoEl.classList.add("hidden");
      videoEl.removeAttribute("src");
      videoEl.load();
    }
    if (imageEl) {
      imageEl.classList.remove("hidden");
      imageEl.src = String(current.url || "");
      imageEl.alt = `Screenshot ${mediaState.index + 1}`;
    }
  }
}

function updateActionButtons(intent) {
  const wishlistBtn = document.getElementById("action-wishlist-btn");
  const followBtn = document.getElementById("action-follow-btn");
  const noneBtn = document.getElementById("action-none-btn");
  const wishlistFollowBtn = document.getElementById("action-wishlist-follow-btn");
  const isWishlistOnly = intent.buyIntent === "BUY" && intent.trackIntent === "OFF";
  const isFollowOnly = intent.buyIntent === "NONE" && intent.trackIntent === "ON";
  const isNone = intent.buyIntent === "NONE" && intent.trackIntent === "OFF";
  const isWishlistAndFollow = intent.buyIntent === "BUY" && intent.trackIntent === "ON";
  if (wishlistBtn) {
    wishlistBtn.classList.toggle("active", isWishlistOnly);
  }
  if (followBtn) {
    followBtn.classList.toggle("active", isFollowOnly);
  }
  if (noneBtn) {
    noneBtn.classList.toggle("active", isNone);
  }
  if (wishlistFollowBtn) {
    wishlistFollowBtn.classList.toggle("active", isWishlistAndFollow);
  }
}

function fitLayoutToViewport() {
  const container = document.querySelector(".container");
  const header = document.querySelector(".top");
  const card = document.getElementById("queue-card");
  const body = card?.querySelector(".queue-body");
  const leftCol = card?.querySelector(".queue-left");
  const controls = card?.querySelector(".media-controls");
  if (!container || !header || !card || !body || !leftCol || card.classList.contains("hidden")) {
    return;
  }
  const viewportHeight = window.innerHeight;
  const containerStyles = getComputedStyle(container);
  const padTop = Number.parseFloat(containerStyles.paddingTop || "0") || 0;
  const padBottom = Number.parseFloat(containerStyles.paddingBottom || "0") || 0;
  const availableHeight = Math.max(320, viewportHeight - padTop - padBottom - header.getBoundingClientRect().height - 12);
  card.style.height = `${Math.floor(availableHeight)}px`;

  const cardStyles = getComputedStyle(card);
  const cardPadTop = Number.parseFloat(cardStyles.paddingTop || "0") || 0;
  const cardPadBottom = Number.parseFloat(cardStyles.paddingBottom || "0") || 0;
  const leftStyles = getComputedStyle(leftCol);
  const leftGap = Number.parseFloat(leftStyles.rowGap || leftStyles.gap || "0") || 0;
  const cardGap = Number.parseFloat(cardStyles.rowGap || cardStyles.gap || "0") || 0;
  const leftHeight = Math.max(
    120,
    Math.floor(
      availableHeight
      - cardPadTop
      - cardPadBottom
      - cardGap
    )
  );
  const fixedLeft = controls ? ((controls.getBoundingClientRect().height || 0) + leftGap) : 0;
  const stageHeight = Math.max(120, Math.floor(leftHeight - fixedLeft));
  card.style.setProperty("--queue-media-height", `${stageHeight}px`);
}

async function renderCurrent() {
  const emptyEl = document.getElementById("empty");
  const cardEl = document.getElementById("queue-card");
  const navEl = document.getElementById("queue-nav");
  const headerBarEl = document.getElementById("queue-header-bar");
  if (!emptyEl || !cardEl || !navEl || !headerBarEl) {
    return;
  }
  if (queueIds.length === 0) {
    emptyEl.classList.remove("hidden");
    cardEl.classList.add("hidden");
    navEl.classList.add("hidden");
    headerBarEl.classList.add("hidden");
    setStatus("No games found for selected collection/state.");
    return;
  }

  const appId = queueIds[queueIndex];
  const item = state?.items?.[appId] || {};
  const intent = getIntent(appId);
  emptyEl.classList.add("hidden");
  cardEl.classList.remove("hidden");
  headerBarEl.classList.remove("hidden");
  navEl.classList.remove("hidden");
  hydrateQueueLeftWidth();

  const titleEl = document.getElementById("game-link");
  const capsuleLinkEl = document.getElementById("capsule-link");
  const appIdEl = document.getElementById("game-appid");
  const posEl = document.getElementById("queue-pos");
  const targetInput = document.getElementById("target-input");
  const demoBtn = document.getElementById("action-demo-btn");
  const steamUrl = `https://store.steampowered.com/app/${encodeURIComponent(appId)}/`;
  const fallbackTitle = String(item.title || "").trim() || `App ${appId}`;
  if (titleEl) {
    titleEl.textContent = fallbackTitle;
    titleEl.href = steamUrl;
  }
  if (capsuleLinkEl) {
    capsuleLinkEl.href = steamUrl;
  }
  if (appIdEl) {
    appIdEl.textContent = `AppID: ${appId}`;
  }
  if (posEl) {
    posEl.textContent = `${queueIndex + 1}/${queueIds.length}`;
  }
  if (targetInput) {
    targetInput.value = Number.isFinite(Number(intent.targetPriceCents)) && Number(intent.targetPriceCents) > 0
      ? (Number(intent.targetPriceCents) / 100).toFixed(2)
      : "";
  }
  if (demoBtn) {
    demoBtn.disabled = true;
    demoBtn.textContent = "DEMO (N/A)";
    demoBtn.title = "Checking demo availability...";
  }
  updateActionButtons(intent);

  const meta = await fetchMeta(appId);
  if (titleEl && meta.titleText) {
    titleEl.textContent = meta.titleText;
  }
  const priceText = document.getElementById("price-text");
  const discountText = document.getElementById("discount-text");
  const reviewText = document.getElementById("review-text");
  const releaseText = document.getElementById("release-text");
  const capsuleImage = document.getElementById("capsule-image");
  const shortDescriptionEl = document.getElementById("short-description");
  if (priceText) {
    priceText.textContent = `Price: ${meta.priceText || "-"}`;
  }
  if (discountText) {
    discountText.textContent = `Discount: ${meta.discountText || "-"}`;
  }
  if (reviewText) {
    reviewText.textContent = `Reviews: ${meta.reviewText || "-"}`;
  }
  if (releaseText) {
    releaseText.textContent = `Release: ${meta.releaseText || "-"}`;
  }
  if (shortDescriptionEl) {
    shortDescriptionEl.textContent = String(meta?.shortDescription || "").trim() || "-";
  }
  if (capsuleImage) {
    const capsuleUrl = String(meta?.capsuleImage || "").trim();
    if (capsuleUrl) {
      capsuleImage.src = capsuleUrl;
      capsuleImage.classList.remove("hidden");
    } else {
      capsuleImage.removeAttribute("src");
      capsuleImage.classList.add("hidden");
    }
  }
  const tagsRow = document.getElementById("tags-row");
  if (tagsRow) {
    tagsRow.innerHTML = "";
    for (const tag of Array.isArray(meta.tags) ? meta.tags : []) {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = String(tag || "");
      tagsRow.appendChild(chip);
    }
  }
  if (demoBtn) {
    const hasDemo = Boolean(meta?.hasDemo) && String(meta?.demoAppId || "").trim().length > 0;
    demoBtn.disabled = !hasDemo;
    demoBtn.textContent = hasDemo ? "DEMO" : "DEMO (N/A)";
    demoBtn.title = hasDemo ? "Add demo to Steam library" : "No demo available for this game";
  }

  fitLayoutToViewport();
  setStatus("Loading media...");
  const seq = ++mediaSeq;
  const media = await fetchMedia(appId);
  if (seq !== mediaSeq) {
    return;
  }
  const mediaItems = [
    ...(Array.isArray(media.videos) ? media.videos.map((video) => ({
      type: "video",
      url: String(video?.url || ""),
      posterUrl: String(video?.posterUrl || "")
    })) : []),
    ...(Array.isArray(media.images) ? media.images.map((imageUrl) => ({
      type: "image",
      url: String(imageUrl || ""),
      posterUrl: ""
    })) : [])
  ].filter((item) => item.url);
  mediaState = {
    index: 0,
    items: mediaItems
  };
  renderMedia();
  fitLayoutToViewport();
  setStatus(mediaItems.length > 0 ? "" : "No media for this game.");
}

async function setIntent(appId, patch) {
  const response = await browser.runtime.sendMessage({
    type: "set-item-intent",
    appId,
    title: String(state?.items?.[appId]?.title || ""),
    ...patch
  });
  const errs = Array.isArray(response?.steamWrite?.errors)
    ? response.steamWrite.errors.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  if (errs.length > 0) {
    setStatus(`Local state saved, Steam write failed: ${errs[0]}`, true);
  }
}

async function fetchSteamSessionId() {
  const fetchText = steamFetchUtils.fetchText || ((url, options = {}) => fetch(url, options).then((r) => r.text()));
  const html = await fetchText("https://store.steampowered.com/account/preferences", {
    method: "GET",
    credentials: "include",
    cache: "no-store"
  });
  const match = String(html || "").match(/g_sessionID\s*=\s*"([^"]+)"/i);
  const sessionId = String(match?.[1] || "").trim();
  if (!sessionId) {
    throw new Error("Could not resolve Steam session id.");
  }
  return sessionId;
}

function createFormData(values) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values || {})) {
    form.append(String(key), String(value ?? ""));
  }
  return form;
}

async function postSteamForm(url, values) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    body: createFormData(values),
    headers: {
      "X-Requested-With": "SteamWishlistManager"
    }
  });
  const bodyText = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Steam request failed (${response.status})${bodyText ? `: ${bodyText.slice(0, 120)}` : ""}`);
  }
  if (!bodyText) {
    return null;
  }
  try {
    return JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
}

function parseSuccessBody(body) {
  if (body == null || body === "") {
    return true;
  }
  if (body === true) {
    return true;
  }
  if (typeof body === "object") {
    return body.success === true || Number(body.success) > 0 || body.result === 1;
  }
  const text = String(body || "").toLowerCase();
  return text.includes("\"success\":1") || text.includes("\"success\":true") || text.includes("success");
}

async function resolveDemoAppId(appId) {
  const fetchJson = steamFetchUtils.fetchJson || ((url, options = {}) => fetch(url, options).then((r) => r.json()));
  const payload = await fetchJson(
    `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&l=english`,
    { cache: "no-store", credentials: "include" }
  );
  const appData = payload?.[appId]?.data || {};
  const demo = Array.isArray(appData?.demos) ? appData.demos[0] : null;
  const demoAppId = String(demo?.appid || "").trim();
  if (!demoAppId) {
    throw new Error("No demo available for this game.");
  }
  return demoAppId;
}

async function resolveDemoSubId(demoAppId) {
  const fetchText = steamFetchUtils.fetchText || ((url, options = {}) => fetch(url, options).then((r) => r.text()));
  const html = await fetchText(
    `https://store.steampowered.com/app/${encodeURIComponent(demoAppId)}/?l=english`,
    { cache: "no-store", credentials: "include" }
  );
  const patterns = [
    /AddFreeLicense\s*\(\s*(\d+)\s*\)/i,
    /addfreelicense\/(\d+)/i,
    /data-subid="(\d+)"/i,
    /name="subid"\s+value="(\d+)"/i
  ];
  for (const pattern of patterns) {
    const match = String(html || "").match(pattern);
    const subId = String(match?.[1] || "").trim();
    if (subId) {
      return subId;
    }
  }
  throw new Error("Could not resolve demo package id.");
}

async function addDemoToLibrary(appId) {
  const demoAppId = await resolveDemoAppId(appId);
  const subId = await resolveDemoSubId(demoAppId);
  const sessionId = await fetchSteamSessionId();
  const attempts = [
    {
      url: "https://store.steampowered.com/checkout/addfreelicense",
      payload: { action: "add_to_cart", sessionid: sessionId, subid: subId }
    },
    {
      url: `https://store.steampowered.com/checkout/addfreelicense/${encodeURIComponent(subId)}`,
      payload: { action: "add_to_cart", sessionid: sessionId, subid: subId }
    },
    {
      url: "https://store.steampowered.com/freelicense/addfreelicense",
      payload: { sessionid: sessionId, subid: subId }
    },
    {
      url: `https://store.steampowered.com/freelicense/addfreelicense/${encodeURIComponent(subId)}`,
      payload: { sessionid: sessionId, subid: subId }
    }
  ];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const body = await postSteamForm(attempt.url, attempt.payload);
      if (!parseSuccessBody(body)) {
        throw new Error("Steam did not confirm the demo claim.");
      }
      return { demoAppId, subId };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Could not add demo to library.");
}

async function refreshStateOnly() {
  await loadState();
  populateCollectionSelect();
}

async function startQueue(collectionOverride = "", listOverride = "") {
  await refreshStateOnly();
  const listFilter = String(listOverride || getListSelection() || "inbox");
  const listEl = document.getElementById("list-select");
  if (listEl) {
    listEl.value = listFilter;
  }
  populateCollectionSelect(listFilter);
  const collectionEl = document.getElementById("collection-select");
  let collection = String(collectionOverride || getCollectionSelection() || "__all__");
  if (collectionEl) {
    collectionEl.value = collection;
    if (String(collectionEl.value || "__all__") !== collection) {
      collection = "__all__";
      collectionEl.value = "__all__";
    }
  }
  queueIndex = 0;
  buildQueueIds(collection, listFilter);
  const setupPanelEl = document.querySelector(".setup-panel");
  const filtersPanelEl = document.getElementById("queue-filters-panel");
  const introEl = document.getElementById("queue-intro");
  const goBtnEl = document.getElementById("go-btn");
  const headerBarEl = document.getElementById("queue-header-bar");
  if (setupPanelEl) {
    setupPanelEl.classList.add("hidden");
  }
  if (filtersPanelEl) {
    filtersPanelEl.classList.add("hidden");
  }
  if (introEl) {
    introEl.classList.add("hidden");
  }
  if (goBtnEl) {
    goBtnEl.classList.add("hidden");
  }
  if (headerBarEl) {
    headerBarEl.classList.remove("hidden");
  }
  await renderCurrent();
  hydrateQueueLeftWidth();
  fitLayoutToViewport();
}

async function rerenderAfterAction(currentAppId = "") {
  await loadState();
  reconcileQueueIds(currentQueueConfig.collection, currentQueueConfig.list, currentAppId);
  await renderCurrent();
}

function bindEvents() {
  document.getElementById("list-select")?.addEventListener("change", () => {
    populateCollectionSelect(getListSelection());
    refreshFilterOptionsForSelection();
    applyFiltersToQueueView().catch((error) => setStatus(String(error?.message || error || "Could not apply filters."), true));
  });
  document.getElementById("collection-select")?.addEventListener("change", () => {
    refreshFilterOptionsForSelection();
    applyFiltersToQueueView().catch((error) => setStatus(String(error?.message || error || "Could not apply filters."), true));
  });
  document.getElementById("go-btn")?.addEventListener("click", async () => {
    const listFilter = getListSelection();
    const collection = getCollectionSelection();
    const runQuery = parseQueueRunQuery();
    if (runQuery.run) {
      await startQueue(collection, listFilter);
      return;
    }
    openQueueRunWindow(listFilter, collection);
  });

  document.getElementById("queue-tag-search-input")?.addEventListener("input", (event) => {
    tagSearchQuery = String(event?.target?.value || "").slice(0, 80);
    tagShowLimit = TAG_SHOW_STEP;
    persistQueueFiltersState();
    renderTagOptions();
  });
  document.getElementById("queue-tag-show-more-btn")?.addEventListener("click", () => {
    tagShowLimit += TAG_SHOW_STEP;
    persistQueueFiltersState();
    renderTagOptions();
  });

  const queueFilterInputs = [
    "queue-rating-min-range",
    "queue-rating-max-range",
    "queue-reviews-min-input",
    "queue-reviews-max-input",
    "queue-price-min-input",
    "queue-price-max-input",
    "queue-discount-min-range",
    "queue-discount-max-range",
    "queue-release-text-enabled",
    "queue-release-year-range-enabled",
    "queue-release-year-min-range",
    "queue-release-year-max-range"
  ];
  for (const id of queueFilterInputs) {
    const el = document.getElementById(id);
    if (!el) {
      continue;
    }
    const applyFromInputs = async () => {
      const num = (value, fallback) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
      };

      ratingMin = Math.max(0, Math.min(100, num(document.getElementById("queue-rating-min-range")?.value, ratingMin)));
      ratingMax = Math.max(ratingMin, Math.min(100, num(document.getElementById("queue-rating-max-range")?.value, ratingMax)));

      const rawReviewsMin = num(document.getElementById("queue-reviews-min-input")?.value, reviewsMin);
      const rawReviewsMax = String(document.getElementById("queue-reviews-max-input")?.value || "").trim();
      const parsedReviewsMax = rawReviewsMax === "" ? OPEN_ENDED_MAX_VALUE : num(rawReviewsMax, reviewsMax);
      reviewsMin = Math.max(0, Math.min(rawReviewsMin, parsedReviewsMax));
      reviewsMax = Math.max(reviewsMin, parsedReviewsMax);

      const rawPriceMin = num(document.getElementById("queue-price-min-input")?.value, priceMin);
      const rawPriceMax = String(document.getElementById("queue-price-max-input")?.value || "").trim();
      const parsedPriceMax = rawPriceMax === "" ? OPEN_ENDED_MAX_VALUE : num(rawPriceMax, priceMax);
      priceMin = Math.max(0, Math.min(rawPriceMin, parsedPriceMax));
      priceMax = Math.max(priceMin, parsedPriceMax);

      discountMin = Math.max(0, Math.min(100, num(document.getElementById("queue-discount-min-range")?.value, discountMin)));
      discountMax = Math.max(discountMin, Math.min(100, num(document.getElementById("queue-discount-max-range")?.value, discountMax)));

      releaseTextEnabled = Boolean(document.getElementById("queue-release-text-enabled")?.checked);
      releaseYearRangeEnabled = Boolean(document.getElementById("queue-release-year-range-enabled")?.checked);
      releaseYearMin = Math.max(1970, Math.floor(num(document.getElementById("queue-release-year-min-range")?.value, releaseYearMin)));
      releaseYearMax = Math.max(releaseYearMin, Math.floor(num(document.getElementById("queue-release-year-max-range")?.value, releaseYearMax)));

      applyAdvancedFiltersToInputs();
      persistQueueFiltersState();
      await applyFiltersToQueueView();
    };

    el.addEventListener("input", () => {
      applyFromInputs().catch((error) => setStatus(String(error?.message || error || "Could not apply filters."), true));
    });
    el.addEventListener("change", () => {
      applyFromInputs().catch((error) => setStatus(String(error?.message || error || "Could not apply filters."), true));
    });
  }

  document.getElementById("prev-btn")?.addEventListener("click", async () => {
    if (queueIds.length === 0) {
      return;
    }
    queueIndex = (queueIndex - 1 + queueIds.length) % queueIds.length;
    persistUiState();
    await renderCurrent();
  });
  document.getElementById("next-btn")?.addEventListener("click", async () => {
    if (queueIds.length === 0) {
      return;
    }
    queueIndex = (queueIndex + 1) % queueIds.length;
    persistUiState();
    await renderCurrent();
  });

  document.getElementById("media-prev-btn")?.addEventListener("click", () => {
    const list = Array.isArray(mediaState.items) ? mediaState.items : [];
    if (!Array.isArray(list) || list.length < 2) {
      return;
    }
    mediaState.index = (mediaState.index - 1 + list.length) % list.length;
    renderMedia();
  });
  document.getElementById("media-next-btn")?.addEventListener("click", () => {
    const list = Array.isArray(mediaState.items) ? mediaState.items : [];
    if (!Array.isArray(list) || list.length < 2) {
      return;
    }
    mediaState.index = (mediaState.index + 1) % list.length;
    renderMedia();
  });
  document.getElementById("media-video")?.addEventListener("ended", () => {
    const list = Array.isArray(mediaState.items) ? mediaState.items : [];
    if (list.length < 2) {
      return;
    }
    mediaState.index = (mediaState.index + 1) % list.length;
    renderMedia();
  });

  document.getElementById("action-wishlist-btn")?.addEventListener("click", async () => {
    const appId = queueIds[queueIndex];
    if (!appId) {
      return;
    }
    updateActionButtons({ buyIntent: "BUY", trackIntent: "OFF" });
    await setIntent(appId, {
      buy: 2,
      track: 0,
      buyIntent: "BUY",
      trackIntent: "OFF",
      bucket: "BUY"
    });
    await rerenderAfterAction(appId);
  });
  document.getElementById("action-follow-btn")?.addEventListener("click", async () => {
    const appId = queueIds[queueIndex];
    if (!appId) {
      return;
    }
    updateActionButtons({ buyIntent: "NONE", trackIntent: "ON" });
    await setIntent(appId, {
      buy: 0,
      track: 1,
      buyIntent: "NONE",
      trackIntent: "ON",
      bucket: "TRACK"
    });
    await rerenderAfterAction(appId);
  });
  document.getElementById("action-none-btn")?.addEventListener("click", async () => {
    const appId = queueIds[queueIndex];
    if (!appId) {
      return;
    }
    updateActionButtons({ buyIntent: "NONE", trackIntent: "OFF" });
    await setIntent(appId, {
      buy: 0,
      track: 0,
      buyIntent: "NONE",
      trackIntent: "OFF",
      bucket: "INBOX"
    });
    await rerenderAfterAction(appId);
  });
  document.getElementById("action-wishlist-follow-btn")?.addEventListener("click", async () => {
    const appId = queueIds[queueIndex];
    if (!appId) {
      return;
    }
    updateActionButtons({ buyIntent: "BUY", trackIntent: "ON" });
    await setIntent(appId, {
      buy: 2,
      track: 1,
      buyIntent: "BUY",
      trackIntent: "ON",
      bucket: "BUY"
    });
    await rerenderAfterAction(appId);
  });
  document.getElementById("action-demo-btn")?.addEventListener("click", async () => {
    const appId = queueIds[queueIndex];
    if (!appId) {
      return;
    }
    const currentMeta = metaCache.get(appId);
    if (!currentMeta || !currentMeta.hasDemo || !String(currentMeta.demoAppId || "").trim()) {
      setStatus("No demo available for this game.", true);
      return;
    }
    const ok = window.confirm("Add this game's demo to your Steam library?");
    if (!ok) {
      return;
    }
    const demoBtn = document.getElementById("action-demo-btn");
    if (demoBtn) {
      demoBtn.disabled = true;
    }
    setStatus("Adding demo to Steam library...");
    try {
      const added = await addDemoToLibrary(appId);
      setStatus(`Demo added to library (app ${added.demoAppId}).`);
    } catch (error) {
      const message = String(error?.message || error || "unknown error");
      setStatus(`Could not add demo automatically: ${message}`, true);
    } finally {
      if (demoBtn) {
        demoBtn.disabled = false;
      }
    }
  });
  document.getElementById("target-input")?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    const appId = queueIds[queueIndex];
    if (!appId) {
      return;
    }
    const input = document.getElementById("target-input");
    const raw = String(input?.value || "").trim().replace(",", ".");
    if (!raw) {
      await setIntent(appId, { targetPriceCents: null });
      setStatus("Target price cleared.");
      await rerenderAfterAction(appId);
      return;
    }
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      setStatus("Invalid target price.", true);
      return;
    }
    await setIntent(appId, { targetPriceCents: Math.round(amount * 100) });
    setStatus("Target price saved.");
    await rerenderAfterAction(appId);
  });

  const resizeHandle = document.getElementById("queue-column-resize-handle");
  if (resizeHandle) {
    resizeHandle.addEventListener("mousedown", (event) => {
      if (window.matchMedia("(max-width: 980px)").matches) {
        return;
      }
      event.preventDefault();
      const queueBody = document.querySelector(".queue-body");
      const leftCol = document.querySelector(".queue-left");
      if (!queueBody || !leftCol) {
        return;
      }
      const startX = event.clientX;
      const startWidth = leftCol.getBoundingClientRect().width;
      const onMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        applyQueueLeftWidth(startWidth + delta);
        fitLayoutToViewport();
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        const currentWidth = leftCol.getBoundingClientRect().width;
        try {
          localStorage.setItem(QUEUE_LEFT_WIDTH_KEY, String(Math.round(currentWidth)));
        } catch {
          // noop
        }
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  window.addEventListener("resize", () => {
    hydrateQueueLeftWidth();
    fitLayoutToViewport();
  });
}

async function init() {
  const runQuery = parseQueueRunQuery();
  await loadState();
  await loadWishlistOrder();
  await loadCollectionsMetaCache();
  await loadQueueCaches();
  hydrateQueueFiltersState();
  if (PAGE_MODE === "setup") {
    ensureExtraFilterUi();
    populateCollectionSelect();
    hydrateUiState();
    applyAdvancedFiltersToInputs();
    refreshFilterOptionsForSelection();
  }
  hydrateQueueLeftWidth();
  bindEvents();
  if (PAGE_MODE === "run" || runQuery.run) {
    await startQueue(runQuery.collection, runQuery.list);
    return;
  }
  await applyFiltersToQueueView();
}

init().catch((error) => {
  setStatus(String(error?.message || "Failed to initialize queue."), true);
});
