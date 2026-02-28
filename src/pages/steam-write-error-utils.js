(() => {
  function normalizeErrorText(value) {
    return String(value || "").trim();
  }

  function firstDetail(details) {
    if (!Array.isArray(details) || details.length === 0) {
      return null;
    }
    return details[0] || null;
  }

  function detailSuffix(detail) {
    const target = normalizeErrorText(detail?.target);
    const stage = normalizeErrorText(detail?.stage);
    const code = normalizeErrorText(detail?.code);
    const suffix = [target, stage, code].filter(Boolean).join("/");
    return suffix ? ` (${suffix})` : "";
  }

  function firstErrorText(errors) {
    if (!Array.isArray(errors) || errors.length === 0) {
      return "";
    }
    return normalizeErrorText(errors[0]);
  }

  function formatSingle(steamWrite) {
    const firstError = firstErrorText(steamWrite?.errors);
    if (!firstError) {
      return "";
    }
    return `${detailSuffix(firstDetail(steamWrite?.errorDetails))}: ${firstError}`.replace(/^:\s*/, "");
  }

  function formatBatch(entry) {
    const firstError = firstErrorText(entry?.errors);
    if (!firstError) {
      return "";
    }
    return `${detailSuffix(firstDetail(entry?.errorDetails))}: ${firstError}`.replace(/^:\s*/, "");
  }

  window.SWMSteamWriteErrorUtils = {
    formatSingle,
    formatBatch
  };
})();
