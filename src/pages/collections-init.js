(() => {
  async function run(options) {
    const loadMetaCache = options?.loadMetaCache || (async () => {});
    const loadWishlistAddedMap = options?.loadWishlistAddedMap || (async () => {});
    const refreshState = options?.refreshState || (async () => ({}));
    const setActiveCollectionFromState = options?.setActiveCollectionFromState || (() => {});
    const attachEvents = options?.attachEvents || (() => {});
    const quickPopulateFiltersFromCache = options?.quickPopulateFiltersFromCache || (() => {});
    const renderRatingControls = options?.renderRatingControls || (() => {});
    const render = options?.render || (async () => {});
    const refreshFilterOptionsInBackground = options?.refreshFilterOptionsInBackground || (() => {});
    const refreshWholeDatabase = options?.refreshWholeDatabase || (async () => {});
    const syncFollowedFromSteam = options?.syncFollowedFromSteam || (async () => {});

    await loadMetaCache();
    await loadWishlistAddedMap();
    const state = await refreshState();
    setActiveCollectionFromState(state);
    await syncFollowedFromSteam();

    attachEvents();
    quickPopulateFiltersFromCache();
    renderRatingControls();
    await render();

    refreshFilterOptionsInBackground();

    const refreshAll = new URLSearchParams(window.location.search).get("refreshAll") === "1";
    if (refreshAll) {
      await refreshWholeDatabase();
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, "", cleanUrl);
    }
  }

  window.SWMCollectionsInit = {
    run
  };
})();
