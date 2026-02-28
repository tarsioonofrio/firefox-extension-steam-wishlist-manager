(() => {
  const STATUS_MESSAGES = {
    sessionExpired: "Steam session expired. Please log in on store.steampowered.com and refresh.",
    wishlistUnavailable: "Steam wishlist is empty or unavailable for this session.",
    wishlistIdsUnavailable: "Could not load wishlist IDs from Steam session."
  };

  function normalizeAppIdList(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((id) => String(id || "").trim()).filter(Boolean);
  }

  function buildPriorityMapFromOrderedIds(orderedIds) {
    const normalized = normalizeAppIdList(orderedIds);
    const map = {};
    for (let i = 0; i < normalized.length; i += 1) {
      map[normalized[i]] = i;
    }
    return map;
  }

  function buildZeroAddedMapFromIds(ids) {
    const normalized = normalizeAppIdList(ids);
    const map = {};
    for (const appId of normalized) {
      map[appId] = 0;
    }
    return map;
  }

  function ensureAddedMapHasIds(addedMap, orderedIds) {
    const next = (addedMap && typeof addedMap === "object") ? { ...addedMap } : {};
    for (const appId of normalizeAppIdList(orderedIds)) {
      if (!Object.prototype.hasOwnProperty.call(next, appId)) {
        next[appId] = 0;
      }
    }
    return next;
  }

  window.SWMWishlistLoaderUtils = {
    STATUS_MESSAGES,
    normalizeAppIdList,
    buildPriorityMapFromOrderedIds,
    buildZeroAddedMapFromIds,
    ensureAddedMapHasIds
  };
})();
