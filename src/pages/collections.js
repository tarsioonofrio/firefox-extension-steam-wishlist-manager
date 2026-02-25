const PAGE_SIZE = 30;
const META_CACHE_KEY = "steamWishlistCollectionsMetaCacheV4";
const META_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const WISHLIST_ADDED_CACHE_KEY = "steamWishlistAddedMapV3";
const WISHLIST_FULL_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TAG_COUNTS_CACHE_KEY = "steamWishlistTagCountsCacheV1";
const TYPE_COUNTS_CACHE_KEY = "steamWishlistTypeCountsCacheV1";
const TAG_SHOW_STEP = 12;

let state = null;
let activeCollection = "__all__";
let sourceMode = "collections";
let page = 1;
let searchQuery = "";
let sortMode = "position";

let metaCache = {};
let wishlistAddedMap = {};
let wishlistOrderedAppIds = [];

let selectedTags = new Set();
let tagSearchQuery = "";
let tagShowLimit = TAG_SHOW_STEP;
let tagCounts = [];
let selectedTypes = new Set();
let typeCounts = [];
let ratingMin = 0;
let ratingMax = 100;
let reviewsMin = 0;
let reviewsMax = 999999999;

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

function setStatus(text, isError = false) {
  const el = document.getElementById("status");
  if (!el) {
    return;
  }
  el.textContent = text;
  el.style.color = isError ? "#ff9696" : "";
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

async function loadWishlistAddedMap() {
  const now = Date.now();
  const stored = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
  const cached = stored[WISHLIST_ADDED_CACHE_KEY] || {};
  const cachedMap = cached.map || {};
  const lastFullSyncAt = Number(cached.lastFullSyncAt || 0);

  async function resolveSteamIdFromStoreHtml() {
    try {
      const response = await fetch("https://store.steampowered.com/", {
        credentials: "include",
        cache: "no-store"
      });
      const html = await response.text();
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
      const wishlistResponse = await fetch(
        `https://store.steampowered.com/wishlist/profiles/${steamId}/wishlistdata/?p=${pageIndex}`,
        {
          credentials: "include",
          cache: "no-store"
        }
      );
      const wishlistPayload = await wishlistResponse.json();
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
    const userdataResponse = await fetch("https://store.steampowered.com/dynamicstore/userdata/", {
      credentials: "include",
      cache: "no-store"
    });
    const userdata = await userdataResponse.json();
    const nowIds = Array.isArray(userdata?.rgWishlist)
      ? userdata.rgWishlist.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    wishlistOrderedAppIds = [...nowIds];

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
  }
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

  if (!force && cached && now - cached.cachedAt < META_CACHE_TTL_MS) {
    return cached;
  }

  try {
    const [detailsResult, reviewsResult] = await Promise.allSettled([
      fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&cc=br&l=pt-BR`),
      fetch(`https://store.steampowered.com/appreviews/${appId}?json=1&language=all&purchase_type=all&num_per_page=0`)
    ]);

    let detailsPayload = null;
    if (detailsResult.status === "fulfilled") {
      detailsPayload = await detailsResult.value.json();
    }

    let reviewsPayload = null;
    if (reviewsResult.status === "fulfilled") {
      reviewsPayload = await reviewsResult.value.json();
    }

    const appData = detailsPayload?.[appId]?.data;
    const reviewSummary = reviewsPayload?.query_summary || {};

    const genres = Array.isArray(appData?.genres)
      ? appData.genres.map((g) => String(g.description || "").trim()).filter(Boolean)
      : [];
    const categories = Array.isArray(appData?.categories)
      ? appData.categories.map((c) => String(c.description || "").trim()).filter(Boolean)
      : [];
    const tags = Array.from(new Set([...genres, ...categories])).slice(0, 12);

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
    const fresh = cached && now - Number(cached.cachedAt || 0) < META_CACHE_TTL_MS && !force;
    if (!fresh) {
      missing.push(appId);
    }
    if (missing.length >= limit) {
      break;
    }
  }

  const concurrency = 8;
  let cursor = 0;

  async function worker() {
    while (cursor < missing.length) {
      const idx = cursor;
      cursor += 1;
      await fetchAppMeta(missing[idx], { force });
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
  const optionsEl = document.getElementById("type-options");
  if (!optionsEl) {
    return;
  }

  optionsEl.innerHTML = "";

  for (const type of typeCounts) {
    const row = document.createElement("label");
    row.className = "tag-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedTypes.has(type.name);
    checkbox.addEventListener("change", async () => {
      if (checkbox.checked) {
        selectedTypes.add(type.name);
      } else {
        selectedTypes.delete(type.name);
      }
      page = 1;
      await renderCards();
    });

    const name = document.createElement("span");
    name.className = "tag-name";
    name.textContent = type.name;

    const count = document.createElement("span");
    count.className = "tag-count";
    count.textContent = formatCompactCount(type.count);

    row.appendChild(checkbox);
    row.appendChild(name);
    row.appendChild(count);
    optionsEl.appendChild(row);
  }
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

function getFilteredAndSorted(ids) {
  const normalizedQuery = searchQuery.toLowerCase();

  const list = ids.filter((appId) => {
    const title = String(state?.items?.[appId]?.title || metaCache?.[appId]?.titleText || "").toLowerCase();
    const textOk = !normalizedQuery || title.includes(normalizedQuery) || appId.includes(normalizedQuery);
    return textOk && passesTagFilter(appId) && passesTypeFilter(appId) && passesReviewFilter(appId);
  });

  if (sortMode === "title") {
    list.sort((a, b) => {
      const ta = String(state?.items?.[a]?.title || metaCache?.[a]?.titleText || a);
      const tb = String(state?.items?.[b]?.title || metaCache?.[b]?.titleText || b);
      return ta.localeCompare(tb, "pt-BR", { sensitivity: "base" });
    });
    return list;
  }

  if (sortMode === "price") {
    list.sort((a, b) => getMetaNumber(a, "priceFinal", 0) - getMetaNumber(b, "priceFinal", 0));
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

  return list;
}

function renderCollectionSelect() {
  const select = document.getElementById("collection-select");
  const deleteBtn = document.getElementById("delete-collection-btn");
  if (!select || !state) {
    return;
  }

  select.innerHTML = "";

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

  select.value = activeCollection;
  const disabled = sourceMode === "wishlist";
  select.disabled = disabled;
  if (deleteBtn) {
    deleteBtn.disabled = disabled;
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

  if (needsMetaForSort || needsMetaForSearch) {
    setStatus("Loading metadata for sorting/search...");
    await ensureMetaForAppIds(sourceIds, sourceIds.length);
  }

  const appIds = getFilteredAndSorted(sourceIds);
  renderPager(appIds.length);

  const start = (page - 1) * PAGE_SIZE;
  const pageIds = appIds.slice(start, start + PAGE_SIZE);

  // Always hydrate visible items to avoid fallback "App {id}" titles.
  await ensureMetaForAppIds(pageIds, pageIds.length);
  if (needsMetaForSort || needsMetaForSearch) {
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

        await browser.runtime.sendMessage({
          type: "remove-item-from-collection",
          appId,
          collectionName
        });

        await refreshState();
        await ensureTagCounts();
        await ensureTypeCounts();
        renderTagOptions();
        renderTypeOptions();
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

async function createCollection() {
  const input = document.getElementById("new-collection-input");
  const name = normalizeCollectionName(input?.value || "");

  if (!name) {
    setStatus("Type a collection name.", true);
    return;
  }

  await browser.runtime.sendMessage({
    type: "create-collection",
    collectionName: name
  });

  if (input) {
    input.value = "";
  }

  await refreshState();
  activeCollection = name;
  page = 1;
  await ensureTagCounts();
  await ensureTypeCounts();
  renderTagOptions();
  renderTypeOptions();
  setStatus(`Collection \"${name}\" created.`);
  await render();
}

async function deleteActiveCollection() {
  if (!activeCollection || activeCollection === "__all__") {
    setStatus("Select a specific collection to delete.", true);
    return;
  }

  await browser.runtime.sendMessage({
    type: "delete-collection",
    collectionName: activeCollection
  });

  await refreshState();
  activeCollection = "__all__";
  page = 1;
  await ensureTagCounts();
  await ensureTypeCounts();
  renderTagOptions();
  renderTypeOptions();
  setStatus("Collection deleted.");
  await render();
}

async function render() {
  const createBtn = document.getElementById("create-collection-btn");
  const newInput = document.getElementById("new-collection-input");
  const sourceSelect = document.getElementById("source-select");
  const sortSelect = document.getElementById("sort-select");
  const isWishlistMode = sourceMode === "wishlist";

  if (createBtn) {
    createBtn.disabled = isWishlistMode;
  }
  if (newInput) {
    newInput.disabled = isWishlistMode;
  }
  if (sourceSelect) {
    sourceSelect.value = sourceMode;
  }
  if (sortSelect) {
    sortSelect.value = sortMode;
  }

  renderCollectionSelect();
  await renderCards();
}

function renderRatingControls() {
  const minLabel = document.getElementById("rating-min-label");
  const maxLabel = document.getElementById("rating-max-label");
  const minRange = document.getElementById("rating-min-range");
  const maxRange = document.getElementById("rating-max-range");
  const minInput = document.getElementById("reviews-min-input");
  const maxInput = document.getElementById("reviews-max-input");
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
}

function attachEvents() {
  document.getElementById("source-select")?.addEventListener("change", async (event) => {
    sourceMode = event.target.value === "wishlist" ? "wishlist" : "collections";
    page = 1;
    selectedTags.clear();
    selectedTypes.clear();
    tagSearchQuery = "";
    tagShowLimit = TAG_SHOW_STEP;
    await ensureTagCounts();
    await ensureTypeCounts();
    renderTagOptions();
    renderTypeOptions();
    await render();
  });

  document.getElementById("collection-select")?.addEventListener("change", async (event) => {
    activeCollection = event.target.value || "__all__";
    page = 1;

    await browser.runtime.sendMessage({
      type: "set-active-collection",
      activeCollection
    });

    selectedTags.clear();
    selectedTypes.clear();
    tagSearchQuery = "";
    tagShowLimit = TAG_SHOW_STEP;
    await ensureTagCounts();
    await ensureTypeCounts();
    renderTagOptions();
    renderTypeOptions();
    await render();
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
    await render();
  });

  document.getElementById("create-collection-btn")?.addEventListener("click", () => {
    createCollection().catch(() => setStatus("Failed to create collection.", true));
  });

  document.getElementById("delete-collection-btn")?.addEventListener("click", () => {
    deleteActiveCollection().catch(() => setStatus("Failed to delete collection.", true));
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
}

async function bootstrap() {
  await loadMetaCache();
  await loadWishlistAddedMap();
  await refreshState();

  activeCollection = state.activeCollection || "__all__";

  attachEvents();
  await ensureTagCounts();
  await ensureTypeCounts();
  renderTagOptions();
  renderTypeOptions();
  renderRatingControls();
  await render();
}

bootstrap().catch(() => setStatus("Failed to load collections page.", true));
