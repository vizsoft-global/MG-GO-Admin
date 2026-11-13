import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPTY_NOTIFICATION_FILTERS,
  FILTER_KEYS,
  mergeNotificationFilterParams,
  notificationFiltersToQuery,
  parseNotificationFilters,
  readAllParams,
  type NotificationFilterState,
} from "./notification-filter-state";

/** A `URLSearchParams`-shaped read-only source, the way `searchParams` arrives. */
function params(entries: Record<string, string>) {
  const inner = new URLSearchParams(entries);
  return {
    get: (key: string) => inner.get(key),
    forEach: (cb: (value: string, key: string) => void) => inner.forEach(cb),
  };
}

describe("mergeNotificationFilterParams", () => {
  const filters: NotificationFilterState = {
    ...EMPTY_NOTIFICATION_FILTERS,
    bucket: "sent",
    category: "support",
  };

  it("keeps the table's own params instead of dropping them", () => {
    /*
     * The page used to write this URL with `notificationFiltersToQuery` alone,
     * which rebuilt the query from the five filter keys. `useTablePrefs` wrote
     * `q` / `group` / `view` back, so the two writers overwrote each other on
     * every click and the search box cleared itself mid-type.
     */
    const existing = params({ q: "ramadan", group: "category", view: "grid", bucket: "drafts" });
    const merged = mergeNotificationFilterParams(existing, filters);
    const out = new URLSearchParams(merged.replace(/^\?/, ""));

    assert.equal(out.get("q"), "ramadan");
    assert.equal(out.get("group"), "category");
    assert.equal(out.get("view"), "grid");
    // The filter keys are ours, so the new values win.
    assert.equal(out.get("bucket"), "sent");
    assert.equal(out.get("category"), "support");
  });

  it("clears a filter key that is no longer set", () => {
    // Returning to All must remove the param, not leave the old value behind.
    const existing = params({ bucket: "sent", from: "2026-11-01", q: "x" });
    const merged = mergeNotificationFilterParams(existing, EMPTY_NOTIFICATION_FILTERS);
    const out = new URLSearchParams(merged.replace(/^\?/, ""));
    assert.equal(out.get("bucket"), null);
    assert.equal(out.get("from"), null);
    assert.equal(out.get("q"), "x");
  });

  it("returns a leading question mark, or an empty string when nothing is set", () => {
    assert.equal(mergeNotificationFilterParams(params({}), EMPTY_NOTIFICATION_FILTERS), "");
    assert.ok(
      mergeNotificationFilterParams(params({}), filters).startsWith("?"),
    );
  });

  it("owns exactly the five filter keys", () => {
    assert.deepEqual([...FILTER_KEYS].sort(), [
      "bucket",
      "category",
      "createdBy",
      "from",
      "to",
    ]);
  });
});

describe("readAllParams", () => {
  it("lists every param, including ones this module does not know", () => {
    assert.deepEqual(
      readAllParams(params({ q: "a", bucket: "sent" })).sort(),
      [
        ["bucket", "sent"],
        ["q", "a"],
      ],
    );
  });

  it("returns nothing for a source with no iterator", () => {
    // A saved link can arrive as a bare `{ get }` in tests and older call sites.
    assert.deepEqual(readAllParams({ get: () => null }), []);
  });
});

describe("round trip", () => {
  it("parses back to the same filters it wrote", () => {
    const filters: NotificationFilterState = {
      bucket: "scheduled",
      category: "payroll",
      from: "2026-11-01",
      to: "2026-11-30",
      createdBy: "u1",
    };
    const query = notificationFiltersToQuery(filters).replace(/^\?/, "");
    assert.deepEqual(parseNotificationFilters(params(Object.fromEntries(new URLSearchParams(query)))), filters);
  });
});
