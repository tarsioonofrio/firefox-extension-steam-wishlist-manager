const PANEL_ID = "swcm-wishlist-panel";
const WISHLIST_SELECTOR = "#wishlist_ctn, #wishlist_items";
const REFRESH_DEBOUNCE_MS = 250;

let observedListContainer = null;
let observedListMutationObserver = null;
let refreshTimer = 0;

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

async function loadState() {
  return browser.runtime.sendMessage({ type: "get-state" });
}

async function saveActiveCollection(activeCollection) {
  await browser.runtime.sendMessage({
    type: "set-active-collection",
    activeCollection
  });
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
  const state = await loadState();
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

  applyCollection(state, select.value);
}

function scheduleRefresh() {
  if (refreshTimer) {
    window.clearTimeout(refreshTimer);
  }

  refreshTimer = window.setTimeout(() => {
    refreshTimer = 0;
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

  observeWishlistContainer();
  await updateFilterOptions();
}

const pageObserver = new MutationObserver(() => {
  if (!document.querySelector(WISHLIST_SELECTOR)) {
    return;
  }

  pageObserver.disconnect();
  init().catch(() => {});
});

if (document.querySelector(WISHLIST_SELECTOR)) {
  init().catch(() => {});
} else {
  pageObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}
