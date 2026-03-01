const TAG_SHOW_STEP = 12;

let activeTabId = 0;
let selectedTagIds = new Set();
let tagSearchQuery = "";
let tagShowLimit = TAG_SHOW_STEP;
let tagCounts = [];
let tagNameToId = new Map();

function normalizeTagKey(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function setStatus(text) {
  const el = document.getElementById("status");
  if (el) {
    el.textContent = String(text || "");
  }
}

async function resolveActiveWishlistTabId() {
  const [active] = await browser.tabs.query({ active: true, currentWindow: true });
  const url = String(active?.url || "");
  if (active?.id && /store\.steampowered\.com\/wishlist/.test(url)) {
    return Number(active.id);
  }
  const tabs = await browser.tabs.query({ url: "*://store.steampowered.com/wishlist*" });
  if (tabs?.[0]?.id) {
    return Number(tabs[0].id);
  }
  return 0;
}

async function sendToWishlist(type, payload = null) {
  if (!(activeTabId > 0)) {
    activeTabId = await resolveActiveWishlistTabId();
  }
  if (!(activeTabId > 0)) {
    throw new Error("Open a Steam wishlist tab first.");
  }
  return browser.tabs.sendMessage(activeTabId, { type, payload });
}

async function loadTagDictionary() {
  if (tagNameToId.size > 0) {
    return;
  }
  try {
    const url = browser.runtime.getURL("src/data/steamdb-tags-hardcoded.json");
    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json();
    const tags = Array.isArray(data?.tags) ? data.tags : [];
    for (const entry of tags) {
      const key = normalizeTagKey(entry?.name);
      const id = Number(entry?.tagid || 0);
      if (!key || !(id > 0) || tagNameToId.has(key)) {
        continue;
      }
      tagNameToId.set(key, id);
    }
  } catch {
    // Keep empty map; UI will still render names.
  }
}

function parseTagIdsFromUrl(urlText) {
  try {
    const url = new URL(String(urlText || ""));
    const raw = String(url.searchParams.get("tagids") || "").trim();
    if (!raw) {
      return new Set();
    }
    const out = new Set();
    for (const part of raw.split(",")) {
      const id = Number(String(part || "").trim());
      if (Number.isFinite(id) && id > 0) {
        out.add(id);
      }
    }
    return out;
  } catch {
    return new Set();
  }
}

async function applyTagIdsToWishlistUrl() {
  if (!(activeTabId > 0)) {
    activeTabId = await resolveActiveWishlistTabId();
  }
  if (!(activeTabId > 0)) {
    throw new Error("Open a Steam wishlist tab first.");
  }
  const tab = await browser.tabs.get(activeTabId);
  const url = new URL(String(tab?.url || ""));
  const values = Array.from(selectedTagIds).map((n) => Number(n)).filter((n) => n > 0).sort((a, b) => a - b);
  if (values.length === 0) {
    url.searchParams.delete("tagids");
  } else {
    url.searchParams.set("tagids", values.join(","));
  }
  await browser.tabs.update(activeTabId, { url: url.toString() });
}

function parseNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function pushCurrentFilters() {
  const payload = {
    stateFilter: document.getElementById("state-filter")?.value || "all",
    selectedTags: [],
    tagSearchQuery,
    tagShowLimit,
    advanced: {
      ratingMin: parseNumber(document.getElementById("rating-min")?.value, 0),
      ratingMax: parseNumber(document.getElementById("rating-max")?.value, 100),
      reviewsMin: parseNumber(document.getElementById("reviews-min")?.value, 0),
      reviewsMax: String(document.getElementById("reviews-max")?.value || "").trim(),
      priceMin: parseNumber(document.getElementById("price-min")?.value, 0),
      priceMax: String(document.getElementById("price-max")?.value || "").trim(),
      discountMin: parseNumber(document.getElementById("discount-min")?.value, 0),
      discountMax: parseNumber(document.getElementById("discount-max")?.value, 100)
    }
  };
  const snapshot = await sendToWishlist("wishlist-filters-set", payload);
  hydrateFromSnapshot(snapshot);
}

function renderTagOptions() {
  const optionsEl = document.getElementById("tags-options");
  const showMoreBtn = document.getElementById("tags-show-more");
  if (!optionsEl || !showMoreBtn) {
    return;
  }

  const query = String(tagSearchQuery || "").trim().toLowerCase();
  const selectedEntries = [];
  const selectedSeen = new Set();
  for (const id of selectedTagIds) {
    const found = tagCounts.find((item) => Number(item.tagid || 0) === Number(id));
    selectedEntries.push(found || { name: `tag:${id}`, count: 0, tagid: Number(id) });
    selectedSeen.add(Number(id));
  }
  const filtered = tagCounts.filter((item) => !query || normalizeTagKey(item.name).includes(query));
  const remaining = filtered.filter((item) => !selectedSeen.has(Number(item.tagid || 0)));
  const ordered = [...selectedEntries, ...remaining];
  const visible = ordered.slice(0, tagShowLimit);

  optionsEl.innerHTML = "";
  for (const item of visible) {
    const row = document.createElement("label");
    row.className = "tag-option";

    const key = normalizeTagKey(item.name);
    const tagId = Number(item.tagid || tagNameToId.get(key) || 0);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = tagId > 0 ? selectedTagIds.has(tagId) : false;
    checkbox.addEventListener("change", async () => {
      if (!(tagId > 0)) {
        checkbox.checked = false;
        setStatus(`Tag id not found for: ${String(item.name || "")}`);
        return;
      }
      if (checkbox.checked) {
        selectedTagIds.add(tagId);
      } else {
        selectedTagIds.delete(tagId);
      }
      try {
        await applyTagIdsToWishlistUrl();
        setStatus("Tag filter applied via wishlist URL.");
      } catch (error) {
        setStatus(error?.message || "Could not apply tag filter.");
      }
    });

    const name = document.createElement("span");
    name.className = "tag-name";
    name.textContent = String(item.name || "");

    const count = document.createElement("span");
    count.className = "tag-count";
    count.textContent = Number(item.count || 0) > 0 ? String(item.count) : "";

    row.appendChild(checkbox);
    row.appendChild(name);
    row.appendChild(count);
    optionsEl.appendChild(row);
  }

  showMoreBtn.style.display = ordered.length > tagShowLimit ? "" : "none";
}

function hydrateFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }
  document.getElementById("state-filter").value = String(snapshot.stateFilter || "all");
  tagSearchQuery = String(snapshot.tagSearchQuery || "");
  tagShowLimit = Number(snapshot.tagShowLimit || TAG_SHOW_STEP);
  tagCounts = (Array.isArray(snapshot.tagCounts) ? snapshot.tagCounts : []).map((item) => {
    const name = String(item?.name || "");
    const count = Number(item?.count || 0);
    const key = normalizeTagKey(name);
    const mappedId = Number(tagNameToId.get(key) || 0);
    return {
      name,
      count: Number.isFinite(count) ? count : 0,
      tagid: mappedId > 0 ? mappedId : 0
    };
  });

  document.getElementById("tags-search").value = tagSearchQuery;

  const advanced = snapshot.advanced || {};
  document.getElementById("rating-min").value = String(advanced.ratingMin ?? 0);
  document.getElementById("rating-max").value = String(advanced.ratingMax ?? 100);
  document.getElementById("reviews-min").value = String(advanced.reviewsMin ?? 0);
  document.getElementById("reviews-max").value = Number.isFinite(Number(advanced.reviewsMax)) ? String(advanced.reviewsMax) : "";
  document.getElementById("price-min").value = String(advanced.priceMin ?? 0);
  document.getElementById("price-max").value = Number.isFinite(Number(advanced.priceMax)) ? String(advanced.priceMax) : "";
  document.getElementById("discount-min").value = String(advanced.discountMin ?? 0);
  document.getElementById("discount-max").value = String(advanced.discountMax ?? 100);

  renderTagOptions();
}

function bindInputs() {
  const pushIds = [
    "state-filter",
    "rating-min",
    "rating-max",
    "reviews-min",
    "reviews-max",
    "price-min",
    "price-max",
    "discount-min",
    "discount-max"
  ];
  for (const id of pushIds) {
    const el = document.getElementById(id);
    el?.addEventListener("input", () => {
      pushCurrentFilters().catch((error) => setStatus(error?.message || "Could not apply filters."));
    });
    el?.addEventListener("change", () => {
      pushCurrentFilters().catch((error) => setStatus(error?.message || "Could not apply filters."));
    });
  }

  document.getElementById("tags-search")?.addEventListener("input", (event) => {
    tagSearchQuery = String(event?.target?.value || "").slice(0, 60);
    tagShowLimit = TAG_SHOW_STEP;
    renderTagOptions();
  });

  document.getElementById("tags-show-more")?.addEventListener("click", () => {
    tagShowLimit += TAG_SHOW_STEP;
    renderTagOptions();
  });

  document.getElementById("close-sidebar")?.addEventListener("click", async () => {
    try {
      await browser.sidebarAction.close();
    } catch {
      window.close();
    }
  });
}

async function init() {
  await loadTagDictionary();
  bindInputs();
  try {
    activeTabId = await resolveActiveWishlistTabId();
    let initialUrlTagIds = new Set();
    if (activeTabId > 0) {
      const tab = await browser.tabs.get(activeTabId);
      initialUrlTagIds = parseTagIdsFromUrl(tab?.url || "");
    }
    const snapshot = await sendToWishlist("wishlist-filters-get");
    hydrateFromSnapshot(snapshot);
    selectedTagIds = initialUrlTagIds;
    renderTagOptions();
    setStatus(activeTabId > 0 ? "Connected" : "Open a Steam wishlist tab.");
  } catch (error) {
    setStatus(error?.message || "Open a Steam wishlist tab.");
  }
}

init().catch((error) => setStatus(error?.message || "Initialization failed."));
