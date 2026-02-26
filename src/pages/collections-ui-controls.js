(() => {
  function renderCollectionSelect(options) {
    const state = options?.state || null;
    const sourceMode = String(options?.sourceMode || "collections");
    const activeCollection = String(options?.activeCollection || "__all__");
    const wishlistCount = Number(options?.wishlistCount || 0);
    const wishlistSelectValue = String(options?.wishlistSelectValue || "__wishlist__");
    const collectionSizes = options?.collectionSizes || {};
    const dynamicNames = new Set(Array.isArray(options?.dynamicNames) ? options.dynamicNames : []);

    const select = document.getElementById("collection-select");
    const selectBtn = document.getElementById("collection-select-btn");
    const selectMenu = document.getElementById("collection-select-options");
    const deleteSelect = document.getElementById("delete-collection-select");
    if (!select || !selectBtn || !selectMenu || !state) {
      return { activeCollection };
    }

    select.innerHTML = "";

    const wishlistOption = document.createElement("option");
    wishlistOption.value = wishlistSelectValue;
    wishlistOption.textContent = `Steam wishlist (${wishlistCount})`;
    select.appendChild(wishlistOption);

    const allOption = document.createElement("option");
    allOption.value = "__all__";
    allOption.textContent = "All collections";
    select.appendChild(allOption);

    for (const name of state.collectionOrder || []) {
      const option = document.createElement("option");
      option.value = name;
      const count = Number(collectionSizes?.[name] ?? (state.collections?.[name] || []).length);
      const suffix = dynamicNames.has(name) ? " [dynamic]" : "";
      option.textContent = `${name}${suffix} (${Number.isFinite(count) ? count : 0})`;
      select.appendChild(option);
    }

    const validValues = Array.from(select.options).map((o) => o.value);
    let nextActiveCollection = activeCollection;
    if (!validValues.includes(nextActiveCollection)) {
      nextActiveCollection = validValues.includes(state.activeCollection) ? state.activeCollection : "__all__";
    }

    select.value = sourceMode === "wishlist" ? wishlistSelectValue : nextActiveCollection;
    const selectedOption = select.options[select.selectedIndex];
    selectBtn.textContent = `Collection: ${selectedOption?.textContent || "Select"}`;

    selectMenu.innerHTML = "";
    for (const option of Array.from(select.options)) {
      const itemBtn = document.createElement("button");
      itemBtn.type = "button";
      itemBtn.className = "dropdown-option";
      if (option.value === select.value) {
        itemBtn.classList.add("active");
      }
      itemBtn.textContent = option.textContent || option.value;
      itemBtn.dataset.value = option.value;
      selectMenu.appendChild(itemBtn);
    }

    if (deleteSelect) {
      deleteSelect.innerHTML = "";
      for (const name of state.collectionOrder || []) {
        const option = document.createElement("option");
        option.value = name;
        const count = Number(collectionSizes?.[name] ?? (state.collections?.[name] || []).length);
        const suffix = dynamicNames.has(name) ? " [dynamic]" : "";
        option.textContent = `${name}${suffix} (${Number.isFinite(count) ? count : 0})`;
        deleteSelect.appendChild(option);
      }
    }

    return { activeCollection: nextActiveCollection };
  }

  function renderSortMenu(options) {
    const fallbackLabel = String(options?.fallbackLabel || "Release Date");
    const select = document.getElementById("sort-select");
    const btn = document.getElementById("sort-menu-btn");
    const menu = document.getElementById("sort-menu-options");
    if (!select || !btn || !menu) {
      return;
    }

    const selectedOption = select.options[select.selectedIndex];
    btn.textContent = `Sort by: ${selectedOption?.textContent || fallbackLabel}`;

    menu.innerHTML = "";
    for (const option of Array.from(select.options)) {
      const itemBtn = document.createElement("button");
      itemBtn.type = "button";
      itemBtn.className = "dropdown-option";
      if (option.value === select.value) {
        itemBtn.classList.add("active");
      }
      itemBtn.textContent = option.textContent || option.value;
      itemBtn.dataset.value = option.value;
      menu.appendChild(itemBtn);
    }
  }

  function renderViewMenu() {
    const select = document.getElementById("view-select");
    const btn = document.getElementById("view-menu-btn");
    const menu = document.getElementById("view-menu-options");
    if (!select || !btn || !menu) {
      return;
    }

    const selectedOption = select.options[select.selectedIndex];
    btn.textContent = `View: ${selectedOption?.textContent || "Card"}`;

    menu.innerHTML = "";
    for (const option of Array.from(select.options)) {
      const itemBtn = document.createElement("button");
      itemBtn.type = "button";
      itemBtn.className = "dropdown-option";
      if (option.value === select.value) {
        itemBtn.classList.add("active");
      }
      itemBtn.textContent = option.textContent || option.value;
      itemBtn.dataset.value = option.value;
      menu.appendChild(itemBtn);
    }
  }

  function renderPager(options) {
    const totalItems = Number(options?.totalItems || 0);
    const pageSize = Math.max(1, Number(options?.pageSize || 30));
    let page = Math.max(1, Number(options?.page || 1));

    const pageInfo = document.getElementById("page-info");
    const prevBtn = document.getElementById("prev-page-btn");
    const nextBtn = document.getElementById("next-page-btn");
    if (!pageInfo || !prevBtn || !nextBtn) {
      return { page, totalPages: 1 };
    }

    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (page > totalPages) {
      page = totalPages;
    }

    pageInfo.textContent = `Page ${page} / ${totalPages}`;
    prevBtn.disabled = page <= 1;
    nextBtn.disabled = page >= totalPages;
    return { page, totalPages };
  }

  window.SWMCollectionsUiControls = {
    renderCollectionSelect,
    renderSortMenu,
    renderViewMenu,
    renderPager
  };
})();
