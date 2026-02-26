(() => {
  const ALLOWED_SORTS = new Set([
    "position",
    "title",
    "price",
    "discount",
    "date-added",
    "top-selling",
    "release-date",
    "review-score"
  ]);

  function resolveCollectionSelection(value, wishlistSelectValue) {
    const raw = String(value || "__all__");
    const sourceMode = raw === String(wishlistSelectValue || "__wishlist__") ? "wishlist" : "collections";
    return {
      sourceMode,
      activeCollection: sourceMode === "wishlist" ? "__all__" : raw,
      page: 1
    };
  }

  function resolveSortSelection(value, sourceMode, isWishlistRankReady) {
    const candidate = String(value || "position");
    const nextSort = ALLOWED_SORTS.has(candidate) ? candidate : "title";
    const isReady = typeof isWishlistRankReady === "function" ? isWishlistRankReady() : false;

    if (nextSort === "position" && !isReady) {
      return {
        sortMode: "position",
        page: 1,
        statusMessage: "Your rank is still syncing; temporarily showing Title order."
      };
    }

    return {
      sortMode: nextSort,
      page: 1,
      statusMessage: ""
    };
  }

  window.SWMCollectionsActions = {
    resolveCollectionSelection,
    resolveSortSelection
  };
})();
