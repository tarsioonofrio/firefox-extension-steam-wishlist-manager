(() => {
  const RANK_SOURCE = "wishlist-api-v1";
  const RANK_SOURCE_VERSION = 3;

  function toAppId(value) {
    const appId = String(value || "").trim();
    return /^\d{1,10}$/.test(appId) ? appId : "";
  }

  function normalizeWishlistSnapshotPayload(payload) {
    const rawItems = Array.isArray(payload?.response?.items) ? payload.response.items : [];
    if (rawItems.length === 0) {
      return {
        orderedAppIds: [],
        priorityMap: {},
        addedMap: {}
      };
    }

    const normalized = [];
    for (let i = 0; i < rawItems.length; i += 1) {
      const item = rawItems[i] || {};
      const appId = toAppId(item.appid);
      if (!appId) {
        continue;
      }
      const priority = Number(item.priority);
      const dateAdded = Number(item.date_added || 0);
      normalized.push({
        appId,
        priority: Number.isFinite(priority) ? priority : 0,
        dateAdded: Number.isFinite(dateAdded) && dateAdded > 0 ? dateAdded : 0,
        index: i
      });
    }

    normalized.sort((a, b) => {
      const aRank = a.priority === 0 ? Number.POSITIVE_INFINITY : a.priority;
      const bRank = b.priority === 0 ? Number.POSITIVE_INFINITY : b.priority;
      if (aRank !== bRank) {
        return aRank - bRank;
      }
      if (b.dateAdded !== a.dateAdded) {
        return b.dateAdded - a.dateAdded;
      }
      return a.index - b.index;
    });

    const orderedAppIds = [];
    const priorityMap = {};
    const addedMap = {};
    const seen = new Set();

    for (const entry of normalized) {
      if (seen.has(entry.appId)) {
        continue;
      }
      seen.add(entry.appId);
      orderedAppIds.push(entry.appId);
      priorityMap[entry.appId] = orderedAppIds.length - 1;
      addedMap[entry.appId] = entry.dateAdded;
    }

    return {
      orderedAppIds,
      priorityMap,
      addedMap
    };
  }

  function isRankReady(state, appIds) {
    if (!state) {
      return false;
    }

    const ids = Array.isArray(appIds) ? appIds : [];
    if (ids.length === 0) {
      return false;
    }

    const ordered = Array.isArray(state.orderedAppIds) ? state.orderedAppIds : [];
    if (ordered.length === 0) {
      return false;
    }

    const hasKnownSource = state.prioritySource === RANK_SOURCE && Number(state.prioritySourceVersion) === RANK_SOURCE_VERSION;
    const priorityMap = state.priorityMap || {};
    const orderedSet = new Set(ordered.map((id) => toAppId(id)).filter(Boolean));
    let idsCoveredByOrderedList = true;
    for (const appId of ids) {
      if (!orderedSet.has(String(appId))) {
        idsCoveredByOrderedList = false;
        break;
      }
    }

    let mappedCount = 0;
    for (const appId of ids) {
      if (Number.isFinite(Number(priorityMap[appId]))) {
        mappedCount += 1;
      }
    }
    const mapCoverage = ids.length > 0 ? (mappedCount / ids.length) : 0;
    const mapMostlyReady = mappedCount > 0 && mapCoverage >= 0.9;

    // Rank is ready if we have canonical source with most priorities or an ordered list that fully covers source IDs.
    if (hasKnownSource && (mapMostlyReady || idsCoveredByOrderedList)) {
      return true;
    }

    // Accept non-canonical fallback when ordered IDs cover all items (keeps "Your rank" usable offline/cache-only).
    return idsCoveredByOrderedList || mapMostlyReady;
  }

  function getUnavailableReason(state) {
    if (!state) {
      return "Your rank cache is outdated; syncing latest ranking from API.";
    }
    const hasKnownSource = state.prioritySource === RANK_SOURCE && Number(state.prioritySourceVersion) === RANK_SOURCE_VERSION;
    if (!hasKnownSource && (!Array.isArray(state.orderedAppIds) || state.orderedAppIds.length === 0)) {
      return "Your rank cache is outdated; syncing latest ranking from API.";
    }
    if (state.priorityLastError) {
      return `Your rank unavailable: ${state.priorityLastError}`;
    }
    return "Your rank is still syncing; temporarily showing Title order.";
  }

  window.SWMWishlistRank = {
    RANK_SOURCE,
    RANK_SOURCE_VERSION,
    normalizeWishlistSnapshotPayload,
    isRankReady,
    getUnavailableReason
  };
})();
