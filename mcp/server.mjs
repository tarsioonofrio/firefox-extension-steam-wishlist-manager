import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.SWM_MCP_DB_PATH
  ? path.resolve(process.env.SWM_MCP_DB_PATH)
  : path.join(__dirname, "data", "state.json");

const APP_ID_RE = /^\d{1,10}$/;
const MAX_COLLECTION_NAME_LENGTH = 64;
const MAX_ITEMS_PER_COLLECTION = 5000;
const EXTENSION_STATE_KEY = "steamWishlistCollectionsState";

const DEFAULT_STATE = {
  version: 1,
  collections: {},
  dynamicCollections: {},
  items: {},
  updatedAt: Date.now()
};

function normalizeCollectionName(name) {
  return String(name || "").replace(/\s+/g, " ").trim().slice(0, MAX_COLLECTION_NAME_LENGTH);
}

function validateAppId(appId) {
  const id = String(appId || "").trim();
  if (!APP_ID_RE.test(id)) {
    throw new Error("Invalid appId.");
  }
  return id;
}

function normalizeState(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const state = {
    ...DEFAULT_STATE,
    ...src
  };

  if (!state.collections || typeof state.collections !== "object") {
    state.collections = {};
  }
  if (!state.dynamicCollections || typeof state.dynamicCollections !== "object") {
    state.dynamicCollections = {};
  }
  if (!state.items || typeof state.items !== "object") {
    state.items = {};
  }

  const nextCollections = {};
  for (const [rawName, rawList] of Object.entries(state.collections)) {
    const name = normalizeCollectionName(rawName);
    if (!name || Array.isArray(state.dynamicCollections?.[name])) {
      continue;
    }
    const ids = Array.isArray(rawList)
      ? Array.from(new Set(rawList.map((v) => String(v || "").trim()).filter((v) => APP_ID_RE.test(v))))
      : [];
    nextCollections[name] = ids;
  }
  state.collections = nextCollections;

  const nextDynamic = {};
  for (const [rawName, rawDef] of Object.entries(state.dynamicCollections)) {
    const name = normalizeCollectionName(rawName);
    if (!name || state.collections[name]) {
      continue;
    }
    const def = rawDef && typeof rawDef === "object" ? rawDef : {};
    nextDynamic[name] = {
      baseSource: String(def.baseSource || "wishlist"),
      baseCollection: normalizeCollectionName(def.baseCollection || ""),
      sortMode: String(def.sortMode || "title"),
      filters: def.filters && typeof def.filters === "object" ? def.filters : {},
      capturedAt: Number.isFinite(Number(def.capturedAt)) ? Number(def.capturedAt) : Date.now()
    };
  }
  state.dynamicCollections = nextDynamic;

  const referenced = new Set();
  for (const ids of Object.values(state.collections)) {
    for (const id of ids) {
      referenced.add(id);
    }
  }
  const nextItems = {};
  for (const id of referenced) {
    nextItems[id] = {
      appId: id,
      title: String(state.items?.[id]?.title || "")
    };
  }
  state.items = nextItems;
  state.updatedAt = Date.now();
  return state;
}

function toNormalizedStateFromExtensionState(rawState) {
  const src = rawState && typeof rawState === "object" ? rawState : {};
  return normalizeState({
    version: 1,
    collections: src.collections || {},
    dynamicCollections: src.dynamicCollections || {},
    items: src.items || {},
    updatedAt: Date.now()
  });
}

function mergeStates(baseState, incomingState) {
  const base = normalizeState(baseState);
  const incoming = normalizeState(incomingState);
  const out = normalizeState(base);

  for (const [name, ids] of Object.entries(incoming.collections || {})) {
    const existing = Array.isArray(out.collections[name]) ? out.collections[name] : [];
    const merged = Array.from(new Set([...existing, ...ids]));
    out.collections[name] = merged.slice(0, MAX_ITEMS_PER_COLLECTION);
  }

  for (const [name, def] of Object.entries(incoming.dynamicCollections || {})) {
    out.dynamicCollections[name] = {
      baseSource: String(def?.baseSource || "wishlist"),
      baseCollection: normalizeCollectionName(def?.baseCollection || ""),
      sortMode: String(def?.sortMode || "title"),
      filters: def?.filters && typeof def.filters === "object" ? def.filters : {},
      capturedAt: Number.isFinite(Number(def?.capturedAt)) ? Number(def.capturedAt) : Date.now()
    };
  }

  for (const [appId, item] of Object.entries(incoming.items || {})) {
    if (!APP_ID_RE.test(String(appId || ""))) {
      continue;
    }
    out.items[appId] = {
      appId: String(appId),
      title: String(item?.title || out.items?.[appId]?.title || "")
    };
  }

  return normalizeState(out);
}

function parseBackupJsonToExtensionState(inputJson) {
  const parsed = JSON.parse(String(inputJson || "{}"));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid backup payload.");
  }
  const data = parsed?.data;
  if (!data || typeof data !== "object") {
    throw new Error("Backup payload missing data field.");
  }
  const extensionState = data[EXTENSION_STATE_KEY];
  if (!extensionState || typeof extensionState !== "object") {
    throw new Error(`Backup payload missing ${EXTENSION_STATE_KEY}.`);
  }
  return extensionState;
}

async function ensureDbDir() {
  await mkdir(path.dirname(DB_PATH), { recursive: true });
}

async function readState() {
  await ensureDbDir();
  try {
    const raw = await readFile(DB_PATH, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return normalizeState(DEFAULT_STATE);
  }
}

async function writeState(state) {
  await ensureDbDir();
  const normalized = normalizeState(state);
  await writeFile(DB_PATH, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

async function withState(mutator) {
  const state = await readState();
  const result = await mutator(state);
  const next = await writeState(state);
  return { next, result };
}

const mcp = new McpServer({
  name: "steam-wishlist-manager-mcp",
  version: "0.1.0"
});

mcp.registerTool(
  "swm_list_collections",
  {
    description: "List static and/or dynamic collections.",
    inputSchema: {
      source: z.enum(["all", "static", "dynamic"]).default("all")
    }
  },
  async ({ source }) => {
    const state = await readState();
    const staticNames = Object.keys(state.collections).sort();
    const dynamicNames = Object.keys(state.dynamicCollections).sort();
    const out = [];

    if (source === "all" || source === "static") {
      for (const name of staticNames) {
        out.push({
          name,
          type: "static",
          count: (state.collections[name] || []).length
        });
      }
    }
    if (source === "all" || source === "dynamic") {
      for (const name of dynamicNames) {
        out.push({
          name,
          type: "dynamic",
          count: 0,
          definition: state.dynamicCollections[name]
        });
      }
    }

    return {
      content: [{ type: "text", text: `Collections: ${out.length}` }],
      structuredContent: { collections: out }
    };
  }
);

mcp.registerTool(
  "swm_create_static_collection",
  {
    description: "Create a static collection.",
    inputSchema: {
      collectionName: z.string().min(1)
    }
  },
  async ({ collectionName }) => {
    const name = normalizeCollectionName(collectionName);
    if (!name) {
      throw new Error("Collection name is required.");
    }
    await withState((state) => {
      if (state.dynamicCollections[name]) {
        throw new Error("A dynamic collection with this name already exists.");
      }
      if (!state.collections[name]) {
        state.collections[name] = [];
      }
    });
    return {
      content: [{ type: "text", text: `Static collection created: ${name}` }],
      structuredContent: { collectionName: name }
    };
  }
);

mcp.registerTool(
  "swm_create_or_update_dynamic_collection",
  {
    description: "Create or update a dynamic collection definition.",
    inputSchema: {
      collectionName: z.string().min(1),
      baseSource: z.enum(["wishlist", "all-static", "static-collection"]).default("wishlist"),
      baseCollection: z.string().optional(),
      sortMode: z.string().default("title"),
      filters: z.string().optional()
    }
  },
  async ({ collectionName, baseSource, baseCollection, sortMode, filters }) => {
    const name = normalizeCollectionName(collectionName);
    if (!name) {
      throw new Error("Collection name is required.");
    }
    const parsedFilters = filters ? JSON.parse(filters) : {};
    await withState((state) => {
      if (state.collections[name]) {
        throw new Error("A static collection with this name already exists.");
      }
      state.dynamicCollections[name] = {
        baseSource,
        baseCollection: normalizeCollectionName(baseCollection || ""),
        sortMode: String(sortMode || "title"),
        filters: parsedFilters && typeof parsedFilters === "object" ? parsedFilters : {},
        capturedAt: Date.now()
      };
    });
    return {
      content: [{ type: "text", text: `Dynamic collection saved: ${name}` }],
      structuredContent: { collectionName: name }
    };
  }
);

mcp.registerTool(
  "swm_add_item_to_collection",
  {
    description: "Add one app to a static collection without removing from others.",
    inputSchema: {
      collectionName: z.string().min(1),
      appId: z.string().regex(APP_ID_RE),
      title: z.string().optional()
    }
  },
  async ({ collectionName, appId, title }) => {
    const name = normalizeCollectionName(collectionName);
    const id = validateAppId(appId);
    await withState((state) => {
      if (state.dynamicCollections[name]) {
        throw new Error("Cannot add items to a dynamic collection.");
      }
      if (!state.collections[name]) {
        state.collections[name] = [];
      }
      if (!state.collections[name].includes(id)) {
        state.collections[name].push(id);
      }
      if (state.collections[name].length > MAX_ITEMS_PER_COLLECTION) {
        state.collections[name] = state.collections[name].slice(0, MAX_ITEMS_PER_COLLECTION);
      }
      state.items[id] = {
        appId: id,
        title: String(title || state.items?.[id]?.title || "")
      };
    });

    return {
      content: [{ type: "text", text: `Added app ${id} to ${name}` }],
      structuredContent: { collectionName: name, appId: id }
    };
  }
);

mcp.registerTool(
  "swm_remove_item_from_collection",
  {
    description: "Remove one app from a static collection.",
    inputSchema: {
      collectionName: z.string().min(1),
      appId: z.string().regex(APP_ID_RE)
    }
  },
  async ({ collectionName, appId }) => {
    const name = normalizeCollectionName(collectionName);
    const id = validateAppId(appId);
    await withState((state) => {
      if (state.dynamicCollections[name]) {
        throw new Error("Cannot remove items from a dynamic collection.");
      }
      if (!state.collections[name]) {
        return;
      }
      state.collections[name] = state.collections[name].filter((value) => value !== id);
    });

    return {
      content: [{ type: "text", text: `Removed app ${id} from ${name}` }],
      structuredContent: { collectionName: name, appId: id }
    };
  }
);

mcp.registerTool(
  "swm_get_collection_items",
  {
    description: "Get items from a static collection.",
    inputSchema: {
      collectionName: z.string().min(1),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(500).default(100)
    }
  },
  async ({ collectionName, offset, limit }) => {
    const name = normalizeCollectionName(collectionName);
    const state = await readState();
    const ids = state.collections[name];
    if (!Array.isArray(ids)) {
      throw new Error("Static collection not found.");
    }
    const slice = ids.slice(offset, offset + limit);
    const items = slice.map((appId) => ({
      appId,
      title: String(state.items?.[appId]?.title || "")
    }));
    return {
      content: [{ type: "text", text: `Items: ${items.length} (from ${ids.length})` }],
      structuredContent: { collectionName: name, total: ids.length, offset, limit, items }
    };
  }
);

mcp.registerTool(
  "swm_import_extension_backup_json",
  {
    description: "Import extension backup JSON payload into MCP DB. Use mode=replace to fully replace or mode=merge to merge incrementally.",
    inputSchema: {
      backupJson: z.string().min(2),
      mode: z.enum(["replace", "merge"]).default("replace")
    }
  },
  async ({ backupJson, mode }) => {
    const extensionState = parseBackupJsonToExtensionState(backupJson);
    const incoming = toNormalizedStateFromExtensionState(extensionState);
    let nextState = null;

    if (mode === "replace") {
      nextState = await writeState(incoming);
    } else {
      const current = await readState();
      nextState = await writeState(mergeStates(current, incoming));
    }

    return {
      content: [{ type: "text", text: `Backup imported (${mode}).` }],
      structuredContent: {
        mode,
        collections: Object.keys(nextState.collections || {}).length,
        dynamicCollections: Object.keys(nextState.dynamicCollections || {}).length,
        items: Object.keys(nextState.items || {}).length
      }
    };
  }
);

mcp.registerTool(
  "swm_import_extension_backup_file",
  {
    description: "Import extension backup JSON file from disk into MCP DB.",
    inputSchema: {
      backupFilePath: z.string().min(1),
      mode: z.enum(["replace", "merge"]).default("replace")
    }
  },
  async ({ backupFilePath, mode }) => {
    const filePath = path.resolve(String(backupFilePath || ""));
    const jsonText = await readFile(filePath, "utf8");
    const extensionState = parseBackupJsonToExtensionState(jsonText);
    const incoming = toNormalizedStateFromExtensionState(extensionState);
    let nextState = null;
    if (mode === "replace") {
      nextState = await writeState(incoming);
    } else {
      const current = await readState();
      nextState = await writeState(mergeStates(current, incoming));
    }
    return {
      content: [{ type: "text", text: `Backup file imported (${mode}): ${filePath}` }],
      structuredContent: {
        mode,
        backupFilePath: filePath,
        collections: Object.keys(nextState.collections || {}).length,
        dynamicCollections: Object.keys(nextState.dynamicCollections || {}).length,
        items: Object.keys(nextState.items || {}).length
      }
    };
  }
);

mcp.registerTool(
  "swm_sync_extension_state_incremental",
  {
    description: "Incrementally sync extension state JSON object (steamWishlistCollectionsState) into MCP DB.",
    inputSchema: {
      extensionStateJson: z.string().min(2)
    }
  },
  async ({ extensionStateJson }) => {
    const parsed = JSON.parse(String(extensionStateJson || "{}"));
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid extension state payload.");
    }
    const incoming = toNormalizedStateFromExtensionState(parsed);
    const current = await readState();
    const nextState = await writeState(mergeStates(current, incoming));
    return {
      content: [{ type: "text", text: "Incremental sync applied." }],
      structuredContent: {
        collections: Object.keys(nextState.collections || {}).length,
        dynamicCollections: Object.keys(nextState.dynamicCollections || {}).length,
        items: Object.keys(nextState.items || {}).length
      }
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
