const PAGE_SIZE = 30;
const META_CACHE_KEY = "steamWishlistCollectionsMetaCacheV4";
const META_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const WISHLIST_ADDED_CACHE_KEY = "steamWishlistAddedMapV3";
const WISHLIST_FULL_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const WISHLIST_RANK_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TAG_COUNTS_CACHE_KEY = "steamWishlistTagCountsCacheV1";
const TYPE_COUNTS_CACHE_KEY = "steamWishlistTypeCountsCacheV1";
const EXTRA_FILTER_COUNTS_CACHE_KEY = "steamWishlistExtraFilterCountsCacheV1";
const TAG_SHOW_STEP = 12;
const SAFE_FETCH_CONCURRENCY = 4;
const SAFE_FETCH_CONCURRENCY_FORCE = 1;
const SAFE_FETCH_BASE_DELAY_MS = 350;
const SAFE_FETCH_JITTER_MS = 220;
const SAFE_FETCH_MAX_RETRIES = 3;
const SAFE_FETCH_FORCE_BASE_DELAY_MS = 700;
const SAFE_FETCH_FORCE_JITTER_MS = 500;
const SAFE_FETCH_BLOCK_COOLDOWN_MS = 12_000;
const WISHLIST_SELECT_VALUE = "__wishlist__";

let state = null;
let activeCollection = "__all__";
let sourceMode = "collections";
let page = 1;
let searchQuery = "";
let sortMode = "title";

let metaCache = {};
let wishlistAddedMap = {};
let wishlistOrderedAppIds = [];
let wishlistPriorityMap = {};
let wishlistPriorityCachedAt = 0;
let wishlistPriorityLastError = "";
let wishlistOrderSyncResult = "";
let wishlistSteamId = "";
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
let filterSyncRunId = 0;

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

let steamCooldownUntil = 0;

async function waitSteamCooldownIfNeeded() {
  const now = Date.now();
  if (steamCooldownUntil > now) {
    await sleep(steamCooldownUntil - now);
  }
}

function bumpSteamCooldown(ms = SAFE_FETCH_BLOCK_COOLDOWN_MS) {
  const now = Date.now();
  steamCooldownUntil = Math.max(steamCooldownUntil, now + ms);
}

async function fetchSteamJson(url, options = {}) {
  let attempt = 0;
  while (true) {
    try {
      await waitSteamCooldownIfNeeded();
      const response = await fetch(url, { cache: "no-store", ...options });
      if (response.ok) {
        return await response.json();
      }
      if (response.status === 403 || response.status === 429) {
        bumpSteamCooldown(SAFE_FETCH_BLOCK_COOLDOWN_MS + (attempt * 3000));
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
      await waitSteamCooldownIfNeeded();
      const response = await fetch(url, { cache: "no-store", ...options });
      if (response.ok) {
        return await response.text();
      }
      if (response.status === 403 || response.status === 429) {
        bumpSteamCooldown(SAFE_FETCH_BLOCK_COOLDOWN_MS + (attempt * 3000));
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

async function fetchSteamBytes(url, options = {}) {
  let attempt = 0;
  while (true) {
    try {
      await waitSteamCooldownIfNeeded();
      const response = await fetch(url, { cache: "no-store", ...options });
      if (response.ok) {
        return new Uint8Array(await response.arrayBuffer());
      }
      if (response.status === 403 || response.status === 429) {
        bumpSteamCooldown(SAFE_FETCH_BLOCK_COOLDOWN_MS + (attempt * 3000));
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

function encodeVarint(value) {
  let n = 0n;
  if (typeof value === "bigint") {
    n = value;
  } else if (typeof value === "string") {
    n = BigInt(value || "0");
  } else {
    n = BigInt(Number(value || 0));
  }
  if (n < 0n) {
    n = 0n;
  }
  const out = [];
  while (n >= 0x80n) {
    out.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  out.push(Number(n));
  return out;
}

function decodeVarint(bytes, startIndex) {
  let value = 0n;
  let shift = 0n;
  let index = startIndex;
  while (index < bytes.length) {
    const b = bytes[index];
    index += 1;
    value |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      return { value, next: index };
    }
    shift += 7n;
  }
  return null;
}

function encodeUtf8(text) {
  return new TextEncoder().encode(String(text || ""));
}

function concatBytes(chunks) {
  const size = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function fieldVarint(field, value) {
  return Uint8Array.from([
    ...encodeVarint((BigInt(field) << 3n) | 0n),
    ...encodeVarint(value)
  ]);
}

function fieldBytes(field, bytes) {
  return concatBytes([
    Uint8Array.from(encodeVarint((BigInt(field) << 3n) | 2n)),
    Uint8Array.from(encodeVarint(bytes.length)),
    bytes
  ]);
}

function toBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function decodeWishlistSortedFilteredItem(bytes) {
  const item = {
    appid: 0,
    priority: null,
    dateAdded: 0
  };
  let index = 0;
  while (index < bytes.length) {
    const tag = decodeVarint(bytes, index);
    if (!tag) {
      break;
    }
    index = tag.next;
    const field = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x7n);

    if (wireType === 0) {
      const value = decodeVarint(bytes, index);
      if (!value) {
        break;
      }
      index = value.next;
      const n = Number(value.value);
      if (field === 1) {
        item.appid = n;
      } else if (field === 2) {
        item.priority = n;
      } else if (field === 3) {
        item.dateAdded = n;
      }
      continue;
    }

    if (wireType === 2) {
      const len = decodeVarint(bytes, index);
      if (!len) {
        break;
      }
      index = len.next + Number(len.value);
      continue;
    }

    if (wireType === 5) {
      index += 4;
      continue;
    }
    if (wireType === 1) {
      index += 8;
      continue;
    }
    break;
  }
  return item;
}

function decodeWishlistSortedFilteredResponse(bytes) {
  const items = [];
  let index = 0;
  while (index < bytes.length) {
    const tag = decodeVarint(bytes, index);
    if (!tag) {
      break;
    }
    index = tag.next;
    const field = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x7n);

    if (field === 1 && wireType === 2) {
      const len = decodeVarint(bytes, index);
      if (!len) {
        break;
      }
      index = len.next;
      const itemBytes = bytes.subarray(index, index + Number(len.value));
      index += Number(len.value);
      const item = decodeWishlistSortedFilteredItem(itemBytes);
      if (Number.isFinite(item.appid) && item.appid > 0) {
        items.push(item);
      }
      continue;
    }

    if (wireType === 0) {
      const value = decodeVarint(bytes, index);
      if (!value) {
        break;
      }
      index = value.next;
      continue;
    }

    if (wireType === 2) {
      const len = decodeVarint(bytes, index);
      if (!len) {
        break;
      }
      index = len.next + Number(len.value);
      continue;
    }

    if (wireType === 5) {
      index += 4;
      continue;
    }
    if (wireType === 1) {
      index += 8;
      continue;
    }
    break;
  }
  return items;
}

function encodeWishlistSortedFilteredRequest({ steamId, startIndex = 0, pageSize = 500 }) {
  const context = concatBytes([
    fieldBytes(1, encodeUtf8("english")),
    fieldBytes(3, encodeUtf8("BR"))
  ]);
  const dataRequest = concatBytes([
    fieldVarint(1, 1),
    fieldVarint(2, 1),
    fieldVarint(3, 1),
    fieldVarint(6, 1),
    fieldVarint(8, 20),
    fieldVarint(9, 1)
  ]);
  const filters = concatBytes([
    fieldVarint(25, 4),
    fieldVarint(25, 3)
  ]);

  return concatBytes([
    fieldVarint(1, steamId),
    fieldBytes(2, context),
    fieldBytes(3, dataRequest),
    fieldBytes(5, filters),
    fieldVarint(6, startIndex),
    fieldVarint(7, pageSize)
  ]);
}

async function fetchWishlistOrderFromService(steamId, targetCount = 0) {
  const pageSize = 500;
  const maxPages = Math.max(1, Math.ceil(Math.max(1, targetCount) / pageSize) + 2);
  const orderedIds = [];
  const seen = new Set();
  const priorityMap = {};
  const wishlistNowIds = Array.isArray(userdata?.rgWishlist)
    ? userdata.rgWishlist.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const wishlistNowSet = new Set(wishlistNowIds);
  let accessToken = "";
  try {
    const userdata = await fetchSteamJson("https://store.steampowered.com/dynamicstore/userdata/", {
      credentials: "include",
      cache: "no-store"
    });
    accessToken = String(
      userdata?.webapi_token
      || userdata?.webapiToken
      || userdata?.webapi_access_token
      || ""
    ).trim();
  } catch {
    accessToken = "";
  }

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const startIndex = pageIndex * pageSize;
    const requestBytes = encodeWishlistSortedFilteredRequest({
      steamId,
      startIndex,
      pageSize
    });
    const url = new URL("https://api.steampowered.com/IWishlistService/GetWishlistSortedFiltered/v1");
    url.searchParams.set("origin", "https://store.steampowered.com");
    url.searchParams.set("input_protobuf_encoded", toBase64(requestBytes));
    if (accessToken) {
      url.searchParams.set("access_token", accessToken);
    }

    const responseBytes = await fetchSteamBytes(url.toString(), {
      credentials: "omit"
    });
    const items = decodeWishlistSortedFilteredResponse(responseBytes);
    if (items.length === 0) {
      break;
    }

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const rawIdNum = Number(item.appid || 0);
      let appId = String(rawIdNum || "").trim();
      if (rawIdNum > 0 && !wishlistNowSet.has(appId) && rawIdNum % 10 === 0) {
        const div10 = String(Math.floor(rawIdNum / 10));
        if (wishlistNowSet.has(div10)) {
          appId = div10;
        }
      }
      if (!appId || seen.has(appId)) {
        continue;
      }
      seen.add(appId);
      orderedIds.push(appId);
      priorityMap[appId] = Number.isFinite(item.priority)
        ? Number(item.priority)
        : (startIndex + i);
    }

    if (items.length < pageSize) {
      break;
    }
  }

  return { orderedIds, priorityMap };
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

  const normalized = [];
  for (let i = 0; i < rawItems.length; i += 1) {
    const item = rawItems[i] || {};
    const appId = String(item.appid || "").trim();
    if (!/^\d{1,10}$/.test(appId)) {
      continue;
    }
    const priority = Number(item.priority);
    const dateAdded = Number(item.date_added || 0);
    normalized.push({
      appId,
      priority: Number.isFinite(priority) ? priority : 0,
      dateAdded: Number.isFinite(dateAdded) && dateAdded > 0 ? dateAdded : 0,
      index: i
    });
  }

  if (normalized.length === 0) {
    throw new Error("Wishlist API returned no valid appids.");
  }

  // Steam wishlist rank: higher priority means closer to top.
  normalized.sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    if (b.dateAdded !== a.dateAdded) {
      return b.dateAdded - a.dateAdded;
    }
    return a.index - b.index;
  });

  const orderedAppIds = [];
  const priorityMap = {};
  const addedMap = {};
  const seen = new Set();

  for (const entry of normalized) {
    if (seen.has(entry.appId)) {
      continue;
    }
    seen.add(entry.appId);
    orderedAppIds.push(entry.appId);
    priorityMap[entry.appId] = orderedAppIds.length - 1;
    addedMap[entry.appId] = entry.dateAdded;
  }

  return {
    orderedAppIds,
    priorityMap,
    addedMap
  };
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
  const ids = Array.isArray(appIds) ? appIds : Object.keys(wishlistAddedMap || {});
  if (ids.length === 0) {
    return false;
  }
  if (!Array.isArray(wishlistOrderedAppIds) || wishlistOrderedAppIds.length === 0) {
    return false;
  }
  for (const appId of ids) {
    if (!Number.isFinite(Number(wishlistPriorityMap?.[appId]))) {
      return false;
    }
  }
  return true;
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

function getWishlistEntryPriority(entry, fallback = null) {
  const raw = Number(entry?.priority);
  if (Number.isFinite(raw) && raw >= 0) {
    return raw;
  }
  const rank = Number(entry?.rank ?? entry?.order ?? entry?.sort_order ?? entry?.wishlist_rank);
  if (Number.isFinite(rank) && rank >= 0) {
    return rank;
  }
  return fallback;
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
  wishlistSteamId = String(effectiveCached.steamId || "");
  const lastFullSyncAt = Number(effectiveCached.lastFullSyncAt || 0);
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
    const rankStale = (now - wishlistPriorityCachedAt) >= WISHLIST_RANK_SYNC_INTERVAL_MS;
    const shouldRefreshRank = Boolean(steamId) && (wishlistChanged || !cacheHasRank || rankStale);

    if (shouldRefreshRank) {
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
            steamId,
            map: wishlistAddedMap
          }
        });
        return;
      } catch (error) {
        wishlistPriorityLastError = String(error?.message || error || "wishlist rank sync failed");
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
  let orderedIds = [];
  try {
    const fromService = await fetchWishlistOrderFromService(steamId, appIds.length);
    if (fromService?.orderedIds?.length) {
      orderedIds = fromService.orderedIds;
      wishlistPriorityMap = {
        ...wishlistPriorityMap,
        ...(fromService.priorityMap || {})
      };
      for (const appId of orderedIds) {
        if (missing.has(appId)) {
          missing.delete(appId);
        }
      }
    }
  } catch {
    // Fallback below for older/blocked API flow.
  }

  if (orderedIds.length === 0) {
    let orderRank = 0;
    const orderedSeen = new Set();
    for (let pageIndex = 0; pageIndex < 200 && missing.size > 0; pageIndex += 1) {
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
        if (!orderedSeen.has(appId)) {
          orderedSeen.add(appId);
          orderedIds.push(appId);
        }
        wishlistPriorityMap[appId] = orderRank;
        if (missing.has(appId)) {
          missing.delete(appId);
        }
        orderRank += 1;
      }
    }
  }

  if (orderedIds.length > 0) {
    const requestedSet = new Set(appIds.map((id) => String(id)));
    const base = orderedIds.filter((id) => requestedSet.has(id));
    for (const id of appIds) {
      if (!base.includes(id)) {
        base.push(id);
      }
    }
    wishlistOrderedAppIds = base;
    try {
      const stored = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
      const cached = stored[WISHLIST_ADDED_CACHE_KEY] || {};
      await browser.storage.local.set({
        [WISHLIST_ADDED_CACHE_KEY]: {
          ...cached,
          orderedAppIds: wishlistOrderedAppIds,
          priorityMap: wishlistPriorityMap,
          priorityCachedAt: Date.now()
        }
      });
    } catch {
      // Ignore storage persistence issues for ordering cache.
    }
  }
  setStatus("");
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

async function ensureWishlistMetaFromSnapshot(appIds) {
  if (sourceMode !== "wishlist" || !Array.isArray(appIds) || appIds.length === 0) {
    return;
  }
  const unresolved = new Set(appIds);

  const steamId = await resolveCurrentSteamId();
  if (!steamId) {
    return;
  }

  const totalNeeded = unresolved.size;
  setStatus(`Loading wishlist snapshot metadata... 0/${totalNeeded} (0%)`);
  let changed = false;

  try {
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
      }

      const resolved = totalNeeded - unresolved.size;
      const pct = totalNeeded > 0 ? Math.round((resolved / totalNeeded) * 100) : 100;
      setStatus(`Loading wishlist snapshot metadata... ${resolved}/${totalNeeded} (${pct}%) | page ${pageIndex + 1}`);
    }

    if (changed) {
      await saveMetaCache();
    }
  } finally {
    setStatus("");
  }
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
  const day = todayKey();
  const needsDailyRefresh = wishlistSnapshotDay !== day;

  if (wishlistSortSignature === signature && wishlistSortOrders?.position?.length && !needsDailyRefresh) {
    return;
  }

  try {
    await ensureWishlistMetaFromSnapshot(appIds);
  } catch {
    // Non-fatal: keep sorting using cached/API wishlist order.
  }
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
  const includeReviews = options.includeReviews !== false;
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
    const requests = [fetchAppDetailsDataWithFallback()];
    if (includeReviews) {
      requests.push(fetchSteamJson(`https://store.steampowered.com/appreviews/${appId}?json=1&language=all&purchase_type=all&num_per_page=0`));
    }
    const settled = await Promise.allSettled(requests);
    const detailsDataResult = settled[0];
    const reviewsResult = includeReviews ? settled[1] : null;

    let appData = null;
    if (detailsDataResult.status === "fulfilled") {
      appData = detailsDataResult.value;
    }

    if (!appData) {
      throw new Error("No appdetails payload");
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

  if (appIds.length === 0) {
    if (cachedBucket && Array.isArray(cachedBucket.counts) && cachedBucket.counts.length > 0) {
      tagCounts = cachedBucket.counts;
    }
    return;
  }

  if (cachedBucket && cachedBucket.day === day && cachedBucket.appCount === appIds.length) {
    tagCounts = Array.isArray(cachedBucket.counts) ? cachedBucket.counts : [];
    return;
  }

  setStatus("Recalculating tag frequencies for full wishlist...");
  await ensureMetaForAppIds(appIds, 2000, false, "Recalculating tag frequencies:", false);

  const nextCounts = buildTagCountsFromAppIds(appIds);
  if (nextCounts.length === 0 && cachedBucket && Array.isArray(cachedBucket.counts) && cachedBucket.counts.length > 0) {
    tagCounts = cachedBucket.counts;
    setStatus("Steam blocked metadata refresh. Keeping previous tag filters.", true);
    return;
  }
  tagCounts = nextCounts;

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
      languageCounts = Array.isArray(cachedBucket.languageCounts) ? cachedBucket.languageCounts : [];
      fullAudioLanguageCounts = Array.isArray(cachedBucket.fullAudioLanguageCounts) ? cachedBucket.fullAudioLanguageCounts : [];
      subtitleLanguageCounts = Array.isArray(cachedBucket.subtitleLanguageCounts) ? cachedBucket.subtitleLanguageCounts : [];
      technologyCounts = Array.isArray(cachedBucket.technologyCounts) ? cachedBucket.technologyCounts : [];
      developerCounts = Array.isArray(cachedBucket.developerCounts) ? cachedBucket.developerCounts : [];
      publisherCounts = Array.isArray(cachedBucket.publisherCounts) ? cachedBucket.publisherCounts : [];
      releaseYearCounts = Array.isArray(cachedBucket.releaseYearCounts) ? cachedBucket.releaseYearCounts : [];
    }
    return;
  }

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
  await ensureMetaForAppIds(appIds, 2000, false, "Loading extra filters:", false);

  const nextPlayerCounts = buildArrayFieldCountsFromAppIds(appIds, "players");
  const nextFeatureCounts = buildArrayFieldCountsFromAppIds(appIds, "features");
  const nextHardwareCounts = buildArrayFieldCountsFromAppIds(appIds, "hardware");
  const nextAccessibilityCounts = buildArrayFieldCountsFromAppIds(appIds, "accessibility");
  const nextPlatformCounts = buildArrayFieldCountsFromAppIds(appIds, "platforms");
  const nextLanguageCounts = buildArrayFieldCountsFromAppIds(appIds, "languages");
  const nextFullAudioLanguageCounts = buildArrayFieldCountsFromAppIds(appIds, "fullAudioLanguages");
  const nextSubtitleLanguageCounts = buildArrayFieldCountsFromAppIds(appIds, "subtitleLanguages");
  const nextTechnologyCounts = buildArrayFieldCountsFromAppIds(appIds, "technologies");
  const nextDeveloperCounts = buildArrayFieldCountsFromAppIds(appIds, "developers");
  const nextPublisherCounts = buildArrayFieldCountsFromAppIds(appIds, "publishers");
  const nextReleaseYearCounts = buildReleaseYearCountsFromAppIds(appIds);

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
    languageCounts = Array.isArray(cachedBucket.languageCounts) ? cachedBucket.languageCounts : [];
    fullAudioLanguageCounts = Array.isArray(cachedBucket.fullAudioLanguageCounts) ? cachedBucket.fullAudioLanguageCounts : [];
    subtitleLanguageCounts = Array.isArray(cachedBucket.subtitleLanguageCounts) ? cachedBucket.subtitleLanguageCounts : [];
    technologyCounts = Array.isArray(cachedBucket.technologyCounts) ? cachedBucket.technologyCounts : [];
    developerCounts = Array.isArray(cachedBucket.developerCounts) ? cachedBucket.developerCounts : [];
    publisherCounts = Array.isArray(cachedBucket.publisherCounts) ? cachedBucket.publisherCounts : [];
    releaseYearCounts = Array.isArray(cachedBucket.releaseYearCounts) ? cachedBucket.releaseYearCounts : [];
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

function quickPopulateFiltersFromCache() {
  const fromWishlist = Object.keys(wishlistAddedMap || {});
  const appIds = fromWishlist.length > 0 ? fromWishlist : getAllKnownAppIds();
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
  const years = [];

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
    const releaseUnix = getMetaNumber(appId, "releaseUnix", 0);
    if (releaseUnix > 0) {
      years.push(String(new Date(releaseUnix * 1000).getUTCFullYear()));
    }
  }

  tagCounts = uniqueSorted(tags).map((name) => ({ name }));
  typeCounts = uniqueSorted(types).map((name) => ({ name }));
  playerCounts = uniqueSorted(players).map((name) => ({ name }));
  featureCounts = uniqueSorted(features).map((name) => ({ name }));
  hardwareCounts = uniqueSorted(hardware).map((name) => ({ name }));
  accessibilityCounts = uniqueSorted(accessibility).map((name) => ({ name }));
  platformCounts = uniqueSorted(platforms).map((name) => ({ name }));
  languageCounts = uniqueSorted(languages).map((name) => ({ name }));
  fullAudioLanguageCounts = uniqueSorted(fullAudioLanguages).map((name) => ({ name }));
  subtitleLanguageCounts = uniqueSorted(subtitleLanguages).map((name) => ({ name }));
  technologyCounts = uniqueSorted(technologies).map((name) => ({ name }));
  developerCounts = uniqueSorted(developers).map((name) => ({ name }));
  publisherCounts = uniqueSorted(publishers).map((name) => ({ name }));
  releaseYearCounts = uniqueSorted(years, (a, b) => Number(b) - Number(a)).map((name) => ({ name }));

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
  renderCheckboxOptions("languages-options", languageCounts, selectedLanguages, languageSearchQuery);
  renderCheckboxOptions("full-audio-languages-options", fullAudioLanguageCounts, selectedFullAudioLanguages, fullAudioLanguageSearchQuery);
  renderCheckboxOptions("subtitle-languages-options", subtitleLanguageCounts, selectedSubtitleLanguages, subtitleLanguageSearchQuery);
  renderCheckboxOptions("technologies-options", technologyCounts, selectedTechnologies, technologySearchQuery);
  renderCheckboxOptions("developers-options", developerCounts, selectedDevelopers, developerSearchQuery);
  renderCheckboxOptions("publishers-options", publisherCounts, selectedPublishers, publisherSearchQuery);
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
  const effectiveSortMode = (sourceMode === "wishlist" && sortMode === "position" && !isWishlistRankReady(ids))
    ? "release-date"
    : sortMode;
  const baseIds = (sourceMode === "wishlist" && wishlistSortOrders?.[effectiveSortMode]?.length)
    ? wishlistSortOrders[effectiveSortMode]
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

  if (sourceMode === "wishlist" && wishlistSortOrders?.[effectiveSortMode]?.length) {
    return list;
  }

  if (effectiveSortMode === "title") {
    list.sort((a, b) => {
      const ta = String(state?.items?.[a]?.title || metaCache?.[a]?.titleText || a);
      const tb = String(state?.items?.[b]?.title || metaCache?.[b]?.titleText || b);
      return ta.localeCompare(tb, "pt-BR", { sensitivity: "base" });
    });
    return list;
  }

  if (effectiveSortMode === "price") {
    list.sort((a, b) => getEffectiveSortPrice(a) - getEffectiveSortPrice(b));
    return list;
  }

  if (effectiveSortMode === "discount") {
    list.sort((a, b) => getMetaNumber(b, "discountPercent", 0) - getMetaNumber(a, "discountPercent", 0));
    return list;
  }

  if (effectiveSortMode === "date-added") {
    list.sort((a, b) => Number(wishlistAddedMap[b] || 0) - Number(wishlistAddedMap[a] || 0));
    return list;
  }

  if (effectiveSortMode === "top-selling") {
    list.sort((a, b) => getMetaNumber(b, "recommendationsTotal", 0) - getMetaNumber(a, "recommendationsTotal", 0));
    return list;
  }

  if (effectiveSortMode === "release-date") {
    list.sort((a, b) => getMetaNumber(b, "releaseUnix", 0) - getMetaNumber(a, "releaseUnix", 0));
    return list;
  }

  if (effectiveSortMode === "review-score") {
    list.sort((a, b) => {
      const pctDiff = getMetaNumber(b, "reviewPositivePct", -1) - getMetaNumber(a, "reviewPositivePct", -1);
      if (pctDiff !== 0) {
        return pctDiff;
      }
      return getMetaNumber(b, "reviewTotalVotes", 0) - getMetaNumber(a, "reviewTotalVotes", 0);
    });
    return list;
  }

  if (effectiveSortMode === "position" && sourceMode === "wishlist") {
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
  renderPager(appIds.length);

  const start = (page - 1) * PAGE_SIZE;
  const pageIds = appIds.slice(start, start + PAGE_SIZE);
  currentRenderedPageIds = [...pageIds];
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
        quickPopulateFiltersFromCache();
        refreshFilterOptionsInBackground();
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
  quickPopulateFiltersFromCache();
  refreshFilterOptionsInBackground();
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
  quickPopulateFiltersFromCache();
  refreshFilterOptionsInBackground();
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
  quickPopulateFiltersFromCache();
  refreshFilterOptionsInBackground();
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

  const rankReady = sourceMode !== "wishlist" || isWishlistRankReady();
  for (const option of Array.from(select.options)) {
    if (option.value === "position") {
      option.disabled = !rankReady;
    }
  }
  if (sourceMode === "wishlist" && sortMode === "position" && !rankReady) {
    sortMode = "release-date";
    select.value = sortMode;
  }

  const selectedOption = select.options[select.selectedIndex];
  btn.textContent = `Sort by: ${selectedOption?.textContent || "Release Date"}`;

  menu.innerHTML = "";
  for (const option of Array.from(select.options)) {
    const itemBtn = document.createElement("button");
    itemBtn.type = "button";
    itemBtn.className = "dropdown-option";
    if (option.disabled) {
      itemBtn.disabled = true;
      itemBtn.title = "Your rank will be available after wishlist rank sync is ready.";
    }
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
    languageSearchQuery = "";
    fullAudioLanguageSearchQuery = "";
    subtitleLanguageSearchQuery = "";
    technologySearchQuery = "";
    developerSearchQuery = "";
    publisherSearchQuery = "";
    tagSearchQuery = "";
    tagShowLimit = TAG_SHOW_STEP;
    const languagesSearchInput = document.getElementById("languages-search-input");
    const fullAudioSearchInput = document.getElementById("full-audio-languages-search-input");
    const subtitleSearchInput = document.getElementById("subtitle-languages-search-input");
    const technologiesSearchInput = document.getElementById("technologies-search-input");
    const developersSearchInput = document.getElementById("developers-search-input");
    const publishersSearchInput = document.getElementById("publishers-search-input");
    if (languagesSearchInput) {
      languagesSearchInput.value = "";
    }
    if (fullAudioSearchInput) {
      fullAudioSearchInput.value = "";
    }
    if (subtitleSearchInput) {
      subtitleSearchInput.value = "";
    }
    if (technologiesSearchInput) {
      technologiesSearchInput.value = "";
    }
    if (developersSearchInput) {
      developersSearchInput.value = "";
    }
    if (publishersSearchInput) {
      publishersSearchInput.value = "";
    }
    quickPopulateFiltersFromCache();
    refreshFilterOptionsInBackground();
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
    const nextSort = allowed.has(event.target.value) ? event.target.value : "title";
    if (sourceMode === "wishlist" && nextSort === "position" && !isWishlistRankReady()) {
      sortMode = "title";
      setStatus("Your rank will be available after wishlist rank sync is ready.");
    } else {
      sortMode = nextSort;
    }
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
    if (btn.disabled) {
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

  document.getElementById("languages-search-input")?.addEventListener("input", (event) => {
    languageSearchQuery = String(event.target.value || "").trim();
    renderExtraFilterOptions();
  });

  document.getElementById("full-audio-languages-search-input")?.addEventListener("input", (event) => {
    fullAudioLanguageSearchQuery = String(event.target.value || "").trim();
    renderExtraFilterOptions();
  });

  document.getElementById("subtitle-languages-search-input")?.addEventListener("input", (event) => {
    subtitleLanguageSearchQuery = String(event.target.value || "").trim();
    renderExtraFilterOptions();
  });

  document.getElementById("technologies-search-input")?.addEventListener("input", (event) => {
    technologySearchQuery = String(event.target.value || "").trim();
    renderExtraFilterOptions();
  });

  document.getElementById("developers-search-input")?.addEventListener("input", (event) => {
    developerSearchQuery = String(event.target.value || "").trim();
    renderExtraFilterOptions();
  });

  document.getElementById("publishers-search-input")?.addEventListener("input", (event) => {
    publisherSearchQuery = String(event.target.value || "").trim();
    renderExtraFilterOptions();
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
  quickPopulateFiltersFromCache();
  renderRatingControls();
  await render();

  // Load heavy filter counts in background; keep UI responsive with local-cache options first.
  refreshFilterOptionsInBackground();

  const refreshAll = new URLSearchParams(window.location.search).get("refreshAll") === "1";
  if (refreshAll) {
    await refreshWholeDatabase();
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, "", cleanUrl);
  }
}

bootstrap().catch(() => setStatus("Failed to load collections page.", true));
