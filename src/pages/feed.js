const TRACK_FEED_CACHE_KEY = "steamWishlistTrackFeedV1";
const TRACK_FEED_META_KEY = "steamWishlistTrackFeedMetaV1";
const TRACK_FEED_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

const steamFetchUtils = window.SWMSteamFetch;
let state = null;
let feedEntries = [];
let hideMuted = false;
let windowDays = 30;
let searchQuery = "";

function setStatus(message, isError = false) {
  const el = document.getElementById("status");
  if (!el) {
    return;
  }
  el.textContent = String(message || "");
  el.style.color = isError ? "#ff9696" : "#9db5c9";
}

function getIntent(appId) {
  const item = state?.items?.[appId] || {};
  const track = Number(item.track || 0) > 0 ? 1 : 0;
  const buyRaw = Number(item.buy || 0);
  const buy = buyRaw >= 2 ? 2 : (buyRaw > 0 ? 1 : 0);
  const labels = Array.isArray(item.labels) ? item.labels.map((x) => String(x || "").toLowerCase()) : [];
  return {
    track,
    buy,
    muted: Boolean(item.muted),
    owned: labels.includes("owned")
  };
}

function parseWindowDays(value) {
  const n = Number(value || 30);
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  return n <= 7 ? 7 : 30;
}

function formatFeedDate(timestampSec) {
  const n = Number(timestampSec || 0);
  if (!Number.isFinite(n) || n <= 0) {
    return "-";
  }
  return new Date(n * 1000).toLocaleString("pt-BR");
}

async function loadState() {
  state = await browser.runtime.sendMessage({ type: "get-state" });
}

async function loadFeedCache() {
  const stored = await browser.storage.local.get([TRACK_FEED_CACHE_KEY, TRACK_FEED_META_KEY]);
  const entries = Array.isArray(stored?.[TRACK_FEED_CACHE_KEY]) ? stored[TRACK_FEED_CACHE_KEY] : [];
  feedEntries = entries
    .map((entry) => ({
      eventId: String(entry?.eventId || ""),
      appId: String(entry?.appId || ""),
      title: String(entry?.title || ""),
      summary: String(entry?.summary || ""),
      url: String(entry?.url || ""),
      publishedAt: Number(entry?.publishedAt || 0)
    }))
    .filter((entry) => entry.eventId && entry.appId && entry.url);
  const lastRefreshedAt = Number(stored?.[TRACK_FEED_META_KEY]?.lastRefreshedAt || 0);
  if (lastRefreshedAt > 0) {
    setStatus(`Last refresh: ${new Date(lastRefreshedAt).toLocaleString("pt-BR")} | events: ${feedEntries.length}`);
  } else {
    setStatus(`Feed cache not refreshed yet | events: ${feedEntries.length}`);
  }
}

function getTrackedAppIds() {
  const out = [];
  for (const appId of Object.keys(state?.items || {})) {
    const intent = getIntent(appId);
    if (intent.track > 0 && !intent.owned) {
      out.push(appId);
    }
  }
  return out;
}

async function refreshFeed() {
  const appIds = getTrackedAppIds();
  if (appIds.length === 0) {
    setStatus("No tracked games to refresh.");
    return;
  }
  const existingMap = new Map(feedEntries.map((entry) => [entry.eventId, entry]));
  const nextMap = new Map(existingMap);
  let done = 0;
  for (const appId of appIds) {
    const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${encodeURIComponent(appId)}&count=5&maxlength=0&format=json`;
    try {
      const payload = await steamFetchUtils.fetchJson(url, { credentials: "omit", cache: "no-store" });
      const newsItems = Array.isArray(payload?.appnews?.newsitems) ? payload.appnews.newsitems : [];
      for (const item of newsItems) {
        const gid = String(item?.gid || "").trim();
        if (!gid) {
          continue;
        }
        const title = String(item?.title || "").trim();
        const contents = String(item?.contents || "").replace(/\s+/g, " ").trim();
        const summary = contents.slice(0, 360);
        const urlValue = String(item?.url || "").trim();
        const published = Number(item?.date || 0);
        nextMap.set(gid, {
          eventId: gid,
          appId,
          title,
          summary,
          url: urlValue,
          publishedAt: published
        });
      }
    } catch {
      // Best effort refresh.
    }
    done += 1;
    setStatus(`Refreshing feed... ${done}/${appIds.length}`);
  }

  const retentionCutoffSec = Math.floor((Date.now() - (60 * 24 * 60 * 60 * 1000)) / 1000);
  feedEntries = Array.from(nextMap.values())
    .filter((entry) => Number(entry.publishedAt || 0) >= retentionCutoffSec)
    .sort((a, b) => Number(b.publishedAt || 0) - Number(a.publishedAt || 0))
    .slice(0, 4000);

  await browser.storage.local.set({
    [TRACK_FEED_CACHE_KEY]: feedEntries,
    [TRACK_FEED_META_KEY]: {
      lastRefreshedAt: Date.now(),
      source: "track-feed-page-v1"
    }
  });
  setStatus(`Feed refreshed. ${feedEntries.length} events.`);
}

async function setIntent(appId, patch) {
  const item = state?.items?.[appId] || {};
  await browser.runtime.sendMessage({
    type: "set-item-intent",
    appId,
    title: String(item?.title || ""),
    ...patch
  });
  await loadState();
}

function render() {
  const listEl = document.getElementById("list");
  const emptyEl = document.getElementById("empty");
  if (!listEl || !emptyEl) {
    return;
  }
  const cutoffSec = windowDays > 0 ? Math.floor(Date.now() / 1000) - (windowDays * 24 * 60 * 60) : 0;
  const q = String(searchQuery || "").trim().toLowerCase();
  const filtered = feedEntries.filter((entry) => {
    const intent = getIntent(entry.appId);
    if (!(intent.track > 0) || intent.owned) {
      return false;
    }
    if (hideMuted && intent.muted) {
      return false;
    }
    if (cutoffSec > 0 && Number(entry.publishedAt || 0) < cutoffSec) {
      return false;
    }
    if (!q) {
      return true;
    }
    const title = String(state?.items?.[entry.appId]?.title || "");
    const hay = `${entry.title} ${entry.summary} ${title} ${entry.appId}`.toLowerCase();
    return hay.includes(q);
  });

  listEl.innerHTML = "";
  emptyEl.classList.toggle("hidden", filtered.length > 0);

  for (const entry of filtered) {
    const row = document.createElement("article");
    row.className = "feed-row";
    const intent = getIntent(entry.appId);

    const head = document.createElement("div");
    head.className = "head";
    const link = document.createElement("a");
    link.className = "title";
    link.href = entry.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = entry.title || "(untitled)";
    const meta = document.createElement("span");
    meta.className = "meta";
    const appTitle = String(state?.items?.[entry.appId]?.title || `App ${entry.appId}`);
    meta.textContent = `${appTitle} | ${formatFeedDate(entry.publishedAt)}`;
    head.appendChild(link);
    head.appendChild(meta);

    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = entry.summary || "-";

    const actions = document.createElement("div");
    actions.className = "actions";
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = "Open post";
    openBtn.addEventListener("click", () => window.open(entry.url, "_blank", "noopener"));

    const trackBtn = document.createElement("button");
    trackBtn.type = "button";
    trackBtn.textContent = intent.track > 0 ? "Untrack" : "Track";
    trackBtn.addEventListener("click", async () => {
      await setIntent(entry.appId, { track: intent.track > 0 ? 0 : 1 });
      render();
    });

    const muteBtn = document.createElement("button");
    muteBtn.type = "button";
    muteBtn.textContent = intent.muted ? "Unmute" : "Mute";
    muteBtn.addEventListener("click", async () => {
      await setIntent(entry.appId, { muted: !intent.muted });
      render();
    });

    const buyBtn = document.createElement("button");
    buyBtn.type = "button";
    buyBtn.textContent = "Buy";
    buyBtn.addEventListener("click", async () => {
      await setIntent(entry.appId, { buy: 2 });
      render();
    });

    const maybeBtn = document.createElement("button");
    maybeBtn.type = "button";
    maybeBtn.textContent = "Maybe";
    maybeBtn.addEventListener("click", async () => {
      await setIntent(entry.appId, { buy: 1 });
      render();
    });

    const clearBuyBtn = document.createElement("button");
    clearBuyBtn.type = "button";
    clearBuyBtn.textContent = "Clear buy";
    clearBuyBtn.addEventListener("click", async () => {
      await setIntent(entry.appId, { buy: 0 });
      render();
    });

    actions.appendChild(openBtn);
    actions.appendChild(trackBtn);
    actions.appendChild(muteBtn);
    actions.appendChild(buyBtn);
    actions.appendChild(maybeBtn);
    actions.appendChild(clearBuyBtn);

    row.appendChild(head);
    row.appendChild(summary);
    row.appendChild(actions);
    listEl.appendChild(row);
  }
}

async function init() {
  await loadState();
  await loadFeedCache();
  render();

  const lastRefreshedAge = Number(Date.now() - Number((await browser.storage.local.get(TRACK_FEED_META_KEY))?.[TRACK_FEED_META_KEY]?.lastRefreshedAt || 0));
  if (!Number.isFinite(lastRefreshedAge) || lastRefreshedAge > TRACK_FEED_REFRESH_INTERVAL_MS) {
    refreshFeed().then(render).catch(() => {});
  }

  document.getElementById("refresh-btn")?.addEventListener("click", async () => {
    await refreshFeed();
    render();
  });
  document.getElementById("hide-muted")?.addEventListener("change", (event) => {
    hideMuted = Boolean(event?.target?.checked);
    render();
  });
  document.getElementById("window-days")?.addEventListener("change", (event) => {
    windowDays = parseWindowDays(event?.target?.value);
    render();
  });
  document.getElementById("search")?.addEventListener("input", (event) => {
    searchQuery = String(event?.target?.value || "");
    render();
  });
}

init().catch((error) => {
  setStatus(String(error?.message || "Failed to load feed page."), true);
});
