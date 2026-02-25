if (!window.location.pathname.startsWith("/wishlist")) {
  // Not a wishlist route.
} else {
  const ENABLE_WISHLIST_ADD_TO_COLLECTION = true;
  const PANEL_ID = "swcm-wishlist-add-panel";
  const STATUS_ID = "swcm-wishlist-add-status";

  if (!ENABLE_WISHLIST_ADD_TO_COLLECTION) {
    // Feature disabled.
  } else {
    function uniqueElements(elements) {
      return Array.from(new Set(elements.filter(Boolean)));
    }

    function getRows() {
      const rows = Array.from(document.querySelectorAll(".wishlist_row, div[id^='game_'], .wishlist_row_ctn"));
      return uniqueElements(rows.map((row) => row.closest(".wishlist_row_ctn") || row));
    }

    function extractAppId(row) {
      const directData =
        row.getAttribute("data-app-id") ||
        row.getAttribute("data-ds-appid") ||
        row.getAttribute("data-appid");
      if (directData) {
        return String(directData);
      }

      const nestedDataEl = row.querySelector("[data-app-id], [data-ds-appid], [data-appid]");
      if (nestedDataEl) {
        const nestedData =
          nestedDataEl.getAttribute("data-app-id") ||
          nestedDataEl.getAttribute("data-ds-appid") ||
          nestedDataEl.getAttribute("data-appid");
        if (nestedData) {
          return String(nestedData);
        }
      }

      const strictIdMatch = (row.id || "").match(/(?:game|app|wishlist(?:_row)?)[_-]?(\d{3,10})/i);
      if (strictIdMatch) {
        return strictIdMatch[1];
      }

      const appLink = row.querySelector("a[href*='/app/'], a[href*='/agecheck/app/']");
      const href = appLink?.getAttribute("href") || "";
      const hrefMatch = href.match(/\/(?:agecheck\/)?app\/(\d+)/);
      return hrefMatch ? hrefMatch[1] : "";
    }

    function extractTitle(row) {
      const candidates = [
        row.querySelector(".title"),
        row.querySelector("a[href*='/app/']"),
        row.querySelector("h3"),
        row.querySelector(".wishlist_row_title")
      ];

      for (const el of candidates) {
        const text = String(el?.textContent || "").trim();
        if (text) {
          return text;
        }
      }

      return document.title;
    }

    function findPanelAnchor() {
      const root = document.querySelector("#wishlist_ctn") || document.body;
      const search = root.querySelector("input[placeholder*='Search by name or tag']");
      if (search) {
        const row = search.closest("div");
        if (row?.parentElement) {
          return row;
        }
      }

      const heading = Array.from(root.querySelectorAll("h1, h2")).find((el) =>
        /\bwishlist\b/i.test(el.textContent || "")
      );
      if (heading?.parentElement) {
        return heading.closest("div") || heading;
      }

      return null;
    }

    function setStatus(text, isError = false) {
      const status = document.getElementById(STATUS_ID);
      if (!status) {
        return;
      }
      status.textContent = text;
      status.classList.toggle("swcm-status-error", isError);
    }

    async function populateCollectionSelect() {
      const select = document.getElementById("swcm-wishlist-collection-select");
      if (!select) {
        return;
      }

      const state = await browser.runtime.sendMessage({ type: "get-state" });
      select.innerHTML = "";

      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "-- choose collection --";
      select.appendChild(empty);

      for (const name of state.collectionOrder || []) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
      }

      const active = String(state.activeCollection || "").trim();
      if (active && active !== "__all__" && Array.from(select.options).some((o) => o.value === active)) {
        select.value = active;
      }
    }

    function getSelectedCollectionName() {
      const newInput = document.getElementById("swcm-wishlist-new-collection");
      const select = document.getElementById("swcm-wishlist-collection-select");

      const newName = String(newInput?.value || "").trim();
      if (newName) {
        return newName;
      }

      const selected = String(select?.value || "").trim();
      return selected;
    }

    function getSelectedPosition() {
      const select = document.getElementById("swcm-wishlist-position-select");
      return select?.value === "start" ? "start" : "end";
    }

    function ensurePanel() {
      let panel = document.getElementById(PANEL_ID);
      if (!panel) {
        panel = document.createElement("div");
        panel.id = PANEL_ID;
        panel.className = "swcm-panel";
        panel.innerHTML = `
          <strong>Collections</strong>
          <select id="swcm-wishlist-collection-select"></select>
          <input id="swcm-wishlist-new-collection" type="text" placeholder="new collection" />
          <select id="swcm-wishlist-position-select">
            <option value="end">End</option>
            <option value="start">Start</option>
          </select>
          <span id="${STATUS_ID}" class="swcm-status"></span>
        `;
      }

      const anchor = findPanelAnchor();
      if (anchor?.parentElement) {
        if (panel.parentElement !== anchor.parentElement || panel.previousElementSibling !== anchor) {
          anchor.insertAdjacentElement("afterend", panel);
        }
      }

      return panel;
    }

    function ensureRowButton(row) {
      const visualRow = row.querySelector(".wishlist_row") || row;
      const appId = extractAppId(visualRow) || extractAppId(row);
      if (!appId) {
        return;
      }

      if (visualRow.querySelector(".swcm-wishlist-add-btn")) {
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "swcm-btn swcm-btn-inline swcm-wishlist-add-btn";
      button.textContent = "Add to Collection";

      button.addEventListener("click", async () => {
        const collectionName = getSelectedCollectionName();
        if (!collectionName) {
          setStatus("Choose or type a collection.", true);
          return;
        }

        try {
          await browser.runtime.sendMessage({
            type: "add-or-move-item",
            appId,
            collectionName,
            position: getSelectedPosition(),
            item: {
              title: extractTitle(visualRow)
            }
          });

          setStatus(`Saved ${extractTitle(visualRow)} to \"${collectionName}\".`);
          await populateCollectionSelect();
        } catch (error) {
          setStatus(error?.message || "Failed to add item.", true);
        }
      });

      const removeBtn = visualRow.querySelector(".remove");
      const actionTarget =
        removeBtn?.parentElement ||
        visualRow.querySelector(".addedon")?.parentElement ||
        visualRow.querySelector(".price, .pricecol, .wishlist_row_price") ||
        visualRow.querySelector(".wishlist_row_action") ||
        visualRow.querySelector(".wishlist_row_title")?.parentElement;

      if (removeBtn) {
        removeBtn.insertAdjacentElement("afterend", button);
      } else if (actionTarget) {
        actionTarget.appendChild(button);
      } else {
        visualRow.appendChild(button);
      }
    }

    async function refresh() {
      ensurePanel();
      await populateCollectionSelect();

      const rows = getRows();
      for (const row of rows) {
        ensureRowButton(row);
      }
    }

    async function bootstrap() {
      await refresh().catch(() => {});

      const observer = new MutationObserver(() => {
        refresh().catch(() => {});
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    bootstrap().catch(() => {});
  }
}
