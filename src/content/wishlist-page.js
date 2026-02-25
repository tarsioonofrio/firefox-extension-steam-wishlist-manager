const PANEL_ID = "swcm-wishlist-panel";

function extractAppId(row) {
  const byData = row.getAttribute("data-app-id") || row.getAttribute("data-ds-appid");
  if (byData) {
    return String(byData);
  }

  const idMatch = (row.id || "").match(/(\d+)/);
  return idMatch ? idMatch[1] : "";
}

function getRows() {
  const selectors = [
    ".wishlist_row",
    "div[id^='game_']",
    "div[data-ds-appid]"
  ];

  const rows = Array.from(document.querySelectorAll(selectors.join(",")));
  const unique = [];
  const seen = new Set();

  for (const row of rows) {
    if (seen.has(row)) {
      continue;
    }
    seen.add(row);
    unique.push(row);
  }

  return unique;
}

function getListContainer() {
  return document.querySelector("#wishlist_ctn") || document.querySelector("#wishlist_items") || document.body;
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

  for (const row of rows) {
    const appId = extractAppId(row);
    if (appId) {
      rowByAppId.set(appId, row);
    }

    row.style.display = allowed.has(appId) ? "" : "none";
  }

  const container = getListContainer();
  for (const appId of orderedIds) {
    const row = rowByAppId.get(appId);
    if (row && row.parentElement === container) {
      container.appendChild(row);
    }
  }

  updateCount(allowed.size, total);
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

async function init() {
  if (document.getElementById(PANEL_ID)) {
    await updateFilterOptions();
    return;
  }

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

  await updateFilterOptions();
}

const wishlistObserver = new MutationObserver(() => {
  init().catch(() => {});
});

wishlistObserver.observe(document.documentElement, {
  childList: true,
  subtree: true
});

init().catch(() => {});
