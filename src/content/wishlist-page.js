if (!window.location.pathname.startsWith("/wishlist")) {
  // Not a wishlist route.
} else {
  const PANEL_ID = "swcm-wishlist-panel";
  const FILTER_ID = "swcm-filter-select";
  const COUNT_ID = "swcm-filter-count";
  const FALLBACK_ID = "swcm-wishlist-fallback";

  let lastRowCount = -1;

  function uniqueElements(elements) {
    return Array.from(new Set(elements.filter(Boolean)));
  }

  function getRows() {
    const primary = uniqueElements(
      Array.from(document.querySelectorAll(".wishlist_row, div[id^='game_'], div[data-ds-appid]"))
    );
    if (primary.length > 0) {
      return primary;
    }

    const wishlistRoot = getListContainer() || document;
    const links = Array.from(wishlistRoot.querySelectorAll("a[href*='/app/']"));
    const fallbackRows = [];

    for (const link of links) {
      const row =
        link.closest(".wishlist_row") ||
        link.closest("div[id^='game_']") ||
        link.closest("[data-ds-appid]") ||
        link.closest(".wishlist_row_ctn") ||
        link.closest(".Panel");
      if (row) {
        fallbackRows.push(row);
      }
    }

    return uniqueElements(fallbackRows);
  }

  function extractAppId(row) {
    const byData = row.getAttribute("data-app-id") || row.getAttribute("data-ds-appid");
    if (byData) {
      return String(byData);
    }

    const idMatch = (row.id || "").match(/(\d+)/);
    if (idMatch) {
      return idMatch[1];
    }

    const appLink = row.querySelector("a[href*='/app/']");
    const href = appLink?.getAttribute("href") || "";
    const hrefMatch = href.match(/\/app\/(\d+)/);
    return hrefMatch ? hrefMatch[1] : "";
  }

  function getListContainer() {
    return document.querySelector("#wishlist_ctn") || document.querySelector("#wishlist_items") || null;
  }

  function findVisibleElement(elements) {
    return elements.find((el) => {
      if (!el) {
        return false;
      }
      const style = window.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    }) || null;
  }

  function getPanelAnchor() {
    const wishlistRoot = document.querySelector("#wishlist_ctn") || document.body;

    const directHeader = findVisibleElement([
      wishlistRoot.querySelector(".wishlist_header"),
      wishlistRoot.querySelector("#wishlist_header"),
      wishlistRoot.querySelector(".wishlist_title")
    ]);
    if (directHeader) {
      return { node: directHeader, mode: "after" };
    }

    const heading = findVisibleElement(
      Array.from(wishlistRoot.querySelectorAll("h1, h2")).filter((el) =>
        /\bwishlist\b/i.test(el.textContent || "")
      )
    );
    if (heading) {
      const block = heading.closest("div");
      if (block) {
        return { node: block, mode: "after" };
      }
    }

    const searchInput = findVisibleElement([
      wishlistRoot.querySelector("input[placeholder*='Search by name or tag']"),
      wishlistRoot.querySelector("input[placeholder*='Search by name']")
    ]);
    if (searchInput) {
      const row = searchInput.closest("div");
      if (row) {
        return { node: row, mode: "before" };
      }
    }

    return null;
  }

  function ensurePanelPosition(panel) {
    const anchor = getPanelAnchor();
    if (!anchor || !anchor.node) {
      return;
    }

    const expectedParent = anchor.node.parentElement;
    if (!expectedParent) {
      return;
    }

    const shouldMove = panel.parentElement !== expectedParent;
    if (shouldMove) {
      if (anchor.mode === "before") {
        anchor.node.insertAdjacentElement("beforebegin", panel);
      } else {
        anchor.node.insertAdjacentElement("afterend", panel);
      }
      return;
    }

    if (anchor.mode === "before") {
      if (panel.nextElementSibling !== anchor.node) {
        anchor.node.insertAdjacentElement("beforebegin", panel);
      }
      return;
    }

    if (panel.previousElementSibling !== anchor.node) {
      anchor.node.insertAdjacentElement("afterend", panel);
    }
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      panel.className = "swcm-panel";
      panel.innerHTML = `
        <strong>Collections</strong>
        <select id="${FILTER_ID}"></select>
        <span id="${COUNT_ID}">0/0 visible</span>
      `;

      const select = panel.querySelector(`#${FILTER_ID}`);
      select?.addEventListener("change", async () => {
        const value = select.value || "__all__";
        await browser.runtime.sendMessage({
          type: "set-active-collection",
          activeCollection: value
        });
        const state = await browser.runtime.sendMessage({ type: "get-state" });
        applyCollection(state, value);
      });
    }

    ensurePanelPosition(panel);
    return panel;
  }

  function ensureFallbackBox() {
    let box = document.getElementById(FALLBACK_ID);
    if (!box) {
      box = document.createElement("div");
      box.id = FALLBACK_ID;
      box.className = "swcm-fallback swcm-hidden";
      box.setAttribute("aria-live", "polite");
    }

    const panel = ensurePanel();
    if (panel.parentElement && box.parentElement !== panel.parentElement) {
      panel.insertAdjacentElement("afterend", box);
    } else if (panel.nextElementSibling !== box) {
      panel.insertAdjacentElement("afterend", box);
    }

    return box;
  }

  function renderFallbackList(state, collectionName, missingIds) {
    const box = ensureFallbackBox();
    if (!box) {
      return;
    }

    if (!collectionName || collectionName === "__all__" || missingIds.length === 0) {
      box.classList.add("swcm-hidden");
      box.innerHTML = "";
      return;
    }

    const items = missingIds.slice(0, 25).map((appId) => {
      const title = state.items?.[appId]?.title || `App ${appId}`;
      return `<li><a href="https://store.steampowered.com/app/${appId}/" target="_blank" rel="noopener noreferrer">${title}</a></li>`;
    });
    const extraCount = Math.max(0, missingIds.length - 25);
    const extraText = extraCount > 0 ? `<p>+${extraCount} more items in this collection.</p>` : "";

    box.innerHTML = `
      <strong>Collection items not loaded in current Steam list:</strong>
      <ul>${items.join("")}</ul>
      ${extraText}
    `;
    box.classList.remove("swcm-hidden");
  }

  function updateCount(visible, total, missingFromPage = 0) {
    const el = document.getElementById(COUNT_ID);
    if (el) {
      if (missingFromPage > 0) {
        el.textContent = `${visible}/${total} visible (${missingFromPage} not loaded yet, scroll down)`;
      } else {
        el.textContent = `${visible}/${total} visible`;
      }
    }
  }

  function applyCollection(state, collectionName) {
    const rows = getRows();
    const total = rows.length;

    if (!collectionName || collectionName === "__all__") {
      for (const row of rows) {
        row.style.display = "";
      }
      renderFallbackList(state, "__all__", []);
      updateCount(total, total);
      return;
    }

    const orderedIds = state.collections?.[collectionName] || [];
    const allowed = new Set(orderedIds);
    const rowByAppId = new Map();
    let visibleCount = 0;

    for (const row of rows) {
      const appId = extractAppId(row);
      if (appId) {
        rowByAppId.set(appId, row);
      }

      const isVisible = allowed.has(appId);
      row.style.display = isVisible ? "" : "none";
      if (isVisible) {
        visibleCount += 1;
      }
    }

    const container = getListContainer();
    if (container) {
      for (const appId of orderedIds) {
        const row = rowByAppId.get(appId);
        if (row && row.parentElement === container) {
          container.appendChild(row);
        }
      }
    }

    const missingIds = [];
    for (const appId of orderedIds) {
      if (!rowByAppId.has(appId)) {
        missingIds.push(appId);
      }
    }

    renderFallbackList(state, collectionName, visibleCount === 0 ? missingIds : []);
    updateCount(visibleCount, total, missingIds.length);
  }

  async function refreshPanel() {
    ensurePanel();

    const state = await browser.runtime.sendMessage({ type: "get-state" });
    const select = document.getElementById(FILTER_ID);
    if (!select) {
      return;
    }

    const previousSelected = select.value || "__all__";
    select.innerHTML = "";

    const allOption = document.createElement("option");
    allOption.value = "__all__";
    allOption.textContent = "All wishlist";
    select.appendChild(allOption);

    for (const collectionName of state.collectionOrder || []) {
      const option = document.createElement("option");
      option.value = collectionName;
      const size = (state.collections[collectionName] || []).length;
      option.textContent = `${collectionName} (${size})`;
      select.appendChild(option);
    }

    const current = state.activeCollection || "__all__";
    const hasPrevious = Array.from(select.options).some((o) => o.value === previousSelected);
    const hasCurrent = Array.from(select.options).some((o) => o.value === current);
    select.value = hasPrevious ? previousSelected : (hasCurrent ? current : "__all__");

    applyCollection(state, select.value);
  }

  async function bootstrap() {
    // Immediate attempt.
    await refreshPanel().catch(() => {});

    // Retry while Steam builds the page asynchronously.
    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;

      const rows = getRows();
      if (rows.length !== lastRowCount) {
        lastRowCount = rows.length;
        await refreshPanel().catch(() => {});
      } else {
        ensurePanel();
      }

      if (attempts >= 120 && document.getElementById(PANEL_ID)) {
        window.clearInterval(timer);
      }
    }, 500);

    // Keep resilient to dynamic re-renders.
    const observer = new MutationObserver(() => {
      const panel = document.getElementById(PANEL_ID);
      if (!panel) {
        refreshPanel().catch(() => {});
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  bootstrap().catch(() => {});
}
