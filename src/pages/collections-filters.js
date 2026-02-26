(() => {
  function isSetLike(value) {
    return Boolean(value)
      && typeof value.has === "function"
      && Number.isFinite(Number(value.size));
  }

  function passesArrayFilter(getMetaArray, appId, key, selectedSet) {
    if (!isSetLike(selectedSet) || selectedSet.size === 0) {
      return true;
    }
    const values = getMetaArray(appId, key);
    return values.some((value) => selectedSet.has(value));
  }

  function passesArrayFilterAll(getMetaArray, appId, key, selectedSet) {
    if (!isSetLike(selectedSet) || selectedSet.size === 0) {
      return true;
    }
    const values = new Set(getMetaArray(appId, key));
    for (const selectedValue of selectedSet) {
      if (!values.has(selectedValue)) {
        return false;
      }
    }
    return true;
  }

  function getPriceForFilter(meta) {
    const isFree = String(meta?.priceText || "").trim().toLowerCase() === "free";
    if (isFree) {
      return 0;
    }
    const finalPrice = Number(meta?.priceFinal);
    if (Number.isFinite(finalPrice) && finalPrice > 0) {
      return finalPrice / 100;
    }
    return null;
  }

  function getFilteredAndSorted(ids, ctx) {
    const source = Array.isArray(ids) ? ids : [];
    const searchQuery = String(ctx?.searchQuery || "").toLowerCase();
    const sourceMode = String(ctx?.sourceMode || "collections");
    const sortMode = String(ctx?.sortMode || "title");
    const wishlistSortOrders = ctx?.wishlistSortOrders || {};
    const isWishlistRankReady = typeof ctx?.isWishlistRankReady === "function"
      ? ctx.isWishlistRankReady
      : () => false;
    const getSortContext = typeof ctx?.getSortContext === "function"
      ? ctx.getSortContext
      : () => ({});
    const sortUtils = ctx?.sortUtils || null;
    const sortByWishlistPriority = typeof ctx?.sortByWishlistPriority === "function"
      ? ctx.sortByWishlistPriority
      : (list) => [...list];
    const getTitle = typeof ctx?.getTitle === "function"
      ? ctx.getTitle
      : (appId) => String(appId);
    const getMeta = typeof ctx?.getMeta === "function"
      ? ctx.getMeta
      : () => ({});
    const getMetaTags = typeof ctx?.getMetaTags === "function"
      ? ctx.getMetaTags
      : () => [];
    const getMetaType = typeof ctx?.getMetaType === "function"
      ? ctx.getMetaType
      : () => "Unknown";
    const getMetaNumber = typeof ctx?.getMetaNumber === "function"
      ? ctx.getMetaNumber
      : () => 0;
    const getMetaArray = typeof ctx?.getMetaArray === "function"
      ? ctx.getMetaArray
      : () => [];

    const selectedTags = ctx?.selectedTags || new Set();
    const selectedTypes = ctx?.selectedTypes || new Set();
    const selectedPlayers = ctx?.selectedPlayers || new Set();
    const selectedFeatures = ctx?.selectedFeatures || new Set();
    const selectedHardware = ctx?.selectedHardware || new Set();
    const selectedAccessibility = ctx?.selectedAccessibility || new Set();
    const selectedPlatforms = ctx?.selectedPlatforms || new Set();
    const selectedLanguages = ctx?.selectedLanguages || new Set();
    const selectedFullAudioLanguages = ctx?.selectedFullAudioLanguages || new Set();
    const selectedSubtitleLanguages = ctx?.selectedSubtitleLanguages || new Set();
    const selectedTechnologies = ctx?.selectedTechnologies || new Set();
    const selectedDevelopers = ctx?.selectedDevelopers || new Set();
    const selectedPublishers = ctx?.selectedPublishers || new Set();
    const getReleaseFilterData = typeof ctx?.getReleaseFilterData === "function"
      ? ctx.getReleaseFilterData
      : (appId) => {
        const meta = getMeta(appId);
        const releaseText = String(meta?.releaseText || "").replace(/\s+/g, " ").trim();
        let textLabel = "";
        if (releaseText && releaseText !== "-") {
          const lower = releaseText.toLowerCase();
          if (lower.includes("coming soon") || lower === "soon") {
            textLabel = "Soon";
          } else if (lower.includes("tba") || lower.includes("to be announced")) {
            textLabel = "TBA";
          } else {
            textLabel = releaseText;
          }
        }

        let year = 0;
        const unix = getMetaNumber(appId, "releaseUnix", 0);
        if (unix > 0) {
          year = new Date(unix * 1000).getUTCFullYear();
        } else {
          const yearMatch = releaseText.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
          year = yearMatch?.[1] ? Number(yearMatch[1]) : 0;
        }
        return { year, textLabel };
      };
    const releaseTextEnabled = Boolean(ctx?.releaseTextEnabled);
    const releaseYearRangeEnabled = Boolean(ctx?.releaseYearRangeEnabled);
    const releaseYearMin = Number(ctx?.releaseYearMin ?? 1970);
    const releaseYearMax = Number(ctx?.releaseYearMax ?? new Date().getUTCFullYear() + 1);

    const ratingMin = Number(ctx?.ratingMin ?? 0);
    const ratingMax = Number(ctx?.ratingMax ?? 100);
    const reviewsMin = Number(ctx?.reviewsMin ?? 0);
    const reviewsMax = Number(ctx?.reviewsMax ?? 999999999);
    const discountMin = Number(ctx?.discountMin ?? 0);
    const discountMax = Number(ctx?.discountMax ?? 100);
    const priceMin = Number(ctx?.priceMin ?? 0);
    const priceMax = Number(ctx?.priceMax ?? 9999999);

    function passesTagFilter(appId) {
      if (selectedTags.size === 0) {
        return true;
      }
      const tags = getMetaTags(appId);
      return tags.some((tag) => selectedTags.has(tag));
    }

    function passesTypeFilter(appId) {
      if (selectedTypes.size === 0) {
        return true;
      }
      return selectedTypes.has(getMetaType(appId));
    }

    function passesReviewFilter(appId) {
      const hasPctFilter = ratingMin > 0 || ratingMax < 100;
      const hasCountFilter = reviewsMin > 0 || reviewsMax < 999999999;
      if (!hasPctFilter && !hasCountFilter) {
        return true;
      }
      const pct = getMetaNumber(appId, "reviewPositivePct", -1);
      const votes = getMetaNumber(appId, "reviewTotalVotes", 0);
      if (pct < 0 || votes <= 0) {
        return true;
      }
      return pct >= ratingMin && pct <= ratingMax && votes >= reviewsMin && votes <= reviewsMax;
    }

    function passesDiscountFilter(appId) {
      const hasDiscountFilter = discountMin > 0 || discountMax < 100;
      if (!hasDiscountFilter) {
        return true;
      }
      const pct = getMetaNumber(appId, "discountPercent", 0);
      return pct >= discountMin && pct <= discountMax;
    }

    function passesPriceFilter(appId) {
      const hasPriceFilter = priceMin > 0 || priceMax < 9999999;
      if (!hasPriceFilter) {
        return true;
      }
      const price = getPriceForFilter(getMeta(appId));
      if (price === null) {
        return false;
      }
      return price >= priceMin && price <= priceMax;
    }

    function passesReleaseYearFilter(appId) {
      const hasTextFilter = releaseTextEnabled;
      const hasRangeFilter = releaseYearRangeEnabled;
      if (!hasTextFilter && !hasRangeFilter) {
        return false;
      }

      const info = getReleaseFilterData(appId) || {};
      const textLabel = String(info.textLabel || "");
      const year = Number(info.year || 0);

      const textMatch = hasTextFilter ? Boolean(textLabel) : false;
      const rangeMatch = hasRangeFilter
        ? (Number.isFinite(year) && year >= releaseYearMin && year <= releaseYearMax)
        : false;

      if (hasTextFilter && hasRangeFilter) {
        return textMatch || rangeMatch;
      }
      if (hasTextFilter) {
        return textMatch;
      }
      return rangeMatch;
    }

    const effectiveSortMode = (sortMode === "position" && !isWishlistRankReady(source))
      ? "title"
      : sortMode;
    const baseIds = (sourceMode === "wishlist" && Array.isArray(wishlistSortOrders?.[effectiveSortMode]) && wishlistSortOrders[effectiveSortMode].length)
      ? wishlistSortOrders[effectiveSortMode]
      : source;

    const list = baseIds.filter((appId) => {
      const title = String(getTitle(appId)).toLowerCase();
      const textOk = !searchQuery || title.includes(searchQuery) || String(appId).includes(searchQuery);
      return textOk
        && passesTagFilter(appId)
        && passesTypeFilter(appId)
        && passesReviewFilter(appId)
        && passesDiscountFilter(appId)
        && passesPriceFilter(appId)
        && passesReleaseYearFilter(appId)
        && passesArrayFilter(getMetaArray, appId, "players", selectedPlayers)
        && passesArrayFilter(getMetaArray, appId, "features", selectedFeatures)
        && passesArrayFilter(getMetaArray, appId, "hardware", selectedHardware)
        && passesArrayFilter(getMetaArray, appId, "accessibility", selectedAccessibility)
        && passesArrayFilter(getMetaArray, appId, "platforms", selectedPlatforms)
        && passesArrayFilter(getMetaArray, appId, "languages", selectedLanguages)
        && passesArrayFilterAll(getMetaArray, appId, "fullAudioLanguages", selectedFullAudioLanguages)
        && passesArrayFilterAll(getMetaArray, appId, "subtitleLanguages", selectedSubtitleLanguages)
        && passesArrayFilter(getMetaArray, appId, "technologies", selectedTechnologies)
        && passesArrayFilter(getMetaArray, appId, "developers", selectedDevelopers)
        && passesArrayFilter(getMetaArray, appId, "publishers", selectedPublishers);
    });

    if (sourceMode === "wishlist" && Array.isArray(wishlistSortOrders?.[effectiveSortMode]) && wishlistSortOrders[effectiveSortMode].length) {
      return list;
    }

    if (sortUtils?.sortIdsByMode) {
      if (effectiveSortMode === "position" && sourceMode === "wishlist") {
        return sortUtils.sortIdsByMode(list, "position", getSortContext());
      }
      if (effectiveSortMode !== "position") {
        return sortUtils.sortIdsByMode(list, effectiveSortMode, getSortContext());
      }
    }

    if (effectiveSortMode === "position" && sourceMode === "wishlist") {
      return sortByWishlistPriority(list);
    }

    return list;
  }

  window.SWMCollectionsFilters = {
    getFilteredAndSorted
  };
})();
