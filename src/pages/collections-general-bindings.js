(() => {
  function bindGeneralControls(options) {
    const onSearchInput = options?.onSearchInput || (async () => {});
    const onPrevPage = options?.onPrevPage || (async () => {});
    const onNextPage = options?.onNextPage || (async () => {});
    const onTagSearchInput = options?.onTagSearchInput || (() => {});
    const onTagShowMore = options?.onTagShowMore || (() => {});
    const onTextFilterInput = options?.onTextFilterInput || (() => {});
    const onRefreshPage = options?.onRefreshPage || (() => {});

    document.getElementById("search-input")?.addEventListener("input", async (event) => {
      await onSearchInput(String(event.target.value || ""));
    });

    document.getElementById("prev-page-btn")?.addEventListener("click", async () => {
      await onPrevPage();
    });

    document.getElementById("next-page-btn")?.addEventListener("click", async () => {
      await onNextPage();
    });

    document.getElementById("tag-search-input")?.addEventListener("input", (event) => {
      onTagSearchInput(String(event.target.value || "").trim());
    });

    document.getElementById("tag-show-more-btn")?.addEventListener("click", () => {
      onTagShowMore();
    });

    const textFilters = [
      "languages-search-input",
      "full-audio-languages-search-input",
      "subtitle-languages-search-input",
      "technologies-search-input",
      "developers-search-input",
      "publishers-search-input"
    ];
    for (const inputId of textFilters) {
      document.getElementById(inputId)?.addEventListener("input", (event) => {
        onTextFilterInput(inputId, String(event.target.value || "").trim());
      });
    }

    document.getElementById("refresh-page-btn")?.addEventListener("click", () => {
      onRefreshPage();
    });
  }

  window.SWMCollectionsGeneralBindings = {
    bindGeneralControls
  };
})();
