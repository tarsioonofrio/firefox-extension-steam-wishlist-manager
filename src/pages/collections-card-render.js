(() => {
  const MEDIA_TOOLTIP_ID = "swm-media-tooltip";
  const MEDIA_TOOLTIP_STYLE_ID = "swm-media-tooltip-style";
  const MEDIA_TOOLTIP_SIZE_KEY = "swm-media-tooltip-size-v1";
  const MEDIA_TOOLTIP_FETCH_LABEL = "media tooltip fetch timeout";
  const MEDIA_TOOLTIP_FETCH_TIMEOUT_MS = 12000;
  let mediaTooltipHoverSeq = 0;
  let mediaTooltipHideTimer = null;

  function clearMediaTooltipHideTimer() {
    if (mediaTooltipHideTimer) {
      clearTimeout(mediaTooltipHideTimer);
      mediaTooltipHideTimer = null;
    }
  }

  function scheduleMediaTooltipHide(delay = 120) {
    clearMediaTooltipHideTimer();
    mediaTooltipHideTimer = setTimeout(() => {
      const tooltip = document.getElementById(MEDIA_TOOLTIP_ID);
      if (tooltip) {
        tooltip.classList.add("hidden");
      }
    }, Math.max(0, Number(delay || 0)));
  }

  function readTooltipSize() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MEDIA_TOOLTIP_SIZE_KEY) || "{}");
      const width = Number(parsed?.width || 0);
      return {
        width: Number.isFinite(width) ? Math.max(280, Math.min(900, Math.round(width))) : 0
      };
    } catch {
      return { width: 0 };
    }
  }

  function saveTooltipSize(tooltip) {
    if (!(tooltip instanceof HTMLElement)) {
      return;
    }
    const width = Math.max(280, Math.min(900, Math.round(Number(tooltip.offsetWidth || 0))));
    try {
      localStorage.setItem(MEDIA_TOOLTIP_SIZE_KEY, JSON.stringify({ width }));
    } catch {
      // noop
    }
  }

  function getTooltipChromeHeight(tooltip) {
    if (!(tooltip instanceof HTMLElement)) {
      return 96;
    }
    const px = (value) => {
      const n = Number.parseFloat(String(value || "0"));
      return Number.isFinite(n) ? n : 0;
    };
    const computed = getComputedStyle(tooltip);
    const status = tooltip.querySelector(".swm-media-tooltip-status");
    const controls = tooltip.querySelector(".swm-media-tooltip-controls");
    const statusStyle = status ? getComputedStyle(status) : null;
    const controlsStyle = controls ? getComputedStyle(controls) : null;
    const chrome = (
      px(computed.paddingTop)
      + px(computed.paddingBottom)
      + px(computed.borderTopWidth)
      + px(computed.borderBottomWidth)
      + (status ? status.getBoundingClientRect().height : 0)
      + (controls ? controls.getBoundingClientRect().height : 0)
      + (statusStyle ? px(statusStyle.marginTop) + px(statusStyle.marginBottom) : 0)
      + (controlsStyle ? px(controlsStyle.marginTop) + px(controlsStyle.marginBottom) : 0)
    );
    return Math.max(72, Math.min(220, Math.round(chrome || 96)));
  }

  function applyTooltipProportionalSize(tooltip, preferredWidth = 0) {
    if (!(tooltip instanceof HTMLElement)) {
      return;
    }
    const fallbackWidth = Number(tooltip.offsetWidth || 420) || 420;
    const width = Math.max(280, Math.min(900, Math.round(Number(preferredWidth || fallbackWidth))));
    const chromeHeight = getTooltipChromeHeight(tooltip);
    const stageHeight = Math.round(width * 9 / 16);
    const height = Math.max(210, Math.min(760, stageHeight + chromeHeight));
    tooltip.style.width = `${width}px`;
    tooltip.style.height = `${height}px`;
  }

  function enableTooltipResizePersistence(tooltip) {
    if (!(tooltip instanceof HTMLElement) || tooltip.dataset.swmResizeBound === "1") {
      return;
    }
    tooltip.dataset.swmResizeBound = "1";
    tooltip.style.resize = "both";
    tooltip.style.overflow = "hidden";
    let debounce = null;
    let applyingSize = false;
    const observer = new ResizeObserver(() => {
      if (tooltip.classList.contains("hidden") || applyingSize) {
        return;
      }
      const expectedWidth = Math.max(280, Math.min(900, Math.round(Number(tooltip.offsetWidth || 0))));
      const chromeHeight = getTooltipChromeHeight(tooltip);
      const expectedHeight = Math.max(210, Math.min(760, Math.round((expectedWidth * 9 / 16) + chromeHeight)));
      if (Math.abs(expectedHeight - Number(tooltip.offsetHeight || 0)) > 1) {
        applyingSize = true;
        tooltip.style.height = `${expectedHeight}px`;
        requestAnimationFrame(() => {
          applyingSize = false;
        });
      }
      clearTimeout(debounce);
      debounce = setTimeout(() => saveTooltipSize(tooltip), 180);
    });
    observer.observe(tooltip);
  }

  function normalizeMediaUrl(rawUrl) {
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
  }

  function parseStoreMediaFromHtml(htmlText) {
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
      const raw = String(match?.[0] || "").replace(/\\\//g, "/");
      const mediaUrl = normalizeMediaUrl(raw);
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
      const normalized = normalizeMediaUrl(img.getAttribute("src") || img.getAttribute("data-src"));
      if (!normalized || seenImages.has(normalized)) {
        continue;
      }
      seenImages.add(normalized);
      images.push(normalized);
    }

    return { videos, images };
  }

  function deriveManifestCandidates(rawManifestUrl) {
    const manifestUrl = normalizeMediaUrl(rawManifestUrl);
    if (!manifestUrl) {
      return [];
    }
    const queryIndex = manifestUrl.indexOf("?");
    const query = queryIndex >= 0 ? manifestUrl.slice(queryIndex) : "";
    const base = queryIndex >= 0 ? manifestUrl.slice(0, queryIndex) : manifestUrl;
    const slashIndex = base.lastIndexOf("/");
    if (slashIndex < 0) {
      return [];
    }
    const dir = base.slice(0, slashIndex + 1);
    return [
      `${dir}movie_max.mp4${query}`,
      `${dir}movie480.mp4${query}`,
      `${dir}movie_max.webm${query}`,
      `${dir}movie480.webm${query}`
    ];
  }

  function deriveStaticMovieCandidates(movie) {
    const out = [];
    const movieId = String(movie?.id || "").trim();
    const thumbUrl = normalizeMediaUrl(movie?.thumbnail || movie?.highlight_thumbnail);
    const thumbQueryIndex = thumbUrl.indexOf("?");
    const thumbQuery = thumbQueryIndex >= 0 ? thumbUrl.slice(thumbQueryIndex) : "";
    if (movieId) {
      out.push(
        `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${movieId}/movie_max.mp4${thumbQuery}`,
        `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${movieId}/movie480.mp4${thumbQuery}`,
        `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${movieId}/movie_max.webm${thumbQuery}`,
        `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${movieId}/movie480.webm${thumbQuery}`
      );
    }
    return out;
  }

  async function fetchAppDetailsMedia(appId) {
    const id = String(appId || "").trim();
    if (!id) {
      return { videos: [], images: [] };
    }
    const videos = [];
    const images = [];
    const seenVideos = new Set();
    const seenImages = new Set();
    const addFromData = (data) => {
      for (const movie of Array.isArray(data?.movies) ? data.movies : []) {
        const candidates = [
          movie?.mp4?.max,
          movie?.mp4?.["480"],
          movie?.webm?.max,
          movie?.webm?.["480"],
          ...deriveStaticMovieCandidates(movie),
          ...deriveManifestCandidates(movie?.dash_h264),
          ...deriveManifestCandidates(movie?.hls_h264),
          ...deriveManifestCandidates(movie?.dash_av1)
        ];
        let picked = "";
        for (const candidate of candidates) {
          const normalized = normalizeMediaUrl(candidate);
          if (!normalized || seenVideos.has(normalized)) {
            continue;
          }
          picked = normalized;
          break;
        }
        if (!picked) {
          continue;
        }
        seenVideos.add(picked);
        const posterUrl = normalizeMediaUrl(movie?.thumbnail || movie?.highlight_thumbnail);
        videos.push({ url: picked, posterUrl });
      }
      for (const screenshot of Array.isArray(data?.screenshots) ? data.screenshots : []) {
        const imageUrl = normalizeMediaUrl(screenshot?.path_full || screenshot?.path_thumbnail);
        if (!imageUrl || seenImages.has(imageUrl)) {
          continue;
        }
        seenImages.add(imageUrl);
        images.push(imageUrl);
      }
    };

    const ccCandidates = ["us", "br", ""];
    for (const cc of ccCandidates) {
      const ccParam = cc ? `&cc=${encodeURIComponent(cc)}` : "";
      const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(id)}&l=english${ccParam}&filters=movies,screenshots`;
      try {
        const json = await fetch(url, { cache: "no-store", credentials: "include" }).then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.json();
        });
        const entry = json?.[id];
        const data = entry?.success ? (entry.data || {}) : {};
        addFromData(data);
      } catch {
        continue;
      }
      if (videos.length > 0 && images.length > 0) {
        break;
      }
    }

    return { videos, images };
  }

  function ensureMediaTooltipStyle() {
    if (document.getElementById(MEDIA_TOOLTIP_STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = MEDIA_TOOLTIP_STYLE_ID;
    style.textContent = `
      .swm-media-tooltip {
        position: fixed;
        z-index: 2147483647;
        width: min(420px, calc(100vw - 20px));
        max-width: calc(100vw - 20px);
        min-height: 210px;
        background: rgba(20, 27, 35, 0.97);
        border: 1px solid rgba(108, 166, 202, 0.55);
        border-radius: 8px;
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
        padding: 8px;
        color: #c7d5e0;
        pointer-events: auto;
      }
      .swm-media-tooltip.hidden { display: none !important; }
      .swm-media-tooltip-stage {
        width: 100%;
        aspect-ratio: 16 / 9;
        border-radius: 6px;
        overflow: hidden;
        background: #000;
      }
      .swm-media-tooltip-video, .swm-media-tooltip-image {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
        background: #000;
        border: 0;
      }
      .swm-media-tooltip-status {
        margin: 6px 0 0;
        color: #9fb7cc;
        font-size: 11px;
      }
      .swm-media-tooltip-controls {
        margin-top: 6px;
        display: grid;
        grid-template-columns: auto auto 1fr auto auto;
        gap: 6px;
        align-items: center;
      }
      .swm-media-tooltip-controls button {
        height: 24px;
        min-width: 56px;
        font-size: 11px;
        padding: 0 8px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 2px;
        background: #2b3b4a;
        color: #c7d5e0;
        cursor: pointer;
      }
      .swm-media-tooltip-controls button.active {
        border-color: #6ca6ca;
        background: #447196;
      }
      .swm-media-tooltip-count {
        text-align: center;
        color: #9fb7cc;
        font-size: 11px;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureMediaTooltip() {
    ensureMediaTooltipStyle();
    let tooltip = document.getElementById(MEDIA_TOOLTIP_ID);
    if (tooltip) {
      return tooltip;
    }

    tooltip = document.createElement("div");
    tooltip.id = MEDIA_TOOLTIP_ID;
    tooltip.className = "swm-media-tooltip hidden";
    tooltip.innerHTML = `
      <div class="swm-media-tooltip-stage"></div>
      <p class="swm-media-tooltip-status">Hover a capsule to preview media.</p>
      <div class="swm-media-tooltip-controls">
        <button type="button" data-mode="video">Videos</button>
        <button type="button" data-mode="image">Images</button>
        <button type="button" data-nav="prev" aria-label="Previous">‹</button>
        <span class="swm-media-tooltip-count">0/0</span>
        <button type="button" data-nav="next" aria-label="Next">›</button>
      </div>
    `;
    tooltip._state = {
      appId: "",
      mode: "",
      index: 0,
      videos: [],
      images: []
    };
    enableTooltipResizePersistence(tooltip);

    tooltip.addEventListener("mouseenter", () => clearMediaTooltipHideTimer());
    tooltip.addEventListener("mouseleave", () => scheduleMediaTooltipHide(120));
    tooltip.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) {
        return;
      }
      const state = tooltip._state || {};
      const nav = target.getAttribute("data-nav");
      const mode = target.getAttribute("data-mode");
      if (mode) {
        if (mode === "video" && Array.isArray(state.videos) && state.videos.length > 0) {
          state.mode = "video";
          state.index = 0;
          renderMediaTooltipState(tooltip);
        } else if (mode === "image" && Array.isArray(state.images) && state.images.length > 0) {
          state.mode = "image";
          state.index = 0;
          renderMediaTooltipState(tooltip);
        }
        return;
      }
      if (!nav) {
        return;
      }
      const list = state.mode === "video" ? state.videos : state.images;
      if (!Array.isArray(list) || list.length === 0) {
        return;
      }
      if (nav === "prev") {
        state.index = (state.index - 1 + list.length) % list.length;
      } else if (nav === "next") {
        state.index = (state.index + 1) % list.length;
      }
      renderMediaTooltipState(tooltip);
    });

    document.body.appendChild(tooltip);
    return tooltip;
  }

  function positionMediaTooltip(tooltip, anchorEl) {
    if (!tooltip || !anchorEl) {
      return;
    }
    const saved = readTooltipSize();
    if (saved.width > 0) {
      applyTooltipProportionalSize(tooltip, saved.width);
    } else {
      applyTooltipProportionalSize(tooltip, Number(tooltip.offsetWidth || 420));
    }
    const rect = anchorEl.getBoundingClientRect();
    const width = Math.max(360, Number(tooltip.offsetWidth || 0));
    const height = Math.max(240, Number(tooltip.offsetHeight || 0));
    const margin = 10;
    const preferRightLeft = rect.right + margin;
    const rightFits = preferRightLeft + width <= window.innerWidth - margin;
    const left = rightFits
      ? preferRightLeft
      : Math.max(margin, Math.min(window.innerWidth - width - margin, rect.left - width - margin));
    const top = Math.max(
      margin,
      Math.min(window.innerHeight - height - margin, rect.top + ((rect.height - height) / 2))
    );
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  function renderMediaTooltipState(tooltip) {
    if (!tooltip) {
      return;
    }
    const state = tooltip._state || {};
    const stage = tooltip.querySelector(".swm-media-tooltip-stage");
    const status = tooltip.querySelector(".swm-media-tooltip-status");
    const count = tooltip.querySelector(".swm-media-tooltip-count");
    const videoBtn = tooltip.querySelector("[data-mode='video']");
    const imageBtn = tooltip.querySelector("[data-mode='image']");
    const prevBtn = tooltip.querySelector("[data-nav='prev']");
    const nextBtn = tooltip.querySelector("[data-nav='next']");
    const videoList = Array.isArray(state.videos) ? state.videos : [];
    const imageList = Array.isArray(state.images) ? state.images : [];
    const activeMode = state.mode === "image" ? "image" : "video";
    const activeList = activeMode === "video" ? videoList : imageList;
    const showSteamPlayerFallback = Boolean(state.steamPlayerFallback && state.appId);
    if (showSteamPlayerFallback) {
      if (stage) {
        stage.innerHTML = "";
        const iframe = document.createElement("iframe");
        iframe.className = "swm-media-tooltip-video";
        iframe.src = `https://store.steampowered.com/video/${encodeURIComponent(String(state.appId))}/?l=english`;
        iframe.setAttribute("allow", "autoplay; fullscreen");
        iframe.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
        stage.appendChild(iframe);
      }
      if (status) {
        status.textContent = "Steam player preview";
      }
      if (count) {
        count.textContent = "—";
      }
      if (videoBtn) {
        videoBtn.disabled = false;
        videoBtn.classList.add("active");
      }
      if (imageBtn) {
        imageBtn.disabled = imageList.length === 0;
        imageBtn.classList.remove("active");
      }
      if (prevBtn) {
        prevBtn.disabled = true;
      }
      if (nextBtn) {
        nextBtn.disabled = true;
      }
      return;
    }
    if (!Array.isArray(activeList) || activeList.length === 0) {
      if (stage) {
        stage.innerHTML = "";
      }
      if (status) {
        status.textContent = "No media available for this game.";
      }
      if (count) {
        count.textContent = "0/0";
      }
      if (videoBtn) {
        videoBtn.disabled = videoList.length === 0;
        videoBtn.classList.toggle("active", activeMode === "video");
      }
      if (imageBtn) {
        imageBtn.disabled = imageList.length === 0;
        imageBtn.classList.toggle("active", activeMode === "image");
      }
      if (prevBtn) {
        prevBtn.disabled = true;
      }
      if (nextBtn) {
        nextBtn.disabled = true;
      }
      return;
    }

    state.mode = activeMode;
    state.index = Math.max(0, Math.min(activeList.length - 1, Number(state.index || 0)));
    const current = activeList[state.index];

    if (stage) {
      stage.innerHTML = "";
      if (activeMode === "video") {
        const video = document.createElement("video");
        video.className = "swm-media-tooltip-video";
        video.src = String(current?.url || "");
        if (current?.posterUrl) {
          video.poster = String(current.posterUrl);
        }
        video.controls = true;
        video.muted = true;
        video.autoplay = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = "none";
        video.addEventListener("error", () => {
          const nextState = tooltip._state && typeof tooltip._state === "object" ? tooltip._state : {};
          if (nextState.appId && !nextState.steamPlayerFallback) {
            nextState.steamPlayerFallback = true;
            renderMediaTooltipState(tooltip);
            const nextStatus = tooltip.querySelector(".swm-media-tooltip-status");
            if (nextStatus) {
              nextStatus.textContent = "Direct video failed; trying Steam player.";
            }
            return;
          }
          const fallbackImages = Array.isArray(nextState.images) ? nextState.images : [];
          if (fallbackImages.length > 0 && nextState.mode === "video" && !nextState.videoFallbackUsed) {
            nextState.videoFallbackUsed = true;
            nextState.mode = "image";
            nextState.index = Math.max(0, Math.min(fallbackImages.length - 1, nextState.index || 0));
            renderMediaTooltipState(tooltip);
            const nextStatus = tooltip.querySelector(".swm-media-tooltip-status");
            if (nextStatus) {
              nextStatus.textContent = "Video unavailable for this game; showing screenshots.";
            }
          }
        });
        stage.appendChild(video);
      } else {
        const image = document.createElement("img");
        image.className = "swm-media-tooltip-image";
        image.src = String(current || "");
        image.alt = `Screenshot ${state.index + 1}`;
        image.loading = "eager";
        stage.appendChild(image);
      }
    }
    if (status) {
      status.textContent = activeMode === "video" ? "Video preview" : "Screenshot preview";
    }
    if (count) {
      count.textContent = `${state.index + 1}/${activeList.length}`;
    }
    if (videoBtn) {
      videoBtn.disabled = videoList.length === 0;
      videoBtn.classList.toggle("active", activeMode === "video");
    }
    if (imageBtn) {
      imageBtn.disabled = imageList.length === 0;
      imageBtn.classList.toggle("active", activeMode === "image");
    }
    if (prevBtn) {
      prevBtn.disabled = activeList.length < 2;
    }
    if (nextBtn) {
      nextBtn.disabled = activeList.length < 2;
    }
  }

  async function openMediaTooltip(anchorEl, appId) {
    const tooltip = ensureMediaTooltip();
    clearMediaTooltipHideTimer();
    tooltip.classList.remove("hidden");
    positionMediaTooltip(tooltip, anchorEl);
    const status = tooltip.querySelector(".swm-media-tooltip-status");
    const stage = tooltip.querySelector(".swm-media-tooltip-stage");
    if (stage) {
      stage.innerHTML = "";
    }
    if (status) {
      status.textContent = "Loading media from Steam page...";
    }
    tooltip._state = { appId: String(appId || ""), mode: "", index: 0, videos: [], images: [], steamPlayerFallback: false };
    renderMediaTooltipState(tooltip);

    const fetchText = window?.SWMSteamFetch?.fetchText;
    const seq = ++mediaTooltipHoverSeq;
    const storeUrl = `https://store.steampowered.com/app/${encodeURIComponent(String(appId || "").trim())}/?l=english`;
    try {
      const fetchPromise = typeof fetchText === "function"
        ? fetchText(storeUrl, { cache: "no-store" })
        : fetch(storeUrl, { cache: "no-store", credentials: "include" }).then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.text();
        });
      const htmlText = await Promise.race([
        fetchPromise,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(MEDIA_TOOLTIP_FETCH_LABEL)), MEDIA_TOOLTIP_FETCH_TIMEOUT_MS);
        })
      ]);
      if (seq !== mediaTooltipHoverSeq) {
        return;
      }
      let parsed = parseStoreMediaFromHtml(htmlText);
      if ((parsed.videos.length + parsed.images.length) === 0) {
        try {
          parsed = await Promise.race([
            fetchAppDetailsMedia(appId),
            new Promise((_, reject) => {
              setTimeout(() => reject(new Error(MEDIA_TOOLTIP_FETCH_LABEL)), MEDIA_TOOLTIP_FETCH_TIMEOUT_MS);
            })
          ]);
        } catch {
          // noop
        }
      }
      tooltip._state = {
        appId: String(appId || ""),
        mode: parsed.videos.length > 0 ? "video" : "image",
        index: 0,
        videos: parsed.videos,
        images: parsed.images,
        steamPlayerFallback: false
      };
      renderMediaTooltipState(tooltip);
      positionMediaTooltip(tooltip, anchorEl);
    } catch (error) {
      if (seq !== mediaTooltipHoverSeq) {
        return;
      }
      if (status) {
        status.textContent = `Failed to load media: ${String(error?.message || "unknown error")}`;
      }
      tooltip._state = {
        appId: String(appId || ""),
        mode: "video",
        index: 0,
        videos: [],
        images: [],
        steamPlayerFallback: true
      };
      renderMediaTooltipState(tooltip);
    }
  }

  function bindMediaPreviewHover(anchorEl, appId) {
    if (!anchorEl) {
      return;
    }
    if (anchorEl.dataset.swmMediaHoverBound === "1") {
      return;
    }
    anchorEl.dataset.swmMediaHoverBound = "1";
    anchorEl.addEventListener("mouseenter", () => {
      openMediaTooltip(anchorEl, appId).catch(() => {});
    });
    anchorEl.addEventListener("mouseleave", () => {
      scheduleMediaTooltipHide(120);
    });
  }

  function buildImageCandidates(appId, primaryUrl) {
    const baseCloudflare = `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}`;
    const baseAkamai = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}`;
    const primary = String(primaryUrl || "").trim();
    const primaryDir = primary.includes("/")
      ? primary.slice(0, primary.lastIndexOf("/") + 1)
      : "";
    const list = [
      primary,
      `${baseCloudflare}/capsule_184x69.jpg`,
      `${baseCloudflare}/capsule_231x87.jpg`,
      `${baseCloudflare}/header.jpg`,
      `${baseCloudflare}/header_alt_assets_0.jpg`,
      `${baseCloudflare}/header_alt_assets_1.jpg`,
      `${baseCloudflare}/capsule_616x353.jpg`,
      `${baseCloudflare}/library_600x900.jpg`,
      `${baseCloudflare}/library_600x900_2x.jpg`,
      `${baseAkamai}/capsule_184x69.jpg`,
      `${baseAkamai}/capsule_231x87.jpg`,
      `${baseAkamai}/header.jpg`,
      `${baseAkamai}/header_alt_assets_0.jpg`,
      `${baseAkamai}/header_alt_assets_1.jpg`,
      `${baseAkamai}/capsule_616x353.jpg`,
      `${baseAkamai}/library_600x900.jpg`,
      `${baseAkamai}/library_600x900_2x.jpg`,
      primaryDir ? `${primaryDir}header.jpg` : "",
      primaryDir ? `${primaryDir}header_alt_assets_0.jpg` : ""
    ];
    const out = [];
    const seen = new Set();
    for (const url of list) {
      if (!url || seen.has(url)) {
        continue;
      }
      seen.add(url);
      out.push(url);
    }
    return out;
  }

  function attachImageFallback(imgEl, candidates) {
    if (!imgEl) {
      return;
    }
    const queue = Array.isArray(candidates) ? [...candidates] : [];
    if (queue.length === 0) {
      return;
    }

    const next = () => {
      const candidate = queue.shift();
      if (!candidate) {
        imgEl.removeAttribute("src");
        imgEl.style.visibility = "hidden";
        return;
      }
      imgEl.style.visibility = "";
      imgEl.src = candidate;
    };

    imgEl.onerror = next;
    next();
  }

  function createCardNodes(options) {
    const template = options?.template;
    const appId = String(options?.appId || "");
    const title = String(options?.title || `App ${appId}`);
    const link = String(options?.link || "");
    const fragment = template.content.cloneNode(true);
    return {
      appId,
      fragment,
      title,
      link,
      cardEl: fragment.querySelector(".card"),
      batchCheckbox: fragment.querySelector(".card-batch-checkbox"),
      orderUpBtn: fragment.querySelector(".order-up-btn"),
      orderDownBtn: fragment.querySelector(".order-down-btn"),
      orderPositionInput: fragment.querySelector(".order-position-input"),
      coverLink: fragment.querySelector(".cover-link"),
      cover: fragment.querySelector(".cover"),
      titleEl: fragment.querySelector(".title"),
      appidEl: fragment.querySelector(".appid"),
      pricingEl: fragment.querySelector(".pricing"),
      discountEl: fragment.querySelector(".discount"),
      tagsRowEl: fragment.querySelector(".tags-row"),
      reviewEl: fragment.querySelector(".review"),
      releaseEl: fragment.querySelector(".release"),
      wishlistAddedEl: fragment.querySelector(".wishlist-added"),
      triageBuyBtn: fragment.querySelector(".triage-buy-btn"),
      triageMaybeBtn: fragment.querySelector(".triage-maybe-btn"),
      triageTrackBtn: fragment.querySelector(".triage-track-btn"),
      triageArchiveBtn: fragment.querySelector(".triage-archive-btn"),
      targetPriceInput: fragment.querySelector(".target-price-input"),
      refreshItemBtn: fragment.querySelector(".refresh-item-btn"),
      collectionsToggleBtn: fragment.querySelector(".collections-toggle-btn"),
      collectionsDropdown: fragment.querySelector(".collections-dropdown"),
      removeBtn: fragment.querySelector(".remove-btn")
    };
  }

  function fillCardStatic(options) {
    const card = options?.card;
    const appId = String(options?.appId || "");
    const imageUrl = String(options?.imageUrl || "");
    const wishlistDate = String(options?.wishlistDate || "-");
    const itemIntent = options?.itemIntent && typeof options.itemIntent === "object" ? options.itemIntent : {};
    if (!card) {
      return;
    }
    if (card.coverLink) {
      card.coverLink.href = card.link;
      bindMediaPreviewHover(card.coverLink, appId);
    }
    if (card.cover) {
      const imageCandidates = buildImageCandidates(appId, imageUrl);
      attachImageFallback(card.cover, imageCandidates);
      card.cover.alt = card.title;
      card.cover.loading = "lazy";
      bindMediaPreviewHover(card.cover, appId);
    }
    if (card.titleEl) {
      card.titleEl.textContent = card.title;
      card.titleEl.href = card.link;
    }
    if (card.appidEl) {
      card.appidEl.textContent = `AppID: ${appId}`;
    }
    if (card.wishlistAddedEl) {
      card.wishlistAddedEl.textContent = `Wishlisted: ${wishlistDate}`;
    }
  }

  function bindCardActions(options) {
    const card = options?.card;
    const appId = String(options?.appId || "");
    const sourceMode = String(options?.sourceMode || "collections");
    const activeCollection = String(options?.activeCollection || "__all__");
    const onRefreshItem = options?.onRefreshItem || (() => Promise.resolve());
    const onRemoveItem = options?.onRemoveItem || (() => Promise.resolve());
    const onSetIntent = options?.onSetIntent || (() => Promise.resolve());
    const setStatus = options?.setStatus || (() => {});
    const confirmFn = options?.confirmFn || ((message) => window.confirm(message));
    const itemIntent = options?.itemIntent && typeof options.itemIntent === "object" ? options.itemIntent : {};
    const targetPriceCents = Number.isFinite(Number(itemIntent.targetPriceCents))
      ? Math.max(0, Math.floor(Number(itemIntent.targetPriceCents)))
      : null;
    if (!card) {
      return;
    }

    if (card.refreshItemBtn) {
      card.refreshItemBtn.addEventListener("click", () => {
        onRefreshItem(appId).catch(() => setStatus("Failed to refresh item.", true));
      });
    }

    const triageActions = [
      {
        key: "buy",
        btn: card.triageBuyBtn,
        patch: { buy: itemIntent.buy === 2 ? 0 : 2 },
        isActive: (intent) => intent.buy === 2
      },
      {
        key: "maybe",
        btn: card.triageMaybeBtn,
        patch: { buy: itemIntent.buy === 1 ? 0 : 1 },
        isActive: (intent) => intent.buy === 1
      },
      {
        key: "track",
        btn: card.triageTrackBtn,
        patch: { track: itemIntent.track > 0 ? 0 : 1 },
        isActive: (intent) => intent.track > 0
      },
      { key: "archive", btn: card.triageArchiveBtn, patch: { track: 0, buy: 0, owned: true }, isActive: (intent) => intent.owned }
    ];
    for (const action of triageActions) {
      if (!action.btn) {
        continue;
      }
      if (action.key === "track") {
        action.btn.textContent = itemIntent.track > 0 ? "Unfollow" : "Follow";
      }
      action.btn.classList.toggle("active", Boolean(action.isActive?.(itemIntent)));
      action.btn.addEventListener("click", async () => {
        try {
          await onSetIntent(appId, action.patch || {});
          if (action.key === "track") {
            setStatus(itemIntent.track > 0 ? "Unfollowed on Steam." : "Followed on Steam.");
          }
        } catch (error) {
          setStatus(String(error?.message || "Failed to update intent."), true);
        }
      });
    }

    const workflowActions = [];
    for (const entry of workflowActions) {
      if (!entry.btn) {
        continue;
      }
      entry.btn.addEventListener("click", async () => {
        try {
          await onSetIntent(appId, entry.patch);
          setStatus(entry.ok);
        } catch (error) {
          setStatus(String(error?.message || "Failed to apply workflow action."), true);
        }
      });
    }
    const parseTargetValueToCents = (raw) => {
      const normalized = String(raw || "").trim().replace(",", ".");
      if (!normalized) {
        return null;
      }
      const amount = Number(normalized);
      if (!Number.isFinite(amount) || amount < 0) {
        return null;
      }
      return Math.round(amount * 100);
    };
    if (card.targetPriceInput) {
      card.targetPriceInput.value = Number.isFinite(targetPriceCents) && targetPriceCents > 0
        ? String((targetPriceCents / 100).toFixed(2))
        : "";
      card.targetPriceInput.addEventListener("keydown", async (event) => {
        if (event.key !== "Enter") {
          return;
        }
        event.preventDefault();
        try {
          const rawTarget = String(card.targetPriceInput.value || "").trim();
          if (!rawTarget) {
            await onSetIntent(appId, { targetPriceCents: null });
            setStatus("Target price cleared.");
            return;
          }
          const nextTarget = parseTargetValueToCents(rawTarget);
          if (nextTarget === null) {
            setStatus("Enter a valid target price (for example: 59.90).", true);
            return;
          }
          await onSetIntent(appId, { targetPriceCents: nextTarget });
          setStatus("Target price saved.");
        } catch (error) {
          setStatus(String(error?.message || "Failed to save target price."), true);
        }
      });
    }

    if (!card.removeBtn) {
      // keep going, remove button is optional
    } else {
      card.removeBtn.style.display = sourceMode === "wishlist" ? "none" : "";
      card.removeBtn.addEventListener("click", async () => {
        if (sourceMode === "wishlist") {
          return;
        }
        if (!activeCollection || activeCollection === "__all__") {
          setStatus("Select a specific collection to remove items.", true);
          return;
        }

        const confirmed = confirmFn(`Remove AppID ${appId} from collection "${activeCollection}"?`);
        if (!confirmed) {
          return;
        }

        await onRemoveItem(appId, activeCollection);
      });
    }

    const allCollectionNames = Array.isArray(options?.allCollectionNames) ? options.allCollectionNames : [];
    const selectedCollectionNames = new Set(Array.isArray(options?.selectedCollectionNames) ? options.selectedCollectionNames : []);
    const onToggleCollection = options?.onToggleCollection || (() => Promise.resolve());
    const batchMode = Boolean(options?.batchMode);
    const isBatchSelected = typeof options?.isBatchSelected === "function"
      ? options.isBatchSelected
      : () => false;
    const onBatchSelectionChange = options?.onBatchSelectionChange || (() => {});
    const reorderEnabled = Boolean(options?.reorderEnabled);
    const itemPosition = Number(options?.itemPosition || 0);
    const totalItems = Number(options?.totalItems || 0);
    const maxPositionDigits = Math.max(1, Number(options?.maxPositionDigits || 1));
    const onMoveUp = options?.onMoveUp || (() => Promise.resolve());
    const onMoveDown = options?.onMoveDown || (() => Promise.resolve());
    const onMoveToPosition = options?.onMoveToPosition || (() => Promise.resolve());

    if (card.collectionsDropdown) {
      card.collectionsDropdown.innerHTML = "";
      if (allCollectionNames.length === 0) {
        const empty = document.createElement("p");
        empty.className = "collections-dropdown-empty";
        empty.textContent = "No static collections yet.";
        card.collectionsDropdown.appendChild(empty);
      } else {
        for (const collectionName of allCollectionNames) {
          const row = document.createElement("label");
          row.className = "collection-checkbox-row";

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = selectedCollectionNames.has(collectionName);
          checkbox.addEventListener("change", async () => {
            try {
              await onToggleCollection(appId, collectionName, checkbox.checked);
              if (checkbox.checked) {
                selectedCollectionNames.add(collectionName);
              } else {
                selectedCollectionNames.delete(collectionName);
              }
            } catch (error) {
              checkbox.checked = !checkbox.checked;
              setStatus(String(error?.message || "Failed to update collections."), true);
            }
          });

          const name = document.createElement("span");
          name.className = "collection-checkbox-name";
          name.textContent = collectionName;

          row.appendChild(checkbox);
          row.appendChild(name);
          card.collectionsDropdown.appendChild(row);
        }
      }
    }

    if (card.collectionsToggleBtn && card.collectionsDropdown) {
      card.collectionsToggleBtn.disabled = allCollectionNames.length === 0;
      card.collectionsToggleBtn.addEventListener("click", () => {
        card.collectionsDropdown.classList.toggle("hidden");
      });
      card.collectionsDropdown.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      if (allCollectionNames.length === 0) {
        card.collectionsDropdown.classList.add("hidden");
      }
    }

    if (card.batchCheckbox) {
      card.batchCheckbox.checked = Boolean(isBatchSelected(appId));
      card.batchCheckbox.disabled = !batchMode;
      card.batchCheckbox.style.display = batchMode ? "" : "none";
      card.batchCheckbox.addEventListener("change", () => {
        onBatchSelectionChange(appId, card.batchCheckbox.checked);
      });
    }

    if (card.orderUpBtn) {
      card.orderUpBtn.disabled = !reorderEnabled || itemPosition <= 1;
      card.orderUpBtn.addEventListener("click", () => {
        onMoveUp(appId).catch(() => setStatus("Failed to move item up.", true));
      });
    }

    if (card.orderDownBtn) {
      card.orderDownBtn.disabled = !reorderEnabled || itemPosition <= 0 || itemPosition >= totalItems;
      card.orderDownBtn.addEventListener("click", () => {
        onMoveDown(appId).catch(() => setStatus("Failed to move item down.", true));
      });
    }

    if (card.orderPositionInput) {
      card.orderPositionInput.value = itemPosition > 0 ? String(itemPosition) : "";
      card.orderPositionInput.disabled = !reorderEnabled;
      card.orderPositionInput.style.setProperty("--pos-digits", String(maxPositionDigits));
      card.orderPositionInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }
        event.preventDefault();
        const target = Number(card.orderPositionInput?.value || 0);
        onMoveToPosition(appId, target).catch(() => setStatus("Failed to move item to position.", true));
      });
    }

  }

  function hydrateCardMeta(options) {
    const card = options?.card;
    const appId = String(options?.appId || "");
    const hasStateTitle = Boolean(options?.hasStateTitle);
    const fetchMeta = options?.fetchMeta || (() => Promise.resolve({}));
    const itemIntent = options?.itemIntent && typeof options.itemIntent === "object" ? options.itemIntent : {};
    const targetPriceCents = Number.isFinite(Number(itemIntent.targetPriceCents))
      ? Math.max(0, Math.floor(Number(itemIntent.targetPriceCents)))
      : null;
    if (!card) {
      return;
    }

    fetchMeta(appId).then((meta) => {
      if (card.cover) {
        const preferredCover = String(meta?.capsuleImageV5 || meta?.capsuleImage || meta?.headerImage || "").trim();
        if (preferredCover) {
          attachImageFallback(card.cover, buildImageCandidates(appId, preferredCover));
        }
      }
      if (card.titleEl && !hasStateTitle && meta.titleText) {
        card.titleEl.textContent = meta.titleText;
      }
      if (card.pricingEl) {
        card.pricingEl.textContent = `Price: ${meta.priceText || "-"}`;
      }
      if (card.discountEl) {
        card.discountEl.textContent = `Discount: ${meta.discountText || "-"}`;
      }
      const priceLabel = String(meta?.priceText || "").trim().toLowerCase();
      const priceKnown = priceLabel && priceLabel !== "-" && priceLabel !== "not announced";
      const priceCents = Number(meta?.priceFinal || 0);
      const hasTarget = Number.isFinite(targetPriceCents) && targetPriceCents > 0;
      const hit = hasTarget && priceKnown && Number.isFinite(priceCents) && priceCents <= targetPriceCents;
      if (card.cardEl) {
        card.cardEl.classList.toggle("target-hit", hit);
      }
      if (card.reviewEl) {
        card.reviewEl.textContent = `Reviews: ${meta.reviewText || "-"}`;
      }
      if (card.releaseEl) {
        card.releaseEl.textContent = `Release: ${meta.releaseText || "-"}`;
      }
      if (card.tagsRowEl) {
        card.tagsRowEl.innerHTML = "";
        for (const tag of meta.tags || []) {
          const chip = document.createElement("span");
          chip.className = "tag-chip";
          chip.textContent = tag;
          card.tagsRowEl.appendChild(chip);
        }
      }
    });
  }

  window.SWMCollectionsCardRender = {
    createCardNodes,
    fillCardStatic,
    bindCardActions,
    hydrateCardMeta,
    bindMediaPreviewHover
  };
})();
