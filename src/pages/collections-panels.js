(() => {
  function togglePanel(panelId, forceOpen = null) {
    const panel = document.getElementById(panelId);
    if (!panel) {
      return false;
    }
    const open = forceOpen === null ? panel.classList.contains("hidden") : Boolean(forceOpen);
    panel.classList.toggle("hidden", !open);
    return open;
  }

  function toggleCollectionMenu(forceOpen = null, options = {}) {
    const open = togglePanel("collection-menu-panel", forceOpen);
    if (!open && typeof options.onClose === "function") {
      options.onClose();
    }
    return open;
  }

  function bindOutsidePanelClose(rules) {
    const items = Array.isArray(rules) ? rules : [];
    document.addEventListener("click", (event) => {
      const target = event.target;
      for (const rule of items) {
        const panel = document.getElementById(rule.panelId);
        const btn = document.getElementById(rule.buttonId);
        if (!panel || !btn || panel.classList.contains("hidden")) {
          continue;
        }
        if (!(panel.contains(target) || btn.contains(target))) {
          if (typeof rule.onClose === "function") {
            rule.onClose();
          } else {
            panel.classList.add("hidden");
          }
        }
      }
    });
  }

  window.SWMCollectionsPanels = {
    togglePanel,
    toggleCollectionMenu,
    bindOutsidePanelClose
  };
})();
