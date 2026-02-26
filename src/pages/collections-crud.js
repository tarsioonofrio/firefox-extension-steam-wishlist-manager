(() => {
  async function createCollectionByName(ctx) {
    const rawName = String(ctx?.rawName || "");
    const normalizeCollectionName = ctx?.normalizeCollectionName || ((value) => String(value || "").trim());
    const setStatus = ctx?.setStatus || (() => {});
    const sendMessage = ctx?.sendMessage || (async () => {});
    const refreshState = ctx?.refreshState || (async () => {});
    const onAfterChange = ctx?.onAfterChange || (async () => {});

    const name = normalizeCollectionName(rawName);
    if (!name) {
      setStatus("Type a collection name.", true);
      return { ok: false };
    }

    await sendMessage({
      type: "create-collection",
      collectionName: name
    });

    await refreshState();
    await onAfterChange();
    setStatus(`Collection \"${name}\" created.`);
    return {
      ok: true,
      activeCollection: name,
      sourceMode: "collections",
      page: 1
    };
  }

  async function renameActiveCollectionByName(ctx) {
    const rawName = String(ctx?.rawName || "");
    const normalizeCollectionName = ctx?.normalizeCollectionName || ((value) => String(value || "").trim());
    const sourceMode = String(ctx?.sourceMode || "collections");
    const activeCollection = String(ctx?.activeCollection || "__all__");
    const setStatus = ctx?.setStatus || (() => {});
    const sendMessage = ctx?.sendMessage || (async () => {});
    const refreshState = ctx?.refreshState || (async () => {});
    const onAfterChange = ctx?.onAfterChange || (async () => {});

    if (sourceMode === "wishlist" || !activeCollection || activeCollection === "__all__") {
      setStatus("Select a specific collection to rename.", true);
      return { ok: false };
    }

    const newName = normalizeCollectionName(rawName);
    if (!newName) {
      setStatus("Type a new collection name.", true);
      return { ok: false };
    }

    await sendMessage({
      type: "rename-collection",
      fromName: activeCollection,
      toName: newName
    });

    await refreshState();
    await onAfterChange();
    setStatus(`Collection renamed to \"${newName}\".`);
    return {
      ok: true,
      activeCollection: newName,
      page: 1
    };
  }

  async function deleteCollectionByName(ctx) {
    const rawName = String(ctx?.rawName || "");
    const normalizeCollectionName = ctx?.normalizeCollectionName || ((value) => String(value || "").trim());
    const activeCollection = String(ctx?.activeCollection || "__all__");
    const sourceMode = String(ctx?.sourceMode || "collections");
    const setStatus = ctx?.setStatus || (() => {});
    const sendMessage = ctx?.sendMessage || (async () => {});
    const refreshState = ctx?.refreshState || (async () => {});
    const onAfterChange = ctx?.onAfterChange || (async () => {});
    const confirmFn = ctx?.confirmFn || ((message) => window.confirm(message));

    const collectionName = normalizeCollectionName(rawName);
    if (!collectionName) {
      setStatus("Select a collection to delete.", true);
      return { ok: false };
    }

    const confirmed = confirmFn(`Delete collection "${collectionName}"?`);
    if (!confirmed) {
      return { ok: false, aborted: true };
    }

    await sendMessage({
      type: "delete-collection",
      collectionName
    });

    await refreshState();
    await onAfterChange();
    setStatus(`Collection \"${collectionName}\" deleted.`);
    return {
      ok: true,
      activeCollection: activeCollection === collectionName ? "__all__" : activeCollection,
      sourceMode: activeCollection === collectionName ? "collections" : sourceMode,
      page: 1
    };
  }

  window.SWMCollectionsCrud = {
    createCollectionByName,
    renameActiveCollectionByName,
    deleteCollectionByName
  };
})();
