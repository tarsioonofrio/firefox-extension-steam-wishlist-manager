(() => {
  function clearSearchInputs(inputIds) {
    const ids = Array.isArray(inputIds) ? inputIds : [];
    for (const id of ids) {
      const input = document.getElementById(id);
      if (input) {
        input.value = "";
      }
    }
  }

  function resetFilterState(options) {
    const sets = options?.sets || [];
    const tagShowStep = Number(options?.tagShowStep || 12);

    for (const set of sets) {
      if (set instanceof Set) {
        set.clear();
      }
    }

    return {
      languageSearchQuery: "",
      fullAudioLanguageSearchQuery: "",
      subtitleLanguageSearchQuery: "",
      technologySearchQuery: "",
      developerSearchQuery: "",
      publisherSearchQuery: "",
      tagSearchQuery: "",
      tagShowLimit: tagShowStep
    };
  }

  window.SWMCollectionsFilterState = {
    clearSearchInputs,
    resetFilterState
  };
})();
