(() => {
  const SAFE_FETCH_BASE_DELAY_MS = 350;
  const SAFE_FETCH_JITTER_MS = 220;
  const SAFE_FETCH_MAX_RETRIES = 3;
  const SAFE_FETCH_BLOCK_COOLDOWN_MS = 12_000;

  let steamCooldownUntil = 0;

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
    let attempt = 0;
    while (true) {
      try {
        await waitSteamCooldownIfNeeded();
        const response = await fetch(url, { cache: "no-store", ...options });
        if (response.ok) {
          return await responseReader(response);
        }
        if (response.status === 403 || response.status === 429) {
          bumpSteamCooldown(SAFE_FETCH_BLOCK_COOLDOWN_MS + (attempt * 3000));
        }
        if (attempt < SAFE_FETCH_MAX_RETRIES && shouldRetryStatus(response.status)) {
          await sleep(nextBackoffDelay(attempt));
          attempt += 1;
          continue;
        }
        throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        if (attempt >= SAFE_FETCH_MAX_RETRIES) {
          throw error;
        }
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

  window.SWMSteamFetch = {
    fetchJson,
    fetchText
  };
})();
