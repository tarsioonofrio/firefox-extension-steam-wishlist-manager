(() => {
  function createCardNodes(options) {
    const template = options?.template;
    const appId = String(options?.appId || "");
    const title = String(options?.title || `App ${appId}`);
    const link = String(options?.link || "");
    const fragment = template.content.cloneNode(true);
    return {
      appId,
      fragment,
      title,
      link,
      coverLink: fragment.querySelector(".cover-link"),
      cover: fragment.querySelector(".cover"),
      titleEl: fragment.querySelector(".title"),
      appidEl: fragment.querySelector(".appid"),
      pricingEl: fragment.querySelector(".pricing"),
      discountEl: fragment.querySelector(".discount"),
      tagsRowEl: fragment.querySelector(".tags-row"),
      reviewEl: fragment.querySelector(".review"),
      releaseEl: fragment.querySelector(".release"),
      wishlistAddedEl: fragment.querySelector(".wishlist-added"),
      refreshItemBtn: fragment.querySelector(".refresh-item-btn"),
      removeBtn: fragment.querySelector(".remove-btn")
    };
  }

  function fillCardStatic(options) {
    const card = options?.card;
    const appId = String(options?.appId || "");
    const imageUrl = String(options?.imageUrl || "");
    const wishlistDate = String(options?.wishlistDate || "-");
    if (!card) {
      return;
    }
    if (card.coverLink) {
      card.coverLink.href = card.link;
    }
    if (card.cover) {
      card.cover.src = imageUrl;
      card.cover.alt = card.title;
      card.cover.loading = "lazy";
    }
    if (card.titleEl) {
      card.titleEl.textContent = card.title;
      card.titleEl.href = card.link;
    }
    if (card.appidEl) {
      card.appidEl.textContent = `AppID: ${appId}`;
    }
    if (card.wishlistAddedEl) {
      card.wishlistAddedEl.textContent = `Wishlist: ${wishlistDate}`;
    }
  }

  function bindCardActions(options) {
    const card = options?.card;
    const appId = String(options?.appId || "");
    const sourceMode = String(options?.sourceMode || "collections");
    const activeCollection = String(options?.activeCollection || "__all__");
    const onRefreshItem = options?.onRefreshItem || (() => Promise.resolve());
    const onRemoveItem = options?.onRemoveItem || (() => Promise.resolve());
    const setStatus = options?.setStatus || (() => {});
    const confirmFn = options?.confirmFn || ((message) => window.confirm(message));
    if (!card) {
      return;
    }

    if (card.refreshItemBtn) {
      card.refreshItemBtn.addEventListener("click", () => {
        onRefreshItem(appId).catch(() => setStatus("Failed to refresh item.", true));
      });
    }

    if (!card.removeBtn) {
      return;
    }

    card.removeBtn.style.display = sourceMode === "wishlist" ? "none" : "";
    card.removeBtn.addEventListener("click", async () => {
      if (sourceMode === "wishlist") {
        return;
      }
      if (!activeCollection || activeCollection === "__all__") {
        setStatus("Select a specific collection to remove items.", true);
        return;
      }

      const confirmed = confirmFn(`Remove AppID ${appId} from collection "${activeCollection}"?`);
      if (!confirmed) {
        return;
      }

      await onRemoveItem(appId, activeCollection);
    });
  }

  function hydrateCardMeta(options) {
    const card = options?.card;
    const appId = String(options?.appId || "");
    const hasStateTitle = Boolean(options?.hasStateTitle);
    const fetchMeta = options?.fetchMeta || (() => Promise.resolve({}));
    if (!card) {
      return;
    }

    fetchMeta(appId).then((meta) => {
      if (card.titleEl && !hasStateTitle && meta.titleText) {
        card.titleEl.textContent = meta.titleText;
      }
      if (card.pricingEl) {
        card.pricingEl.textContent = `Price: ${meta.priceText || "-"}`;
      }
      if (card.discountEl) {
        card.discountEl.textContent = `Discount: ${meta.discountText || "-"}`;
      }
      if (card.reviewEl) {
        card.reviewEl.textContent = `Reviews: ${meta.reviewText || "-"}`;
      }
      if (card.releaseEl) {
        card.releaseEl.textContent = `Release: ${meta.releaseText || "-"}`;
      }
      if (card.tagsRowEl) {
        card.tagsRowEl.innerHTML = "";
        for (const tag of meta.tags || []) {
          const chip = document.createElement("span");
          chip.className = "tag-chip";
          chip.textContent = tag;
          card.tagsRowEl.appendChild(chip);
        }
      }
    });
  }

  window.SWMCollectionsCardRender = {
    createCardNodes,
    fillCardStatic,
    bindCardActions,
    hydrateCardMeta
  };
})();
