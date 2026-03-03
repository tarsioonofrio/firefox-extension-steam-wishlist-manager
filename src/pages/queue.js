const WISHLIST_ADDED_CACHE_KEY = "steamWishlistAddedMapV3";
const QUEUE_COLLECTION_KEY = "swmQueueCollectionV2";
const QUEUE_STATE_KEY = "swmQueueStateV2";
const QUEUE_INDEX_KEY = "swmQueueIndexV2";

const steamFetchUtils = window.SWMSteamFetch || {};

let state = null;
let wishlistOrderedIds = [];
let queueIds = [];
let queueIndex = 0;
let currentQueueConfig = { collection: "__wishlist__", state: "all" };
let mediaState = { index: 0, items: [] };
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

function shuffleIds(ids) {
  const out = Array.isArray(ids) ? [...ids] : [];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
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

function matchesStateFilter(appId, stateFilter) {
  const intent = getIntent(appId);
  switch (String(stateFilter || "all")) {
    case "inbox":
      return !intent.owned && intent.track <= 0 && intent.buy <= 0;
    case "track":
      return !intent.owned && intent.track > 0;
    case "maybe":
      return !intent.owned && intent.buy === 1;
    case "buy":
      return !intent.owned && intent.buy === 2;
    case "archive":
      return intent.owned === true;
    default:
      return true;
  }
}

function getCollectionSelection() {
  const collectionEl = document.getElementById("collection-select");
  return String(collectionEl?.value || "__wishlist__");
}

function getStateSelection() {
  const stateEl = document.getElementById("state-select");
  return String(stateEl?.value || "all");
}

function persistUiState() {
  try {
    localStorage.setItem(QUEUE_COLLECTION_KEY, currentQueueConfig.collection);
    localStorage.setItem(QUEUE_STATE_KEY, currentQueueConfig.state);
    localStorage.setItem(QUEUE_INDEX_KEY, String(queueIndex));
  } catch {
    // noop
  }
}

function hydrateUiState() {
  try {
    const collection = String(localStorage.getItem(QUEUE_COLLECTION_KEY) || "__wishlist__");
    const stateValue = String(localStorage.getItem(QUEUE_STATE_KEY) || "all");
    const index = Number(localStorage.getItem(QUEUE_INDEX_KEY) || 0);
    const collectionEl = document.getElementById("collection-select");
    const stateEl = document.getElementById("state-select");
    if (collectionEl) {
      collectionEl.value = collection;
    }
    if (stateEl) {
      stateEl.value = stateValue;
    }
    if (Number.isFinite(index) && index >= 0) {
      queueIndex = Math.floor(index);
    }
    currentQueueConfig = { collection, state: stateValue };
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
    wishlistOrderedIds = Array.isArray(userdata?.rgWishlist)
      ? userdata.rgWishlist.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
  } catch {
    wishlistOrderedIds = [];
  }
}

function populateCollectionSelect() {
  const el = document.getElementById("collection-select");
  if (!el) {
    return;
  }
  const selectedValue = String(el.value || "__wishlist__");
  const options = [
    { value: "__wishlist__", label: "Wishlist (all games)" }
  ];
  for (const name of Array.isArray(state?.collectionOrder) ? state.collectionOrder : []) {
    if (state?.dynamicCollections?.[name]) {
      continue;
    }
    options.push({ value: String(name), label: String(name) });
  }
  el.innerHTML = "";
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    el.appendChild(node);
  }
  el.value = options.some((x) => x.value === selectedValue) ? selectedValue : "__wishlist__";
}

function resolveBaseIdsByCollection(collection) {
  if (collection === "__wishlist__") {
    if (wishlistOrderedIds.length > 0) {
      return wishlistOrderedIds;
    }
    return Object.keys(state?.items || {});
  }
  return Array.isArray(state?.collections?.[collection]) ? state.collections[collection] : [];
}

function buildQueueIds(collection, stateFilter) {
  const base = resolveBaseIdsByCollection(collection);
  const deduped = [];
  const seen = new Set();
  for (const rawId of base) {
    const appId = String(rawId || "").trim();
    if (!appId || seen.has(appId)) {
      continue;
    }
    if (!matchesStateFilter(appId, stateFilter)) {
      continue;
    }
    deduped.push(appId);
    seen.add(appId);
  }
  queueIds = shuffleIds(deduped);
  queueIndex = queueIds.length > 0 ? Math.min(queueIndex, queueIds.length - 1) : 0;
  currentQueueConfig = { collection, state: stateFilter };
  persistUiState();
}

async function fetchMeta(appId) {
  if (metaCache.has(appId)) {
    return metaCache.get(appId);
  }
  const fallback = {
    titleText: "",
    capsuleImage: "",
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
      capsuleImage: String(appData?.capsule_imagev5 || appData?.capsule_image || appData?.header_image || "").trim(),
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
  const fetchText = steamFetchUtils.fetchText || ((url, options = {}) => fetch(url, options).then((r) => r.text()));
  const normalizeMediaUrl = (rawUrl) => {
    const url = String(rawUrl || "")
      .trim()
      .replace(/\\u0026/gi, "&")
      .replace(/\\x26/gi, "&")
      .replace(/\\u002f/gi, "/")
      .replace(/&amp;/gi, "&")
      .replace(/\\\//g, "/");
    if (!url) {
      return "";
    }
    if (url.startsWith("//")) {
      return `https:${url}`;
    }
    return url;
  };
  const parseStoreMediaFromHtml = (htmlText) => {
    const doc = new DOMParser().parseFromString(String(htmlText || ""), "text/html");
    const videos = [];
    const images = [];
    const seenVideos = new Set();
    const seenImages = new Set();
    const movieNodes = doc.querySelectorAll(".highlight_movie, [id^='highlight_movie_']");
    for (const movie of movieNodes) {
      const sourceNodes = movie.querySelectorAll("video source, source");
      const sourceCandidates = [
        movie.getAttribute("data-mp4-source"),
        movie.getAttribute("data-webm-source"),
        ...(Array.from(sourceNodes).map((node) => node.getAttribute("src")))
      ];
      let mediaUrl = "";
      for (const candidate of sourceCandidates) {
        const normalized = normalizeMediaUrl(candidate);
        if (!normalized) {
          continue;
        }
        mediaUrl = normalized;
        break;
      }
      if (!mediaUrl || seenVideos.has(mediaUrl)) {
        continue;
      }
      seenVideos.add(mediaUrl);
      const posterEl = movie.querySelector("img");
      const posterUrl = normalizeMediaUrl(
        movie.getAttribute("data-poster")
        || posterEl?.getAttribute("src")
        || posterEl?.getAttribute("data-src")
      );
      videos.push({ url: mediaUrl, posterUrl });
    }
    const directVideoMatches = Array.from(
      String(htmlText || "").matchAll(/https?:\\?\/\\?\/[^"'\\\s<>()]+?\.(?:mp4|webm)(?:\?[^"'\\\s<>()]*)?/gi)
    );
    for (const match of directVideoMatches) {
      const mediaUrl = normalizeMediaUrl(String(match?.[0] || "").replace(/\\\//g, "/"));
      if (!mediaUrl || seenVideos.has(mediaUrl)) {
        continue;
      }
      seenVideos.add(mediaUrl);
      videos.push({ url: mediaUrl, posterUrl: "" });
    }
    const imageNodes = doc.querySelectorAll(
      ".highlight_strip_screenshot img, .highlight_screenshot_link img, [id^='thumb_screenshot_'] img"
    );
    for (const img of imageNodes) {
      const imageUrl = normalizeMediaUrl(img.getAttribute("src") || img.getAttribute("data-src"));
      if (!imageUrl || seenImages.has(imageUrl)) {
        continue;
      }
      seenImages.add(imageUrl);
      images.push(imageUrl);
    }
    return { videos, images };
  };
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
    if (videos.length === 0) {
      try {
        const html = await fetchText(
          `https://store.steampowered.com/app/${encodeURIComponent(appId)}/?l=english`,
          { cache: "no-store", credentials: "include" }
        );
        const parsed = parseStoreMediaFromHtml(html);
        if (parsed.videos.length > 0) {
          return {
            videos: parsed.videos,
            images: images.length > 0 ? images : parsed.images
          };
        }
        if (images.length === 0 && parsed.images.length > 0) {
          return { videos: [], images: parsed.images };
        }
      } catch {
        // keep appdetails result
      }
    }
    return { videos, images };
  } catch {
    try {
      const html = await fetchText(
        `https://store.steampowered.com/app/${encodeURIComponent(appId)}/?l=english`,
        { cache: "no-store", credentials: "include" }
      );
      return parseStoreMediaFromHtml(html);
    } catch {
      return { videos: [], images: [] };
    }
  }
}

function renderMedia() {
  const videoEl = document.getElementById("media-video");
  const imageEl = document.getElementById("media-image");
  const countEl = document.getElementById("media-count");
  const prevBtn = document.getElementById("media-prev-btn");
  const nextBtn = document.getElementById("media-next-btn");
  const list = Array.isArray(mediaState.items) ? mediaState.items : [];
  const total = Array.isArray(list) ? list.length : 0;
  if (total === 0) {
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
  const current = list[mediaState.index] || {};
  if (current.type === "video") {
    const video = current || {};
    if (imageEl) {
      imageEl.classList.add("hidden");
      imageEl.removeAttribute("src");
    }
    if (videoEl) {
      videoEl.classList.remove("hidden");
      videoEl.src = String(video.url || "");
      videoEl.poster = String(video.posterUrl || "");
      videoEl.loop = total <= 1;
      videoEl.play().catch(() => {});
    }
  } else {
    videoEl?.pause();
    if (videoEl) {
      videoEl.classList.add("hidden");
      videoEl.removeAttribute("src");
      videoEl.load();
    }
    if (imageEl) {
      imageEl.classList.remove("hidden");
      imageEl.src = String(current.url || "");
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

function fitLayoutToViewport() {
  const container = document.querySelector(".container");
  const header = document.querySelector(".top");
  const card = document.getElementById("queue-card");
  const body = card?.querySelector(".queue-body");
  const leftCol = card?.querySelector(".queue-left");
  const controls = card?.querySelector(".media-controls");
  if (!container || !header || !card || !body || !leftCol || card.classList.contains("hidden")) {
    return;
  }
  const viewportHeight = window.innerHeight;
  const containerStyles = getComputedStyle(container);
  const padTop = Number.parseFloat(containerStyles.paddingTop || "0") || 0;
  const padBottom = Number.parseFloat(containerStyles.paddingBottom || "0") || 0;
  const availableHeight = Math.max(320, viewportHeight - padTop - padBottom - header.getBoundingClientRect().height - 12);
  card.style.height = `${Math.floor(availableHeight)}px`;

  const cardStyles = getComputedStyle(card);
  const cardPadTop = Number.parseFloat(cardStyles.paddingTop || "0") || 0;
  const cardPadBottom = Number.parseFloat(cardStyles.paddingBottom || "0") || 0;
  const leftStyles = getComputedStyle(leftCol);
  const leftGap = Number.parseFloat(leftStyles.rowGap || leftStyles.gap || "0") || 0;
  const cardGap = Number.parseFloat(cardStyles.rowGap || cardStyles.gap || "0") || 0;
  const leftHeight = Math.max(
    120,
    Math.floor(
      availableHeight
      - cardPadTop
      - cardPadBottom
      - cardGap
    )
  );
  const fixedLeft = (controls?.getBoundingClientRect().height || 0) + leftGap;
  const stageHeight = Math.max(120, Math.floor(leftHeight - fixedLeft));
  card.style.setProperty("--queue-media-height", `${stageHeight}px`);
}

async function renderCurrent() {
  const emptyEl = document.getElementById("empty");
  const cardEl = document.getElementById("queue-card");
  const navEl = document.getElementById("queue-nav");
  const headerBarEl = document.getElementById("queue-header-bar");
  if (!emptyEl || !cardEl || !navEl || !headerBarEl) {
    return;
  }
  if (queueIds.length === 0) {
    emptyEl.classList.remove("hidden");
    cardEl.classList.add("hidden");
    navEl.classList.add("hidden");
    headerBarEl.classList.add("hidden");
    setStatus("No games found for selected collection/state.");
    return;
  }

  const appId = queueIds[queueIndex];
  const item = state?.items?.[appId] || {};
  const intent = getIntent(appId);
  emptyEl.classList.add("hidden");
  cardEl.classList.remove("hidden");
  headerBarEl.classList.remove("hidden");
  navEl.classList.remove("hidden");

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
  const capsuleImage = document.getElementById("capsule-image");
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
  if (capsuleImage) {
    const capsuleUrl = String(meta?.capsuleImage || "").trim();
    if (capsuleUrl) {
      capsuleImage.src = capsuleUrl;
      capsuleImage.classList.remove("hidden");
    } else {
      capsuleImage.removeAttribute("src");
      capsuleImage.classList.add("hidden");
    }
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

  fitLayoutToViewport();
  setStatus("Loading media...");
  const seq = ++mediaSeq;
  const media = await fetchMedia(appId);
  if (seq !== mediaSeq) {
    return;
  }
  const mediaItems = [
    ...(Array.isArray(media.videos) ? media.videos.map((video) => ({
      type: "video",
      url: String(video?.url || ""),
      posterUrl: String(video?.posterUrl || "")
    })) : []),
    ...(Array.isArray(media.images) ? media.images.map((imageUrl) => ({
      type: "image",
      url: String(imageUrl || ""),
      posterUrl: ""
    })) : [])
  ].filter((item) => item.url);
  mediaState = {
    index: 0,
    items: mediaItems
  };
  renderMedia();
  fitLayoutToViewport();
  setStatus(mediaItems.length > 0 ? "" : "No media for this game.");
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

async function refreshStateOnly() {
  await loadState();
  populateCollectionSelect();
}

async function startQueue() {
  await refreshStateOnly();
  const collection = getCollectionSelection();
  const stateFilter = getStateSelection();
  queueIndex = 0;
  buildQueueIds(collection, stateFilter);
  const setupPanelEl = document.querySelector(".setup-panel");
  const headerBarEl = document.getElementById("queue-header-bar");
  if (setupPanelEl) {
    setupPanelEl.classList.add("hidden");
  }
  if (headerBarEl) {
    headerBarEl.classList.remove("hidden");
  }
  await renderCurrent();
}

async function rerenderAfterAction() {
  await loadState();
  buildQueueIds(currentQueueConfig.collection, currentQueueConfig.state);
  await renderCurrent();
}

function bindEvents() {
  document.getElementById("go-btn")?.addEventListener("click", async () => {
    await startQueue();
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

  document.getElementById("media-prev-btn")?.addEventListener("click", () => {
    const list = Array.isArray(mediaState.items) ? mediaState.items : [];
    if (!Array.isArray(list) || list.length < 2) {
      return;
    }
    mediaState.index = (mediaState.index - 1 + list.length) % list.length;
    renderMedia();
  });
  document.getElementById("media-next-btn")?.addEventListener("click", () => {
    const list = Array.isArray(mediaState.items) ? mediaState.items : [];
    if (!Array.isArray(list) || list.length < 2) {
      return;
    }
    mediaState.index = (mediaState.index + 1) % list.length;
    renderMedia();
  });
  document.getElementById("media-video")?.addEventListener("ended", () => {
    const list = Array.isArray(mediaState.items) ? mediaState.items : [];
    if (list.length < 2) {
      return;
    }
    mediaState.index = (mediaState.index + 1) % list.length;
    renderMedia();
  });

  document.getElementById("action-confirm-btn")?.addEventListener("click", async () => {
    const appId = queueIds[queueIndex];
    if (!appId) {
      return;
    }
    const intent = getIntent(appId);
    await setIntent(appId, { buy: intent.buy === 2 ? 0 : 2 });
    await rerenderAfterAction();
  });
  document.getElementById("action-maybe-btn")?.addEventListener("click", async () => {
    const appId = queueIds[queueIndex];
    if (!appId) {
      return;
    }
    const intent = getIntent(appId);
    await setIntent(appId, { buy: intent.buy === 1 ? 0 : 1 });
    await rerenderAfterAction();
  });
  document.getElementById("action-track-btn")?.addEventListener("click", async () => {
    const appId = queueIds[queueIndex];
    if (!appId) {
      return;
    }
    const intent = getIntent(appId);
    await setIntent(appId, { track: intent.track > 0 ? 0 : 1 });
    await rerenderAfterAction();
  });
  document.getElementById("action-archive-btn")?.addEventListener("click", async () => {
    const appId = queueIds[queueIndex];
    if (!appId) {
      return;
    }
    await setIntent(appId, { track: 0, buy: 0, owned: true });
    await rerenderAfterAction();
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
      await rerenderAfterAction();
      return;
    }
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      setStatus("Invalid target price.", true);
      return;
    }
    await setIntent(appId, { targetPriceCents: Math.round(amount * 100) });
    setStatus("Target price saved.");
    await rerenderAfterAction();
  });

  window.addEventListener("resize", () => fitLayoutToViewport());
}

async function init() {
  await loadState();
  await loadWishlistOrder();
  populateCollectionSelect();
  hydrateUiState();
  bindEvents();
  setStatus("");
}

init().catch((error) => {
  setStatus(String(error?.message || "Failed to initialize queue."), true);
});
