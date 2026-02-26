(() => {
  function normalizeAppTypeLabel(value) {
    const raw = String(value || "").trim();
    const lowered = raw.toLowerCase();
    if (!raw) {
      return "Unknown";
    }

    const known = {
      game: "Game",
      dlc: "DLC",
      music: "Music",
      demo: "Demo",
      application: "Application",
      video: "Video",
      movie: "Video",
      series: "Series",
      tool: "Tool",
      beta: "Beta"
    };

    if (known[lowered]) {
      return known[lowered];
    }

    return raw;
  }

  function parseSupportedLanguages(rawHtml) {
    const text = String(rawHtml || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?strong>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/\(text only\)/gi, "")
      .replace(/\(interface\)/gi, "")
      .replace(/\(subtitles\)/gi, "")
      .replace(/\(full audio\)/gi, "");

    const langs = [];
    for (const line of text.split("\n")) {
      const normalized = String(line || "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
      if (normalized) {
        langs.push(normalized);
      }
    }
    return Array.from(new Set(langs));
  }

  function parseFullAudioLanguages(rawHtml) {
    const html = String(rawHtml || "").replace(/<br\s*\/?>/gi, "\n");
    const out = [];
    for (const line of html.split("\n")) {
      if (!line.includes("*")) {
        continue;
      }
      const normalized = line
        .replace(/<\/?strong>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/\*/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) {
        out.push(normalized);
      }
    }
    return Array.from(new Set(out));
  }

  function parseLooseInteger(value, fallback = 0) {
    const digits = String(value ?? "").replace(/[^\d]/g, "");
    if (!digits) {
      return fallback;
    }
    const n = Number(digits);
    return Number.isFinite(n) ? n : fallback;
  }

  function extractPriceTextFromDiscountBlock(blockHtml) {
    const block = String(blockHtml || "");
    if (!block) {
      return "";
    }

    const finalMatch = block.match(/discount_final_price">([^<]+)/i);
    if (finalMatch?.[1]) {
      return finalMatch[1].replace(/&nbsp;/g, " ").trim();
    }

    const plainMatch = block.match(/game_purchase_price\s*price">([^<]+)/i);
    if (plainMatch?.[1]) {
      return plainMatch[1].replace(/&nbsp;/g, " ").trim();
    }

    return "";
  }

  window.SWMMetaParsers = {
    normalizeAppTypeLabel,
    parseSupportedLanguages,
    parseFullAudioLanguages,
    parseLooseInteger,
    extractPriceTextFromDiscountBlock
  };
})();
