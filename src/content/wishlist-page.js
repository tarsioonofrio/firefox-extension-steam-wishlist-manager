const PANEL_ID = "swcm-wishlist-panel";
const MODAL_ID = "swcm-collections-modal";
const MANAGE_BUTTON_ID = "swcm-manage-collections";
const ENABLE_MANAGE_COLLECTIONS = false;
const WISHLIST_SELECTOR = "#wishlist_ctn, #wishlist_items, .wishlist_row";
const REFRESH_DEBOUNCE_MS = 250;
const PRUNE_INTERVAL_MS = 10000;
const WISHLIST_API_CACHE_TTL_MS = 60000;

let observedListContainer = null;
let observedListMutationObserver = null;
let refreshTimer = 0;
let lastPruneAt = 0;
let wishlistApiCache = null;
let wishlistApiCacheAt = 0;
let wishlistApiInFlight = null;

function extractAppId(row) {
  const byData = row.getAttribute("data-app-id") || row.getAttribute("data-ds-appid");
  if (byData) {
    return String(byData);
  }

  const idMatch = (row.id || "").match(/(\d+)/);
  return idMatch ? idMatch[1] : "";
}

function getRows() {
  return Array.from(document.querySelectorAll(".wishlist_row, div[id^='game_'], div[data-ds-appid]"));
}

function getListContainer() {
  return document.querySelector("#wishlist_ctn") || document.querySelector("#wishlist_items") || null;
}

function invalidateWishlistApiCache() {
  wishlistApiCache = null;
  wishlistApiCacheAt = 0;
}

async function fetchWishlistAppIdsFromApi() {
  const now = Date.now();
  if (wishlistApiCache && now - wishlistApiCacheAt < WISHLIST_API_CACHE_TTL_MS) {
    return wishlistApiCache;
  }

  if (wishlistApiInFlight) {
    return wishlistApiInFlight;
  }

  wishlistApiInFlight = fetch("https://store.steampowered.com/dynamicstore/userdata/", {
    method: "GET",
    credentials: "include",
    cache: "no-store"
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`dynamicstore/userdata failed: ${response.status}`);
      }

      const payload = await response.json();
      const wishlistArray = Array.isArray(payload?.rgWishlist) ? payload.rgWishlist : [];
      const normalized = wishlistArray.map((appId) => String(appId));

      wishlistApiCache = normalized;
      wishlistApiCacheAt = Date.now();
      return normalized;
    })
    .finally(() => {
      wishlistApiInFlight = null;
    });

  return wishlistApiInFlight;
}

function createPanel() {
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.className = "swcm-panel";
  panel.innerHTML = `
    <strong>Collections</strong>
    <select id="swcm-filter-select"></select>
    <span id="swcm-filter-count">0 visible</span>
  `;
  return panel;
}

function createManageButton() {
  const button = document.createElement("button");
  button.id = MANAGE_BUTTON_ID;
  button.className = "swcm-btn swcm-btn-inline";
  button.type = "button";
  button.textContent = "Manage Collections";
  return button;
}

function createCollectionsModal() {
  const overlay = document.createElement("div");
  overlay.id = MODAL_ID;
  overlay.className = "swcm-overlay swcm-hidden";

  overlay.innerHTML = `
    <div class="swcm-modal" role="dialog" aria-modal="true" aria-label="Manage collections">
      <h3>Manage Collections</h3>
      <label>
        New collection name
        <input id="swcm-new-collection-name" type="text" placeholder="e.g. High Priority" />
      </label>
      <div class="swcm-actions swcm-actions-left">
        <button id="swcm-create-collection" type="button" class="swcm-btn">Create</button>
      </div>
      <label>
        Remove collection
        <select id="swcm-delete-collection-select"></select>
      </label>
      <div class="swcm-actions swcm-actions-left">
        <button id="swcm-delete-collection" type="button" class="swcm-btn swcm-btn-danger">Remove</button>
      </div>
      <div class="swcm-actions">
        <button id="swcm-close-collections" type="button" class="swcm-btn swcm-btn-secondary">Close</button>
      </div>
      <p id="swcm-collections-status" class="swcm-status" aria-live="polite"></p>
    </div>
  `;

  return overlay;
}

function setCollectionsStatus(text, isError = false) {
  const status = document.getElementById("swcm-collections-status");
  if (!status) {
    return;
  }

  status.textContent = text;
  status.classList.toggle("swcm-status-error", isError);
}

function openCollectionsModal() {
  const modal = document.getElementById(MODAL_ID);
  modal?.classList.remove("swcm-hidden");
}

function closeCollectionsModal() {
  const modal = document.getElementById(MODAL_ID);
  modal?.classList.add("swcm-hidden");
}

async function loadState() {
  return browser.runtime.sendMessage({ type: "get-state" });
}

async function saveActiveCollection(activeCollection) {
  await browser.runtime.sendMessage({
    type: "set-active-collection",
    activeCollection
  });
}

async function pruneCollectionsBySteamWishlist() {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) {
    return null;
  }

  lastPruneAt = now;

  try {
    const appIds = await fetchWishlistAppIdsFromApi();

    const result = await browser.runtime.sendMessage({
      type: "prune-items-not-in-wishlist",
      appIds
    });

    return result?.state || null;
  } catch {
    return null;
  }
}

async function populateCollectionsManagement(state) {
  const select = document.getElementById("swcm-delete-collection-select");
  if (!select) {
    return;
  }

  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "-- choose collection --";
  select.appendChild(placeholder);

  for (const collectionName of state.collectionOrder || []) {
    const option = document.createElement("option");
    option.value = collectionName;
    option.textContent = collectionName;
    select.appendChild(option);
  }
}

async function createCollection() {
  const input = document.getElementById("swcm-new-collection-name");
  const collectionName = String(input?.value || "").trim();

  if (!collectionName) {
    setCollectionsStatus("Type a collection name.", true);
    return;
  }

  await browser.runtime.sendMessage({
    type: "create-collection",
    collectionName
  });

  if (input) {
    input.value = "";
  }

  setCollectionsStatus(`Collection "${collectionName}" created.`);
  await updateFilterOptions();
}

async function deleteCollection() {
  const select = document.getElementById("swcm-delete-collection-select");
  const collectionName = String(select?.value || "").trim();

  if (!collectionName) {
    setCollectionsStatus("Select a collection to remove.", true);
    return;
  }

  await browser.runtime.sendMessage({
    type: "delete-collection",
    collectionName
  });

  setCollectionsStatus(`Collection "${collectionName}" removed.`);
  await updateFilterOptions();
}

function updateCount(visible, total) {
  const el = document.getElementById("swcm-filter-count");
  if (el) {
    el.textContent = `${visible}/${total} visible`;
  }
}

function applyCollection(state, collectionName) {
  const rows = getRows();
  const total = rows.length;

  if (!collectionName || collectionName === "__all__") {
    for (const row of rows) {
      row.style.display = "";
    }
    updateCount(total, total);
    return;
  }

  const orderedIds = state.collections[collectionName] || [];
  const allowed = new Set(orderedIds);
  const rowByAppId = new Map();
  let visibleCount = 0;

  for (const row of rows) {
    const appId = extractAppId(row);
    if (appId) {
      rowByAppId.set(appId, row);
    }

    const isVisible = allowed.has(appId);
    row.style.display = isVisible ? "" : "none";
    if (isVisible) {
      visibleCount += 1;
    }
  }

  const container = getListContainer();
  if (container) {
    for (const appId of orderedIds) {
      const row = rowByAppId.get(appId);
      if (row && row.parentElement === container) {
        container.appendChild(row);
      }
    }
  }

  updateCount(visibleCount, total);
}

async function updateFilterOptions() {
  attachManageButton();

  const prunedState = await pruneCollectionsBySteamWishlist();
  const state = prunedState || (await loadState());

  const select = document.getElementById("swcm-filter-select");
  if (!select) {
    return;
  }

  select.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "__all__";
  allOption.textContent = "All wishlist";
  select.appendChild(allOption);

  for (const collectionName of state.collectionOrder || []) {
    const option = document.createElement("option");
    option.value = collectionName;
    const size = (state.collections[collectionName] || []).length;
    option.textContent = `${collectionName} (${size})`;
    select.appendChild(option);
  }

  const current = state.activeCollection || "__all__";
  select.value = Array.from(select.options).some((o) => o.value === current)
    ? current
    : "__all__";

  await populateCollectionsManagement(state);
  applyCollection(state, select.value);
}

function scheduleRefresh() {
  if (refreshTimer) {
    window.clearTimeout(refreshTimer);
  }

  refreshTimer = window.setTimeout(() => {
    refreshTimer = 0;
    invalidateWishlistApiCache();
    updateFilterOptions().catch(() => {});
  }, REFRESH_DEBOUNCE_MS);
}

function observeWishlistContainer() {
  const container = getListContainer();

  if (!container || container === observedListContainer) {
    return;
  }

  if (observedListMutationObserver) {
    observedListMutationObserver.disconnect();
  }

  observedListContainer = container;
  observedListMutationObserver = new MutationObserver(() => {
    scheduleRefresh();
  });

  observedListMutationObserver.observe(container, {
    childList: true,
    subtree: true
  });
}

function getWishlistTitleAnchor() {
  const header = document.querySelector(".wishlist_header");
  if (!header) {
    return null;
  }

  const candidates = Array.from(header.querySelectorAll("h1, h2, div, span, a"));
  for (const el of candidates) {
    const text = (el.textContent || "").replace(/\s+/g, " ").trim().toUpperCase();
    const looksLikeUserWishlistTitle = /.+\sWISHLIST$/.test(text);

    if (looksLikeUserWishlistTitle) {
      return el;
    }
  }

  return null;
}

function attachManageButton() {
  if (!ENABLE_MANAGE_COLLECTIONS) {
    return;
  }

  if (document.getElementById(MANAGE_BUTTON_ID)) {
    return;
  }

  const button = createManageButton();
  button.addEventListener("click", async () => {
    setCollectionsStatus("");
    await updateFilterOptions();
    openCollectionsModal();
  });

  const titleAnchor = getWishlistTitleAnchor();
  if (titleAnchor) {
    titleAnchor.insertAdjacentElement("afterend", button);
    return;
  }

  const countAnchor = document.querySelector(".wishlist_header .num, .wishlist_header .wishlist_count");
  if (countAnchor?.parentElement) {
    countAnchor.insertAdjacentElement("afterend", button);
    return;
  }

  const headerAnchor = document.querySelector(".wishlist_header");
  if (headerAnchor) {
    headerAnchor.appendChild(button);
    return;
  }

  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    panel.appendChild(button);
  }
}

function attachCollectionsModal() {
  if (!ENABLE_MANAGE_COLLECTIONS) {
    return;
  }

  if (document.getElementById(MODAL_ID)) {
    return;
  }

  const modal = createCollectionsModal();
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeCollectionsModal();
    }
  });

  document.body.appendChild(modal);

  document.getElementById("swcm-close-collections")?.addEventListener("click", closeCollectionsModal);
  document.getElementById("swcm-create-collection")?.addEventListener("click", () => {
    createCollection().catch((error) => {
      setCollectionsStatus(error?.message || "Failed to create collection.", true);
    });
  });
  document.getElementById("swcm-delete-collection")?.addEventListener("click", () => {
    deleteCollection().catch((error) => {
      setCollectionsStatus(error?.message || "Failed to remove collection.", true);
    });
  });
}

async function init() {
  if (!document.getElementById(PANEL_ID)) {
    const panel = createPanel();
    const target = document.querySelector(".wishlist_header") || document.body;
    target.insertAdjacentElement("afterend", panel);

    const select = document.getElementById("swcm-filter-select");
    select?.addEventListener("change", async () => {
      const state = await loadState();
      const value = select.value || "__all__";
      await saveActiveCollection(value);
      applyCollection(state, value);
    });
  }

  attachManageButton();
  attachCollectionsModal();
  observeWishlistContainer();
  await updateFilterOptions();
}

const pageObserver = new MutationObserver(() => {
  if (!document.querySelector(WISHLIST_SELECTOR)) {
    return;
  }

  init().catch(() => {});
  attachManageButton();
});

if (document.querySelector(WISHLIST_SELECTOR)) {
  init().catch(() => {});
  attachManageButton();
}

pageObserver.observe(document.documentElement, {
  childList: true,
  subtree: true
});
