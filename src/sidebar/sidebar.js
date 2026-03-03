const TAG_SHOW_STEP = 12;
const EXTRA_SHOW_STEP = 12;
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

let activeTabId = 0;
let selectedTagIds = new Set();
let tagSearchQuery = "";
let tagShowLimit = TAG_SHOW_STEP;
let tagCounts = [];
let tagNameToId = new Map();

let extraFilterSelected = Object.fromEntries(EXTRA_FILTER_CONFIGS.map((cfg) => [cfg.key, new Set()]));
let extraFilterCounts = Object.fromEntries(EXTRA_FILTER_CONFIGS.map((cfg) => [cfg.key, []]));
let extraFilterSearchQuery = Object.fromEntries(EXTRA_FILTER_CONFIGS.map((cfg) => [cfg.key, ""]));
let extraFilterShowLimit = Object.fromEntries(EXTRA_FILTER_CONFIGS.map((cfg) => [cfg.key, EXTRA_SHOW_STEP]));

function normalizeTagKey(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeFilterValue(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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

function toExtraSelectedPayload() {
  const selected = {};
  for (const cfg of EXTRA_FILTER_CONFIGS) {
    selected[cfg.key] = Array.from(extraFilterSelected[cfg.key] || []);
  }
  return selected;
}

async function pushCurrentFilters() {
  const payload = {
    stateFilter: document.getElementById("state-filter")?.value || "all",
    selectedTags: [],
    tagSearchQuery,
    tagShowLimit,
    multiFilters: {
      selected: toExtraSelectedPayload()
    },
    advanced: {
      ratingMin: parseNumber(document.getElementById("rating-min")?.value, 0),
      ratingMax: parseNumber(document.getElementById("rating-max")?.value, 100),
      reviewsMin: parseNumber(document.getElementById("reviews-min")?.value, 0),
      reviewsMax: String(document.getElementById("reviews-max")?.value || "").trim(),
      priceMin: parseNumber(document.getElementById("price-min")?.value, 0),
      priceMax: String(document.getElementById("price-max")?.value || "").trim(),
      discountMin: parseNumber(document.getElementById("discount-min")?.value, 0),
      discountMax: parseNumber(document.getElementById("discount-max")?.value, 100),
      releaseTextEnabled: Boolean(document.getElementById("release-text-enabled")?.checked),
      releaseYearRangeEnabled: Boolean(document.getElementById("release-year-range-enabled")?.checked),
      releaseYearMin: parseNumber(document.getElementById("release-year-min")?.value, 1970),
      releaseYearMax: parseNumber(document.getElementById("release-year-max")?.value, new Date().getUTCFullYear() + 1)
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

function renderExtraFilterOptions(key) {
  const cfg = EXTRA_FILTER_CONFIGS.find((entry) => entry.key === key);
  if (!cfg) {
    return;
  }
  const optionsEl = document.getElementById(`${key}-options`);
  const showMoreBtn = document.getElementById(`${key}-show-more`);
  if (!optionsEl || !showMoreBtn) {
    return;
  }

  const selectedSet = extraFilterSelected[key] || new Set();
  const counts = Array.isArray(extraFilterCounts[key]) ? extraFilterCounts[key] : [];
  const query = String(extraFilterSearchQuery[key] || "").trim().toLowerCase();

  const selectedEntries = [];
  const selectedSeen = new Set();
  for (const value of selectedSet) {
    const found = counts.find((item) => normalizeFilterValue(item?.name) === value);
    selectedEntries.push(found || { name: value, count: 0 });
    selectedSeen.add(value);
  }

  const filtered = counts.filter((item) => {
    const name = normalizeFilterValue(item?.name);
    return !query || name.toLowerCase().includes(query);
  });
  const remaining = filtered.filter((item) => !selectedSeen.has(normalizeFilterValue(item?.name)));
  const ordered = [...selectedEntries, ...remaining];
  const visible = ordered.slice(0, Number(extraFilterShowLimit[key] || EXTRA_SHOW_STEP));

  optionsEl.innerHTML = "";
  for (const item of visible) {
    const value = normalizeFilterValue(item?.name);
    if (!value) {
      continue;
    }
    const row = document.createElement("label");
    row.className = "tag-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedSet.has(value);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedSet.add(value);
      } else {
        selectedSet.delete(value);
      }
      extraFilterSelected[key] = selectedSet;
      renderExtraFilterOptions(key);
      pushCurrentFilters().catch((error) => setStatus(error?.message || "Could not apply filters."));
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

function renderAllExtraFilterOptions() {
  for (const cfg of EXTRA_FILTER_CONFIGS) {
    renderExtraFilterOptions(cfg.key);
  }
}

function ensureExtraFilterUi() {
  const root = document.getElementById("extra-filters-root");
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
    search.id = `${cfg.key}-search`;
    search.placeholder = cfg.placeholder;
    search.addEventListener("input", (event) => {
      extraFilterSearchQuery[cfg.key] = String(event?.target?.value || "").slice(0, 80);
      extraFilterShowLimit[cfg.key] = EXTRA_SHOW_STEP;
      renderExtraFilterOptions(cfg.key);
    });

    const options = document.createElement("div");
    options.id = `${cfg.key}-options`;
    options.className = "tag-options";

    const showMore = document.createElement("button");
    showMore.type = "button";
    showMore.id = `${cfg.key}-show-more`;
    showMore.className = "small-btn";
    showMore.textContent = "Show more";
    showMore.addEventListener("click", () => {
      extraFilterShowLimit[cfg.key] = Number(extraFilterShowLimit[cfg.key] || EXTRA_SHOW_STEP) + EXTRA_SHOW_STEP;
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

function hydrateFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }

  const stateFilterEl = document.getElementById("state-filter");
  if (stateFilterEl) {
    stateFilterEl.value = String(snapshot.stateFilter || "all");
  }

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

  const tagsSearchEl = document.getElementById("tags-search");
  if (tagsSearchEl) {
    tagsSearchEl.value = tagSearchQuery;
  }

  const multi = snapshot.multiFilters && typeof snapshot.multiFilters === "object" ? snapshot.multiFilters : {};
  const selected = multi.selected && typeof multi.selected === "object" ? multi.selected : {};
  const counts = multi.counts && typeof multi.counts === "object" ? multi.counts : {};

  for (const cfg of EXTRA_FILTER_CONFIGS) {
    const key = cfg.key;
    extraFilterSelected[key] = new Set(
      (Array.isArray(selected[key]) ? selected[key] : [])
        .map(normalizeFilterValue)
        .filter(Boolean)
    );
    extraFilterCounts[key] = (Array.isArray(counts[key]) ? counts[key] : []).map((item) => ({
      name: normalizeFilterValue(item?.name),
      count: Number(item?.count || 0)
    })).filter((item) => item.name);
    const searchInput = document.getElementById(`${key}-search`);
    if (searchInput) {
      searchInput.value = String(extraFilterSearchQuery[key] || "");
    }
  }

  const advanced = snapshot.advanced || {};
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) {
      el.value = value;
    }
  };
  setValue("rating-min", String(advanced.ratingMin ?? 0));
  setValue("rating-max", String(advanced.ratingMax ?? 100));
  setValue("reviews-min", String(advanced.reviewsMin ?? 0));
  setValue("reviews-max", Number.isFinite(Number(advanced.reviewsMax)) ? String(advanced.reviewsMax) : "");
  setValue("price-min", String(advanced.priceMin ?? 0));
  setValue("price-max", Number.isFinite(Number(advanced.priceMax)) ? String(advanced.priceMax) : "");
  setValue("discount-min", String(advanced.discountMin ?? 0));
  setValue("discount-max", String(advanced.discountMax ?? 100));
  setValue("release-year-min", String(advanced.releaseYearMin ?? 1970));
  setValue("release-year-max", String(advanced.releaseYearMax ?? (new Date().getUTCFullYear() + 1)));

  const releaseTextToggle = document.getElementById("release-text-enabled");
  if (releaseTextToggle) {
    releaseTextToggle.checked = advanced.releaseTextEnabled !== false;
  }
  const releaseRangeToggle = document.getElementById("release-year-range-enabled");
  if (releaseRangeToggle) {
    releaseRangeToggle.checked = advanced.releaseYearRangeEnabled !== false;
  }

  renderTagOptions();
  renderAllExtraFilterOptions();
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
    "discount-max",
    "release-year-min",
    "release-year-max",
    "release-text-enabled",
    "release-year-range-enabled"
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
  ensureExtraFilterUi();
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
