const TAG_SHOW_STEP = 12;

let activeTabId = 0;
let selectedTags = new Set();
let tagSearchQuery = "";
let tagShowLimit = TAG_SHOW_STEP;
let tagCounts = [];

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

function parseNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function pushCurrentFilters() {
  const payload = {
    stateFilter: document.getElementById("state-filter")?.value || "all",
    selectedTags: Array.from(selectedTags),
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
  for (const key of selectedTags) {
    const found = tagCounts.find((item) => String(item.name || "").toLowerCase() === key);
    selectedEntries.push(found || { name: key, count: 0 });
    selectedSeen.add(key);
  }
  const filtered = tagCounts.filter((item) => !query || String(item.name || "").toLowerCase().includes(query));
  const remaining = filtered.filter((item) => !selectedSeen.has(String(item.name || "").toLowerCase()));
  const ordered = [...selectedEntries, ...remaining];
  const visible = ordered.slice(0, tagShowLimit);

  optionsEl.innerHTML = "";
  for (const item of visible) {
    const row = document.createElement("label");
    row.className = "tag-option";

    const key = String(item.name || "").toLowerCase();
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedTags.has(key);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedTags.add(key);
      } else {
        selectedTags.delete(key);
      }
      pushCurrentFilters().catch((error) => setStatus(error?.message || "Could not apply filters."));
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
  selectedTags = new Set(Array.isArray(snapshot.selectedTags) ? snapshot.selectedTags.map((t) => String(t || "").toLowerCase()) : []);
  tagSearchQuery = String(snapshot.tagSearchQuery || "");
  tagShowLimit = Number(snapshot.tagShowLimit || TAG_SHOW_STEP);
  tagCounts = Array.isArray(snapshot.tagCounts) ? snapshot.tagCounts : [];

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
}

async function init() {
  bindInputs();
  try {
    activeTabId = await resolveActiveWishlistTabId();
    const snapshot = await sendToWishlist("wishlist-filters-get");
    hydrateFromSnapshot(snapshot);
    setStatus(activeTabId > 0 ? "Connected" : "Open a Steam wishlist tab.");
  } catch (error) {
    setStatus(error?.message || "Open a Steam wishlist tab.");
  }
}

init().catch((error) => setStatus(error?.message || "Initialization failed."));
