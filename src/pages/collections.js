const PAGE_SIZE = 30;
const META_CACHE_KEY = "steamWishlistCollectionsMetaCacheV4";
const META_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const WISHLIST_ADDED_CACHE_KEY = "steamWishlistAddedMapV3";
const WISHLIST_FULL_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TAG_COUNTS_CACHE_KEY = "steamWishlistTagCountsCacheV1";
const TYPE_COUNTS_CACHE_KEY = "steamWishlistTypeCountsCacheV1";
const EXTRA_FILTER_COUNTS_CACHE_KEY = "steamWishlistExtraFilterCountsCacheV1";
const TAG_SHOW_STEP = 12;
const SAFE_FETCH_CONCURRENCY = 4;
const SAFE_FETCH_BASE_DELAY_MS = 350;
const SAFE_FETCH_JITTER_MS = 220;
const SAFE_FETCH_MAX_RETRIES = 3;
const WISHLIST_SELECT_VALUE = "__wishlist__";

let state = null;
let activeCollection = "__all__";
let sourceMode = "collections";
let page = 1;
let searchQuery = "";
let sortMode = "position";

let metaCache = {};
let wishlistAddedMap = {};
let wishlistOrderedAppIds = [];
let wishlistPriorityMap = {};
let wishlistSortSignature = "";
let wishlistSortOrders = {};
let wishlistSnapshotDay = "";
let currentRenderedPageIds = [];

let selectedTags = new Set();
let tagSearchQuery = "";
let tagShowLimit = TAG_SHOW_STEP;
let tagCounts = [];
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
let selectedFullAudioLanguages = new Set();
let fullAudioLanguageCounts = [];
let selectedSubtitleLanguages = new Set();
let subtitleLanguageCounts = [];
let selectedTechnologies = new Set();
let technologyCounts = [];
let selectedDevelopers = new Set();
let developerCounts = [];
let selectedPublishers = new Set();
let publisherCounts = [];
let selectedReleaseYears = new Set();
let releaseYearCounts = [];
let ratingMin = 0;
let ratingMax = 100;
let reviewsMin = 0;
let reviewsMax = 999999999;
let discountMin = 0;
let discountMax = 100;
let priceMin = 0;
let priceMax = 9999999;

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

function nextBackoffDelay(attempt) {
  const jitter = Math.floor(Math.random() * SAFE_FETCH_JITTER_MS);
  return (SAFE_FETCH_BASE_DELAY_MS * (2 ** attempt)) + jitter;
}

function shouldRetryStatus(status) {
  return [403, 429, 500, 502, 503, 504].includes(Number(status));
}

async function fetchSteamJson(url, options = {}) {
  let attempt = 0;
  while (true) {
    try {
      const response = await fetch(url, { cache: "no-store", ...options });
      if (response.ok) {
        return await response.json();
      }
      if (attempt < SAFE_FETCH_MAX_RETRIES && shouldRetryStatus(response.status)) {
        await sleep(nextBackoffDelay(attempt));
        attempt += 1;
        continue;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (attempt >= SAFE_FETCH_MAX_RETRIES) {
        throw error;
      }
      await sleep(nextBackoffDelay(attempt));
      attempt += 1;
    }
  }
}

async function fetchSteamText(url, options = {}) {
  let attempt = 0;
  while (true) {
    try {
      const response = await fetch(url, { cache: "no-store", ...options });
      if (response.ok) {
        return await response.text();
      }
      if (attempt < SAFE_FETCH_MAX_RETRIES && shouldRetryStatus(response.status)) {
        await sleep(nextBackoffDelay(attempt));
        attempt += 1;
        continue;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (attempt >= SAFE_FETCH_MAX_RETRIES) {
        throw error;
      }
      await sleep(nextBackoffDelay(attempt));
      attempt += 1;
    }
  }
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
    for (const name of state.collectionOrder || []) {
      const ids = state.collections?.[name] || [];
      for (const id of ids) {
        all.push(id);
      }
    }
    return Array.from(new Set(all));
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

function sortByWishlistPriority(appIds) {
  const indexed = appIds.map((id, index) => ({ id, index }));
  indexed.sort((a, b) => {
    const pa = Number(wishlistPriorityMap?.[a.id]);
    const pb = Number(wishlistPriorityMap?.[b.id]);
    const hasPa = Number.isFinite(pa);
    const hasPb = Number.isFinite(pb);
    if (hasPa && hasPb) {
      return pa - pb;
    }
    if (hasPa) {
      return -1;
    }
    if (hasPb) {
      return 1;
    }
    return a.index - b.index;
  });
  return indexed.map((entry) => entry.id);
}

function buildWishlistSortOrders(appIds) {
  const ids = Array.isArray(appIds) ? [...appIds] : [];
  const basePosition = sortByWishlistPriority(ids);

  function stableSorted(compareFn) {
    const indexed = ids.map((id, index) => ({ id, index }));
    indexed.sort((a, b) => {
      const byRule = compareFn(a.id, b.id);
      if (byRule !== 0) {
        return byRule;
      }
      return a.index - b.index;
    });
    return indexed.map((entry) => entry.id);
  }

  return {
    position: basePosition,
    title: stableSorted((a, b) => {
      const ta = String(state?.items?.[a]?.title || metaCache?.[a]?.titleText || a);
      const tb = String(state?.items?.[b]?.title || metaCache?.[b]?.titleText || b);
      return ta.localeCompare(tb, "pt-BR", { sensitivity: "base" });
    }),
    price: stableSorted((a, b) => getEffectiveSortPrice(a) - getEffectiveSortPrice(b)),
    discount: stableSorted((a, b) => getMetaNumber(b, "discountPercent", 0) - getMetaNumber(a, "discountPercent", 0)),
    "date-added": stableSorted((a, b) => Number(wishlistAddedMap[b] || 0) - Number(wishlistAddedMap[a] || 0)),
    "top-selling": stableSorted((a, b) => getMetaNumber(b, "recommendationsTotal", 0) - getMetaNumber(a, "recommendationsTotal", 0)),
    "release-date": stableSorted((a, b) => getMetaNumber(b, "releaseUnix", 0) - getMetaNumber(a, "releaseUnix", 0)),
    "review-score": stableSorted((a, b) => {
      const pctDiff = getMetaNumber(b, "reviewPositivePct", -1) - getMetaNumber(a, "reviewPositivePct", -1);
      if (pctDiff !== 0) {
        return pctDiff;
      }
      return getMetaNumber(b, "reviewTotalVotes", 0) - getMetaNumber(a, "reviewTotalVotes", 0);
    })
  };
}

function buildTagCacheBucketKey() {
  return "wishlist-all";
}

function getMetaTags(appId) {
  const tags = metaCache[appId]?.tags;
  return Array.isArray(tags) ? tags : [];
}

function normalizeAppTypeLabel(value) {
  const raw = String(value || "").trim();
  const lowered = raw.toLowerCase();
  if (!raw) {
    return "Unknown";
  }

  const known = {
    game: "Game",
    dlc: "DLC",
    music: "Music",
    demo: "Demo",
    application: "Application",
    video: "Video",
    movie: "Video",
    series: "Series",
    tool: "Tool",
    beta: "Beta"
  };

  if (known[lowered]) {
    return known[lowered];
  }

  // Preserve raw Steam type when it's not in our mapping.
  return raw;
}

function getMetaType(appId) {
  const value = metaCache[appId]?.appType;
  return normalizeAppTypeLabel(value);
}

function getMetaNumber(appId, key, fallback = 0) {
  const n = Number(metaCache?.[appId]?.[key]);
  return Number.isFinite(n) ? n : fallback;
}

function getMetaArray(appId, key) {
  const value = metaCache?.[appId]?.[key];
  return Array.isArray(value) ? value : [];
}

function parseSupportedLanguages(rawHtml) {
  const text = String(rawHtml || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?strong>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\(text only\)/gi, "")
    .replace(/\(interface\)/gi, "")
    .replace(/\(subtitles\)/gi, "")
    .replace(/\(full audio\)/gi, "");

  const langs = [];
  for (const line of text.split("\n")) {
    const normalized = String(line || "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
    if (normalized) {
      langs.push(normalized);
    }
  }
  return Array.from(new Set(langs));
}

function parseFullAudioLanguages(rawHtml) {
  const html = String(rawHtml || "").replace(/<br\s*\/?>/gi, "\n");
  const out = [];
  for (const line of html.split("\n")) {
    if (!line.includes("*")) {
      continue;
    }
    const normalized = line
      .replace(/<\/?strong>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (normalized) {
      out.push(normalized);
    }
  }
  return Array.from(new Set(out));
}

function parseLooseInteger(value, fallback = 0) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (!digits) {
    return fallback;
  }
  const n = Number(digits);
  return Number.isFinite(n) ? n : fallback;
}

function extractPriceTextFromDiscountBlock(blockHtml) {
  const block = String(blockHtml || "");
  if (!block) {
    return "";
  }

  const finalMatch = block.match(/discount_final_price">([^<]+)/i);
  if (finalMatch?.[1]) {
    return finalMatch[1].replace(/&nbsp;/g, " ").trim();
  }

  const plainMatch = block.match(/game_purchase_price\s*price">([^<]+)/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].replace(/&nbsp;/g, " ").trim();
  }

  return "";
}

function getEffectiveSortPrice(appId) {
  const meta = metaCache?.[appId] || {};
  const isFree = String(meta.priceText || "").trim().toLowerCase() === "free";
  if (isFree) {
    return 0;
  }

  const finalPrice = Number(meta.priceFinal);
  if (Number.isFinite(finalPrice) && finalPrice > 0) {
    // Steam `final` already includes active discount.
    return finalPrice;
  }

  // Unknown/unavailable price goes to end.
  return Number.POSITIVE_INFINITY;
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

async function loadWishlistAddedMap() {
  const now = Date.now();
  const stored = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
  const cached = stored[WISHLIST_ADDED_CACHE_KEY] || {};
  const cachedMap = cached.map || {};
  const lastFullSyncAt = Number(cached.lastFullSyncAt || 0);

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

  try {
    const userdata = await fetchSteamJson("https://store.steampowered.com/dynamicstore/userdata/", {
      credentials: "include",
      cache: "no-store"
    });
    const nowIds = Array.isArray(userdata?.rgWishlist)
      ? userdata.rgWishlist.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    wishlistOrderedAppIds = [...nowIds];
    wishlistPriorityMap = {};
    wishlistSortSignature = "";
    wishlistSortOrders = {};
    wishlistSnapshotDay = "";

    // If we couldn't load current wishlist, keep existing cache to avoid destructive overwrite.
    if (nowIds.length === 0 && Object.keys(cachedMap).length > 0) {
      wishlistAddedMap = { ...cachedMap };
      if (wishlistOrderedAppIds.length === 0) {
        wishlistOrderedAppIds = Object.keys(cachedMap);
      }
      return;
    }

    const nowSet = new Set(nowIds);
    const cachedIds = Object.keys(cachedMap);
    const cachedSet = new Set(cachedIds);

    const addedIds = nowIds.filter((id) => !cachedSet.has(id));
    const removedIds = cachedIds.filter((id) => !nowSet.has(id));

    const nextMap = { ...cachedMap };
    for (const id of removedIds) {
      delete nextMap[id];
    }
    for (const id of addedIds) {
      nextMap[id] = 0;
    }

    let steamId = String(
      userdata?.steamid
      || userdata?.strSteamId
      || userdata?.str_steamid
      || userdata?.webapi_token_steamid
      || ""
    ).trim();

    const shouldRunDailyFullSync = now - lastFullSyncAt >= WISHLIST_FULL_SYNC_INTERVAL_MS;
    const needsTimestampSync = addedIds.length > 0 || shouldRunDailyFullSync;
    let nextLastFullSyncAt = lastFullSyncAt;

    if (needsTimestampSync) {
      if (!steamId) {
        steamId = await resolveSteamIdFromStoreHtml();
      }

      if (steamId) {
        const targetIds = shouldRunDailyFullSync ? nowIds : addedIds;
        const addedById = await fetchAddedTimestampsById(steamId, targetIds);
        for (const [appId, added] of Object.entries(addedById)) {
          nextMap[appId] = Number(added || 0);
        }
      }

      // Avoid retrying full sync on every render when Steam ID/timestamps are unavailable.
      if (shouldRunDailyFullSync) {
        nextLastFullSyncAt = now;
      }
    }

    wishlistAddedMap = nextMap;
    await browser.storage.local.set({
      [WISHLIST_ADDED_CACHE_KEY]: {
        cachedAt: now,
        lastFullSyncAt: nextLastFullSyncAt,
        map: wishlistAddedMap
      }
    });
  } catch {
    wishlistAddedMap = { ...cachedMap };
    if (wishlistOrderedAppIds.length === 0) {
      wishlistOrderedAppIds = Object.keys(cachedMap);
    }
    wishlistSortSignature = "";
    wishlistSortOrders = {};
    wishlistSnapshotDay = "";
  }
}

async function ensureWishlistOrderFromSnapshot(appIds) {
  if (sourceMode !== "wishlist" || !Array.isArray(appIds) || appIds.length === 0) {
    return;
  }

  const missing = new Set(
    appIds.filter((appId) => !Number.isFinite(Number(wishlistPriorityMap?.[appId])))
  );
  if (missing.size === 0) {
    wishlistOrderedAppIds = sortByWishlistPriority(appIds);
    return;
  }

  const steamId = await resolveCurrentSteamId();
  if (!steamId) {
    return;
  }

  setStatus("Loading wishlist order...");
  let orderRank = 0;
  for (let pageIndex = 0; pageIndex < 200 && missing.size > 0; pageIndex += 1) {
    const payload = await fetchSteamJson(
      `https://store.steampowered.com/wishlist/profiles/${steamId}/wishlistdata/?p=${pageIndex}`,
      {
        credentials: "include",
        cache: "no-store"
      }
    );
    const entries = Object.entries(payload || {});
    if (entries.length === 0) {
      break;
    }

    for (const [appId, entry] of entries) {
      if (!missing.has(appId)) {
        orderRank += 1;
        continue;
      }
      // Use snapshot traversal order to mirror Steam wishlist ranking.
      wishlistPriorityMap[appId] = orderRank;
      orderRank += 1;
      missing.delete(appId);
    }
  }

  wishlistOrderedAppIds = sortByWishlistPriority(appIds);
  setStatus("");
}

async function resolveCurrentSteamId() {
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

async function ensureWishlistMetaFromSnapshot(appIds) {
  if (sourceMode !== "wishlist" || !Array.isArray(appIds) || appIds.length === 0) {
    return;
  }
  const unresolved = new Set(appIds);

  const steamId = await resolveCurrentSteamId();
  if (!steamId) {
    return;
  }

  setStatus("Loading wishlist snapshot metadata...");
  let changed = false;
  let orderRank = 0;

  for (let pageIndex = 0; pageIndex < 200 && unresolved.size > 0; pageIndex += 1) {
    const payload = await fetchSteamJson(
      `https://store.steampowered.com/wishlist/profiles/${steamId}/wishlistdata/?p=${pageIndex}`,
      {
        credentials: "include",
        cache: "no-store"
      }
    );
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
      // Keep ranking for all items seen in snapshot pages.
      wishlistPriorityMap[appId] = orderRank;
      orderRank += 1;
    }
  }

  if (changed) {
    await saveMetaCache();
  }

  wishlistOrderedAppIds = sortByWishlistPriority(appIds);

  setStatus("");
}

async function ensureWishlistPrecomputedSorts(appIds) {
  if (sourceMode !== "wishlist" || !Array.isArray(appIds) || appIds.length === 0) {
    return;
  }

  const signature = buildWishlistSignature(appIds);
  const day = todayKey();
  const needsDailyRefresh = wishlistSnapshotDay !== day;

  if (wishlistSortSignature === signature && wishlistSortOrders?.position?.length && !needsDailyRefresh) {
    return;
  }

  await ensureWishlistMetaFromSnapshot(appIds);
  wishlistSortOrders = buildWishlistSortOrders(appIds);
  wishlistSortSignature = signature;
  wishlistSnapshotDay = day;
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
  await ensureMetaForAppIds(allIds, allIds.length, true);
  await browser.storage.local.remove([TAG_COUNTS_CACHE_KEY, TYPE_COUNTS_CACHE_KEY, EXTRA_FILTER_COUNTS_CACHE_KEY]);
  invalidateWishlistPrecomputedSorts();

  await Promise.allSettled([ensureTagCounts(), ensureTypeCounts(), ensureExtraFilterCounts()]);
  renderTagOptions();
  renderTypeOptions();
  renderExtraFilterOptions();
  await render();
  setStatus("Database refreshed.");
}

async function refreshCurrentPageItems() {
  const ids = Array.isArray(currentRenderedPageIds) ? currentRenderedPageIds : [];
  if (ids.length === 0) {
    setStatus("No visible items to refresh.");
    return;
  }

  setStatus(`Refreshing ${ids.length} visible items...`);
  await ensureMetaForAppIds(ids, ids.length, true);
  await browser.storage.local.remove([TAG_COUNTS_CACHE_KEY, TYPE_COUNTS_CACHE_KEY, EXTRA_FILTER_COUNTS_CACHE_KEY]);
  invalidateWishlistPrecomputedSorts();
  await Promise.allSettled([ensureTagCounts(), ensureTypeCounts(), ensureExtraFilterCounts()]);
  renderTagOptions();
  renderTypeOptions();
  renderExtraFilterOptions();
  await render();
  setStatus("Visible items refreshed.");
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
  const stored = await browser.storage.local.get(META_CACHE_KEY);
  metaCache = stored[META_CACHE_KEY] || {};
}

async function saveMetaCache() {
  await browser.storage.local.set({ [META_CACHE_KEY]: metaCache });
}

function getCardImageUrl(appId) {
  return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_184x69.jpg`;
}

function getAppLink(appId) {
  return `https://store.steampowered.com/app/${appId}/`;
}

async function fetchAppMeta(appId, options = {}) {
  const force = Boolean(options.force);
  const cached = metaCache[appId];
  const now = Date.now();

  if (!force && cached && now - cached.cachedAt < META_CACHE_TTL_MS && !isMetaIncomplete(cached)) {
    return cached;
  }

  async function fetchAppDetailsDataWithFallback() {
    const urls = [
      `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=br&l=pt-BR`,
      `https://store.steampowered.com/api/appdetails?appids=${appId}&l=en`,
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

  try {
    const [detailsDataResult, reviewsResult] = await Promise.allSettled([
      fetchAppDetailsDataWithFallback(),
      fetchSteamJson(`https://store.steampowered.com/appreviews/${appId}?json=1&language=all&purchase_type=all&num_per_page=0`)
    ]);

    let appData = null;
    if (detailsDataResult.status === "fulfilled") {
      appData = detailsDataResult.value;
    }

    if (!appData) {
      throw new Error("No appdetails payload");
    }

    let reviewsPayload = null;
    if (reviewsResult.status === "fulfilled") {
      reviewsPayload = reviewsResult.value;
    }

    const reviewSummary = reviewsPayload?.query_summary || {};

    const genres = Array.isArray(appData?.genres)
      ? appData.genres.map((g) => String(g.description || "").trim()).filter(Boolean)
      : [];
    const categories = Array.isArray(appData?.categories)
      ? appData.categories.map((c) => String(c.description || "").trim()).filter(Boolean)
      : [];
    const tags = Array.from(new Set([...genres, ...categories])).slice(0, 12);
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

async function ensureMetaForAppIds(appIds, limit = 400, force = false) {
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

  const concurrency = SAFE_FETCH_CONCURRENCY;
  let cursor = 0;

  async function worker() {
    while (cursor < missing.length) {
      const idx = cursor;
      cursor += 1;
      await fetchAppMeta(missing[idx], { force });
      await sleep(80 + Math.floor(Math.random() * 100));
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
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

function buildReleaseYearCountsFromAppIds(appIds) {
  const counts = new Map();
  for (const appId of appIds) {
    const unix = getMetaNumber(appId, "releaseUnix", 0);
    if (!unix) {
      continue;
    }
    const year = new Date(unix * 1000).getUTCFullYear();
    if (!Number.isFinite(year) || year < 1970) {
      continue;
    }
    const key = String(year);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => Number(b.name) - Number(a.name));
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

  const storage = await browser.storage.local.get(TAG_COUNTS_CACHE_KEY);
  const cache = storage[TAG_COUNTS_CACHE_KEY] || {};
  const cachedBucket = cache[bucket];

  if (cachedBucket && cachedBucket.day === day && cachedBucket.appCount === appIds.length) {
    tagCounts = Array.isArray(cachedBucket.counts) ? cachedBucket.counts : [];
    return;
  }

  setStatus("Recalculating tag frequencies for full wishlist...");
  await ensureMetaForAppIds(appIds, 2000);

  tagCounts = buildTagCountsFromAppIds(appIds);

  cache[bucket] = {
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

  if (cachedBucket && cachedBucket.day === day) {
    typeCounts = Array.isArray(cachedBucket.counts) ? cachedBucket.counts : [];
    return;
  }

  setStatus("Loading full wishlist metadata for type frequencies...");
  await ensureMetaForAppIds(appIds, appIds.length);

  const unknownTypeIds = getUnknownTypeAppIds(appIds);
  if (unknownTypeIds.length > 0) {
    setStatus("Refreshing unresolved app types...");
    await ensureMetaForAppIds(unknownTypeIds, unknownTypeIds.length, true);
  }

  typeCounts = buildTypeCountsFromAppIds(appIds);

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

  if (cachedBucket && cachedBucket.day === day) {
    playerCounts = Array.isArray(cachedBucket.playerCounts) ? cachedBucket.playerCounts : [];
    featureCounts = Array.isArray(cachedBucket.featureCounts) ? cachedBucket.featureCounts : [];
    hardwareCounts = Array.isArray(cachedBucket.hardwareCounts) ? cachedBucket.hardwareCounts : [];
    accessibilityCounts = Array.isArray(cachedBucket.accessibilityCounts) ? cachedBucket.accessibilityCounts : [];
    platformCounts = Array.isArray(cachedBucket.platformCounts) ? cachedBucket.platformCounts : [];
    languageCounts = Array.isArray(cachedBucket.languageCounts) ? cachedBucket.languageCounts : [];
    fullAudioLanguageCounts = Array.isArray(cachedBucket.fullAudioLanguageCounts) ? cachedBucket.fullAudioLanguageCounts : [];
    subtitleLanguageCounts = Array.isArray(cachedBucket.subtitleLanguageCounts) ? cachedBucket.subtitleLanguageCounts : [];
    technologyCounts = Array.isArray(cachedBucket.technologyCounts) ? cachedBucket.technologyCounts : [];
    developerCounts = Array.isArray(cachedBucket.developerCounts) ? cachedBucket.developerCounts : [];
    publisherCounts = Array.isArray(cachedBucket.publisherCounts) ? cachedBucket.publisherCounts : [];
    releaseYearCounts = Array.isArray(cachedBucket.releaseYearCounts) ? cachedBucket.releaseYearCounts : [];
    return;
  }

  setStatus("Loading metadata for extra filters...");
  await ensureMetaForAppIds(appIds, 2000);

  playerCounts = buildArrayFieldCountsFromAppIds(appIds, "players");
  featureCounts = buildArrayFieldCountsFromAppIds(appIds, "features");
  hardwareCounts = buildArrayFieldCountsFromAppIds(appIds, "hardware");
  accessibilityCounts = buildArrayFieldCountsFromAppIds(appIds, "accessibility");
  platformCounts = buildArrayFieldCountsFromAppIds(appIds, "platforms");
  languageCounts = buildArrayFieldCountsFromAppIds(appIds, "languages");
  fullAudioLanguageCounts = buildArrayFieldCountsFromAppIds(appIds, "fullAudioLanguages");
  subtitleLanguageCounts = buildArrayFieldCountsFromAppIds(appIds, "subtitleLanguages");
  technologyCounts = buildArrayFieldCountsFromAppIds(appIds, "technologies");
  developerCounts = buildArrayFieldCountsFromAppIds(appIds, "developers");
  publisherCounts = buildArrayFieldCountsFromAppIds(appIds, "publishers");
  releaseYearCounts = buildReleaseYearCountsFromAppIds(appIds);

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

function renderCheckboxOptions(containerId, counts, selectedSet) {
  const optionsEl = document.getElementById(containerId);
  if (!optionsEl) {
    return;
  }
  optionsEl.innerHTML = "";

  for (const item of counts) {
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
    count.textContent = formatCompactCount(item.count);

    row.appendChild(checkbox);
    row.appendChild(name);
    row.appendChild(count);
    optionsEl.appendChild(row);
  }
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
    count.textContent = formatCompactCount(tag.count);

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
  renderCheckboxOptions("languages-options", languageCounts, selectedLanguages);
  renderCheckboxOptions("full-audio-languages-options", fullAudioLanguageCounts, selectedFullAudioLanguages);
  renderCheckboxOptions("subtitle-languages-options", subtitleLanguageCounts, selectedSubtitleLanguages);
  renderCheckboxOptions("technologies-options", technologyCounts, selectedTechnologies);
  renderCheckboxOptions("developers-options", developerCounts, selectedDevelopers);
  renderCheckboxOptions("publishers-options", publisherCounts, selectedPublishers);
  renderCheckboxOptions("release-year-options", releaseYearCounts, selectedReleaseYears);
}

function passesTagFilter(appId) {
  if (selectedTags.size === 0) {
    return true;
  }

  const tags = getMetaTags(appId);
  if (tags.length === 0) {
    return false;
  }

  return tags.some((t) => selectedTags.has(t));
}

function passesTypeFilter(appId) {
  if (selectedTypes.size === 0) {
    return true;
  }
  return selectedTypes.has(getMetaType(appId));
}

function passesArrayFilter(appId, key, selectedSet) {
  if (selectedSet.size === 0) {
    return true;
  }
  const values = getMetaArray(appId, key);
  return values.some((value) => selectedSet.has(value));
}

function passesReviewFilter(appId) {
  const hasPctFilter = ratingMin > 0 || ratingMax < 100;
  const hasCountFilter = reviewsMin > 0 || reviewsMax < 999999999;
  if (!hasPctFilter && !hasCountFilter) {
    return true;
  }

  const meta = metaCache?.[appId] || {};
  const pct = Number(meta.reviewPositivePct);
  const votes = parseNonNegativeInt(meta.reviewTotalVotes, 0);

  if (!Number.isFinite(pct)) {
    // Keep items visible when review metrics are still unavailable.
    return true;
  }

  return pct >= ratingMin && pct <= ratingMax && votes >= reviewsMin && votes <= reviewsMax;
}

function passesDiscountFilter(appId) {
  const hasDiscountFilter = discountMin > 0 || discountMax < 100;
  if (!hasDiscountFilter) {
    return true;
  }
  const pct = getMetaNumber(appId, "discountPercent", 0);
  return pct >= discountMin && pct <= discountMax;
}

function getPriceForFilter(appId) {
  const meta = metaCache?.[appId] || {};
  const isFree = String(meta.priceText || "").trim().toLowerCase() === "free";
  if (isFree) {
    return 0;
  }
  const finalPrice = Number(meta.priceFinal);
  if (Number.isFinite(finalPrice) && finalPrice > 0) {
    return finalPrice / 100;
  }
  return null;
}

function passesPriceFilter(appId) {
  const hasPriceFilter = priceMin > 0 || priceMax < 9999999;
  if (!hasPriceFilter) {
    return true;
  }
  const price = getPriceForFilter(appId);
  if (price === null) {
    return false;
  }
  return price >= priceMin && price <= priceMax;
}

function passesReleaseYearFilter(appId) {
  if (selectedReleaseYears.size === 0) {
    return true;
  }
  const unix = getMetaNumber(appId, "releaseUnix", 0);
  if (!unix) {
    return false;
  }
  const year = String(new Date(unix * 1000).getUTCFullYear());
  return selectedReleaseYears.has(year);
}

function getFilteredAndSorted(ids) {
  const normalizedQuery = searchQuery.toLowerCase();
  const baseIds = (sourceMode === "wishlist" && wishlistSortOrders?.[sortMode]?.length)
    ? wishlistSortOrders[sortMode]
    : ids;

  const list = baseIds.filter((appId) => {
    const title = String(state?.items?.[appId]?.title || metaCache?.[appId]?.titleText || "").toLowerCase();
    const textOk = !normalizedQuery || title.includes(normalizedQuery) || appId.includes(normalizedQuery);
    return textOk
      && passesTagFilter(appId)
      && passesTypeFilter(appId)
      && passesReviewFilter(appId)
      && passesDiscountFilter(appId)
      && passesPriceFilter(appId)
      && passesReleaseYearFilter(appId)
      && passesArrayFilter(appId, "players", selectedPlayers)
      && passesArrayFilter(appId, "features", selectedFeatures)
      && passesArrayFilter(appId, "hardware", selectedHardware)
      && passesArrayFilter(appId, "accessibility", selectedAccessibility)
      && passesArrayFilter(appId, "platforms", selectedPlatforms)
      && passesArrayFilter(appId, "languages", selectedLanguages)
      && passesArrayFilter(appId, "fullAudioLanguages", selectedFullAudioLanguages)
      && passesArrayFilter(appId, "subtitleLanguages", selectedSubtitleLanguages)
      && passesArrayFilter(appId, "technologies", selectedTechnologies)
      && passesArrayFilter(appId, "developers", selectedDevelopers)
      && passesArrayFilter(appId, "publishers", selectedPublishers);
  });

  if (sourceMode === "wishlist" && wishlistSortOrders?.[sortMode]?.length) {
    return list;
  }

  if (sortMode === "title") {
    list.sort((a, b) => {
      const ta = String(state?.items?.[a]?.title || metaCache?.[a]?.titleText || a);
      const tb = String(state?.items?.[b]?.title || metaCache?.[b]?.titleText || b);
      return ta.localeCompare(tb, "pt-BR", { sensitivity: "base" });
    });
    return list;
  }

  if (sortMode === "price") {
    list.sort((a, b) => getEffectiveSortPrice(a) - getEffectiveSortPrice(b));
    return list;
  }

  if (sortMode === "discount") {
    list.sort((a, b) => getMetaNumber(b, "discountPercent", 0) - getMetaNumber(a, "discountPercent", 0));
    return list;
  }

  if (sortMode === "date-added") {
    list.sort((a, b) => Number(wishlistAddedMap[b] || 0) - Number(wishlistAddedMap[a] || 0));
    return list;
  }

  if (sortMode === "top-selling") {
    list.sort((a, b) => getMetaNumber(b, "recommendationsTotal", 0) - getMetaNumber(a, "recommendationsTotal", 0));
    return list;
  }

  if (sortMode === "release-date") {
    list.sort((a, b) => getMetaNumber(b, "releaseUnix", 0) - getMetaNumber(a, "releaseUnix", 0));
    return list;
  }

  if (sortMode === "review-score") {
    list.sort((a, b) => {
      const pctDiff = getMetaNumber(b, "reviewPositivePct", -1) - getMetaNumber(a, "reviewPositivePct", -1);
      if (pctDiff !== 0) {
        return pctDiff;
      }
      return getMetaNumber(b, "reviewTotalVotes", 0) - getMetaNumber(a, "reviewTotalVotes", 0);
    });
    return list;
  }

  if (sortMode === "position" && sourceMode === "wishlist") {
    return sortByWishlistPriority(list);
  }

  return list;
}

function renderCollectionSelect() {
  const select = document.getElementById("collection-select");
  const selectBtn = document.getElementById("collection-select-btn");
  const selectMenu = document.getElementById("collection-select-options");
  const deleteSelect = document.getElementById("delete-collection-select");
  if (!select || !selectBtn || !selectMenu || !state) {
    return;
  }

  select.innerHTML = "";

  const wishlistOption = document.createElement("option");
  wishlistOption.value = WISHLIST_SELECT_VALUE;
  wishlistOption.textContent = `Steam wishlist (${Object.keys(wishlistAddedMap || {}).length})`;
  select.appendChild(wishlistOption);

  const allOption = document.createElement("option");
  allOption.value = "__all__";
  allOption.textContent = "All collections";
  select.appendChild(allOption);

  for (const name of state.collectionOrder || []) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = `${name} (${(state.collections?.[name] || []).length})`;
    select.appendChild(option);
  }

  const validValues = Array.from(select.options).map((o) => o.value);
  if (!validValues.includes(activeCollection)) {
    activeCollection = validValues.includes(state.activeCollection) ? state.activeCollection : "__all__";
  }

  select.value = sourceMode === "wishlist" ? WISHLIST_SELECT_VALUE : activeCollection;
  const selectedOption = select.options[select.selectedIndex];
  selectBtn.textContent = `Collection: ${selectedOption?.textContent || "Select"}`;

  selectMenu.innerHTML = "";
  for (const option of Array.from(select.options)) {
    const itemBtn = document.createElement("button");
    itemBtn.type = "button";
    itemBtn.className = "dropdown-option";
    if (option.value === select.value) {
      itemBtn.classList.add("active");
    }
    itemBtn.textContent = option.textContent || option.value;
    itemBtn.dataset.value = option.value;
    selectMenu.appendChild(itemBtn);
  }

  if (deleteSelect) {
    deleteSelect.innerHTML = "";
    for (const name of state.collectionOrder || []) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = `${name} (${(state.collections?.[name] || []).length})`;
      deleteSelect.appendChild(option);
    }
  }
}

function renderPager(totalItems) {
  const pageInfo = document.getElementById("page-info");
  const prevBtn = document.getElementById("prev-page-btn");
  const nextBtn = document.getElementById("next-page-btn");
  if (!pageInfo || !prevBtn || !nextBtn) {
    return;
  }

  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  if (page > totalPages) {
    page = totalPages;
  }

  pageInfo.textContent = `Page ${page} / ${totalPages}`;
  prevBtn.disabled = page <= 1;
  nextBtn.disabled = page >= totalPages;
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
    try {
      await ensureWishlistPrecomputedSorts(sourceIds);
    } catch {
      setStatus("Could not precompute wishlist sorts, using fallback.", true);
    }
  }

  if (!shouldSkipHeavyMetaHydration && (needsMetaForSort || needsMetaForSearch)) {
    setStatus("Loading metadata for sorting/search...");
    try {
      await ensureMetaForAppIds(sourceIds, sourceIds.length);
    } catch {
      setStatus("Metadata loading partially failed.", true);
    }
  }

  const appIds = getFilteredAndSorted(sourceIds);
  renderPager(appIds.length);

  const start = (page - 1) * PAGE_SIZE;
  const pageIds = appIds.slice(start, start + PAGE_SIZE);
  currentRenderedPageIds = [...pageIds];

  // Always hydrate visible items to avoid fallback "App {id}" titles.
  try {
    await ensureMetaForAppIds(pageIds, pageIds.length);
  } catch {
    setStatus("Some visible items could not be refreshed.", true);
  }
  if (!shouldSkipHeavyMetaHydration && (needsMetaForSort || needsMetaForSearch)) {
    setStatus("");
  }

  cardsEl.innerHTML = "";
  emptyEl.classList.toggle("hidden", pageIds.length > 0);

  for (const appId of pageIds) {
    const fragment = template.content.cloneNode(true);

    const title = state?.items?.[appId]?.title || metaCache?.[appId]?.titleText || `App ${appId}`;
    const link = getAppLink(appId);

    const coverLink = fragment.querySelector(".cover-link");
    const cover = fragment.querySelector(".cover");
    const titleEl = fragment.querySelector(".title");
    const appidEl = fragment.querySelector(".appid");
    const pricingEl = fragment.querySelector(".pricing");
    const discountEl = fragment.querySelector(".discount");
    const tagsRowEl = fragment.querySelector(".tags-row");
    const reviewEl = fragment.querySelector(".review");
    const releaseEl = fragment.querySelector(".release");
    const wishlistAddedEl = fragment.querySelector(".wishlist-added");
    const refreshItemBtn = fragment.querySelector(".refresh-item-btn");
    const removeBtn = fragment.querySelector(".remove-btn");

    if (coverLink) {
      coverLink.href = link;
    }
    if (cover) {
      cover.src = getCardImageUrl(appId);
      cover.alt = title;
      cover.loading = "lazy";
    }
    if (titleEl) {
      titleEl.textContent = title;
      titleEl.href = link;
    }
    if (appidEl) {
      appidEl.textContent = `AppID: ${appId}`;
    }
    if (wishlistAddedEl) {
      wishlistAddedEl.textContent = `Wishlist: ${formatUnixDate(wishlistAddedMap[appId])}`;
    }

    if (refreshItemBtn) {
      refreshItemBtn.addEventListener("click", () => {
        refreshSingleItem(appId).catch(() => setStatus("Failed to refresh item.", true));
      });
    }

    if (removeBtn) {
      removeBtn.style.display = sourceMode === "wishlist" ? "none" : "";
      removeBtn.addEventListener("click", async () => {
        if (sourceMode === "wishlist") {
          return;
        }

        const collectionName = activeCollection;
        if (!collectionName || collectionName === "__all__") {
          setStatus("Select a specific collection to remove items.", true);
          return;
        }

        const confirmed = window.confirm(`Remove AppID ${appId} from collection "${collectionName}"?`);
        if (!confirmed) {
          return;
        }

        await browser.runtime.sendMessage({
          type: "remove-item-from-collection",
          appId,
          collectionName
        });

        await refreshState();
        await ensureTagCounts();
        await ensureTypeCounts();
        await ensureExtraFilterCounts();
        renderTagOptions();
        renderTypeOptions();
        renderExtraFilterOptions();
        await render();
      });
    }

    cardsEl.appendChild(fragment);

    fetchAppMeta(appId).then((meta) => {
      if (titleEl && !state?.items?.[appId]?.title && meta.titleText) {
        titleEl.textContent = meta.titleText;
      }
      if (pricingEl) {
        pricingEl.textContent = `Price: ${meta.priceText || "-"}`;
      }
      if (discountEl) {
        discountEl.textContent = `Discount: ${meta.discountText || "-"}`;
      }
      if (reviewEl) {
        reviewEl.textContent = `Reviews: ${meta.reviewText || "-"}`;
      }
      if (releaseEl) {
        releaseEl.textContent = `Release: ${meta.releaseText || "-"}`;
      }
      if (tagsRowEl) {
        tagsRowEl.innerHTML = "";
        for (const tag of meta.tags || []) {
          const chip = document.createElement("span");
          chip.className = "tag-chip";
          chip.textContent = tag;
          tagsRowEl.appendChild(chip);
        }
      }
    });
  }
}

async function refreshState() {
  state = await browser.runtime.sendMessage({ type: "get-state" });
}

async function createCollectionByName(rawName) {
  const name = normalizeCollectionName(rawName || "");
  if (!name) {
    setStatus("Type a collection name.", true);
    return;
  }

  await browser.runtime.sendMessage({
    type: "create-collection",
    collectionName: name
  });

  await refreshState();
  activeCollection = name;
  sourceMode = "collections";
  page = 1;
  await ensureTagCounts();
  await ensureTypeCounts();
  await ensureExtraFilterCounts();
  renderTagOptions();
  renderTypeOptions();
  renderExtraFilterOptions();
  setStatus(`Collection \"${name}\" created.`);
  await render();
}

async function renameActiveCollectionByName(rawName) {
  if (sourceMode === "wishlist" || !activeCollection || activeCollection === "__all__") {
    setStatus("Select a specific collection to rename.", true);
    return;
  }

  const newName = normalizeCollectionName(rawName || "");
  if (!newName) {
    setStatus("Type a new collection name.", true);
    return;
  }

  await browser.runtime.sendMessage({
    type: "rename-collection",
    fromName: activeCollection,
    toName: newName
  });

  await refreshState();
  activeCollection = newName;
  page = 1;
  await ensureTagCounts();
  await ensureTypeCounts();
  await ensureExtraFilterCounts();
  renderTagOptions();
  renderTypeOptions();
  renderExtraFilterOptions();
  setStatus(`Collection renamed to \"${newName}\".`);
  await render();
}

async function deleteCollectionByName(rawName) {
  const collectionName = normalizeCollectionName(rawName || "");
  if (!collectionName) {
    setStatus("Select a collection to delete.", true);
    return;
  }

  const confirmed = window.confirm(`Delete collection "${collectionName}"?`);
  if (!confirmed) {
    return;
  }

  await browser.runtime.sendMessage({
    type: "delete-collection",
    collectionName
  });

  await refreshState();
  if (activeCollection === collectionName) {
    activeCollection = "__all__";
    sourceMode = "collections";
  }
  page = 1;
  await ensureTagCounts();
  await ensureTypeCounts();
  await ensureExtraFilterCounts();
  renderTagOptions();
  renderTypeOptions();
  renderExtraFilterOptions();
  setStatus(`Collection \"${collectionName}\" deleted.`);
  await render();
}

async function render() {
  const sortSelect = document.getElementById("sort-select");
  const renameActionBtn = document.getElementById("menu-action-rename");
  const deleteActionBtn = document.getElementById("menu-action-delete");
  const deleteSelect = document.getElementById("delete-collection-select");
  if (sortSelect) {
    sortSelect.value = sortMode;
  }

  renderSortMenu();
  renderCollectionSelect();
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
  const minLabel = document.getElementById("rating-min-label");
  const maxLabel = document.getElementById("rating-max-label");
  const minRange = document.getElementById("rating-min-range");
  const maxRange = document.getElementById("rating-max-range");
  const minInput = document.getElementById("reviews-min-input");
  const maxInput = document.getElementById("reviews-max-input");
  const discountMinLabel = document.getElementById("discount-min-label");
  const discountMaxLabel = document.getElementById("discount-max-label");
  const discountMinRange = document.getElementById("discount-min-range");
  const discountMaxRange = document.getElementById("discount-max-range");
  const priceMinInput = document.getElementById("price-min-input");
  const priceMaxInput = document.getElementById("price-max-input");
  if (minLabel) {
    minLabel.textContent = `${ratingMin}%`;
  }
  if (maxLabel) {
    maxLabel.textContent = `${ratingMax}%`;
  }
  if (minRange) {
    minRange.value = String(ratingMin);
  }
  if (maxRange) {
    maxRange.value = String(ratingMax);
  }
  if (minInput) {
    minInput.value = String(reviewsMin);
  }
  if (maxInput) {
    maxInput.value = String(reviewsMax);
  }
  if (discountMinLabel) {
    discountMinLabel.textContent = `${discountMin}%`;
  }
  if (discountMaxLabel) {
    discountMaxLabel.textContent = `${discountMax}%`;
  }
  if (discountMinRange) {
    discountMinRange.value = String(discountMin);
  }
  if (discountMaxRange) {
    discountMaxRange.value = String(discountMax);
  }
  if (priceMinInput) {
    priceMinInput.value = String(priceMin);
  }
  if (priceMaxInput) {
    priceMaxInput.value = String(priceMax);
  }
}

function renderSortMenu() {
  const select = document.getElementById("sort-select");
  const btn = document.getElementById("sort-menu-btn");
  const menu = document.getElementById("sort-menu-options");
  if (!select || !btn || !menu) {
    return;
  }

  const selectedOption = select.options[select.selectedIndex];
  btn.textContent = `Sort by: ${selectedOption?.textContent || "Your order"}`;

  menu.innerHTML = "";
  for (const option of Array.from(select.options)) {
    const itemBtn = document.createElement("button");
    itemBtn.type = "button";
    itemBtn.className = "dropdown-option";
    if (option.value === select.value) {
      itemBtn.classList.add("active");
    }
    itemBtn.textContent = option.textContent || option.value;
    itemBtn.dataset.value = option.value;
    menu.appendChild(itemBtn);
  }
}

function toggleSortMenu(forceOpen = null) {
  const panel = document.getElementById("sort-menu-panel");
  if (!panel) {
    return;
  }
  const open = forceOpen === null ? panel.classList.contains("hidden") : Boolean(forceOpen);
  panel.classList.toggle("hidden", !open);
}

function toggleCollectionSelectMenu(forceOpen = null) {
  const panel = document.getElementById("collection-select-panel");
  if (!panel) {
    return;
  }
  const open = forceOpen === null ? panel.classList.contains("hidden") : Boolean(forceOpen);
  panel.classList.toggle("hidden", !open);
}

function hideCollectionMenuForms() {
  document.getElementById("rename-collection-form")?.classList.add("hidden");
  document.getElementById("create-collection-form")?.classList.add("hidden");
  document.getElementById("delete-collection-form")?.classList.add("hidden");
}

function toggleCollectionMenu(forceOpen = null) {
  const panel = document.getElementById("collection-menu-panel");
  if (!panel) {
    return;
  }
  const open = forceOpen === null ? panel.classList.contains("hidden") : Boolean(forceOpen);
  panel.classList.toggle("hidden", !open);
  if (!open) {
    hideCollectionMenuForms();
  }
}

function attachEvents() {
  document.getElementById("collection-select")?.addEventListener("change", async (event) => {
    const value = event.target.value || "__all__";
    sourceMode = value === WISHLIST_SELECT_VALUE ? "wishlist" : "collections";
    activeCollection = sourceMode === "wishlist" ? "__all__" : value;
    page = 1;

    if (sourceMode !== "wishlist") {
      await browser.runtime.sendMessage({
        type: "set-active-collection",
        activeCollection
      });
    }

    selectedTags.clear();
    selectedTypes.clear();
    selectedPlayers.clear();
    selectedFeatures.clear();
    selectedHardware.clear();
    selectedAccessibility.clear();
    selectedPlatforms.clear();
    selectedLanguages.clear();
    selectedFullAudioLanguages.clear();
    selectedSubtitleLanguages.clear();
    selectedTechnologies.clear();
    selectedDevelopers.clear();
    selectedPublishers.clear();
    selectedReleaseYears.clear();
    tagSearchQuery = "";
    tagShowLimit = TAG_SHOW_STEP;
    await ensureTagCounts();
    await ensureTypeCounts();
    await ensureExtraFilterCounts();
    renderTagOptions();
    renderTypeOptions();
    renderExtraFilterOptions();
    await render();
  });

  document.getElementById("collection-select-btn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleCollectionMenu(false);
    toggleSortMenu(false);
    toggleCollectionSelectMenu();
  });

  document.getElementById("collection-select-options")?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const btn = target.closest("button[data-value]");
    if (!(btn instanceof HTMLButtonElement)) {
      return;
    }
    const value = String(btn.dataset.value || "");
    const select = document.getElementById("collection-select");
    if (!select || !value) {
      return;
    }
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    toggleCollectionSelectMenu(false);
  });

  document.getElementById("search-input")?.addEventListener("input", async (event) => {
    searchQuery = String(event.target.value || "");
    page = 1;
    await render();
  });

  document.getElementById("sort-select")?.addEventListener("change", async (event) => {
    const allowed = new Set([
      "position",
      "title",
      "price",
      "discount",
      "date-added",
      "top-selling",
      "release-date",
      "review-score"
    ]);
    sortMode = allowed.has(event.target.value) ? event.target.value : "position";
    page = 1;
    renderSortMenu();
    await render();
  });

  document.getElementById("sort-menu-btn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleCollectionMenu(false);
    toggleCollectionSelectMenu(false);
    toggleSortMenu();
  });

  document.getElementById("sort-menu-options")?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const btn = target.closest("button[data-value]");
    if (!(btn instanceof HTMLButtonElement)) {
      return;
    }
    const value = String(btn.dataset.value || "");
    const select = document.getElementById("sort-select");
    if (!select || !value) {
      return;
    }
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    toggleSortMenu(false);
  });

  document.getElementById("collection-menu-btn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleCollectionSelectMenu(false);
    toggleSortMenu(false);
    toggleCollectionMenu();
  });

  document.getElementById("menu-action-rename")?.addEventListener("click", () => {
    hideCollectionMenuForms();
    document.getElementById("rename-collection-form")?.classList.remove("hidden");
  });

  document.getElementById("menu-action-create")?.addEventListener("click", () => {
    hideCollectionMenuForms();
    document.getElementById("create-collection-form")?.classList.remove("hidden");
  });

  document.getElementById("menu-action-delete")?.addEventListener("click", () => {
    hideCollectionMenuForms();
    document.getElementById("delete-collection-form")?.classList.remove("hidden");
  });

  document.getElementById("rename-collection-ok")?.addEventListener("click", () => {
    const input = document.getElementById("rename-collection-input");
    const value = String(input?.value || "");
    renameActiveCollectionByName(value).catch(() => setStatus("Failed to rename collection.", true));
    if (input) {
      input.value = "";
    }
  });

  document.getElementById("create-collection-ok")?.addEventListener("click", () => {
    const input = document.getElementById("create-collection-input");
    const value = String(input?.value || "");
    createCollectionByName(value).catch(() => setStatus("Failed to create collection.", true));
    if (input) {
      input.value = "";
    }
  });

  document.getElementById("delete-collection-ok")?.addEventListener("click", () => {
    const select = document.getElementById("delete-collection-select");
    const value = String(select?.value || "");
    deleteCollectionByName(value).catch(() => setStatus("Failed to delete collection.", true));
  });

  document.getElementById("prev-page-btn")?.addEventListener("click", async () => {
    page = Math.max(1, page - 1);
    await renderCards();
  });

  document.getElementById("next-page-btn")?.addEventListener("click", async () => {
    page += 1;
    await renderCards();
  });

  document.getElementById("tag-search-input")?.addEventListener("input", (event) => {
    tagSearchQuery = String(event.target.value || "").trim();
    tagShowLimit = TAG_SHOW_STEP;
    renderTagOptions();
  });

  document.getElementById("tag-show-more-btn")?.addEventListener("click", () => {
    tagShowLimit += TAG_SHOW_STEP;
    renderTagOptions();
  });

  document.getElementById("refresh-page-btn")?.addEventListener("click", () => {
    refreshCurrentPageItems().catch(() => setStatus("Failed to refresh visible items.", true));
  });

  document.getElementById("rating-min-range")?.addEventListener("input", async (event) => {
    const next = parseNonNegativeInt(event.target.value, ratingMin);
    ratingMin = Math.max(0, Math.min(next, ratingMax));
    renderRatingControls();
    page = 1;
    await renderCards();
  });

  document.getElementById("rating-max-range")?.addEventListener("input", async (event) => {
    const next = parseNonNegativeInt(event.target.value, ratingMax);
    ratingMax = Math.min(100, Math.max(next, ratingMin));
    renderRatingControls();
    page = 1;
    await renderCards();
  });

  document.getElementById("apply-reviews-btn")?.addEventListener("click", async () => {
    const minValue = parseNonNegativeInt(document.getElementById("reviews-min-input")?.value, 0);
    const maxValue = parseNonNegativeInt(document.getElementById("reviews-max-input")?.value, 999999999);
    reviewsMin = Math.min(minValue, maxValue);
    reviewsMax = Math.max(minValue, maxValue);
    renderRatingControls();
    page = 1;
    await renderCards();
  });

  document.getElementById("discount-min-range")?.addEventListener("input", async (event) => {
    const next = parseNonNegativeInt(event.target.value, discountMin);
    discountMin = Math.max(0, Math.min(next, discountMax));
    renderRatingControls();
    page = 1;
    await renderCards();
  });

  document.getElementById("discount-max-range")?.addEventListener("input", async (event) => {
    const next = parseNonNegativeInt(event.target.value, discountMax);
    discountMax = Math.min(100, Math.max(next, discountMin));
    renderRatingControls();
    page = 1;
    await renderCards();
  });

  document.getElementById("apply-price-btn")?.addEventListener("click", async () => {
    const minValue = Number(document.getElementById("price-min-input")?.value || 0);
    const maxValue = Number(document.getElementById("price-max-input")?.value || 9999999);
    const normMin = Number.isFinite(minValue) && minValue >= 0 ? minValue : 0;
    const normMax = Number.isFinite(maxValue) && maxValue >= 0 ? maxValue : 9999999;
    priceMin = Math.min(normMin, normMax);
    priceMax = Math.max(normMin, normMax);
    renderRatingControls();
    page = 1;
    await renderCards();
  });

  document.addEventListener("click", (event) => {
    const panel = document.getElementById("collection-menu-panel");
    const btn = document.getElementById("collection-menu-btn");
    const target = event.target;
    if (panel && btn && !panel.classList.contains("hidden")) {
      if (!(panel.contains(target) || btn.contains(target))) {
        toggleCollectionMenu(false);
      }
    }

    const sortPanel = document.getElementById("sort-menu-panel");
    const sortBtn = document.getElementById("sort-menu-btn");
    if (sortPanel && sortBtn && !sortPanel.classList.contains("hidden")) {
      if (!(sortPanel.contains(target) || sortBtn.contains(target))) {
        toggleSortMenu(false);
      }
    }

    const collectionSelectPanel = document.getElementById("collection-select-panel");
    const collectionSelectBtn = document.getElementById("collection-select-btn");
    if (collectionSelectPanel && collectionSelectBtn && !collectionSelectPanel.classList.contains("hidden")) {
      if (!(collectionSelectPanel.contains(target) || collectionSelectBtn.contains(target))) {
        toggleCollectionSelectMenu(false);
      }
    }
  });
}

async function bootstrap() {
  await loadMetaCache();
  await loadWishlistAddedMap();
  await refreshState();

  activeCollection = state.activeCollection || "__all__";

  attachEvents();
  renderRatingControls();
  await render();

  // Load heavy filter counts after first paint to avoid blank screen on large wishlists.
  Promise.allSettled([ensureTagCounts(), ensureTypeCounts(), ensureExtraFilterCounts()]).then(() => {
    renderTagOptions();
    renderTypeOptions();
    renderExtraFilterOptions();
  });

  const refreshAll = new URLSearchParams(window.location.search).get("refreshAll") === "1";
  if (refreshAll) {
    await refreshWholeDatabase();
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, "", cleanUrl);
  }
}

bootstrap().catch(() => setStatus("Failed to load collections page.", true));
