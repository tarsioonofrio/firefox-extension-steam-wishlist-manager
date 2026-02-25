const PAGE_SIZE = 30;
const META_CACHE_KEY = "steamWishlistCollectionsMetaCacheV4";
const META_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const WISHLIST_ADDED_CACHE_KEY = "steamWishlistAddedMapV3";
const WISHLIST_ADDED_CACHE_TTL_MS = 30 * 60 * 1000;
const TAG_COUNTS_CACHE_KEY = "steamWishlistTagCountsCacheV1";
const TAG_SHOW_STEP = 12;

let state = null;
let activeCollection = "__all__";
let sourceMode = "collections";
let page = 1;
let searchQuery = "";
let sortMode = "position";

let metaCache = {};
let wishlistAddedMap = {};

let selectedTags = new Set();
let tagSearchQuery = "";
let tagShowLimit = TAG_SHOW_STEP;
let tagCounts = [];

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
    return Object.keys(wishlistAddedMap).sort((a, b) => Number(wishlistAddedMap[b] || 0) - Number(wishlistAddedMap[a] || 0));
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

async function loadWishlistAddedMap() {
  const now = Date.now();
  const stored = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
  const cached = stored[WISHLIST_ADDED_CACHE_KEY];
  if (cached && now - Number(cached.cachedAt || 0) < WISHLIST_ADDED_CACHE_TTL_MS) {
    wishlistAddedMap = cached.map || {};
    return;
  }

  async function resolveSteamIdFromStoreHtml() {
    try {
      const response = await fetch("https://store.steampowered.com/", {
        credentials: "include",
        cache: "no-store"
      });
      const html = await response.text();
      const match = html.match(/g_steamID\\s*=\\s*\"(\\d{10,20})\"/);
      return match ? match[1] : "";
    } catch {
      return "";
    }
  }

  try {
    const userdataResponse = await fetch("https://store.steampowered.com/dynamicstore/userdata/", {
      credentials: "include",
      cache: "no-store"
    });
    const userdata = await userdataResponse.json();

    const rgWishlistArray = Array.isArray(userdata?.rgWishlist)
      ? userdata.rgWishlist.map((id) => String(id || "").trim()).filter(Boolean)
      : [];

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
      const fallback = {};
      for (const appId of rgWishlistArray) {
        fallback[appId] = 0;
      }
      wishlistAddedMap = fallback;
      return;
    }

    const map = {};
    for (let pageIndex = 0; pageIndex < 200; pageIndex += 1) {
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
        const added = Number(value?.added || 0);
        map[String(appId)] = added > 0 ? added : 0;
      }
    }

    wishlistAddedMap = map;
    if (Object.keys(wishlistAddedMap).length === 0 && rgWishlistArray.length > 0) {
      for (const appId of rgWishlistArray) {
        wishlistAddedMap[appId] = 0;
      }
    }

    await browser.storage.local.set({
      [WISHLIST_ADDED_CACHE_KEY]: {
        cachedAt: now,
        map: wishlistAddedMap
      }
    });
  } catch {
    wishlistAddedMap = {};
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

async function fetchAppMeta(appId) {
  const cached = metaCache[appId];
  const now = Date.now();

  if (cached && now - cached.cachedAt < META_CACHE_TTL_MS) {
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

    const meta = {
      cachedAt: now,
      titleText: String(appData?.name || "").trim(),
      priceText,
      discountText: appData?.price_overview?.discount_percent
        ? `${appData.price_overview.discount_percent}% off`
        : "-",
      tags,
      reviewText,
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
      discountText: "-",
      tags: [],
      reviewText: "No user reviews",
      releaseText: "-"
    };
  }
}

async function ensureMetaForAppIds(appIds, limit = 400) {
  const now = Date.now();
  const missing = [];

  for (const appId of appIds) {
    const cached = metaCache[appId];
    const fresh = cached && now - Number(cached.cachedAt || 0) < META_CACHE_TTL_MS;
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
      await fetchAppMeta(missing[idx]);
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

function getFilteredAndSorted(ids) {
  const normalizedQuery = searchQuery.toLowerCase();

  const list = ids.filter((appId) => {
    const title = String(state?.items?.[appId]?.title || metaCache?.[appId]?.titleText || "").toLowerCase();
    const textOk = !normalizedQuery || title.includes(normalizedQuery) || appId.includes(normalizedQuery);
    return textOk && passesTagFilter(appId);
  });

  if (sortMode === "title") {
    list.sort((a, b) => {
      const ta = String(state?.items?.[a]?.title || metaCache?.[a]?.titleText || a);
      const tb = String(state?.items?.[b]?.title || metaCache?.[b]?.titleText || b);
      return ta.localeCompare(tb, "pt-BR", { sensitivity: "base" });
    });
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

  const appIds = getFilteredAndSorted(getCurrentSourceAppIds());
  renderPager(appIds.length);

  const start = (page - 1) * PAGE_SIZE;
  const pageIds = appIds.slice(start, start + PAGE_SIZE);

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
        renderTagOptions();
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
  renderTagOptions();
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
  renderTagOptions();
  setStatus("Collection deleted.");
  await render();
}

async function render() {
  const createBtn = document.getElementById("create-collection-btn");
  const newInput = document.getElementById("new-collection-input");
  const sourceSelect = document.getElementById("source-select");
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

  renderCollectionSelect();
  await renderCards();
}

function attachEvents() {
  document.getElementById("source-select")?.addEventListener("change", async (event) => {
    sourceMode = event.target.value === "wishlist" ? "wishlist" : "collections";
    page = 1;
    selectedTags.clear();
    tagSearchQuery = "";
    tagShowLimit = TAG_SHOW_STEP;
    await ensureTagCounts();
    renderTagOptions();
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
    tagSearchQuery = "";
    tagShowLimit = TAG_SHOW_STEP;
    await ensureTagCounts();
    renderTagOptions();
    await render();
  });

  document.getElementById("search-input")?.addEventListener("input", async (event) => {
    searchQuery = String(event.target.value || "");
    page = 1;
    await render();
  });

  document.getElementById("sort-select")?.addEventListener("change", async (event) => {
    sortMode = event.target.value === "title" ? "title" : "position";
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
}

async function bootstrap() {
  await loadMetaCache();
  await loadWishlistAddedMap();
  await refreshState();

  activeCollection = state.activeCollection || "__all__";

  attachEvents();
  await ensureTagCounts();
  renderTagOptions();
  await render();
}

bootstrap().catch(() => setStatus("Failed to load collections page.", true));
