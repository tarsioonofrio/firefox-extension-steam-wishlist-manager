(() => {
  const SAFE_FETCH_BASE_DELAY_MS = 350;
  const SAFE_FETCH_JITTER_MS = 220;
  const SAFE_FETCH_MAX_RETRIES = 3;
  const SAFE_FETCH_BLOCK_COOLDOWN_MS = 12_000;

  let steamCooldownUntil = 0;
  let consecutiveThrottleHits = 0;
  const endpointStats = {};

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function nextBackoffDelay(attempt) {
    const jitter = Math.floor(Math.random() * SAFE_FETCH_JITTER_MS);
    return (SAFE_FETCH_BASE_DELAY_MS * (2 ** attempt)) + jitter;
  }

  function shouldRetryStatus(status) {
    return [403, 429, 500, 502, 503, 504].includes(Number(status));
  }

  function getEndpointKey(url) {
    try {
      const parsed = new URL(String(url || ""), location.href);
      const host = String(parsed.host || "").toLowerCase();
      const path = String(parsed.pathname || "").toLowerCase();
      if (host === "api.steampowered.com" && path.includes("/iwishlistservice/getwishlist/v1")) {
        return "api:GetWishlist/v1";
      }
      if (host === "api.steampowered.com" && path.includes("/iwishlistservice/getwishlistsortedfiltered/v1")) {
        return "api:GetWishlistSortedFiltered/v1";
      }
      if (host === "store.steampowered.com" && path.includes("/dynamicstore/userdata/")) {
        return "store:dynamicstore/userdata";
      }
      if (host === "store.steampowered.com" && path.includes("/wishlistdata/")) {
        return "store:wishlistdata";
      }
      if (host === "store.steampowered.com" && path.includes("/api/appdetails")) {
        return "store:api/appdetails";
      }
      if (host === "store.steampowered.com" && path.includes("/appreviews/")) {
        return "store:appreviews";
      }
      const segments = path.split("/").filter(Boolean);
      const keyPath = segments.slice(0, 2).join("/");
      return `${host}:${keyPath || "/"}`;
    } catch {
      return "unknown";
    }
  }

  function getStatsFor(url) {
    const key = getEndpointKey(url);
    if (!endpointStats[key]) {
      endpointStats[key] = {
        endpoint: key,
        requests: 0,
        success: 0,
        fail: 0,
        retries: 0,
        throttles: 0,
        networkErrors: 0,
        lastStatus: 0,
        lastError: "",
        lastAt: 0
      };
    }
    return endpointStats[key];
  }

  async function waitSteamCooldownIfNeeded() {
    const now = Date.now();
    if (steamCooldownUntil > now) {
      await sleep(steamCooldownUntil - now);
    }
  }

  function bumpSteamCooldown(ms = SAFE_FETCH_BLOCK_COOLDOWN_MS) {
    const now = Date.now();
    steamCooldownUntil = Math.max(steamCooldownUntil, now + ms);
  }

  async function fetchWithRetry(url, responseReader, options = {}) {
    const stats = getStatsFor(url);
    let attempt = 0;
    while (true) {
      stats.requests += 1;
      stats.lastAt = Date.now();
      try {
        await waitSteamCooldownIfNeeded();
        const response = await fetch(url, { cache: "no-store", ...options });
        if (response.ok) {
          stats.success += 1;
          stats.lastStatus = Number(response.status || 200);
          stats.lastError = "";
          consecutiveThrottleHits = 0;
          return await responseReader(response);
        }
        stats.fail += 1;
        stats.lastStatus = Number(response.status || 0);
        stats.lastError = `HTTP ${response.status}`;
        if (response.status === 403 || response.status === 429) {
          stats.throttles += 1;
          consecutiveThrottleHits += 1;
          const adaptiveExtra = Math.min(5, consecutiveThrottleHits - 1) * 5000;
          bumpSteamCooldown(SAFE_FETCH_BLOCK_COOLDOWN_MS + (attempt * 3000) + adaptiveExtra);
        } else if (consecutiveThrottleHits > 0) {
          consecutiveThrottleHits = Math.max(0, consecutiveThrottleHits - 1);
        }
        if (attempt < SAFE_FETCH_MAX_RETRIES && shouldRetryStatus(response.status)) {
          stats.retries += 1;
          await sleep(nextBackoffDelay(attempt));
          attempt += 1;
          continue;
        }
        throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        stats.lastError = String(error?.message || error || "network error");
        if (!stats.lastStatus) {
          stats.networkErrors += 1;
          stats.fail += 1;
        }
        if (attempt >= SAFE_FETCH_MAX_RETRIES) {
          throw error;
        }
        stats.retries += 1;
        await sleep(nextBackoffDelay(attempt));
        attempt += 1;
      }
    }
  }

  async function fetchJson(url, options = {}) {
    return fetchWithRetry(url, (response) => response.json(), options);
  }

  async function fetchText(url, options = {}) {
    return fetchWithRetry(url, (response) => response.text(), options);
  }

  function getTelemetry() {
    const now = Date.now();
    return {
      cooldownUntil: steamCooldownUntil,
      cooldownMsRemaining: Math.max(0, steamCooldownUntil - now),
      consecutiveThrottleHits,
      endpoints: Object.values(endpointStats)
        .sort((a, b) => (b.fail - a.fail) || (b.requests - a.requests) || a.endpoint.localeCompare(b.endpoint))
        .map((entry) => ({ ...entry }))
    };
  }

  function getTelemetrySummary(limit = 2) {
    const data = getTelemetry();
    const endpointParts = data.endpoints
      .slice(0, Math.max(1, Number(limit || 2)))
      .map((entry) => `${entry.endpoint} ok:${entry.success} fail:${entry.fail} retry:${entry.retries}`);
    const cooldownPart = data.cooldownMsRemaining > 0
      ? `cooldown:${Math.ceil(data.cooldownMsRemaining / 1000)}s`
      : "cooldown:0s";
    return `net ${cooldownPart} | ${endpointParts.join(" | ")}`;
  }

  function clearTelemetry() {
    steamCooldownUntil = 0;
    consecutiveThrottleHits = 0;
    for (const key of Object.keys(endpointStats)) {
      delete endpointStats[key];
    }
  }

  window.SWMSteamFetch = {
    fetchJson,
    fetchText,
    getTelemetry,
    getTelemetrySummary,
    clearTelemetry
  };
})();
