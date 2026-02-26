(() => {
  function bindCollectionControls(options) {
    const onCollectionChange = options?.onCollectionChange || (async () => {});
    const closeMenusBeforeOpenCollectionSelect = options?.closeMenusBeforeOpenCollectionSelect || (() => {});
    const toggleCollectionSelectMenu = options?.toggleCollectionSelectMenu || (() => {});
    const closeCollectionSelectMenu = options?.closeCollectionSelectMenu || (() => {});

    document.getElementById("collection-select")?.addEventListener("change", async (event) => {
      const value = event.target.value || "__all__";
      await onCollectionChange(value);
    });

    document.getElementById("collection-select-btn")?.addEventListener("click", (event) => {
      event.stopPropagation();
      closeMenusBeforeOpenCollectionSelect();
      toggleCollectionSelectMenu();
    });

    document.getElementById("collection-select-options")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const btn = target.closest("button[data-value]");
      if (!(btn instanceof HTMLButtonElement)) {
        return;
      }
      const value = String(btn.dataset.value || "");
      const select = document.getElementById("collection-select");
      if (!select || !value) {
        return;
      }
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      closeCollectionSelectMenu();
    });
  }

  function bindSortControls(options) {
    const onSortChange = options?.onSortChange || (async () => {});
    const closeMenusBeforeOpenSort = options?.closeMenusBeforeOpenSort || (() => {});
    const toggleSortMenu = options?.toggleSortMenu || (() => {});
    const closeSortMenu = options?.closeSortMenu || (() => {});

    document.getElementById("sort-select")?.addEventListener("change", async (event) => {
      await onSortChange(event.target.value);
    });

    document.getElementById("sort-menu-btn")?.addEventListener("click", (event) => {
      event.stopPropagation();
      closeMenusBeforeOpenSort();
      toggleSortMenu();
    });

    document.getElementById("sort-menu-options")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const btn = target.closest("button[data-value]");
      if (!(btn instanceof HTMLButtonElement)) {
        return;
      }
      const value = String(btn.dataset.value || "");
      const select = document.getElementById("sort-select");
      if (!select || !value || btn.disabled) {
        return;
      }
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      closeSortMenu();
    });
  }

  window.SWMCollectionsSelectionBindings = {
    bindCollectionControls,
    bindSortControls
  };
})();
