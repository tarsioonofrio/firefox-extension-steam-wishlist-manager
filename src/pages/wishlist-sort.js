(() => {
  function getEffectiveSortPriceFromMeta(meta) {
    const data = meta || {};
    const isFree = String(data.priceText || "").trim().toLowerCase() === "free";
    if (isFree) {
      return 0;
    }
    const finalPrice = Number(data.priceFinal);
    if (Number.isFinite(finalPrice) && finalPrice > 0) {
      return finalPrice;
    }
    return Number.POSITIVE_INFINITY;
  }

  function sortByWishlistPriority(ids, priorityMap) {
    const indexed = (Array.isArray(ids) ? ids : []).map((id, index) => ({ id, index }));
    const map = priorityMap || {};
    indexed.sort((a, b) => {
      const pa = Number(map[a.id]);
      const pb = Number(map[b.id]);
      const hasPa = Number.isFinite(pa);
      const hasPb = Number.isFinite(pb);
      if (hasPa && hasPb) {
        return pa - pb;
      }
      if (hasPa) {
        return -1;
      }
      if (hasPb) {
        return 1;
      }
      return a.index - b.index;
    });
    return indexed.map((entry) => entry.id);
  }

  function stableSorted(ids, compareFn) {
    const indexed = (Array.isArray(ids) ? ids : []).map((id, index) => ({ id, index }));
    indexed.sort((a, b) => {
      const byRule = compareFn(a.id, b.id);
      if (byRule !== 0) {
        return byRule;
      }
      return a.index - b.index;
    });
    return indexed.map((entry) => entry.id);
  }

  function sortIdsByMode(ids, mode, ctx) {
    const source = Array.isArray(ids) ? ids : [];
    const getTitle = ctx?.getTitle || ((id) => String(id));
    const getMetaNumber = ctx?.getMetaNumber || (() => 0);
    const getMeta = ctx?.getMeta || (() => ({}));
    const wishlistAddedMap = ctx?.wishlistAddedMap || {};
    const wishlistPriorityMap = ctx?.wishlistPriorityMap || {};

    if (mode === "position") {
      return sortByWishlistPriority(source, wishlistPriorityMap);
    }

    if (mode === "title") {
      return stableSorted(source, (a, b) =>
        String(getTitle(a)).localeCompare(String(getTitle(b)), "pt-BR", { sensitivity: "base" })
      );
    }

    if (mode === "price") {
      return stableSorted(source, (a, b) =>
        getEffectiveSortPriceFromMeta(getMeta(a)) - getEffectiveSortPriceFromMeta(getMeta(b))
      );
    }

    if (mode === "discount") {
      return stableSorted(source, (a, b) =>
        getMetaNumber(b, "discountPercent", 0) - getMetaNumber(a, "discountPercent", 0)
      );
    }

    if (mode === "date-added") {
      return stableSorted(source, (a, b) =>
        Number(wishlistAddedMap[b] || 0) - Number(wishlistAddedMap[a] || 0)
      );
    }

    if (mode === "top-selling") {
      return stableSorted(source, (a, b) =>
        getMetaNumber(b, "recommendationsTotal", 0) - getMetaNumber(a, "recommendationsTotal", 0)
      );
    }

    if (mode === "release-date") {
      return stableSorted(source, (a, b) =>
        getMetaNumber(b, "releaseUnix", 0) - getMetaNumber(a, "releaseUnix", 0)
      );
    }

    if (mode === "review-score") {
      return stableSorted(source, (a, b) => {
        const pctDiff = getMetaNumber(b, "reviewPositivePct", -1) - getMetaNumber(a, "reviewPositivePct", -1);
        if (pctDiff !== 0) {
          return pctDiff;
        }
        return getMetaNumber(b, "reviewTotalVotes", 0) - getMetaNumber(a, "reviewTotalVotes", 0);
      });
    }

    return [...source];
  }

  function buildWishlistSortOrders(ids, ctx) {
    const modes = [
      "position",
      "title",
      "price",
      "discount",
      "date-added",
      "top-selling",
      "release-date",
      "review-score"
    ];
    const out = {};
    for (const mode of modes) {
      out[mode] = sortIdsByMode(ids, mode, ctx);
    }
    return out;
  }

  window.SWMWishlistSort = {
    buildWishlistSortOrders,
    sortByWishlistPriority,
    sortIdsByMode
  };
})();
