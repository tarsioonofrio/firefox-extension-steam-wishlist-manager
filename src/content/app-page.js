const EXT_ROOT_ID = "swcm-root";
const MODAL_ID = "swcm-modal";
const APP_MANAGE_BUTTON_ID = "swcm-manage-collections-app";
const APP_MANAGE_MODAL_ID = "swcm-collections-modal-app";
const ENABLE_MANAGE_COLLECTIONS = false;
const ENABLE_APP_PAGE_ADD_COLLECTION = false;
const QUEUE_MODE_ROOT_ID = "swm-queue-mode-root";
const QUEUE_MODE_STYLE_ID = "swm-queue-mode-style";
const QUEUE_MODE_ACTIONS_ID = "swm-queue-actions";
const QUEUE_MODE_STATUS_ID = "swm-queue-status";
const QUEUE_MODE_NEXT_ID = "swm-queue-next";
const QUEUE_MODE_TITLE_ID = "swm-queue-title";
const QUEUE_MODE_TITLE_LINK_CLASS = "swm-queue-title-link";
const QUEUE_MODE_TITLE_ROW_ID = "swm-queue-title-row";
const QUEUE_MODE_TITLE_LEFT_ID = "swm-queue-title-left";
const QUEUE_MODE_TITLE_ACTIONS_ID = "swm-queue-title-actions";

let queueModeState = null;
let queueNoiseObserver = null;

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
const NON_FATAL_LOG_WINDOW_MS = 15000;
const nonFatalLogAt = new Map();

function getQueueModeQuery() {
  const params = new URLSearchParams(window.location.search || "");
  const enabled = params.get("swm_queue") === "1";
  const sessionId = String(params.get("sid") || "").trim();
  const indexRaw = Number(params.get("i"));
  const index = Number.isFinite(indexRaw) ? Math.max(0, Math.floor(indexRaw)) : 0;
  return { enabled, sessionId, index };
}

function buildQueueModeAppUrl(appId, sessionId, index) {
  const url = new URL(`https://store.steampowered.com/app/${encodeURIComponent(String(appId || "").trim())}/`);
  url.searchParams.set("swm_queue", "1");
  url.searchParams.set("sid", String(sessionId || "").trim());
  url.searchParams.set("i", String(Math.max(0, Number(index) || 0)));
  return url.toString();
}

function getOriginalAppUrl(appId) {
  return `https://store.steampowered.com/app/${encodeURIComponent(String(appId || "").trim())}/`;
}

function setQueueModeStatus(text, isError = false) {
  const el = document.getElementById(QUEUE_MODE_STATUS_ID);
  if (!el) {
    return;
  }
  el.textContent = String(text || "");
  el.style.color = isError ? "#ff9b9b" : "#9ab8d3";
}

async function fetchQueueModeItem(sessionId, index) {
  return browser.runtime.sendMessage({
    type: "get-store-queue-item",
    sessionId: String(sessionId || "").trim(),
    index: Math.max(0, Number(index) || 0)
  });
}

function ensureQueueModeStyle() {
  if (document.getElementById(QUEUE_MODE_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = QUEUE_MODE_STYLE_ID;
  style.textContent = `
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: #0f1a24 !important;
      min-height: 100vh !important;
      overflow-x: hidden !important;
    }
    #${QUEUE_MODE_ROOT_ID} {
      box-sizing: border-box;
      width: min(1100px, 100%);
      margin: 0 auto;
      padding: 10px 12px 20px;
      color: #c7d5e0;
      font-family: "Motiva Sans", "Segoe UI", Arial, sans-serif;
    }
    #${QUEUE_MODE_ACTIONS_ID} {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 10px;
      margin-bottom: 10px;
    }
    #${QUEUE_MODE_TITLE_ROW_ID} {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      margin: 4px 0 6px;
    }
    #${QUEUE_MODE_TITLE_LEFT_ID} {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1 1 auto;
      flex-wrap: wrap;
    }
    #${QUEUE_MODE_TITLE_ID} {
      margin: 0;
      font-size: 34px;
      line-height: 1.1;
      font-weight: 300;
      letter-spacing: 0;
    }
    #${QUEUE_MODE_TITLE_ACTIONS_ID} {
      display: flex;
      align-items: center;
      gap: 8px;
      justify-content: flex-end;
      margin-left: auto;
      flex-wrap: wrap;
    }
    #${QUEUE_MODE_ACTIONS_ID} button,
    #${QUEUE_MODE_NEXT_ID} {
      border: 1px solid #2f445a;
      background: #2d4d6b;
      color: #d9ecff;
      border-radius: 4px;
      padding: 7px 12px;
      cursor: pointer;
      font-size: 13px;
      line-height: 1.2;
    }
    #${QUEUE_MODE_NEXT_ID} {
      margin-left: 10px;
      vertical-align: middle;
    }
    .${QUEUE_MODE_TITLE_LINK_CLASS} {
      color: inherit !important;
      text-decoration: none !important;
    }
    .${QUEUE_MODE_TITLE_LINK_CLASS}:hover {
      text-decoration: underline !important;
    }
    #${QUEUE_MODE_ROOT_ID} .blockbg,
    #${QUEUE_MODE_ROOT_ID} .apphub_OtherSiteInfo,
    #${QUEUE_MODE_ROOT_ID} .breadcrumbs,
    #${QUEUE_MODE_ROOT_ID} .apphub_HomeHeaderContent,
    #${QUEUE_MODE_ROOT_ID} .apphub_HeaderStandardTop,
    #${QUEUE_MODE_ROOT_ID} .apphub_AppIcon {
      display: none !important;
    }
    #${QUEUE_MODE_STATUS_ID} {
      display: inline-flex;
      align-items: center;
      margin: 0 0 0 8px;
      white-space: nowrap;
      font-size: 12px;
      color: #9ab8d3;
    }
  `;
  document.documentElement.appendChild(style);
}

function mountQueueModeLayout(pageTopArea, demoArea) {
  let root = document.getElementById(QUEUE_MODE_ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = QUEUE_MODE_ROOT_ID;
    document.body.appendChild(root);
  }

  const children = Array.from(document.body.children);
  for (const child of children) {
    if (child === root) {
      continue;
    }
    child.style.display = "none";
    child.setAttribute("data-swm-queue-hidden", "1");
  }

  root.innerHTML = "";
  if (pageTopArea) {
    root.appendChild(pageTopArea);
  }
  if (demoArea) {
    root.appendChild(demoArea);
  }
  return root;
}

function resolveQueueTitleText(appId) {
  const steamTitle = document.getElementById("appHubAppName") || document.querySelector(".apphub_AppName");
  const steamText = String(steamTitle?.textContent || "").trim();
  if (steamText) {
    return steamText;
  }
  const ogTitle = String(document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "")
    .replace(/\s+on\s+steam\s*$/i, "")
    .trim();
  if (ogTitle) {
    return ogTitle;
  }
  const docTitle = String(document.title || "")
    .replace(/\s*::\s*steam.*$/i, "")
    .replace(/\s+on\s+steam\s*$/i, "")
    .trim();
  if (docTitle) {
    return docTitle;
  }
  return `App ${String(appId || "").trim()}`;
}

function buildQueueTitleAndNext(appId) {
  const originalUrl = getOriginalAppUrl(appId);
  const titleEl = document.createElement("h1");
  titleEl.id = QUEUE_MODE_TITLE_ID;
  const link = document.createElement("a");
  link.className = QUEUE_MODE_TITLE_LINK_CLASS;
  link.href = originalUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = resolveQueueTitleText(appId);
  titleEl.appendChild(link);

  const nextBtn = document.createElement("button");
  nextBtn.id = QUEUE_MODE_NEXT_ID;
  nextBtn.type = "button";
  nextBtn.textContent = "Next";

  return { titleEl, nextBtn };
}

function stripQueueTopAreaNoise() {
  const noise = document.querySelectorAll(
    ".blockbg, .apphub_OtherSiteInfo, .breadcrumbs, .apphub_HomeHeaderContent, .apphub_HeaderStandardTop, .apphub_AppIcon"
  );
  for (const node of noise) {
    node.remove();
  }
}

function startQueueNoiseObserver() {
  if (queueNoiseObserver) {
    return;
  }
  queueNoiseObserver = new MutationObserver(() => {
    stripQueueTopAreaNoise();
  });
  queueNoiseObserver.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });
}

function ensureCapstoneLink(pageTopArea, appId) {
  if (!pageTopArea) {
    return null;
  }
  const originalUrl = getOriginalAppUrl(appId);
  const candidates = [
    ".game_background_glow img",
    ".game_header_image_full",
    ".game_capsule",
    ".game_page_background img",
    ".game_page_background"
  ];
  let capstone = null;
  for (const selector of candidates) {
    const el = pageTopArea.querySelector(selector);
    if (el) {
      capstone = el;
      break;
    }
  }
  if (!capstone) {
    return null;
  }
  const existingLink = capstone.closest("a[href]");
  if (existingLink) {
    existingLink.href = originalUrl;
    existingLink.target = "_blank";
    existingLink.rel = "noopener noreferrer";
    return capstone;
  }
  const wrapper = document.createElement("a");
  wrapper.href = originalUrl;
  wrapper.target = "_blank";
  wrapper.rel = "noopener noreferrer";
  wrapper.className = "swm-queue-capstone-link";
  if (capstone.parentNode) {
    capstone.parentNode.insertBefore(wrapper, capstone);
    wrapper.appendChild(capstone);
  }
  return capstone;
}

function createQueueActionButtons() {
  const root = document.createElement("div");
  root.id = QUEUE_MODE_ACTIONS_ID;
  root.innerHTML = `
    <button type="button" data-swm-action="confirm">Confirm</button>
    <button type="button" data-swm-action="follow">Follow</button>
    <button type="button" data-swm-action="cf">C*F</button>
    <button type="button" data-swm-action="none">None</button>
  `;
  return root;
}

async function applyQueueIntentAction(appId, action) {
  const id = String(appId || "").trim();
  if (!id) {
    throw new Error("Invalid app id.");
  }
  const payloadMap = {
    confirm: {
      buy: 2,
      track: 0,
      buyIntent: "BUY",
      trackIntent: "OFF",
      bucket: "BUY"
    },
    follow: {
      buy: 0,
      track: 1,
      buyIntent: "NONE",
      trackIntent: "ON",
      bucket: "TRACK"
    },
    cf: {
      buy: 2,
      track: 1,
      buyIntent: "BUY",
      trackIntent: "ON",
      bucket: "BUY"
    },
    none: {
      buy: 0,
      track: 0,
      buyIntent: "NONE",
      trackIntent: "OFF",
      bucket: "INBOX"
    }
  };
  const payload = payloadMap[String(action || "").trim().toLowerCase()];
  if (!payload) {
    throw new Error("Unknown queue action.");
  }
  const response = await browser.runtime.sendMessage({
    type: "set-item-intent",
    appId: id,
    ...payload,
    syncSteam: true,
    deferSteam: true,
    steamProxyAllowCreateTab: false,
    source: "queue-app-page"
  });
  if (!response?.ok) {
    throw new Error(String(response?.error || "Could not update intent."));
  }
}

function setQueueButtonsDisabled(disabled) {
  const all = Array.from(document.querySelectorAll(`#${QUEUE_MODE_ACTIONS_ID} button, #${QUEUE_MODE_NEXT_ID}`));
  for (const btn of all) {
    btn.disabled = Boolean(disabled);
  }
}

async function advanceQueueMode(step = 1) {
  if (!queueModeState) {
    return;
  }
  const nextIndex = Math.max(0, Number(queueModeState.index || 0) + Math.max(1, Number(step) || 1));
  const sessionId = String(queueModeState.sessionId || "").trim();
  const response = await fetchQueueModeItem(sessionId, nextIndex);
  if (!response?.ok || !response?.appId) {
    setQueueModeStatus("Queue finished.", false);
    setQueueButtonsDisabled(true);
    return;
  }
  window.location.replace(buildQueueModeAppUrl(response.appId, sessionId, Number(response.index || nextIndex)));
}

async function initQueueMode() {
  const query = getQueueModeQuery();
  if (!query.enabled) {
    return false;
  }
  const currentAppId = getAppIdFromUrl();
  if (!currentAppId) {
    return false;
  }
  ensureQueueModeStyle();
  const queueItem = await fetchQueueModeItem(query.sessionId, query.index);
  if (!queueItem?.ok) {
    throw new Error(String(queueItem?.error || "Queue session unavailable."));
  }
  const sessionId = String(queueItem.sessionId || query.sessionId || "").trim();
  const normalizedIndex = Number(queueItem.index || query.index || 0);
  queueModeState = {
    sessionId,
    index: normalizedIndex,
    total: Number(queueItem.total || 0),
    appId: String(queueItem.appId || currentAppId).trim()
  };
  const activeAppId = queueModeState.appId || currentAppId;
  if (activeAppId && activeAppId !== currentAppId) {
    window.location.replace(buildQueueModeAppUrl(activeAppId, sessionId, normalizedIndex));
    return true;
  }

  const pageTopArea = document.querySelector(".page_top_area");
  const demoArea = document.querySelector(".game_area_purchase_game.demo_above_purchase");
  if (!pageTopArea) {
    throw new Error("Could not find Steam page top area.");
  }
  mountQueueModeLayout(pageTopArea, demoArea || null);
  stripQueueTopAreaNoise();
  startQueueNoiseObserver();
  const { titleEl, nextBtn } = buildQueueTitleAndNext(activeAppId);
  ensureCapstoneLink(pageTopArea, activeAppId);

  const actionButtons = createQueueActionButtons();
  const status = document.createElement("p");
  status.id = QUEUE_MODE_STATUS_ID;
  status.textContent = `Queue ${normalizedIndex + 1}/${Math.max(1, Number(queueModeState.total || 1))}`;

  const titleRow = document.createElement("div");
  titleRow.id = QUEUE_MODE_TITLE_ROW_ID;
  const titleLeft = document.createElement("div");
  titleLeft.id = QUEUE_MODE_TITLE_LEFT_ID;
  const titleActions = document.createElement("div");
  titleActions.id = QUEUE_MODE_TITLE_ACTIONS_ID;

  titleLeft.appendChild(titleEl);
  if (nextBtn) {
    titleLeft.appendChild(nextBtn);
  }
  titleLeft.appendChild(status);
  titleActions.appendChild(actionButtons);
  titleRow.appendChild(titleLeft);
  titleRow.appendChild(titleActions);

  pageTopArea.insertAdjacentElement("afterbegin", titleRow);
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      setQueueButtonsDisabled(true);
      advanceQueueMode(1).catch((error) => {
        setQueueButtonsDisabled(false);
        setQueueModeStatus(String(error?.message || error || "Could not advance queue."), true);
      });
    });
  }

  actionButtons.addEventListener("click", (event) => {
    const btn = event.target instanceof Element ? event.target.closest("button[data-swm-action]") : null;
    if (!btn) {
      return;
    }
    const action = String(btn.getAttribute("data-swm-action") || "").trim();
    setQueueButtonsDisabled(true);
    applyQueueIntentAction(activeAppId, action)
      .then(() => advanceQueueMode(1))
      .catch((error) => {
        setQueueButtonsDisabled(false);
        setQueueModeStatus(String(error?.message || error || "Could not apply queue action."), true);
      });
  });

  setQueueModeStatus(`Queue ${normalizedIndex + 1}/${Math.max(1, Number(queueModeState.total || 1))}`);
  setTimeout(() => {
    stripQueueTopAreaNoise();
  }, 300);
  return true;
}

function reportNonFatal(scope, error) {
  const key = String(scope || "unknown");
  const now = Date.now();
  const last = Number(nonFatalLogAt.get(key) || 0);
  if (now - last < NON_FATAL_LOG_WINDOW_MS) {
    return;
  }
  nonFatalLogAt.set(key, now);
  const message = String(error?.message || error || "unknown error");
  console.debug(`[SWM app-page] ${key}: ${message}`);
}

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
  } catch (error) {
    reportNonFatal("wishlist-membership-api", error);
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
  } catch (error) {
    reportNonFatal("wishlist-prune-sync", error);
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
    .catch((error) => reportNonFatal("remove-item-everywhere", error));
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
    updateTriggerAvailability(appId).catch((error) => reportNonFatal("update-trigger-availability", error));
    updateSaveAvailability(appId).catch((error) => reportNonFatal("update-save-availability", error));
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
  try {
    const queueModeMounted = await initQueueMode();
    if (queueModeMounted) {
      return;
    }
  } catch (error) {
    reportNonFatal("queue-mode-bootstrap", error);
  }

  if (!ENABLE_APP_PAGE_ADD_COLLECTION) {
    return;
  }

  await init().catch((error) => {
    reportNonFatal("init-first-pass", error);
    return false;
  });

  const observer = new MutationObserver(() => {
    init().catch((error) => reportNonFatal("init-mutation-observer", error));
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Periodic lightweight re-check for late Steam async UI replacements.
  window.setInterval(() => {
    init().catch((error) => reportNonFatal("init-periodic", error));
  }, INIT_RETRY_INTERVAL_MS * MAX_INIT_ATTEMPTS);
}

bootstrap().catch((error) => reportNonFatal("bootstrap", error));
