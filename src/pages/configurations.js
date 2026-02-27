const STORAGE_KEY = "steamWishlistCollectionsState";
const META_CACHE_KEY = "steamWishlistCollectionsMetaCacheV4";
const WISHLIST_ADDED_CACHE_KEY = "steamWishlistAddedMapV3";
const TAG_COUNTS_CACHE_KEY = "steamWishlistTagCountsCacheV1";
const TYPE_COUNTS_CACHE_KEY = "steamWishlistTypeCountsCacheV1";
const EXTRA_FILTER_COUNTS_CACHE_KEY = "steamWishlistExtraFilterCountsCacheV2";
const BACKUP_SETTINGS_KEY = "steamWishlistBackupSettingsV1";
const BACKUP_SCHEMA_VERSION = 1;
const DEFAULT_QUEUE_DAYS = 30;
const MIN_QUEUE_DAYS = 1;
const MAX_QUEUE_DAYS = 365;
const BACKUP_DATA_KEYS = [
  STORAGE_KEY,
  META_CACHE_KEY,
  WISHLIST_ADDED_CACHE_KEY,
  TAG_COUNTS_CACHE_KEY,
  TYPE_COUNTS_CACHE_KEY,
  EXTRA_FILTER_COUNTS_CACHE_KEY,
  BACKUP_SETTINGS_KEY
];

function setStatus(text, isError = false) {
  const el = document.getElementById("status");
  if (!el) {
    return;
  }
  el.textContent = text;
  el.style.color = isError ? "#ff9696" : "#9ab8d3";
}

function setBackupSummary(text) {
  const el = document.getElementById("backup-summary");
  if (!el) {
    return;
  }
  el.textContent = text;
}

function formatDateTime(timestamp) {
  const n = Number(timestamp || 0);
  if (!Number.isFinite(n) || n <= 0) {
    return "-";
  }
  return new Date(n).toLocaleString("pt-BR");
}

function normalizeBackupSettings(rawSettings) {
  const raw = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  return {
    enabled: Boolean(raw.enabled),
    intervalHours: Number.isFinite(Number(raw.intervalHours)) ? Math.max(1, Math.floor(Number(raw.intervalHours))) : 24
  };
}

function normalizeQueuePolicy(rawPolicy) {
  const raw = rawPolicy && typeof rawPolicy === "object" ? rawPolicy : {};
  const maybeDays = Number.isFinite(Number(raw.maybeDays))
    ? Math.max(MIN_QUEUE_DAYS, Math.min(MAX_QUEUE_DAYS, Math.floor(Number(raw.maybeDays))))
    : DEFAULT_QUEUE_DAYS;
  const archiveDays = Number.isFinite(Number(raw.archiveDays))
    ? Math.max(MIN_QUEUE_DAYS, Math.min(MAX_QUEUE_DAYS, Math.floor(Number(raw.archiveDays))))
    : DEFAULT_QUEUE_DAYS;
  return { maybeDays, archiveDays };
}

function applyQueuePolicyToUI(policy) {
  const safe = normalizeQueuePolicy(policy);
  const maybeEl = document.getElementById("queue-maybe-days");
  const archiveEl = document.getElementById("queue-archive-days");
  if (maybeEl) {
    maybeEl.value = String(safe.maybeDays);
  }
  if (archiveEl) {
    archiveEl.value = String(safe.archiveDays);
  }
}

function getQueuePolicyFromUI() {
  const maybeEl = document.getElementById("queue-maybe-days");
  const archiveEl = document.getElementById("queue-archive-days");
  return normalizeQueuePolicy({
    maybeDays: Number(maybeEl?.value || DEFAULT_QUEUE_DAYS),
    archiveDays: Number(archiveEl?.value || DEFAULT_QUEUE_DAYS)
  });
}

function applyBackupSettingsToUI(settings) {
  const safe = normalizeBackupSettings(settings);
  const enabledEl = document.getElementById("auto-backup-enabled");
  const intervalEl = document.getElementById("auto-backup-interval");
  if (enabledEl) {
    enabledEl.checked = safe.enabled;
  }
  if (intervalEl) {
    intervalEl.value = String(safe.intervalHours);
  }
}

async function refreshBackupSummary() {
  try {
    const response = await browser.runtime.sendMessage({ type: "get-backup-summary" });
    if (!response?.ok) {
      throw new Error("Could not load backup summary.");
    }
    const summary = response.summary || {};
    const settings = normalizeBackupSettings(summary.settings || {});
    applyBackupSettingsToUI(settings);
    const latest = summary.latest;
    const count = Number(summary.count || 0);
    const latestText = latest
      ? `latest ${formatDateTime(latest.createdAt)} (${latest.reason || "unknown"})`
      : "no backups yet";
    setBackupSummary(`Auto: ${settings.enabled ? "on" : "off"} every ${settings.intervalHours}h | Stored backups: ${count} | ${latestText}`);
  } catch {
    setBackupSummary("Could not load backup summary.");
  }
}

async function refreshQueuePolicySummary() {
  const response = await browser.runtime.sendMessage({ type: "get-queue-policy" });
  if (!response?.ok) {
    throw new Error("Could not load queue policy.");
  }
  applyQueuePolicyToUI(response.policy || {});
}

async function openCollectionsWithRefresh() {
  const base = browser.runtime.getURL("src/pages/collections.html");
  const url = `${base}?refreshAll=1`;
  await browser.tabs.create({ url });
}

async function openCollectionsWithFrequenciesRefresh() {
  const base = browser.runtime.getURL("src/pages/collections.html");
  const url = `${base}?refreshFrequencies=1`;
  await browser.tabs.create({ url });
}

function triggerDownload(fileName, contentText) {
  const blob = new Blob([contentText], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function buildBackupFileName() {
  const now = new Date();
  const iso = now.toISOString().replace(/[:.]/g, "-");
  return `steam-wishlist-manager-backup-${iso}.json`;
}

async function exportCurrentData() {
  const payload = await browser.storage.local.get(BACKUP_DATA_KEYS);
  const backup = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: Date.now(),
    app: "steam-wishlist-manager",
    data: payload
  };
  triggerDownload(buildBackupFileName(), JSON.stringify(backup, null, 2));
}

function validateBackupPayload(parsed) {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid backup file.");
  }
  if (!parsed.data || typeof parsed.data !== "object") {
    throw new Error("Backup missing data section.");
  }
  return parsed;
}

async function restoreFromParsedBackup(parsed) {
  const backup = validateBackupPayload(parsed);
  const incomingData = backup.data || {};
  const filtered = {};
  for (const key of BACKUP_DATA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(incomingData, key)) {
      filtered[key] = incomingData[key];
    }
  }

  await browser.runtime.sendMessage({ type: "create-backup-snapshot", reason: "pre-restore" });
  await browser.storage.local.remove(BACKUP_DATA_KEYS);
  await browser.storage.local.set(filtered);
  await browser.runtime.sendMessage({ type: "apply-backup-settings" });
}

async function onRestoreFileSelected(file) {
  if (!file) {
    return;
  }
  const text = await file.text();
  const parsed = JSON.parse(text);
  validateBackupPayload(parsed);
  const confirmed = window.confirm("Restore this backup now? Current data will be replaced.");
  if (!confirmed) {
    return;
  }
  await restoreFromParsedBackup(parsed);
}

async function saveAutoBackupSettingsFromUI() {
  const enabledEl = document.getElementById("auto-backup-enabled");
  const intervalEl = document.getElementById("auto-backup-interval");
  const settings = normalizeBackupSettings({
    enabled: Boolean(enabledEl?.checked),
    intervalHours: Number(intervalEl?.value || 24)
  });
  const response = await browser.runtime.sendMessage({
    type: "set-backup-settings",
    settings
  });
  if (!response?.ok) {
    throw new Error("Could not save backup settings.");
  }
}

async function saveQueuePolicyFromUI() {
  const policy = getQueuePolicyFromUI();
  const response = await browser.runtime.sendMessage({
    type: "set-queue-policy",
    policy
  });
  if (!response?.ok) {
    throw new Error("Could not save queue policy.");
  }
  applyQueuePolicyToUI(response.policy || policy);
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

document.getElementById("refresh-frequencies")?.addEventListener("click", async () => {
  const confirmed = window.confirm("Refresh filter frequencies now? Existing frequencies remain in use until recalculation finishes.");
  if (!confirmed) {
    return;
  }

  try {
    setStatus("Starting frequency refresh in Collections page...");
    await openCollectionsWithFrequenciesRefresh();
    setStatus("Frequency refresh started in Collections page.");
  } catch {
    setStatus("Failed to refresh frequencies.", true);
  }
});

document.getElementById("publish-bridge")?.addEventListener("click", async () => {
  try {
    setStatus("Publishing native bridge snapshot...");
    const response = await browser.runtime.sendMessage({
      type: "publish-native-bridge-snapshot",
      reason: "configurations-page-manual"
    });
    if (!response?.ok) {
      throw new Error(response?.error || "native bridge publish failed");
    }
    setStatus("Native bridge snapshot published.");
  } catch (error) {
    const message = String(error?.message || error || "native bridge publish failed");
    setStatus(`Failed to publish native bridge snapshot: ${message}`, true);
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
    await refreshBackupSummary();
  } catch {
    setStatus("Failed to clear database.", true);
  }
});

document.getElementById("backup-now")?.addEventListener("click", async () => {
  try {
    setStatus("Creating backup snapshot...");
    await browser.runtime.sendMessage({ type: "create-backup-snapshot", reason: "manual" });
    setStatus("Backup snapshot created.");
    await refreshBackupSummary();
  } catch {
    setStatus("Failed to create backup snapshot.", true);
  }
});

document.getElementById("export-backup")?.addEventListener("click", async () => {
  try {
    setStatus("Preparing backup export...");
    await exportCurrentData();
    setStatus("Backup JSON exported.");
  } catch {
    setStatus("Failed to export backup.", true);
  }
});

document.getElementById("restore-backup")?.addEventListener("click", () => {
  document.getElementById("restore-backup-file")?.click();
});

document.getElementById("restore-backup-file")?.addEventListener("change", async (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }
  const file = input.files && input.files[0] ? input.files[0] : null;
  input.value = "";
  if (!file) {
    return;
  }
  try {
    setStatus("Restoring backup...");
    await onRestoreFileSelected(file);
    setStatus("Backup restored.");
    await refreshBackupSummary();
  } catch {
    setStatus("Failed to restore backup file.", true);
  }
});

document.getElementById("auto-backup-enabled")?.addEventListener("change", async () => {
  try {
    await saveAutoBackupSettingsFromUI();
    setStatus("Automatic backup settings updated.");
    await refreshBackupSummary();
  } catch {
    setStatus("Failed to save automatic backup settings.", true);
  }
});

document.getElementById("auto-backup-interval")?.addEventListener("change", async () => {
  try {
    await saveAutoBackupSettingsFromUI();
    setStatus("Automatic backup interval updated.");
    await refreshBackupSummary();
  } catch {
    setStatus("Failed to save automatic backup interval.", true);
  }
});

document.getElementById("save-queue-policy")?.addEventListener("click", async () => {
  try {
    await saveQueuePolicyFromUI();
    setStatus("Queue timeouts updated.");
  } catch {
    setStatus("Failed to save queue timeouts.", true);
  }
});

refreshBackupSummary().catch(() => {});
refreshQueuePolicySummary().catch(() => {
  applyQueuePolicyToUI({});
});
