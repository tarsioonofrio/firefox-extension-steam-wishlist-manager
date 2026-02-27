import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const ROOT = process.cwd();

function createDom(html = "<!doctype html><html><body></body></html>") {
  return new JSDOM(html, { url: "https://example.test/" });
}

function loadModule(dom, relPath) {
  const code = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  const context = vm.createContext({
    window: dom.window,
    document: dom.window.document,
    console,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(code, context, { filename: relPath });
}

function setupBindingsDom() {
  return createDom(`
    <select id="collection-select"><option value="__all__">All</option><option value="x">X</option></select>
    <button id="collection-select-btn"></button>
    <div id="collection-select-options"><button data-value="x"></button></div>
    <select id="sort-select"><option value="title">Title</option></select>
    <button id="sort-menu-btn"></button>
    <div id="sort-menu-options"><button data-value="title"></button></div>
    <input id="search-input">
    <button id="prev-page-btn"></button>
    <button id="next-page-btn"></button>
    <input id="tag-search-input">
    <button id="tag-show-more-btn"></button>
    <input id="languages-search-input">
    <input id="full-audio-languages-search-input">
    <input id="subtitle-languages-search-input">
    <input id="technologies-search-input">
    <input id="developers-search-input">
    <input id="publishers-search-input">
    <button id="refresh-page-btn"></button>
    <button id="refresh-track-feed-btn"></button>
    <button id="reset-track-feed-dismissed-btn"></button>
    <select id="triage-filter-select"><option value="all">All</option></select>
    <input id="hide-muted-checkbox" type="checkbox">
    <input id="under-target-checkbox" type="checkbox">
    <select id="track-window-select"><option value="30">30</option></select>
    <button id="collection-menu-btn"></button>
    <button id="menu-action-rename"></button>
    <button id="menu-action-create"></button>
    <button id="menu-action-delete"></button>
    <div id="rename-collection-form"></div>
    <div id="create-collection-form"></div>
    <div id="delete-collection-form"></div>
    <input id="rename-collection-input" value="new name">
    <input id="create-collection-input" value="created name">
    <select id="delete-collection-select"><option value="to-delete" selected>to-delete</option></select>
    <button id="rename-collection-ok"></button>
    <button id="create-collection-ok"></button>
    <button id="delete-collection-ok"></button>
    <span id="rating-min-label"></span>
    <span id="rating-max-label"></span>
    <input id="rating-min-range" value="0">
    <input id="rating-max-range" value="100">
    <input id="reviews-min-input" value="0">
    <input id="reviews-max-input" value="1000">
    <span id="discount-min-label"></span>
    <span id="discount-max-label"></span>
    <input id="discount-min-range" value="0">
    <input id="discount-max-range" value="100">
    <input id="price-min-input" value="0">
    <input id="price-max-input" value="999">
    <button id="apply-reviews-btn"></button>
    <button id="apply-price-btn"></button>
  `);
}

async function testSelectionBindings() {
  const dom = setupBindingsDom();
  loadModule(dom, "src/pages/collections-selection-bindings.js");
  const bindings = dom.window.SWMCollectionsSelectionBindings;
  assert.ok(bindings);

  const events = [];
  bindings.bindCollectionControls({
    onCollectionChange: async (value) => events.push(["collection-change", value]),
    closeMenusBeforeOpenCollectionSelect: () => events.push(["close-before-collection"]),
    toggleCollectionSelectMenu: () => events.push(["toggle-collection-menu"]),
    closeCollectionSelectMenu: () => events.push(["close-collection-menu"])
  });
  bindings.bindSortControls({
    onSortChange: async (value) => events.push(["sort-change", value]),
    closeMenusBeforeOpenSort: () => events.push(["close-before-sort"]),
    toggleSortMenu: () => events.push(["toggle-sort-menu"]),
    closeSortMenu: () => events.push(["close-sort-menu"])
  });

  const doc = dom.window.document;
  const collectionSelect = doc.getElementById("collection-select");
  collectionSelect.value = "x";
  collectionSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  doc.getElementById("collection-select-btn").click();
  doc.querySelector("#collection-select-options button").click();

  const sortSelect = doc.getElementById("sort-select");
  sortSelect.value = "title";
  sortSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  doc.getElementById("sort-menu-btn").click();
  doc.querySelector("#sort-menu-options button").click();

  await new Promise((r) => setTimeout(r, 0));
  assert.ok(events.some((e) => e[0] === "collection-change" && e[1] === "x"));
  assert.ok(events.some((e) => e[0] === "sort-change" && e[1] === "title"));
}

async function testGeneralBindingsAndMenuAndRange() {
  const dom = setupBindingsDom();
  loadModule(dom, "src/pages/collections-general-bindings.js");
  loadModule(dom, "src/pages/collections-menu-bindings.js");
  loadModule(dom, "src/pages/collections-range-controls.js");

  const general = dom.window.SWMCollectionsGeneralBindings;
  const menu = dom.window.SWMCollectionsMenuBindings;
  const range = dom.window.SWMCollectionsRangeControls;
  assert.ok(general);
  assert.ok(menu);
  assert.ok(range);

  const calls = [];
  general.bindGeneralControls({
    onSearchInput: async (value) => calls.push(["search", value]),
    onPrevPage: async () => calls.push(["prev"]),
    onNextPage: async () => calls.push(["next"]),
    onTagSearchInput: (value) => calls.push(["tag-search", value]),
    onTagShowMore: () => calls.push(["tag-more"]),
    onTextFilterInput: (id, value) => calls.push(["text-filter", id, value]),
    onRefreshPage: () => calls.push(["refresh-page"]),
    onRefreshTrackFeed: () => calls.push(["refresh-track-feed"]),
    onResetTrackFeedDismissed: () => calls.push(["reset-track-feed-dismissed"]),
    onTriageFilterChange: async (value) => calls.push(["triage-filter", value]),
    onHideMutedChange: async (value) => calls.push(["hide-muted", value]),
    onUnderTargetChange: async (value) => calls.push(["under-target", value]),
    onTrackWindowChange: async (value) => calls.push(["track-window", value])
  });

  const doc = dom.window.document;
  doc.getElementById("search-input").value = "arc";
  doc.getElementById("search-input").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  doc.getElementById("prev-page-btn").click();
  doc.getElementById("next-page-btn").click();
  doc.getElementById("tag-search-input").value = "rpg";
  doc.getElementById("tag-search-input").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  doc.getElementById("tag-show-more-btn").click();
  doc.getElementById("languages-search-input").value = "english";
  doc.getElementById("languages-search-input").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  doc.getElementById("refresh-page-btn").click();
  doc.getElementById("refresh-track-feed-btn").click();
  doc.getElementById("reset-track-feed-dismissed-btn").click();
  doc.getElementById("triage-filter-select").value = "all";
  doc.getElementById("triage-filter-select").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  doc.getElementById("hide-muted-checkbox").checked = true;
  doc.getElementById("hide-muted-checkbox").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  doc.getElementById("under-target-checkbox").checked = true;
  doc.getElementById("under-target-checkbox").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  doc.getElementById("track-window-select").value = "30";
  doc.getElementById("track-window-select").dispatchEvent(new dom.window.Event("change", { bubbles: true }));

  menu.bindCollectionMenuControls({
    hideForms: () => {
      doc.getElementById("rename-collection-form").classList.add("hidden");
      doc.getElementById("create-collection-form").classList.add("hidden");
      doc.getElementById("delete-collection-form").classList.add("hidden");
    },
    toggleCollectionSelectMenu: () => calls.push(["toggle-collection-select-menu"]),
    toggleSortMenu: () => calls.push(["toggle-sort-menu"]),
    toggleCollectionMenu: () => calls.push(["toggle-collection-menu"]),
    renameHandler: async (value) => calls.push(["rename", value]),
    createHandler: async (value) => calls.push(["create", value]),
    deleteHandler: async (value) => calls.push(["delete", value]),
    onError: (message) => calls.push(["error", message])
  });

  doc.getElementById("menu-action-create").click();
  doc.getElementById("create-collection-ok").click();

  range.renderRangeControls({
    ratingMin: 10,
    ratingMax: 90,
    reviewsMin: 100,
    reviewsMax: 500,
    discountMin: 5,
    discountMax: 80,
    priceMin: 10,
    priceMax: 200
  });

  const rangeCalls = [];
  range.bindRangeControls({
    onRatingMinInput: (v) => rangeCalls.push(["rating-min", v]),
    onRatingMaxInput: (v) => rangeCalls.push(["rating-max", v]),
    onApplyReviews: (min, max) => rangeCalls.push(["reviews", min, max]),
    onDiscountMinInput: (v) => rangeCalls.push(["discount-min", v]),
    onDiscountMaxInput: (v) => rangeCalls.push(["discount-max", v]),
    onApplyPrice: (min, max) => rangeCalls.push(["price", min, max])
  });

  doc.getElementById("rating-min-range").value = "12";
  doc.getElementById("rating-min-range").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  doc.getElementById("apply-reviews-btn").click();

  await new Promise((r) => setTimeout(r, 0));
  assert.ok(calls.some((e) => e[0] === "search" && e[1] === "arc"));
  assert.ok(calls.some((e) => e[0] === "refresh-track-feed"));
  assert.ok(calls.some((e) => e[0] === "reset-track-feed-dismissed"));
  assert.ok(calls.some((e) => e[0] === "create" && e[1] === "created name"));
  assert.equal(doc.getElementById("create-collection-input").value, "");
  assert.equal(doc.getElementById("rating-min-label").textContent, "10%");
  assert.ok(rangeCalls.some((e) => e[0] === "rating-min" && e[1] === "12"));
}

async function main() {
  await testSelectionBindings();
  await testGeneralBindingsAndMenuAndRange();
  console.log("ui smoke ok");
}

main();
