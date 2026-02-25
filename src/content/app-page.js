const EXT_ROOT_ID = "swcm-root";
const MODAL_ID = "swcm-modal";
const APP_MANAGE_BUTTON_ID = "swcm-manage-collections-app";
const APP_MANAGE_MODAL_ID = "swcm-collections-modal-app";
const ENABLE_MANAGE_COLLECTIONS = false;

const INIT_RETRY_INTERVAL_MS = 400;
const MAX_INIT_ATTEMPTS = 20;
const WISHLIST_API_CACHE_TTL_MS = 60000;
const MEMBERSHIP_ENFORCE_MIN_INTERVAL_MS = 5000;
const GLOBAL_PRUNE_MIN_INTERVAL_MS = 30000;

let wishlistStateObserver = null;
let wishlistStateRefreshTimer = 0;
let wishlistApiCache = null;
let wishlistApiCacheAt = 0;
let wishlistApiInFlight = null;
let lastMembershipEnforceAt = 0;
let lastGlobalPruneAt = 0;

function getAppIdFromUrl() {
  const match = window.location.pathname.match(/\/app\/(\d+)/);
  return match ? match[1] : "";
}

function getGameTitle() {
  const titleElement = document.querySelector(".apphub_AppName");
  return titleElement ? titleElement.textContent.trim() : document.title;
}

function getWishlistButton() {
  return (
    document.querySelector("#add_to_wishlist_area") ||
    document.querySelector("#add_to_wishlist_area_success") ||
    document.querySelector("#add_to_wishlist_area a") ||
    document.querySelector("a.queue_btn_wishlist")
  );
}

function getActiveWishlistContainer() {
  const area = document.querySelector("#add_to_wishlist_area");
  const success = document.querySelector("#add_to_wishlist_area_success");

  if (isElementVisible(success)) {
    return success;
  }

  return area;
}

function ensureAddButtonPosition() {
  const root = document.getElementById(EXT_ROOT_ID);
  if (!root) {
    return;
  }

  const container = getActiveWishlistContainer();
  if (!container) {
    return;
  }

  if (root.previousElementSibling !== container) {
    container.insertAdjacentElement("afterend", root);
  }
}

function getCommunityHubAnchor() {
  const candidates = Array.from(document.querySelectorAll("a, span, div"));
  for (const el of candidates) {
    const text = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (text === "community hub") {
      return el;
    }
  }
  return null;
}

function invalidateWishlistApiCache() {
  wishlistApiCache = null;
  wishlistApiCacheAt = 0;
}

async function fetchWishlistSetFromApi() {
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
      const normalized = new Set(wishlistArray.map((appId) => String(appId)));

      wishlistApiCache = normalized;
      wishlistApiCacheAt = Date.now();
      return normalized;
    })
    .finally(() => {
      wishlistApiInFlight = null;
    });

  return wishlistApiInFlight;
}

function isElementVisible(element) {
  if (!element) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  return element.offsetWidth > 0 || element.offsetHeight > 0;
}

function isOnSteamWishlistFromUi() {
  const area = document.querySelector("#add_to_wishlist_area");
  const successArea = document.querySelector("#add_to_wishlist_area_success");

  if (isElementVisible(successArea)) {
    return true;
  }

  const button = area?.querySelector("a, button");
  if (!button) {
    return false;
  }

  const buttonText = (button.textContent || "").toLowerCase();
  const ariaPressed = button.getAttribute("aria-pressed");

  const addActionPatterns = [
    /add to your wishlist/,
    /adicionar a( sua)? lista de desejos/,
    /adicionar a lista de desejos/
  ];

  const onWishlistPatterns = [
    /on wishlist/,
    /in your wishlist/,
    /na sua lista de desejos/,
    /em sua lista de desejos/
  ];

  if (addActionPatterns.some((pattern) => pattern.test(buttonText))) {
    return false;
  }

  if (onWishlistPatterns.some((pattern) => pattern.test(buttonText))) {
    return true;
  }

  return ariaPressed === "true";
}

async function isOnSteamWishlist(appId) {
  try {
    const wishlistSet = await fetchWishlistSetFromApi();
    return wishlistSet.has(appId);
  } catch {
    return isOnSteamWishlistFromUi();
  }
}

async function syncCollectionsWithWishlistApi() {
  const now = Date.now();
  if (now - lastGlobalPruneAt < GLOBAL_PRUNE_MIN_INTERVAL_MS) {
    return;
  }

  try {
    const wishlistSet = await fetchWishlistSetFromApi();
    lastGlobalPruneAt = Date.now();

    await browser.runtime.sendMessage({
      type: "prune-items-not-in-wishlist",
      appIds: Array.from(wishlistSet)
    });
  } catch {
    // Ignore sync failures and keep local state unchanged.
  }
}

function syncRemovalIfNotWishlisted(appId, onSteamWishlist) {
  if (onSteamWishlist) {
    return;
  }

  const now = Date.now();
  if (now - lastMembershipEnforceAt < MEMBERSHIP_ENFORCE_MIN_INTERVAL_MS) {
    return;
  }

  lastMembershipEnforceAt = now;
  browser.runtime
    .sendMessage({
      type: "remove-item-everywhere",
      appId
    })
    .catch(() => {});
}

async function updateTriggerAvailability(appId) {
  const triggerButton = document.getElementById("swcm-open-modal");
  if (!triggerButton) {
    return;
  }

  await syncCollectionsWithWishlistApi();

  const onSteamWishlist = await isOnSteamWishlist(appId);
  syncRemovalIfNotWishlisted(appId, onSteamWishlist);

  triggerButton.disabled = !onSteamWishlist;
  triggerButton.title = onSteamWishlist
    ? "Add this game to a collection"
    : "Game is not in Steam wishlist. Add it on Steam first.";
}

async function updateSaveAvailability(appId) {
  const saveButton = document.getElementById("swcm-save");
  if (!saveButton) {
    return;
  }

  await syncCollectionsWithWishlistApi();

  const onSteamWishlist = await isOnSteamWishlist(appId);
  syncRemovalIfNotWishlisted(appId, onSteamWishlist);

  saveButton.disabled = !onSteamWishlist;

  if (!onSteamWishlist) {
    setStatus("Game is not in Steam wishlist. Add it on Steam first.", true);
  }
}

function refreshAvailabilitySoon(appId) {
  if (wishlistStateRefreshTimer) {
    window.clearTimeout(wishlistStateRefreshTimer);
  }

  wishlistStateRefreshTimer = window.setTimeout(() => {
    wishlistStateRefreshTimer = 0;
    invalidateWishlistApiCache();
    updateTriggerAvailability(appId).catch(() => {});
    updateSaveAvailability(appId).catch(() => {});
  }, 60);
}

function observeWishlistState(appId) {
  const area = document.querySelector("#add_to_wishlist_area");
  const successArea = document.querySelector("#add_to_wishlist_area_success");
  const parent = area?.parentElement || null;

  const targets = [area, successArea, parent].filter(Boolean);
  if (!targets.length) {
    return;
  }

  if (wishlistStateObserver) {
    wishlistStateObserver.disconnect();
  }

  wishlistStateObserver = new MutationObserver(() => {
    ensureAddButtonPosition();
    refreshAvailabilitySoon(appId);
  });

  for (const target of targets) {
    wishlistStateObserver.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "aria-pressed"]
    });
  }
}

function createButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.id = "swcm-open-modal";
  button.className = "swcm-btn";
  button.textContent = "Add to Collection";
  return button;
}

function createModal() {
  const overlay = document.createElement("div");
  overlay.id = MODAL_ID;
  overlay.className = "swcm-overlay swcm-hidden";

  overlay.innerHTML = `
    <div class="swcm-modal" role="dialog" aria-modal="true" aria-label="Add game to collection">
      <h3>Steam Wishlist Collection</h3>
      <label>
        Existing collection
        <select id="swcm-collection-select"></select>
      </label>
      <label>
        Or create new
        <input id="swcm-new-collection" type="text" placeholder="e.g. Must Play" />
      </label>
      <label>
        Insert position
        <select id="swcm-position-select">
          <option value="end">End of collection</option>
          <option value="start">Beginning of collection</option>
        </select>
      </label>
      <p class="swcm-status">Sandbox mode: this only saves to extension data.</p>
      <div class="swcm-actions">
        <button id="swcm-cancel" type="button" class="swcm-btn swcm-btn-secondary">Cancel</button>
        <button id="swcm-save" type="button" class="swcm-btn">Save</button>
      </div>
      <p id="swcm-status" class="swcm-status" aria-live="polite"></p>
    </div>
  `;

  return overlay;
}

function createAppManageButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.id = APP_MANAGE_BUTTON_ID;
  button.className = "swcm-btn swcm-btn-inline";
  button.textContent = "Manage Collections";
  return button;
}

function createAppManageModal() {
  const overlay = document.createElement("div");
  overlay.id = APP_MANAGE_MODAL_ID;
  overlay.className = "swcm-overlay swcm-hidden";

  overlay.innerHTML = `
    <div class="swcm-modal" role="dialog" aria-modal="true" aria-label="Manage collections">
      <h3>Manage Collections</h3>
      <label>
        New collection name
        <input id="swcm-app-new-collection-name" type="text" placeholder="e.g. High Priority" />
      </label>
      <div class="swcm-actions swcm-actions-left">
        <button id="swcm-app-create-collection" type="button" class="swcm-btn">Create</button>
      </div>
      <label>
        Remove collection
        <select id="swcm-app-delete-collection-select"></select>
      </label>
      <div class="swcm-actions swcm-actions-left">
        <button id="swcm-app-delete-collection" type="button" class="swcm-btn swcm-btn-danger">Remove</button>
      </div>
      <div class="swcm-actions">
        <button id="swcm-app-close-collections" type="button" class="swcm-btn swcm-btn-secondary">Close</button>
      </div>
      <p id="swcm-app-collections-status" class="swcm-status" aria-live="polite"></p>
    </div>
  `;

  return overlay;
}

function setStatus(text, isError = false) {
  const status = document.getElementById("swcm-status");
  if (!status) {
    return;
  }

  status.textContent = text;
  status.classList.toggle("swcm-status-error", isError);
}

function setAppCollectionsStatus(text, isError = false) {
  const status = document.getElementById("swcm-app-collections-status");
  if (!status) {
    return;
  }

  status.textContent = text;
  status.classList.toggle("swcm-status-error", isError);
}

function openModal() {
  const modal = document.getElementById(MODAL_ID);
  modal?.classList.remove("swcm-hidden");
}

function closeModal() {
  const modal = document.getElementById(MODAL_ID);
  modal?.classList.add("swcm-hidden");
}

function openAppManageModal() {
  const modal = document.getElementById(APP_MANAGE_MODAL_ID);
  modal?.classList.remove("swcm-hidden");
}

function closeAppManageModal() {
  const modal = document.getElementById(APP_MANAGE_MODAL_ID);
  modal?.classList.add("swcm-hidden");
}

async function fillCollectionSelect() {
  const select = document.getElementById("swcm-collection-select");
  if (!select) {
    return;
  }

  const state = await browser.runtime.sendMessage({ type: "get-state" });
  const names = state.collectionOrder || [];

  select.innerHTML = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "-- choose collection --";
  select.appendChild(emptyOption);

  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
}

async function populateAppCollectionsSelect() {
  const select = document.getElementById("swcm-app-delete-collection-select");
  if (!select) {
    return;
  }

  const state = await browser.runtime.sendMessage({ type: "get-state" });
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

async function createCollectionFromAppModal() {
  const input = document.getElementById("swcm-app-new-collection-name");
  const collectionName = String(input?.value || "").trim();

  if (!collectionName) {
    setAppCollectionsStatus("Type a collection name.", true);
    return;
  }

  await browser.runtime.sendMessage({
    type: "create-collection",
    collectionName
  });

  if (input) {
    input.value = "";
  }

  setAppCollectionsStatus(`Collection "${collectionName}" created.`);
  await fillCollectionSelect();
  await populateAppCollectionsSelect();
}

async function deleteCollectionFromAppModal() {
  const select = document.getElementById("swcm-app-delete-collection-select");
  const collectionName = String(select?.value || "").trim();

  if (!collectionName) {
    setAppCollectionsStatus("Select a collection to remove.", true);
    return;
  }

  await browser.runtime.sendMessage({
    type: "delete-collection",
    collectionName
  });

  setAppCollectionsStatus(`Collection "${collectionName}" removed.`);
  await fillCollectionSelect();
  await populateAppCollectionsSelect();
}

async function saveToCollection(appId) {
  const onSteamWishlist = await isOnSteamWishlist(appId);
  syncRemovalIfNotWishlisted(appId, onSteamWishlist);

  if (!onSteamWishlist) {
    setStatus("Game is not in Steam wishlist. Add it on Steam first.", true);
    return;
  }

  if (!appId) {
    setStatus("Could not detect Steam app id on this page.", true);
    return;
  }

  const collectionSelect = document.getElementById("swcm-collection-select");
  const newCollectionInput = document.getElementById("swcm-new-collection");
  const positionSelect = document.getElementById("swcm-position-select");

  const collectionName =
    (newCollectionInput?.value || "").trim() || (collectionSelect?.value || "").trim();

  if (!collectionName) {
    setStatus("Choose an existing collection or type a new one.", true);
    return;
  }

  await browser.runtime.sendMessage({
    type: "add-or-move-item",
    appId,
    collectionName,
    position: positionSelect?.value === "start" ? "start" : "end",
    item: {
      title: getGameTitle()
    }
  });

  setStatus(`Saved locally to "${collectionName}".`);
  await fillCollectionSelect();
}

function attachAppManageUi() {
  if (!ENABLE_MANAGE_COLLECTIONS) {
    return;
  }

  if (!document.getElementById(APP_MANAGE_MODAL_ID)) {
    const modal = createAppManageModal();
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeAppManageModal();
      }
    });
    document.body.appendChild(modal);

    document.getElementById("swcm-app-close-collections")?.addEventListener("click", closeAppManageModal);
    document.getElementById("swcm-app-create-collection")?.addEventListener("click", () => {
      createCollectionFromAppModal().catch((error) => {
        setAppCollectionsStatus(error?.message || "Failed to create collection.", true);
      });
    });
    document.getElementById("swcm-app-delete-collection")?.addEventListener("click", () => {
      deleteCollectionFromAppModal().catch((error) => {
        setAppCollectionsStatus(error?.message || "Failed to remove collection.", true);
      });
    });
  }

  if (document.getElementById(APP_MANAGE_BUTTON_ID)) {
    return;
  }

  const manageButton = createAppManageButton();
  manageButton.addEventListener("click", async () => {
    setAppCollectionsStatus("");
    await populateAppCollectionsSelect();
    openAppManageModal();
  });

  const communityAnchor = getCommunityHubAnchor();
  if (communityAnchor) {
    const target = communityAnchor.closest("a") || communityAnchor;
    target.insertAdjacentElement("afterend", manageButton);
    return;
  }

  const root = document.getElementById(EXT_ROOT_ID);
  if (root) {
    root.insertAdjacentElement("afterend", manageButton);
  }
}

async function init() {
  if (document.getElementById(EXT_ROOT_ID)) {
    ensureAddButtonPosition();
    attachAppManageUi();
    return true;
  }

  const appId = getAppIdFromUrl();
  if (!appId) {
    return false;
  }

  const wishlistContainer = getActiveWishlistContainer() || getWishlistButton();
  if (!wishlistContainer) {
    return false;
  }

  const root = document.createElement("div");
  root.id = EXT_ROOT_ID;

  const button = createButton();
  button.addEventListener("click", async () => {
    if (button.disabled) {
      setStatus("Game is not in Steam wishlist. Add it on Steam first.", true);
      return;
    }

    await fillCollectionSelect();
    setStatus("");
    openModal();
    await updateSaveAvailability(appId);
  });

  const modal = createModal();
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  root.appendChild(button);
  document.body.appendChild(modal);

  const target = wishlistContainer;
  target.insertAdjacentElement("afterend", root);
  ensureAddButtonPosition();

  document.getElementById("swcm-cancel")?.addEventListener("click", closeModal);
  document.getElementById("swcm-save")?.addEventListener("click", () => {
    saveToCollection(appId).catch((error) => {
      setStatus(error?.message || "Failed to save game.", true);
    });
  });

  await updateTriggerAvailability(appId);
  observeWishlistState(appId);
  attachAppManageUi();

  return true;
}

async function bootstrap() {
  await init().catch(() => false);

  const observer = new MutationObserver(() => {
    init().catch(() => {});
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Periodic lightweight re-check for late Steam async UI replacements.
  window.setInterval(() => {
    init().catch(() => {});
  }, INIT_RETRY_INTERVAL_MS * MAX_INIT_ATTEMPTS);
}

bootstrap().catch(() => {});
