(() => {
  function buildImageCandidates(appId, primaryUrl) {
    const base = `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}`;
    const list = [
      String(primaryUrl || "").trim(),
      `${base}/capsule_231x87.jpg`,
      `${base}/header.jpg`,
      `${base}/capsule_616x353.jpg`,
      `${base}/library_600x900.jpg`,
      `${base}/library_600x900_2x.jpg`
    ];
    const out = [];
    const seen = new Set();
    for (const url of list) {
      if (!url || seen.has(url)) {
        continue;
      }
      seen.add(url);
      out.push(url);
    }
    return out;
  }

  function attachImageFallback(imgEl, candidates) {
    if (!imgEl) {
      return;
    }
    const queue = Array.isArray(candidates) ? [...candidates] : [];
    if (queue.length === 0) {
      return;
    }

    const next = () => {
      const candidate = queue.shift();
      if (!candidate) {
        imgEl.removeAttribute("src");
        imgEl.style.visibility = "hidden";
        return;
      }
      imgEl.src = candidate;
    };

    imgEl.onerror = next;
    next();
  }

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
      cardEl: fragment.querySelector(".card"),
      batchCheckbox: fragment.querySelector(".card-batch-checkbox"),
      orderUpBtn: fragment.querySelector(".order-up-btn"),
      orderDownBtn: fragment.querySelector(".order-down-btn"),
      orderPositionInput: fragment.querySelector(".order-position-input"),
      coverLink: fragment.querySelector(".cover-link"),
      cover: fragment.querySelector(".cover"),
      titleEl: fragment.querySelector(".title"),
      appidEl: fragment.querySelector(".appid"),
      pricingEl: fragment.querySelector(".pricing"),
      discountEl: fragment.querySelector(".discount"),
      targetStatusEl: fragment.querySelector(".target-status"),
      tagsRowEl: fragment.querySelector(".tags-row"),
      reviewEl: fragment.querySelector(".review"),
      releaseEl: fragment.querySelector(".release"),
      wishlistAddedEl: fragment.querySelector(".wishlist-added"),
      triageBucketEl: fragment.querySelector(".triage-bucket"),
      triageBuyBtn: fragment.querySelector(".triage-buy-btn"),
      triageMaybeBtn: fragment.querySelector(".triage-maybe-btn"),
      triageTrackBtn: fragment.querySelector(".triage-track-btn"),
      triageArchiveBtn: fragment.querySelector(".triage-archive-btn"),
      targetPriceInput: fragment.querySelector(".target-price-input"),
      targetSaveBtn: fragment.querySelector(".target-save-btn"),
      targetClearBtn: fragment.querySelector(".target-clear-btn"),
      noteInput: fragment.querySelector(".note-input"),
      noteSaveBtn: fragment.querySelector(".note-save-btn"),
      noteClearBtn: fragment.querySelector(".note-clear-btn"),
      refreshItemBtn: fragment.querySelector(".refresh-item-btn"),
      collectionsToggleBtn: fragment.querySelector(".collections-toggle-btn"),
      collectionsDropdown: fragment.querySelector(".collections-dropdown"),
      removeBtn: fragment.querySelector(".remove-btn")
    };
  }

  function fillCardStatic(options) {
    const card = options?.card;
    const appId = String(options?.appId || "");
    const imageUrl = String(options?.imageUrl || "");
    const wishlistDate = String(options?.wishlistDate || "-");
    const itemIntent = options?.itemIntent && typeof options.itemIntent === "object" ? options.itemIntent : {};
    if (!card) {
      return;
    }
    if (card.coverLink) {
      card.coverLink.href = card.link;
    }
    if (card.cover) {
      const imageCandidates = buildImageCandidates(appId, imageUrl);
      attachImageFallback(card.cover, imageCandidates);
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
      const buyIntent = String(itemIntent.buyIntent || "UNSET").toUpperCase();
      const trackIntent = String(itemIntent.trackIntent || "UNSET").toUpperCase();
      const steamWishlistHint = itemIntent.steamWishlisted ? "Steam" : "-";
      card.wishlistAddedEl.textContent = `Wishlisted: ${wishlistDate} | Steam: ${steamWishlistHint} | BuyIntent: ${buyIntent} | TrackIntent: ${trackIntent}`;
    }
  }

  function bindCardActions(options) {
    const card = options?.card;
    const appId = String(options?.appId || "");
    const sourceMode = String(options?.sourceMode || "collections");
    const activeCollection = String(options?.activeCollection || "__all__");
    const onRefreshItem = options?.onRefreshItem || (() => Promise.resolve());
    const onRemoveItem = options?.onRemoveItem || (() => Promise.resolve());
    const onSetIntent = options?.onSetIntent || (() => Promise.resolve());
    const setStatus = options?.setStatus || (() => {});
    const confirmFn = options?.confirmFn || ((message) => window.confirm(message));
    const itemIntent = options?.itemIntent && typeof options.itemIntent === "object" ? options.itemIntent : {};
    const currentBucket = String(itemIntent.bucket || "INBOX").toUpperCase();
    const targetPriceCents = Number.isFinite(Number(itemIntent.targetPriceCents))
      ? Math.max(0, Math.floor(Number(itemIntent.targetPriceCents)))
      : null;
    const noteText = String(itemIntent.note || "");
    if (!card) {
      return;
    }

    if (card.refreshItemBtn) {
      card.refreshItemBtn.addEventListener("click", () => {
        onRefreshItem(appId).catch(() => setStatus("Failed to refresh item.", true));
      });
    }

    if (card.triageBucketEl) {
      card.triageBucketEl.textContent = `Bucket: ${currentBucket}`;
    }

    const triageActions = [
      {
        key: "buy",
        btn: card.triageBuyBtn,
        patch: { buy: itemIntent.buy === 2 ? 0 : 2 },
        isActive: (intent) => intent.buy === 2
      },
      {
        key: "maybe",
        btn: card.triageMaybeBtn,
        patch: { buy: itemIntent.buy === 1 ? 0 : 1 },
        isActive: (intent) => intent.buy === 1
      },
      {
        key: "track",
        btn: card.triageTrackBtn,
        patch: { track: itemIntent.track > 0 ? 0 : 1 },
        isActive: (intent) => intent.track > 0
      },
      { key: "archive", btn: card.triageArchiveBtn, patch: { track: 0, buy: 0, owned: true }, isActive: (intent) => intent.owned }
    ];
    for (const action of triageActions) {
      if (!action.btn) {
        continue;
      }
      if (action.key === "track") {
        action.btn.textContent = itemIntent.track > 0 ? "Unfollow" : "Follow";
      }
      action.btn.classList.toggle("active", Boolean(action.isActive?.(itemIntent)));
      action.btn.addEventListener("click", async () => {
        try {
          await onSetIntent(appId, action.patch || {});
          if (action.key === "track") {
            setStatus(itemIntent.track > 0 ? "Unfollowed on Steam." : "Followed on Steam.");
          }
        } catch (error) {
          setStatus(String(error?.message || "Failed to update intent."), true);
        }
      });
    }

    const workflowActions = [];
    for (const entry of workflowActions) {
      if (!entry.btn) {
        continue;
      }
      entry.btn.addEventListener("click", async () => {
        try {
          await onSetIntent(appId, entry.patch);
          setStatus(entry.ok);
        } catch (error) {
          setStatus(String(error?.message || "Failed to apply workflow action."), true);
        }
      });
    }
    if (card.targetStatusEl) {
      card.targetStatusEl.textContent = targetPriceCents > 0
        ? `Target: ${(targetPriceCents / 100).toFixed(2)}`
        : "Target: -";
    }

    const parseTargetValueToCents = (raw) => {
      const normalized = String(raw || "").trim().replace(",", ".");
      if (!normalized) {
        return null;
      }
      const amount = Number(normalized);
      if (!Number.isFinite(amount) || amount < 0) {
        return null;
      }
      return Math.round(amount * 100);
    };
    if (card.targetPriceInput) {
      card.targetPriceInput.value = Number.isFinite(targetPriceCents) && targetPriceCents > 0
        ? String((targetPriceCents / 100).toFixed(2))
        : "";
      card.targetPriceInput.addEventListener("keydown", async (event) => {
        if (event.key !== "Enter") {
          return;
        }
        event.preventDefault();
        const nextTarget = parseTargetValueToCents(card.targetPriceInput.value);
        if (nextTarget === null) {
          setStatus("Enter a valid target price (for example: 59.90).", true);
          return;
        }
        try {
          await onSetIntent(appId, { targetPriceCents: nextTarget });
          setStatus("Target price saved.");
        } catch (error) {
          setStatus(String(error?.message || "Failed to save target price."), true);
        }
      });
    }
    if (card.targetSaveBtn) {
      card.targetSaveBtn.addEventListener("click", async () => {
        const nextTarget = parseTargetValueToCents(card.targetPriceInput?.value || "");
        if (nextTarget === null) {
          setStatus("Enter a valid target price (for example: 59.90).", true);
          return;
        }
        try {
          await onSetIntent(appId, { targetPriceCents: nextTarget });
          setStatus("Target price saved.");
        } catch (error) {
          setStatus(String(error?.message || "Failed to save target price."), true);
        }
      });
    }
    if (card.targetClearBtn) {
      card.targetClearBtn.addEventListener("click", async () => {
        try {
          await onSetIntent(appId, { targetPriceCents: null });
          setStatus("Target price cleared.");
        } catch (error) {
          setStatus(String(error?.message || "Failed to clear target price."), true);
        }
      });
    }

    if (card.noteInput) {
      card.noteInput.value = noteText;
      card.noteInput.addEventListener("keydown", async (event) => {
        if (event.key !== "Enter") {
          return;
        }
        event.preventDefault();
        try {
          await onSetIntent(appId, { note: String(card.noteInput?.value || "").slice(0, 600) });
          setStatus("Note saved.");
        } catch (error) {
          setStatus(String(error?.message || "Failed to save note."), true);
        }
      });
    }
    if (card.noteSaveBtn) {
      card.noteSaveBtn.addEventListener("click", async () => {
        try {
          await onSetIntent(appId, { note: String(card.noteInput?.value || "").slice(0, 600) });
          setStatus("Note saved.");
        } catch (error) {
          setStatus(String(error?.message || "Failed to save note."), true);
        }
      });
    }
    if (card.noteClearBtn) {
      card.noteClearBtn.addEventListener("click", async () => {
        try {
          await onSetIntent(appId, { note: "" });
          setStatus("Note cleared.");
        } catch (error) {
          setStatus(String(error?.message || "Failed to clear note."), true);
        }
      });
    }

    if (!card.removeBtn) {
      // keep going, remove button is optional
    } else {
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

    const allCollectionNames = Array.isArray(options?.allCollectionNames) ? options.allCollectionNames : [];
    const selectedCollectionNames = new Set(Array.isArray(options?.selectedCollectionNames) ? options.selectedCollectionNames : []);
    const onToggleCollection = options?.onToggleCollection || (() => Promise.resolve());
    const batchMode = Boolean(options?.batchMode);
    const isBatchSelected = typeof options?.isBatchSelected === "function"
      ? options.isBatchSelected
      : () => false;
    const onBatchSelectionChange = options?.onBatchSelectionChange || (() => {});
    const reorderEnabled = Boolean(options?.reorderEnabled);
    const itemPosition = Number(options?.itemPosition || 0);
    const totalItems = Number(options?.totalItems || 0);
    const maxPositionDigits = Math.max(1, Number(options?.maxPositionDigits || 1));
    const onMoveUp = options?.onMoveUp || (() => Promise.resolve());
    const onMoveDown = options?.onMoveDown || (() => Promise.resolve());
    const onMoveToPosition = options?.onMoveToPosition || (() => Promise.resolve());

    if (card.collectionsDropdown) {
      card.collectionsDropdown.innerHTML = "";
      if (allCollectionNames.length === 0) {
        const empty = document.createElement("p");
        empty.className = "collections-dropdown-empty";
        empty.textContent = "No static collections yet.";
        card.collectionsDropdown.appendChild(empty);
      } else {
        for (const collectionName of allCollectionNames) {
          const row = document.createElement("label");
          row.className = "collection-checkbox-row";

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = selectedCollectionNames.has(collectionName);
          checkbox.addEventListener("change", async () => {
            try {
              await onToggleCollection(appId, collectionName, checkbox.checked);
              if (checkbox.checked) {
                selectedCollectionNames.add(collectionName);
              } else {
                selectedCollectionNames.delete(collectionName);
              }
            } catch (error) {
              checkbox.checked = !checkbox.checked;
              setStatus(String(error?.message || "Failed to update collections."), true);
            }
          });

          const name = document.createElement("span");
          name.className = "collection-checkbox-name";
          name.textContent = collectionName;

          row.appendChild(checkbox);
          row.appendChild(name);
          card.collectionsDropdown.appendChild(row);
        }
      }
    }

    if (card.collectionsToggleBtn && card.collectionsDropdown) {
      card.collectionsToggleBtn.disabled = allCollectionNames.length === 0;
      card.collectionsToggleBtn.addEventListener("click", () => {
        card.collectionsDropdown.classList.toggle("hidden");
      });
      card.collectionsDropdown.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      if (allCollectionNames.length === 0) {
        card.collectionsDropdown.classList.add("hidden");
      }
    }

    if (card.batchCheckbox) {
      card.batchCheckbox.checked = Boolean(isBatchSelected(appId));
      card.batchCheckbox.disabled = !batchMode;
      card.batchCheckbox.style.display = batchMode ? "" : "none";
      card.batchCheckbox.addEventListener("change", () => {
        onBatchSelectionChange(appId, card.batchCheckbox.checked);
      });
    }

    if (card.orderUpBtn) {
      card.orderUpBtn.disabled = !reorderEnabled || itemPosition <= 1;
      card.orderUpBtn.addEventListener("click", () => {
        onMoveUp(appId).catch(() => setStatus("Failed to move item up.", true));
      });
    }

    if (card.orderDownBtn) {
      card.orderDownBtn.disabled = !reorderEnabled || itemPosition <= 0 || itemPosition >= totalItems;
      card.orderDownBtn.addEventListener("click", () => {
        onMoveDown(appId).catch(() => setStatus("Failed to move item down.", true));
      });
    }

    if (card.orderPositionInput) {
      card.orderPositionInput.value = itemPosition > 0 ? String(itemPosition) : "";
      card.orderPositionInput.disabled = !reorderEnabled;
      card.orderPositionInput.style.setProperty("--pos-digits", String(maxPositionDigits));
      card.orderPositionInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }
        event.preventDefault();
        const target = Number(card.orderPositionInput?.value || 0);
        onMoveToPosition(appId, target).catch(() => setStatus("Failed to move item to position.", true));
      });
    }

  }

  function hydrateCardMeta(options) {
    const card = options?.card;
    const appId = String(options?.appId || "");
    const hasStateTitle = Boolean(options?.hasStateTitle);
    const fetchMeta = options?.fetchMeta || (() => Promise.resolve({}));
    const itemIntent = options?.itemIntent && typeof options.itemIntent === "object" ? options.itemIntent : {};
    const targetPriceCents = Number.isFinite(Number(itemIntent.targetPriceCents))
      ? Math.max(0, Math.floor(Number(itemIntent.targetPriceCents)))
      : null;
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
      if (card.targetStatusEl) {
        const priceLabel = String(meta?.priceText || "").trim().toLowerCase();
        const priceKnown = priceLabel && priceLabel !== "-" && priceLabel !== "not announced";
        const priceCents = Number(meta?.priceFinal || 0);
        const hasTarget = Number.isFinite(targetPriceCents) && targetPriceCents > 0;
        const hit = hasTarget && priceKnown && Number.isFinite(priceCents) && priceCents <= targetPriceCents;
        if (hasTarget) {
          card.targetStatusEl.textContent = hit
            ? `Target: ${(targetPriceCents / 100).toFixed(2)} (hit)`
            : `Target: ${(targetPriceCents / 100).toFixed(2)}`;
        } else {
          card.targetStatusEl.textContent = "Target: -";
        }
        card.targetStatusEl.classList.toggle("target-hit", hit);
        if (card.cardEl) {
          card.cardEl.classList.toggle("target-hit", hit);
        }
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
