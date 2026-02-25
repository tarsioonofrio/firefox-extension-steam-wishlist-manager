function setStatus(text, isError = false) {
  const el = document.getElementById("status");
  if (!el) {
    return;
  }
  el.textContent = text;
  el.style.color = isError ? "#ff9696" : "#9ab8d3";
}

async function openCollectionsWithRefresh() {
  const base = browser.runtime.getURL("src/pages/collections.html");
  const url = `${base}?refreshAll=1`;
  await browser.tabs.create({ url });
}

document.getElementById("refresh-db")?.addEventListener("click", async () => {
  const confirmed = window.confirm("Refresh entire database now? This may take some time.");
  if (!confirmed) {
    return;
  }

  try {
    setStatus("Invalidating caches...");
    await browser.runtime.sendMessage({ type: "invalidate-caches" });
    await openCollectionsWithRefresh();
    setStatus("Refresh started in Collections page.");
  } catch {
    setStatus("Failed to refresh database.", true);
  }
});

document.getElementById("clear-db")?.addEventListener("click", async () => {
  const confirmed = window.confirm("This will remove all extension data (collections and cache). Continue?");
  if (!confirmed) {
    return;
  }

  try {
    setStatus("Clearing all data...");
    await browser.runtime.sendMessage({ type: "clear-all-data" });
    setStatus("All extension data removed.");
  } catch {
    setStatus("Failed to clear database.", true);
  }
});
