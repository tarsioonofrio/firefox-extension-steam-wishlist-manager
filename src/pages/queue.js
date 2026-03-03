const WISHLIST_ADDED_CACHE_KEY = "steamWishlistAddedMapV3";
const SOURCE_KEY = "swmQueueSourceV1";
const SEARCH_KEY = "swmQueueSearchV1";
const INDEX_KEY = "swmQueueIndexV1";

const steamFetchUtils = window.SWMSteamFetch || {};

let state = null;
let wishlistOrderedIds = [];
let queueIds = [];
let queueIndex = 0;
let mediaState = { mode: "video", index: 0, videos: [], images: [] };
let mediaSeq = 0;
const metaCache = new Map();

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
  const rawTrackIntent = String(item.trackIntent || "").trim().toUpperCase();
  const rawBuyIntent = String(item.buyIntent || "").trim().toUpperCase();
  const track = rawTrackIntent === "ON" ? 1 : (rawTrackIntent === "OFF" ? 0 : (Number(item.track || 0) > 0 ? 1 : 0));
  const buyRaw = Number(item.buy || 0);
  const buy = rawBuyIntent === "BUY"
    ? 2
    : (rawBuyIntent === "MAYBE" ? 1 : (buyRaw >= 2 ? 2 : (buyRaw > 0 ? 1 : 0)));
  const labels = Array.isArray(item.labels) ? item.labels.map((x) => String(x || "").toLowerCase()) : [];
  return {
    track,
    buy,
    owned: labels.includes("owned"),
    targetPriceCents: Number.isFinite(Number(item.targetPriceCents)) ? Number(item.targetPriceCents) : null
  };
}

function getSelectedSource() {
  const select = document.getElementById("source-select");
  return String(select?.value || "wishlist");
}

function getSearchQuery() {
  const input = document.getElementById("search-input");
  return String(input?.value || "").trim().toLowerCase();
}

function persistUiState() {
  try {
    localStorage.setItem(SOURCE_KEY, getSelectedSource());
    localStorage.setItem(SEARCH_KEY, document.getElementById("search-input")?.value || "");
    localStorage.setItem(INDEX_KEY, String(queueIndex));
  } catch {
    // noop
  }
}

function hydrateUiState() {
  try {
    const source = String(localStorage.getItem(SOURCE_KEY) || "wishlist");
    const query = String(localStorage.getItem(SEARCH_KEY) || "");
    const index = Number(localStorage.getItem(INDEX_KEY) || 0);
    const sourceEl = document.getElementById("source-select");
    const searchEl = document.getElementById("search-input");
    if (sourceEl) {
      sourceEl.value = source;
    }
    if (searchEl) {
      searchEl.value = query;
    }
    if (Number.isFinite(index) && index >= 0) {
      queueIndex = Math.floor(index);
    }
  } catch {
    // noop
  }
}

async function loadState() {
  state = await browser.runtime.sendMessage({ type: "get-state" });
}

async function loadWishlistOrder() {
  const stored = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
  const ordered = stored?.[WISHLIST_ADDED_CACHE_KEY]?.orderedAppIds;
  wishlistOrderedIds = Array.isArray(ordered) ? ordered.map((id) => String(id || "").trim()).filter(Boolean) : [];
  if (wishlistOrderedIds.length > 0) {
    return;
  }
  try {
    const fetchJson = steamFetchUtils.fetchJson || ((url, options = {}) => fetch(url, options).then((r) => r.json()));
    const userdata = await fetchJson("https://store.steampowered.com/dynamicstore/userdata/", {
      credentials: "include",
      cache: "no-store"
    });
    const ids = Array.isArray(userdata?.rgWishlist)
      ? userdata.rgWishlist.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    wishlistOrderedIds = ids;
  } catch {
    wishlistOrderedIds = [];
  }
}

function buildQueueIds() {
  const source = getSelectedSource();
  const q = getSearchQuery();
  const allKnownIds = new Set(Object.keys(state?.items || {}).map((id) => String(id || "").trim()).filter(Boolean));
  const order = wishlistOrderedIds.length > 0 ? wishlistOrderedIds : Array.from(allKnownIds);
  for (const id of order) {
    allKnownIds.add(id);
  }
  const out = [];
  const seen = new Set();
  for (const appId of order) {
    if (!appId || seen.has(appId)) {
      continue;
    }
    const item = state?.items?.[appId] || {};
    const title = String(item.title || "").toLowerCase();
    const intent = getIntent(appId);
    if (source === "confirmed" && intent.buy !== 2) {
      continue;
    }
    if (source === "maybe" && intent.buy !== 1) {
      continue;
    }
    if (source === "track" && intent.track <= 0) {
      continue;
    }
    if (source === "archive" && !intent.owned) {
      continue;
    }
    if (q && !(`${title} ${appId}`).includes(q)) {
      continue;
    }
    out.push(appId);
    seen.add(appId);
  }
  if (source !== "wishlist") {
    for (const appId of allKnownIds) {
      if (!appId || seen.has(appId)) {
        continue;
      }
      const item = state?.items?.[appId] || {};
      const title = String(item.title || "").toLowerCase();
      const intent = getIntent(appId);
      if (source === "confirmed" && intent.buy !== 2) {
        continue;
      }
      if (source === "maybe" && intent.buy !== 1) {
        continue;
      }
      if (source === "track" && intent.track <= 0) {
        continue;
      }
      if (source === "archive" && !intent.owned) {
        continue;
      }
      if (q && !(`${title} ${appId}`).includes(q)) {
        continue;
      }
      out.push(appId);
      seen.add(appId);
    }
  }
  queueIds = out;
  if (queueIndex >= queueIds.length) {
    queueIndex = Math.max(0, queueIds.length - 1);
  }
  persistUiState();
}

async function fetchMeta(appId) {
  if (metaCache.has(appId)) {
    return metaCache.get(appId);
  }
  const fallback = {
    titleText: "",
    releaseText: "-",
    reviewText: "No user reviews",
    priceText: "-",
    discountText: "-",
    tags: []
  };
  try {
    const fetchJson = steamFetchUtils.fetchJson || ((url, options = {}) => fetch(url, options).then((r) => r.json()));
    const payload = await fetchJson(
      `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&cc=br&l=en`,
      { cache: "no-store", credentials: "include" }
    );
    const appData = payload?.[appId]?.data || null;
    if (!appData) {
      metaCache.set(appId, fallback);
      return fallback;
    }
    const reviewPayload = await fetchJson(
      `https://store.steampowered.com/appreviews/${encodeURIComponent(appId)}?json=1&language=all&purchase_type=all&num_per_page=0`,
      { cache: "no-store" }
    ).catch(() => ({}));
    const summary = reviewPayload?.query_summary || {};
    const totalPositive = Number(summary?.total_positive || 0);
    const totalNegative = Number(summary?.total_negative || 0);
    const totalVotes = totalPositive + totalNegative;
    const positivePct = totalVotes > 0 ? Math.round((totalPositive / totalVotes) * 100) : 0;
    const genres = Array.isArray(appData?.genres) ? appData.genres.map((x) => String(x?.description || "").trim()).filter(Boolean) : [];
    const categories = Array.isArray(appData?.categories) ? appData.categories.map((x) => String(x?.description || "").trim()).filter(Boolean) : [];
    const meta = {
      titleText: String(appData?.name || "").trim(),
      releaseText: String(appData?.release_date?.date || (appData?.release_date?.coming_soon ? "Coming soon" : "-")),
      reviewText: totalVotes > 0 ? `${positivePct}% positive (${totalVotes} reviews)` : "No user reviews",
      priceText: appData?.is_free === true
        ? "Free"
        : (String(appData?.price_overview?.final_formatted || "").trim() || (appData?.release_date?.coming_soon ? "Not announced" : "-")),
      discountText: Number(appData?.price_overview?.discount_percent || 0) > 0
        ? `${Number(appData.price_overview.discount_percent)}% off`
        : "-",
      tags: Array.from(new Set([...genres, ...categories])).slice(0, 12)
    };
    metaCache.set(appId, meta);
    return meta;
  } catch {
    metaCache.set(appId, fallback);
    return fallback;
  }
}

async function fetchMedia(appId) {
  const fetchJson = steamFetchUtils.fetchJson || ((url, options = {}) => fetch(url, options).then((r) => r.json()));
  try {
    const payload = await fetchJson(
      `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&l=english&filters=movies,screenshots`,
      { cache: "no-store", credentials: "include" }
    );
    const appData = payload?.[appId]?.data || {};
    const videos = [];
    for (const movie of Array.isArray(appData?.movies) ? appData.movies : []) {
      const src = String(
        movie?.mp4?.max
        || movie?.mp4?.["480"]
        || movie?.webm?.max
        || movie?.webm?.["480"]
        || ""
      ).trim();
      if (!src) {
        continue;
      }
      videos.push({
        url: src,
        posterUrl: String(movie?.thumbnail || movie?.highlight_thumbnail || "").trim()
      });
    }
    const images = [];
    for (const shot of Array.isArray(appData?.screenshots) ? appData.screenshots : []) {
      const src = String(shot?.path_full || shot?.path_thumbnail || "").trim();
      if (!src) {
        continue;
      }
      images.push(src);
    }
    return { videos, images };
  } catch {
    return { videos: [], images: [] };
  }
}

function renderMedia() {
  const videoEl = document.getElementById("media-video");
  const imageEl = document.getElementById("media-image");
  const countEl = document.getElementById("media-count");
  const videoBtn = document.getElementById("mode-video-btn");
  const imageBtn = document.getElementById("mode-image-btn");
  const prevBtn = document.getElementById("media-prev-btn");
  const nextBtn = document.getElementById("media-next-btn");
  const list = mediaState.mode === "video" ? mediaState.videos : mediaState.images;
  const total = Array.isArray(list) ? list.length : 0;
  if (!Array.isArray(list) || total === 0) {
    videoEl?.pause();
    if (videoEl) {
      videoEl.classList.add("hidden");
      videoEl.removeAttribute("src");
      videoEl.load();
    }
    if (imageEl) {
      imageEl.classList.add("hidden");
      imageEl.removeAttribute("src");
    }
    if (countEl) {
      countEl.textContent = "0/0";
    }
    if (prevBtn) {
      prevBtn.disabled = true;
    }
    if (nextBtn) {
      nextBtn.disabled = true;
    }
    if (videoBtn) {
      videoBtn.classList.toggle("active", mediaState.mode === "video");
      videoBtn.disabled = (mediaState.videos || []).length === 0;
    }
    if (imageBtn) {
      imageBtn.classList.toggle("active", mediaState.mode === "image");
      imageBtn.disabled = (mediaState.images || []).length === 0;
    }
    return;
  }
  mediaState.index = Math.max(0, Math.min(total - 1, Number(mediaState.index || 0)));
  if (countEl) {
    countEl.textContent = `${mediaState.index + 1}/${total}`;
  }
  if (prevBtn) {
    prevBtn.disabled = total < 2;
  }
  if (nextBtn) {
    nextBtn.disabled = total < 2;
  }
  if (videoBtn) {
    videoBtn.classList.toggle("active", mediaState.mode === "video");
    videoBtn.disabled = (mediaState.videos || []).length === 0;
  }
  if (imageBtn) {
    imageBtn.classList.toggle("active", mediaState.mode === "image");
    imageBtn.disabled = (mediaState.images || []).length === 0;
  }

  if (mediaState.mode === "video") {
    const video = mediaState.videos[mediaState.index] || {};
    if (imageEl) {
      imageEl.classList.add("hidden");
      imageEl.removeAttribute("src");
    }
    if (videoEl) {
      videoEl.classList.remove("hidden");
      videoEl.src = String(video.url || "");
      videoEl.poster = String(video.posterUrl || "");
      videoEl.loop = mediaState.videos.length <= 1;
      videoEl.play().catch(() => {});
    }
  } else {
    const image = String(mediaState.images[mediaState.index] || "");
    videoEl?.pause();
    if (videoEl) {
      videoEl.classList.add("hidden");
      videoEl.removeAttribute("src");
      videoEl.load();
    }
    if (imageEl) {
      imageEl.classList.remove("hidden");
      imageEl.src = image;
      imageEl.alt = `Screenshot ${mediaState.index + 1}`;
    }
  }
}

function updateActionButtons(intent) {
  const confirmBtn = document.getElementById("action-confirm-btn");
  const maybeBtn = document.getElementById("action-maybe-btn");
  const trackBtn = document.getElementById("action-track-btn");
  const archiveBtn = document.getElementById("action-archive-btn");
  if (confirmBtn) {
    confirmBtn.classList.toggle("active", intent.buy === 2);
  }
  if (maybeBtn) {
    maybeBtn.classList.toggle("active", intent.buy === 1);
  }
  if (trackBtn) {
    trackBtn.classList.toggle("active", intent.track > 0);
  }
  if (archiveBtn) {
    archiveBtn.classList.toggle("active", intent.owned === true);
  }
}

async function renderCurrent() {
  const emptyEl = document.getElementById("empty");
  const cardEl = document.getElementById("queue-card");
  if (!emptyEl || !cardEl) {
    return;
  }
  if (queueIds.length === 0) {
    emptyEl.classList.remove("hidden");
    cardEl.classList.add("hidden");
    setStatus("No games available in current source/filter.");
    return;
  }
  const appId = queueIds[queueIndex];
  const item = state?.items?.[appId] || {};
  const intent = getIntent(appId);
  emptyEl.classList.add("hidden");
  cardEl.classList.remove("hidden");

  const titleEl = document.getElementById("game-link");
  const appIdEl = document.getElementById("game-appid");
  const posEl = document.getElementById("queue-pos");
  const targetInput = document.getElementById("target-input");
  const fallbackTitle = String(item.title || "").trim() || `App ${appId}`;
  if (titleEl) {
    titleEl.textContent = fallbackTitle;
    titleEl.href = `https://store.steampowered.com/app/${encodeURIComponent(appId)}/`;
  }
  if (appIdEl) {
    appIdEl.textContent = `AppID: ${appId}`;
  }
  if (posEl) {
    posEl.textContent = `${queueIndex + 1}/${queueIds.length}`;
  }
  if (targetInput) {
    targetInput.value = Number.isFinite(Number(intent.targetPriceCents)) && Number(intent.targetPriceCents) > 0
      ? (Number(intent.targetPriceCents) / 100).toFixed(2)
      : "";
  }
  updateActionButtons(intent);

  const meta = await fetchMeta(appId);
  if (titleEl && meta.titleText) {
    titleEl.textContent = meta.titleText;
  }
  const priceText = document.getElementById("price-text");
  const discountText = document.getElementById("discount-text");
  const reviewText = document.getElementById("review-text");
  const releaseText = document.getElementById("release-text");
  if (priceText) {
    priceText.textContent = `Price: ${meta.priceText || "-"}`;
  }
  if (discountText) {
    discountText.textContent = `Discount: ${meta.discountText || "-"}`;
  }
  if (reviewText) {
    reviewText.textContent = `Reviews: ${meta.reviewText || "-"}`;
  }
  if (releaseText) {
    releaseText.textContent = `Release: ${meta.releaseText || "-"}`;
  }
  const tagsRow = document.getElementById("tags-row");
  if (tagsRow) {
    tagsRow.innerHTML = "";
    for (const tag of Array.isArray(meta.tags) ? meta.tags : []) {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = String(tag || "");
      tagsRow.appendChild(chip);
    }
  }

  setStatus("Loading media...");
  const seq = ++mediaSeq;
  const media = await fetchMedia(appId);
  if (seq !== mediaSeq) {
    return;
  }
  mediaState = {
    mode: media.videos.length > 0 ? "video" : "image",
    index: 0,
    videos: media.videos,
    images: media.images
  };
  renderMedia();
  setStatus(media.videos.length + media.images.length > 0 ? "Ready." : "No media for this game.");
}

async function setIntent(appId, patch) {
  const response = await browser.runtime.sendMessage({
    type: "set-item-intent",
    appId,
    title: String(state?.items?.[appId]?.title || ""),
    ...patch
  });
  const errs = Array.isArray(response?.steamWrite?.errors)
    ? response.steamWrite.errors.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  if (errs.length > 0) {
    setStatus(`Local state saved, Steam write failed: ${errs[0]}`, true);
  }
}

async function refreshQueueAndRender() {
  await loadState();
  await loadWishlistOrder();
  buildQueueIds();
  await renderCurrent();
}

function bindEvents() {
  document.getElementById("source-select")?.addEventListener("change", async () => {
    queueIndex = 0;
    persistUiState();
    await refreshQueueAndRender();
  });
  document.getElementById("search-input")?.addEventListener("input", async () => {
    queueIndex = 0;
    persistUiState();
    await refreshQueueAndRender();
  });
  document.getElementById("prev-btn")?.addEventListener("click", async () => {
    if (queueIds.length === 0) {
      return;
    }
    queueIndex = (queueIndex - 1 + queueIds.length) % queueIds.length;
    persistUiState();
    await renderCurrent();
  });
  document.getElementById("next-btn")?.addEventListener("click", async () => {
    if (queueIds.length === 0) {
      return;
    }
    queueIndex = (queueIndex + 1) % queueIds.length;
    persistUiState();
    await renderCurrent();
  });
  document.getElementById("mode-video-btn")?.addEventListener("click", () => {
    if ((mediaState.videos || []).length === 0) {
      return;
    }
    mediaState.mode = "video";
    mediaState.index = 0;
    renderMedia();
  });
  document.getElementById("mode-image-btn")?.addEventListener("click", () => {
    if ((mediaState.images || []).length === 0) {
      return;
    }
    mediaState.mode = "image";
    mediaState.index = 0;
    renderMedia();
  });
  document.getElementById("media-prev-btn")?.addEventListener("click", () => {
    const list = mediaState.mode === "video" ? mediaState.videos : mediaState.images;
    if (!Array.isArray(list) || list.length < 2) {
      return;
    }
    mediaState.index = (mediaState.index - 1 + list.length) % list.length;
    renderMedia();
  });
  document.getElementById("media-next-btn")?.addEventListener("click", () => {
    const list = mediaState.mode === "video" ? mediaState.videos : mediaState.images;
    if (!Array.isArray(list) || list.length < 2) {
      return;
    }
    mediaState.index = (mediaState.index + 1) % list.length;
    renderMedia();
  });
  document.getElementById("media-video")?.addEventListener("ended", () => {
    if (mediaState.mode !== "video" || !Array.isArray(mediaState.videos) || mediaState.videos.length < 2) {
      return;
    }
    mediaState.index = (mediaState.index + 1) % mediaState.videos.length;
    renderMedia();
  });

  document.getElementById("action-confirm-btn")?.addEventListener("click", async () => {
    const appId = queueIds[queueIndex];
    if (!appId) {
      return;
    }
    const intent = getIntent(appId);
    await setIntent(appId, { buy: intent.buy === 2 ? 0 : 2 });
    await refreshQueueAndRender();
  });
  document.getElementById("action-maybe-btn")?.addEventListener("click", async () => {
    const appId = queueIds[queueIndex];
    if (!appId) {
      return;
    }
    const intent = getIntent(appId);
    await setIntent(appId, { buy: intent.buy === 1 ? 0 : 1 });
    await refreshQueueAndRender();
  });
  document.getElementById("action-track-btn")?.addEventListener("click", async () => {
    const appId = queueIds[queueIndex];
    if (!appId) {
      return;
    }
    const intent = getIntent(appId);
    await setIntent(appId, { track: intent.track > 0 ? 0 : 1 });
    await refreshQueueAndRender();
  });
  document.getElementById("action-archive-btn")?.addEventListener("click", async () => {
    const appId = queueIds[queueIndex];
    if (!appId) {
      return;
    }
    await setIntent(appId, { track: 0, buy: 0, owned: true });
    await refreshQueueAndRender();
  });
  document.getElementById("target-input")?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    const appId = queueIds[queueIndex];
    if (!appId) {
      return;
    }
    const input = document.getElementById("target-input");
    const raw = String(input?.value || "").trim().replace(",", ".");
    if (!raw) {
      await setIntent(appId, { targetPriceCents: null });
      setStatus("Target price cleared.");
      await refreshQueueAndRender();
      return;
    }
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      setStatus("Invalid target price.", true);
      return;
    }
    await setIntent(appId, { targetPriceCents: Math.round(amount * 100) });
    setStatus("Target price saved.");
    await refreshQueueAndRender();
  });
}

async function init() {
  hydrateUiState();
  bindEvents();
  await refreshQueueAndRender();
}

init().catch((error) => {
  setStatus(String(error?.message || "Failed to initialize queue."), true);
});
