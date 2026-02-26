const WISHLIST_ADDED_CACHE_KEY = "steamWishlistAddedMapV3";
const ORDER_SYNC_INTERVAL_MS = 10 * 60 * 1000;

function encodeVarint(value) {
  let n = 0n;
  if (typeof value === "bigint") {
    n = value;
  } else if (typeof value === "string") {
    n = BigInt(value || "0");
  } else {
    n = BigInt(Number(value || 0));
  }
  if (n < 0n) {
    n = 0n;
  }
  const out = [];
  while (n >= 0x80n) {
    out.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  out.push(Number(n));
  return out;
}

function decodeVarint(bytes, startIndex) {
  let value = 0n;
  let shift = 0n;
  let index = startIndex;
  while (index < bytes.length) {
    const b = bytes[index];
    index += 1;
    value |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      return { value, next: index };
    }
    shift += 7n;
  }
  return null;
}

function encodeUtf8(text) {
  return new TextEncoder().encode(String(text || ""));
}

function concatBytes(chunks) {
  const size = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function fieldVarint(field, value) {
  return Uint8Array.from([
    ...encodeVarint((BigInt(field) << 3n) | 0n),
    ...encodeVarint(value)
  ]);
}

function fieldBytes(field, bytes) {
  return concatBytes([
    Uint8Array.from(encodeVarint((BigInt(field) << 3n) | 2n)),
    Uint8Array.from(encodeVarint(bytes.length)),
    bytes
  ]);
}

function toBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function decodeWishlistSortedFilteredItem(bytes) {
  const item = {
    appid: 0,
    priority: null,
    dateAdded: 0
  };
  let index = 0;
  while (index < bytes.length) {
    const tag = decodeVarint(bytes, index);
    if (!tag) {
      break;
    }
    index = tag.next;
    const field = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x7n);

    if (wireType === 0) {
      const value = decodeVarint(bytes, index);
      if (!value) {
        break;
      }
      index = value.next;
      const n = Number(value.value);
      if (field === 1) {
        item.appid = n;
      } else if (field === 2) {
        item.priority = n;
      } else if (field === 3) {
        item.dateAdded = n;
      }
      continue;
    }

    if (wireType === 2) {
      const len = decodeVarint(bytes, index);
      if (!len) {
        break;
      }
      index = len.next + Number(len.value);
      continue;
    }

    if (wireType === 5) {
      index += 4;
      continue;
    }
    if (wireType === 1) {
      index += 8;
      continue;
    }
    break;
  }
  return item;
}

function decodeWishlistSortedFilteredResponse(bytes) {
  const items = [];
  let index = 0;
  while (index < bytes.length) {
    const tag = decodeVarint(bytes, index);
    if (!tag) {
      break;
    }
    index = tag.next;
    const field = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x7n);

    if (field === 1 && wireType === 2) {
      const len = decodeVarint(bytes, index);
      if (!len) {
        break;
      }
      index = len.next;
      const itemBytes = bytes.subarray(index, index + Number(len.value));
      index += Number(len.value);
      const item = decodeWishlistSortedFilteredItem(itemBytes);
      if (Number.isFinite(item.appid) && item.appid > 0) {
        items.push(item);
      }
      continue;
    }

    if (wireType === 0) {
      const value = decodeVarint(bytes, index);
      if (!value) {
        break;
      }
      index = value.next;
      continue;
    }

    if (wireType === 2) {
      const len = decodeVarint(bytes, index);
      if (!len) {
        break;
      }
      index = len.next + Number(len.value);
      continue;
    }

    if (wireType === 5) {
      index += 4;
      continue;
    }
    if (wireType === 1) {
      index += 8;
      continue;
    }
    break;
  }
  return items;
}

function buildWishlistSortedFilteredRequest({ steamId, startIndex = 0, pageSize = 500 }) {
  const context = concatBytes([
    fieldBytes(1, encodeUtf8("english")),
    fieldBytes(3, encodeUtf8("BR"))
  ]);
  const dataRequest = concatBytes([
    fieldVarint(1, 1),
    fieldVarint(2, 1),
    fieldVarint(3, 1),
    fieldVarint(6, 1),
    fieldVarint(8, 20),
    fieldVarint(9, 1)
  ]);
  const filters = concatBytes([
    fieldVarint(25, 4),
    fieldVarint(25, 3)
  ]);

  return concatBytes([
    fieldVarint(1, steamId),
    fieldBytes(2, context),
    fieldBytes(3, dataRequest),
    fieldBytes(5, filters),
    fieldVarint(6, startIndex),
    fieldVarint(7, pageSize)
  ]);
}

async function getCurrentSteamId() {
  const response = await fetch("https://store.steampowered.com/dynamicstore/userdata/", {
    cache: "no-store"
  });
  if (!response.ok) {
    return "";
  }
  const data = await response.json();
  return String(
    data?.steamid
    || data?.strSteamId
    || data?.str_steamid
    || data?.webapi_token_steamid
    || ""
  ).trim();
}

async function fetchWishlistOrderFromService(steamId) {
  const orderedAppIds = [];
  const priorityMap = {};
  const pageSize = 500;
  const seen = new Set();

  for (let page = 0; page < 20; page += 1) {
    const requestBytes = buildWishlistSortedFilteredRequest({
      steamId,
      startIndex: page * pageSize,
      pageSize
    });
    const url = new URL("https://api.steampowered.com/IWishlistService/GetWishlistSortedFiltered/v1");
    url.searchParams.set("origin", "https://store.steampowered.com");
    url.searchParams.set("input_protobuf_encoded", toBase64(requestBytes));

    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Wishlist order request failed (${response.status})`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const items = decodeWishlistSortedFilteredResponse(bytes);
    if (items.length === 0) {
      break;
    }

    for (const item of items) {
      const appId = String(item.appid || "").trim();
      if (!appId || seen.has(appId)) {
        continue;
      }
      seen.add(appId);
      orderedAppIds.push(appId);
      priorityMap[appId] = Number.isFinite(item.priority)
        ? Number(item.priority)
        : orderedAppIds.length - 1;
    }

    if (items.length < pageSize) {
      break;
    }
  }

  return { orderedAppIds, priorityMap };
}

async function syncWishlistOrderCache() {
  if (!window.location.pathname.startsWith("/wishlist")) {
    return;
  }

  try {
    const now = Date.now();
    const stored = await browser.storage.local.get(WISHLIST_ADDED_CACHE_KEY);
    const cached = stored[WISHLIST_ADDED_CACHE_KEY] || {};
    const last = Number(cached.priorityCachedAt || 0);
    if (now - last < ORDER_SYNC_INTERVAL_MS) {
      return;
    }

    const steamId = await getCurrentSteamId();
    if (!steamId) {
      return;
    }

    const { orderedAppIds, priorityMap } = await fetchWishlistOrderFromService(steamId);
    if (!Array.isArray(orderedAppIds) || orderedAppIds.length === 0) {
      return;
    }

    await browser.storage.local.set({
      [WISHLIST_ADDED_CACHE_KEY]: {
        ...cached,
        orderedAppIds,
        priorityMap,
        priorityCachedAt: now
      }
    });
  } catch {
    // Silent by design; collections page has fallback ordering.
  }
}

if (window.location.pathname.startsWith("/wishlist")) {
  syncWishlistOrderCache();
}
