const EXT_ROOT_ID = "swcm-root";
const MODAL_ID = "swcm-modal";
const INIT_RETRY_INTERVAL_MS = 400;
const MAX_INIT_ATTEMPTS = 20;

function getAppIdFromUrl() {
  const match = window.location.pathname.match(/\/app\/(\d+)/);
  return match ? match[1] : "";
}

function getGameTitle() {
  const titleElement = document.querySelector(".apphub_AppName");
  return titleElement ? titleElement.textContent.trim() : document.title;
}

function getWishlistButton() {
  return (
    document.querySelector("#add_to_wishlist_area a") ||
    document.querySelector("#add_to_wishlist_area") ||
    document.querySelector("a.queue_btn_wishlist")
  );
}

function createButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.id = "swcm-open-modal";
  button.className = "swcm-btn";
  button.textContent = "Add to Collection";
  return button;
}

function createModal() {
  const overlay = document.createElement("div");
  overlay.id = MODAL_ID;
  overlay.className = "swcm-overlay swcm-hidden";

  overlay.innerHTML = `
    <div class="swcm-modal" role="dialog" aria-modal="true" aria-label="Add game to collection">
      <h3>Steam Wishlist Collection</h3>
      <label>
        Existing collection
        <select id="swcm-collection-select"></select>
      </label>
      <label>
        Or create new
        <input id="swcm-new-collection" type="text" placeholder="e.g. Must Play" />
      </label>
      <label>
        Insert position
        <select id="swcm-position-select">
          <option value="end">End of collection</option>
          <option value="start">Beginning of collection</option>
        </select>
      </label>
      <p class="swcm-status">Sandbox mode: this only saves to extension data.</p>
      <div class="swcm-actions">
        <button id="swcm-cancel" type="button" class="swcm-btn swcm-btn-secondary">Cancel</button>
        <button id="swcm-save" type="button" class="swcm-btn">Save</button>
      </div>
      <p id="swcm-status" class="swcm-status" aria-live="polite"></p>
    </div>
  `;

  return overlay;
}

function setStatus(text, isError = false) {
  const status = document.getElementById("swcm-status");
  if (!status) {
    return;
  }
  status.textContent = text;
  status.classList.toggle("swcm-status-error", isError);
}

function openModal() {
  const modal = document.getElementById(MODAL_ID);
  if (!modal) {
    return;
  }
  modal.classList.remove("swcm-hidden");
}

function closeModal() {
  const modal = document.getElementById(MODAL_ID);
  if (!modal) {
    return;
  }
  modal.classList.add("swcm-hidden");
}

async function fillCollectionSelect() {
  const select = document.getElementById("swcm-collection-select");
  if (!select) {
    return;
  }

  const state = await browser.runtime.sendMessage({ type: "get-state" });
  const names = state.collectionOrder || [];

  select.innerHTML = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "-- choose collection --";
  select.appendChild(emptyOption);

  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
}

async function saveToCollection() {
  const appId = getAppIdFromUrl();
  if (!appId) {
    setStatus("Could not detect Steam app id on this page.", true);
    return;
  }

  const collectionSelect = document.getElementById("swcm-collection-select");
  const newCollectionInput = document.getElementById("swcm-new-collection");
  const positionSelect = document.getElementById("swcm-position-select");

  const collectionName =
    (newCollectionInput?.value || "").trim() || (collectionSelect?.value || "").trim();

  if (!collectionName) {
    setStatus("Choose an existing collection or type a new one.", true);
    return;
  }

  await browser.runtime.sendMessage({
    type: "add-or-move-item",
    appId,
    collectionName,
    position: positionSelect?.value === "start" ? "start" : "end",
    item: {
      title: getGameTitle()
    }
  });

  setStatus(`Saved locally to "${collectionName}".`);
  await fillCollectionSelect();
}

async function init() {
  if (document.getElementById(EXT_ROOT_ID)) {
    return true;
  }

  const anchor = getWishlistButton();
  if (!anchor) {
    return false;
  }

  const root = document.createElement("div");
  root.id = EXT_ROOT_ID;

  const button = createButton();
  button.addEventListener("click", async () => {
    await fillCollectionSelect();
    setStatus("");
    openModal();
  });

  const modal = createModal();
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  root.appendChild(button);
  document.body.appendChild(modal);

  const parent = anchor.parentElement || anchor;
  parent.insertAdjacentElement("afterend", root);

  document.getElementById("swcm-cancel")?.addEventListener("click", closeModal);
  document.getElementById("swcm-save")?.addEventListener("click", () => {
    saveToCollection().catch((error) => {
      setStatus(error?.message || "Failed to save game.", true);
    });
  });

  return true;
}

async function bootstrap() {
  for (let attempt = 0; attempt < MAX_INIT_ATTEMPTS; attempt += 1) {
    const initialized = await init().catch(() => false);
    if (initialized) {
      return;
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, INIT_RETRY_INTERVAL_MS);
    });
  }
}

bootstrap().catch(() => {});
