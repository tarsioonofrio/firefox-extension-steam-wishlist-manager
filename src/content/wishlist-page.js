const WISHLIST_ADDED_CACHE_KEY = "steamWishlistAddedMapV3";
const ORDER_SYNC_INTERVAL_MS = 10 * 60 * 1000;
let domOrderSyncInFlight = false;

function withTimeout(promise, timeoutMs, label = "timeout") {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), timeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function encodeVarint(value) {
  let n = 0n;
  if (typeof value === "bigint") {
    n = value;
  } else if (typeof value === "string") {
    n = BigInt(value || "0");
  } else {
    n = BigInt(Number(value || 0));
  }
  if (n < 0n) {
    n = 0n;
  }
  const out = [];
  while (n >= 0x80n) {
    out.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  out.push(Number(n));
  return out;
}

function decodeVarint(bytes, startIndex) {
  let value = 0n;
  let shift = 0n;
  let index = startIndex;
  while (index < bytes.length) {
    const b = bytes[index];
    index += 1;
    value |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      return { value, next: index };
    }
    shift += 7n;
  }
  return null;
}

function encodeUtf8(text) {
  return new TextEncoder().encode(String(text || ""));
}

function concatBytes(chunks) {
  const size = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function fieldVarint(field, value) {
  return Uint8Array.from([
    ...encodeVarint((BigInt(field) << 3n) | 0n),
    ...encodeVarint(value)
  ]);
}

function fieldFixed64(field, value) {
  let n = 0n;
  if (typeof value === "bigint") {
    n = value;
  } else if (typeof value === "string") {
    n = BigInt(value || "0");
  } else {
    n = BigInt(Number(value || 0));
  }
  if (n < 0n) {
    n = 0n;
  }
  const out = [];
  for (let i = 0; i < 8; i += 1) {
    out.push(Number((n >> BigInt(i * 8)) & 0xffn));
  }
  return Uint8Array.from([
    ...encodeVarint((BigInt(field) << 3n) | 1n),
    ...out
  ]);
}

function fieldBytes(field, bytes) {
  return concatBytes([
    Uint8Array.from(encodeVarint((BigInt(field) << 3n) | 2n)),
    Uint8Array.from(encodeVarint(bytes.length)),
    bytes
  ]);
}

function toBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

async function pageWorldFetchBytes(url) {
  const targetUrl = String(url || "");
  const response = await withTimeout(fetch(targetUrl, {
    cache: "no-store",
    mode: "cors",
    credentials: "omit"
  }), 20000, "content fetch timeout");
  const status = Number(response?.status || 0);
  const buffer = await withTimeout(response.arrayBuffer(), 20000, "content arrayBuffer timeout");
  return {
    status,
    bytes: new Uint8Array(buffer)
  };
}

function decodeWishlistSortedFilteredItem(bytes) {
  const item = {
    appid: 0,
    priority: null,
    dateAdded: 0
  };
  let index = 0;
  while (index < bytes.length) {
    const tag = decodeVarint(bytes, index);
    if (!tag) {
      break;
    }
    index = tag.next;
    const field = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x7n);

    if (wireType === 0) {
      const value = decodeVarint(bytes, index);
      if (!value) {
        break;
      }
      index = value.next;
      const n = Number(value.value);
      if (field === 1) {
        item.appid = n;
      } else if (field === 2) {
        item.priority = n;
      } else if (field === 3) {
        item.dateAdded = n;
      }
      continue;
    }

    if (wireType === 2) {
      const len = decodeVarint(bytes, index);
      if (!len) {
        break;
      }
      index = len.next + Number(len.value);
      continue;
    }

    if (wireType === 5) {
      index += 4;
      continue;
    }
    if (wireType === 1) {
      index += 8;
      continue;
    }
    break;
  }
  return item;
}

function decodeWishlistSortedFilteredResponse(bytes) {
  const items = [];
  let index = 0;
  while (index < bytes.length) {
    const tag = decodeVarint(bytes, index);
    if (!tag) {
      break;
    }
    index = tag.next;
    const field = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x7n);

    if (field === 1 && wireType === 2) {
      const len = decodeVarint(bytes, index);
      if (!len) {
        break;
      }
      index = len.next;
      const itemBytes = bytes.subarray(index, index + Number(len.value));
      index += Number(len.value);
      const item = decodeWishlistSortedFilteredItem(itemBytes);
      if (Number.isFinite(item.appid) && item.appid > 0) {
        items.push(item);
      }
      continue;
    }

    if (wireType === 0) {
      const value = decodeVarint(bytes, index);
      if (!value) {
        break;
      }
      index = value.next;
      continue;
    }

    if (wireType === 2) {
      const len = decodeVarint(bytes, index);
      if (!len) {
        break;
      }
      index = len.next + Number(len.value);
      continue;
    }

    if (wireType === 5) {
      index += 4;
      continue;
    }
    if (wireType === 1) {
      index += 8;
      continue;
    }
    break;
  }
  return items;
}

function buildWishlistSortedFilteredRequest({ steamId, startIndex = 0, pageSize = 500 }) {
  const context = concatBytes([
    fieldBytes(1, encodeUtf8("english")),
    fieldBytes(3, encodeUtf8("BR"))
  ]);
  const dataRequest = concatBytes([
    fieldVarint(1, 1),
    fieldVarint(2, 1),
    fieldVarint(3, 1),
    fieldVarint(6, 1),
    fieldVarint(8, 20),
    fieldVarint(9, 1)
  ]);
  const filters = concatBytes([
    fieldVarint(25, 4),
    fieldVarint(25, 3)
  ]);

  return concatBytes([
    fieldFixed64(1, steamId),
    fieldBytes(2, context),
    fieldBytes(3, dataRequest),
    fieldBytes(5, filters),
    fieldVarint(6, startIndex),
    fieldVarint(7, pageSize)
  ]);
}

async function getCurrentWishlistContext() {
  const response = await withTimeout(fetch("https://store.steampowered.com/dynamicstore/userdata/", {
    cache: "no-store"
  }), 12000, "userdata fetch timeout");
  if (!response.ok) {
    return { steamId: "", wishlistIds: [] };
  }
  const data = await response.json();
  return {
    steamId: String(
    data?.steamid
    || data?.strSteamId
    || data?.str_steamid
    || data?.webapi_token_steamid
    || ""
    ).trim(),
    wishlistIds: Array.isArray(data?.rgWishlist)
      ? data.rgWishlist.map((id) => String(id || "").trim()).filter(Boolean)
      : []
  };
}

async function fetchWishlistOrderFromService(steamId, wishlistNowSet) {
  const orderedAppIds = [];
  const priorityMap = {};
  const pageSize = 500;
  const seen = new Set();

  for (let page = 0; page < 20; page += 1) {
    const requestBytes = buildWishlistSortedFilteredRequest({
      steamId,
      startIndex: page * pageSize,
      pageSize
    });
    const url = new URL("https://api.steampowered.com/IWishlistService/GetWishlistSortedFiltered/v1");
    url.searchParams.set("origin", "https://store.steampowered.com");
    url.searchParams.set("input_protobuf_encoded", toBase64(requestBytes));

    const pageResponse = await pageWorldFetchBytes(url.toString());
    if (!pageResponse || pageResponse.status < 200 || pageResponse.status >= 300) {
      throw new Error(`Wishlist order request failed (${pageResponse?.status || 0})`);
    }
    const bytes = pageResponse.bytes;
    const items = decodeWishlistSortedFilteredResponse(bytes);
    if (items.length === 0) {
      break;
    }

    for (const item of items) {
      const rawIdNum = Number(item.appid || 0);
      let appId = String(rawIdNum || "").trim();
      if (rawIdNum > 0 && wishlistNowSet && wishlistNowSet.size > 0 && !wishlistNowSet.has(appId) && rawIdNum % 10 === 0) {
        const div10 = String(Math.floor(rawIdNum / 10));
        if (wishlistNowSet.has(div10)) {
          appId = div10;
        }
      }
      if (!appId || seen.has(appId)) {
        continue;
      }
      seen.add(appId);
      orderedAppIds.push(appId);
      priorityMap[appId] = Number.isFinite(item.priority)
        ? Number(item.priority)
        : orderedAppIds.length - 1;
    }

    if (items.length < pageSize) {
      break;
    }
  }

  return { orderedAppIds, priorityMap };
}

async function syncWishlistOrderCache() {
  if (!window.location.pathname.startsWith("/wishlist")) {
    return;
  }

  try {
    const now = Date.now();
    const stored = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
    const cached = stored[WISHLIST_ADDED_CACHE_KEY] || {};
    const last = Number(cached.priorityCachedAt || 0);
    if (now - last < ORDER_SYNC_INTERVAL_MS) {
      return;
    }
    await browser.storage.local.set({
      [WISHLIST_ADDED_CACHE_KEY]: {
        ...cached,
        priorityLastError: "content-sync-started"
      }
    });

    const context = await getCurrentWishlistContext();
    const pathSteamIdMatch = window.location.pathname.match(/\/wishlist\/profiles\/(\d{10,20})/);
    const steamId = String(context.steamId || pathSteamIdMatch?.[1] || "").trim();
    const wishlistNowSet = new Set(context.wishlistIds || []);
    if (!steamId) {
      throw new Error("Could not resolve steamid in wishlist content sync.");
    }

    await browser.storage.local.set({
      [WISHLIST_ADDED_CACHE_KEY]: {
        ...cached,
        priorityLastError: "content-sync-fetching-order"
      }
    });

    const { orderedAppIds, priorityMap } = await fetchWishlistOrderFromService(steamId, wishlistNowSet);
    if (!Array.isArray(orderedAppIds) || orderedAppIds.length === 0) {
      throw new Error("Wishlist order service returned empty ordering.");
    }

    const storedLatest = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
    const cachedLatest = storedLatest[WISHLIST_ADDED_CACHE_KEY] || {};
    await browser.storage.local.set({
      [WISHLIST_ADDED_CACHE_KEY]: {
        ...cachedLatest,
        orderedAppIds,
        priorityMap,
        priorityCachedAt: now,
        priorityLastError: "",
        steamId
      }
    });
  } catch (error) {
    const storedOnError = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
    const cachedOnError = storedOnError[WISHLIST_ADDED_CACHE_KEY] || {};
    await browser.storage.local.set({
      [WISHLIST_ADDED_CACHE_KEY]: {
        ...cachedOnError,
        priorityLastError: String(error?.message || error || "wishlist content sync failed")
      }
    });
  }
}

function extractWishlistRowsOrderFromDom() {
  const ids = [];
  const seen = new Set();
  const rows = document.querySelectorAll(".wishlist_row, [id^='game_'], [data-app-id]");
  for (const row of rows) {
    const idText = String(row?.id || "");
    const dataAppId = String(row?.getAttribute?.("data-app-id") || "").trim();
    const match = idText.match(/game_(\d+)/);
    const appId = String(match?.[1] || dataAppId || "").trim();
    if (!appId || seen.has(appId)) {
      continue;
    }
    seen.add(appId);
    ids.push(appId);
  }
  return ids;
}

async function fetchWishlistIdsInPublicOrder(steamId) {
  const ordered = [];
  const seen = new Set();
  if (!/^\d{10,20}$/.test(String(steamId || ""))) {
    return ordered;
  }

  for (let pageIndex = 0; pageIndex < 200; pageIndex += 1) {
    const response = await withTimeout(fetch(
      `https://store.steampowered.com/wishlist/profiles/${steamId}/wishlistdata/?p=${pageIndex}`,
      {
        cache: "no-store",
        credentials: "include"
      }
    ), 12000, "wishlistdata fetch timeout");
    if (!response.ok) {
      break;
    }
    const raw = await withTimeout(response.text(), 12000, "wishlistdata text timeout");
    const idsInOrder = [];
    const localSeen = new Set();
    const re = /"(\d+)"\s*:/g;
    let match = null;
    while ((match = re.exec(raw)) !== null) {
      const appId = String(match[1] || "").trim();
      if (!appId || localSeen.has(appId)) {
        continue;
      }
      localSeen.add(appId);
      idsInOrder.push(appId);
    }
    if (idsInOrder.length === 0) {
      break;
    }
    for (const appId of idsInOrder) {
      if (seen.has(appId)) {
        continue;
      }
      seen.add(appId);
      ordered.push(appId);
    }
  }

  return ordered;
}

function clickWishlistLoadMoreIfVisible() {
  const btn = document.querySelector("#wishlist_ctn .btnv6_blue_hoverfade, #wishlist_bottom .btnv6_blue_hoverfade, .wishlist_load_more_button");
  if (!btn) {
    return false;
  }
  const hidden = btn.classList.contains("btn_disabled") || btn.getAttribute("style")?.includes("display: none");
  if (hidden) {
    return false;
  }
  btn.click();
  return true;
}

async function syncWishlistOrderFromDom(steamIdHint = "") {
  if (!window.location.pathname.startsWith("/wishlist")) {
    return { ok: false, error: "Not on wishlist page." };
  }
  if (domOrderSyncInFlight) {
    return { ok: false, error: "DOM wishlist sync already running." };
  }

  domOrderSyncInFlight = true;
  try {
    const stored = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
    const cached = stored[WISHLIST_ADDED_CACHE_KEY] || {};
    await browser.storage.local.set({
      [WISHLIST_ADDED_CACHE_KEY]: {
        ...cached,
        priorityLastError: "content-dom-sync-started"
      }
    });

    for (let i = 0; i < 80; i += 1) {
      if (document.querySelector(".wishlist_row, [id^='game_'], [data-app-id]")) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    window.scrollTo({ top: 0, behavior: "auto" });
    let lastCount = 0;
    let stableRounds = 0;
    let rounds = 0;
    let sameHeightRounds = 0;
    let lastHeight = 0;
    while (rounds < 600) {
      rounds += 1;
      clickWishlistLoadMoreIfVisible();
      const scroller = document.scrollingElement || document.documentElement || document.body;
      const step = Math.max(500, Math.floor(window.innerHeight * 0.8));
      const nextTop = Math.min(scroller.scrollTop + step, scroller.scrollHeight);
      window.scrollTo({ top: nextTop, behavior: "auto" });
      await withTimeout(new Promise((resolve) => setTimeout(resolve, 450)), 2000, "dom sync wait timeout");

      const currentIds = extractWishlistRowsOrderFromDom();
      if (currentIds.length === lastCount) {
        stableRounds += 1;
      } else {
        stableRounds = 0;
        lastCount = currentIds.length;
      }

      const currentHeight = Math.max(
        Number(document.body?.scrollHeight || 0),
        Number(document.documentElement?.scrollHeight || 0)
      );
      if (currentHeight === lastHeight) {
        sameHeightRounds += 1;
      } else {
        sameHeightRounds = 0;
        lastHeight = currentHeight;
      }

      const nearBottom = (scroller.scrollTop + window.innerHeight) >= (scroller.scrollHeight - 200);
      if (stableRounds >= 24 && sameHeightRounds >= 16 && nearBottom) {
        break;
      }
    }

    const pathSteamIdMatch = window.location.pathname.match(/\/wishlist\/profiles\/(\d{10,20})/);
    const steamId = String(steamIdHint || pathSteamIdMatch?.[1] || cached.steamId || "").trim();
    let orderedAppIds = extractWishlistRowsOrderFromDom();
    if (!Array.isArray(orderedAppIds) || orderedAppIds.length === 0) {
      orderedAppIds = await fetchWishlistIdsInPublicOrder(steamId);
    }
    if (!Array.isArray(orderedAppIds) || orderedAppIds.length === 0) {
      throw new Error("Could not read wishlist rows from DOM.");
    }

    const priorityMap = {};
    for (let i = 0; i < orderedAppIds.length; i += 1) {
      priorityMap[orderedAppIds[i]] = i;
    }

    const now = Date.now();
    const storedLatest = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
    const cachedLatest = storedLatest[WISHLIST_ADDED_CACHE_KEY] || {};
    await browser.storage.local.set({
      [WISHLIST_ADDED_CACHE_KEY]: {
        ...cachedLatest,
        orderedAppIds,
        priorityMap,
        priorityCachedAt: now,
        priorityLastError: "",
        steamId
      }
    });

    return { ok: true, updated: orderedAppIds.length, cachedAt: now };
  } catch (error) {
    const storedOnError = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
    const cachedOnError = storedOnError[WISHLIST_ADDED_CACHE_KEY] || {};
    await browser.storage.local.set({
      [WISHLIST_ADDED_CACHE_KEY]: {
        ...cachedOnError,
        priorityLastError: String(error?.message || error || "wishlist dom sync failed")
      }
    });
    return { ok: false, error: String(error?.message || error || "wishlist dom sync failed") };
  } finally {
    domOrderSyncInFlight = false;
  }
}

async function getStoreSessionIdFromPage() {
  const response = await withTimeout(fetch("https://store.steampowered.com/account/preferences", {
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "text/html"
    }
  }), 12000, "preferences fetch timeout");
  if (!response.ok) {
    throw new Error(`Could not load session page (${response.status}).`);
  }
  const html = await withTimeout(response.text(), 12000, "preferences text timeout");
  const match = html.match(/g_sessionID\s*=\s*"([^"]+)"/i);
  const sessionId = String(match?.[1] || "").trim();
  if (!sessionId) {
    throw new Error("Could not resolve Steam session id from page.");
  }
  return sessionId;
}

async function proxyReadUserdata() {
  const params = new URLSearchParams();
  params.set("_", String(Date.now()));
  const response = await withTimeout(fetch(
    `https://store.steampowered.com/dynamicstore/userdata/?${params.toString()}`,
    {
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "text/html"
      }
    }
  ), 12000, "userdata fetch timeout");
  if (!response.ok) {
    throw new Error(`Could not read Steam userdata (${response.status}).`);
  }
  const data = await withTimeout(response.json(), 12000, "userdata json timeout");
  return {
    rgWishlist: Array.isArray(data?.rgWishlist) ? data.rgWishlist : [],
    rgFollowedApps: Array.isArray(data?.rgFollowedApps) ? data.rgFollowedApps : []
  };
}

async function proxyWriteSteamAction(action, appId) {
  const act = String(action || "").trim();
  const id = String(appId || "").trim();
  if (!id) {
    throw new Error("Invalid appId.");
  }
  const sessionId = await getStoreSessionIdFromPage();
  let url = "";
  const form = new FormData();
  form.set("sessionid", sessionId);
  form.set("appid", id);
  if (act === "wishlist-add") {
    url = "https://store.steampowered.com/api/addtowishlist";
  } else if (act === "wishlist-remove") {
    url = "https://store.steampowered.com/api/removefromwishlist";
  } else if (act === "follow-on") {
    url = "https://store.steampowered.com/explore/followgame/";
  } else if (act === "follow-off") {
    url = "https://store.steampowered.com/explore/followgame/";
    form.set("unfollow", "1");
  } else {
    throw new Error("Unsupported action.");
  }

  const response = await withTimeout(fetch(url, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    body: form,
    headers: {
      "X-Requested-With": "SteamWishlistManager"
    }
  }), 12000, "write action timeout");
  const status = Number(response?.status || 0);
  const rawText = await withTimeout(response.text(), 12000, "write action text timeout");
  let body = null;
  if (rawText) {
    try {
      body = JSON.parse(rawText);
    } catch {
      body = rawText;
    }
  }
  const success = body === true
    || body?.success === true
    || Number(body?.success) > 0
    || body?.result === 1;
  return {
    ok: status >= 200 && status < 300 && success,
    status,
    body
  };
}

browser.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  if (message.type === "sync-wishlist-order-from-dom") {
    return syncWishlistOrderFromDom(String(message.steamId || ""));
  }
  if (message.type === "steam-proxy-read-userdata") {
    return proxyReadUserdata();
  }
  if (message.type === "steam-proxy-write-action") {
    return proxyWriteSteamAction(String(message.action || ""), String(message.appId || ""));
  }
  return undefined;
});

if (window.location.pathname.startsWith("/wishlist")) {
  const profileMatch = window.location.pathname.match(/\/wishlist\/profiles\/(\d{10,20})/);
  if (profileMatch?.[1]) {
    browser.runtime.sendMessage({
      type: "set-wishlist-steamid",
      steamId: profileMatch[1]
    }).catch(() => {});
  }
  syncWishlistOrderCache();
}
