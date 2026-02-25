const PAGE_SIZE = 30;
const META_CACHE_KEY = "steamWishlistCollectionsMetaCacheV2";
const META_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

let state = null;
let activeCollection = "__all__";
let page = 1;
let searchQuery = "";
let sortMode = "position";
let metaCache = {};

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
      fetch(
        `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&purchase_type=all&num_per_page=0`
      )
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
    const tags = (genres.length > 0 ? genres : categories).slice(0, 5);

    const releaseText = appData?.release_date?.date
      || (appData?.release_date?.coming_soon ? "Coming soon" : "-");
    const reviewText = reviewSummary?.review_score_desc
      ? `${reviewSummary.review_score_desc} (${reviewSummary.total_reviews || 0})`
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
      priceText: "-",
      discountText: "-",
      tags: [],
      reviewText: "No user reviews",
      releaseText: "-"
    };
  }
}

function getSelectedAppIds() {
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

function getFilteredAndSorted(ids) {
  const normalizedQuery = searchQuery.toLowerCase();
  const list = ids.filter((appId) => {
    if (!normalizedQuery) {
      return true;
    }
    const title = String(state.items?.[appId]?.title || "").toLowerCase();
    return title.includes(normalizedQuery) || appId.includes(normalizedQuery);
  });

  if (sortMode === "title") {
    list.sort((a, b) => {
      const ta = String(state.items?.[a]?.title || a);
      const tb = String(state.items?.[b]?.title || b);
      return ta.localeCompare(tb, "pt-BR", { sensitivity: "base" });
    });
  }

  return list;
}

function renderCollectionSelect() {
  const select = document.getElementById("collection-select");
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
  if (!cardsEl || !emptyEl || !template || !state) {
    return;
  }

  const appIds = getFilteredAndSorted(getSelectedAppIds());
  renderPager(appIds.length);

  const start = (page - 1) * PAGE_SIZE;
  const pageIds = appIds.slice(start, start + PAGE_SIZE);

  cardsEl.innerHTML = "";
  emptyEl.classList.toggle("hidden", pageIds.length > 0);

  for (const appId of pageIds) {
    const fragment = template.content.cloneNode(true);

    const title = state.items?.[appId]?.title || `App ${appId}`;
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
    if (removeBtn) {
      removeBtn.addEventListener("click", async () => {
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
        await render();
      });
    }

    cardsEl.appendChild(fragment);

    fetchAppMeta(appId).then((meta) => {
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
  setStatus(`Collection "${name}" created.`);
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
  setStatus("Collection deleted.");
  await render();
}

async function render() {
  renderCollectionSelect();
  await renderCards();
}

function attachEvents() {
  document.getElementById("collection-select")?.addEventListener("change", async (event) => {
    activeCollection = event.target.value || "__all__";
    page = 1;

    await browser.runtime.sendMessage({
      type: "set-active-collection",
      activeCollection
    });

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
}

async function bootstrap() {
  await loadMetaCache();
  await refreshState();
  activeCollection = state.activeCollection || "__all__";
  attachEvents();
  await render();
}

bootstrap().catch(() => setStatus("Failed to load collections page.", true));
