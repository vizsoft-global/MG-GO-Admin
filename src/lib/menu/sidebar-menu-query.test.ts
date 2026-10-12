import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LIST_SEARCH_DEBOUNCE_MS,
  SIDEBAR_MENU_STALE_MS,
  sidebarMenuQueryKey,
} from "./sidebar-menu-query";

describe("sidebar menu query key", () => {
  it("includes role, super-admin, and both epochs", () => {
    assert.deepEqual(sidebarMenuQueryKey("operator", false, { accessEpoch: 4, menuEpoch: 9 }), [
      "sidebar-menu",
      "operator",
      false,
      4,
      9,
    ]);
  });

  it("defaults missing epochs to 0 so Stage D can land later", () => {
    assert.deepEqual(sidebarMenuQueryKey("administrator", true), [
      "sidebar-menu",
      "administrator",
      true,
      0,
      0,
    ]);
    assert.deepEqual(sidebarMenuQueryKey("operator", false, {}), [
      "sidebar-menu",
      "operator",
      false,
      0,
      0,
    ]);
  });

  it("treats an omitted epoch as 0 without dropping a provided one", () => {
    assert.deepEqual(sidebarMenuQueryKey("operator", false, { menuEpoch: 2 }), [
      "sidebar-menu",
      "operator",
      false,
      0,
      2,
    ]);
  });
});

describe("list search debounce", () => {
  it("waits 300ms", () => {
    assert.equal(LIST_SEARCH_DEBOUNCE_MS, 300);
  });

  it("keeps the sidebar menu fresh for five minutes", () => {
    assert.equal(SIDEBAR_MENU_STALE_MS, 5 * 60 * 1000);
  });
});
