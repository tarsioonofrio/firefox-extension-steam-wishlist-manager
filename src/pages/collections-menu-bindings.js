(() => {
  function bindCollectionMenuControls(options) {
    const hideForms = options?.hideForms || (() => {});
    const toggleCollectionSelectMenu = options?.toggleCollectionSelectMenu || (() => {});
    const toggleSortMenu = options?.toggleSortMenu || (() => {});
    const toggleCollectionMenu = options?.toggleCollectionMenu || (() => {});
    const renameHandler = options?.renameHandler || (async () => {});
    const createHandler = options?.createHandler || (async () => {});
    const deleteHandler = options?.deleteHandler || (async () => {});
    const onError = options?.onError || (() => {});

    const showOnlyForm = (formId) => {
      hideForms();
      document.getElementById(formId)?.classList.remove("hidden");
    };

    const bindSubmit = (buttonId, inputOrSelectId, handler, failMessage, clearAfter = false) => {
      document.getElementById(buttonId)?.addEventListener("click", () => {
        const field = document.getElementById(inputOrSelectId);
        const value = String(field?.value || "");
        handler(value).catch(() => onError(failMessage));
        if (clearAfter && field) {
          field.value = "";
        }
      });
    };

    document.getElementById("collection-menu-btn")?.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleCollectionSelectMenu(false);
      toggleSortMenu(false);
      toggleCollectionMenu();
    });

    document.getElementById("menu-action-rename")?.addEventListener("click", () => {
      showOnlyForm("rename-collection-form");
    });
    document.getElementById("menu-action-create")?.addEventListener("click", () => {
      showOnlyForm("create-collection-form");
    });
    document.getElementById("menu-action-delete")?.addEventListener("click", () => {
      showOnlyForm("delete-collection-form");
    });

    bindSubmit("rename-collection-ok", "rename-collection-input", renameHandler, "Failed to rename collection.", true);
    bindSubmit("create-collection-ok", "create-collection-input", createHandler, "Failed to create collection.", true);
    bindSubmit("delete-collection-ok", "delete-collection-select", deleteHandler, "Failed to delete collection.", false);
  }

  window.SWMCollectionsMenuBindings = {
    bindCollectionMenuControls
  };
})();
