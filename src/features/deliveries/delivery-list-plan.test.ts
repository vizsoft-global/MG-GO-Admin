import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONTAINS_SCAN_READS,
  DELIVERY_SEARCH_CAP,
  DELIVERY_SEARCH_FIELDS,
  capPrefixMatchSet,
  DELIVERY_SEARCH_BACKFILL_COMPLETE,
  deliverySearchUsesPrefix,
  gpsInChunks,
  GPS_IN_CHUNK,
  pagePrefixMatches,
  prefixPageDecision,
  prefixPageNeedsFullScan,
  routeDeliveryList,
} from "./delivery-list-plan";

const open = {
  indexed: true,
  offset: 0,
  limit: 50,
};

describe("routeDeliveryList", () => {
  it("uses an indexed page when there is no search", () => {
    assert.equal(routeDeliveryList(open).kind, "indexed");
  });

  it("keeps last digits and last names on the scan", () => {
    const digits = routeDeliveryList({ ...open, search: "1234" });
    assert.equal(digits.kind, "scan");
    if (digits.kind === "scan") assert.ok(digits.reasons.includes("contains_search"));
    const lastName = routeDeliveryList({ ...open, search: "smith" });
    assert.equal(lastName.kind, "scan");
    if (lastName.kind === "scan") assert.ok(lastName.reasons.includes("contains_search"));
    assert.equal(DELIVERY_SEARCH_FIELDS.contains.orderIdLastDigits, "external_order_id");
    assert.equal(DELIVERY_SEARCH_FIELDS.contains.riderLastName, "profiles.full_name");
    assert.equal(DELIVERY_SEARCH_FIELDS.prefix.orderIdStart, "order_id_lower");
  });

  it("uses a prefix page only for the start of an order id or a name", () => {
    const route = routeDeliveryList({
      ...open,
      search: "ORD-9",
      status: "verified",
      searchShape: "prefix",
    });
    assert.equal(route.kind, "prefix");
    if (route.kind === "prefix") assert.equal(route.fieldEquality, "status");
  });

  it("keeps the old scan for filters a prefix index would answer differently", () => {
    assert.equal(routeDeliveryList({ ...open, search: "mid", cancelReason: "other" }).kind, "scan");
    const hex = routeDeliveryList({ ...open, search: "ab12" });
    assert.equal(hex.kind, "scan");
    if (hex.kind === "scan") assert.ok(hex.reasons.includes("document_id_prefix"));
    const ranged = routeDeliveryList({ ...open, search: "ali", dateFrom: "2026-10-01" });
    assert.equal(ranged.kind, "scan");
    if (ranged.kind === "scan") assert.ok(ranged.reasons.includes("search_plus_delivered_at_range"));
    const both = routeDeliveryList({ ...open, search: "ali", zoneId: "z", partnerId: "p" });
    assert.equal(both.kind, "scan");
    if (both.kind === "scan") {
      assert.ok(both.reasons.includes("search_plus_zone_and_partner"));
      assert.ok(both.reasons.includes("search_plus_multiple_equalities"));
    }
    const missing = routeDeliveryList({ ...open, search: "alia", indexed: false, searchShape: "prefix" });
    assert.equal(missing.kind, "scan");
    if (missing.kind === "scan") assert.ok(missing.reasons.includes("lowercase_field_absent"));
    const deep = routeDeliveryList({
      ...open,
      search: "alia",
      searchShape: "prefix",
      offset: DELIVERY_SEARCH_CAP,
      limit: 50,
    });
    assert.equal(deep.kind, "prefix");
    assert.equal(CONTAINS_SCAN_READS.deliveryDocsMax, DELIVERY_SEARCH_CAP);
    assert.equal(CONTAINS_SCAN_READS.driverDocs, "all");
    assert.equal(CONTAINS_SCAN_READS.profileDocs, "all");
    assert.equal(CONTAINS_SCAN_READS.matchedDriverIdCap, 300);
    const inside = routeDeliveryList({
      ...open,
      search: "alia",
      searchShape: "prefix",
      offset: 980,
      limit: 50,
    });
    assert.equal(inside.kind, "prefix");
  });

  it("pages a three-character prefix instead of refusing it", () => {
    const route = routeDeliveryList({ ...open, search: "abc", searchShape: "prefix" });
    assert.equal(route.kind, "prefix");
    if (route.kind === "prefix") assert.equal(route.bounds.start, "abc");
  });

  it("pages a one-character prefix", () => {
    const route = routeDeliveryList({ ...open, search: "a", searchShape: "prefix" });
    assert.equal(route.kind, "prefix");
  });

  it("uses a prefix page for a 4-character prefix when indexed", () => {
    const route = routeDeliveryList({ ...open, search: "name", searchShape: "prefix" });
    assert.equal(route.kind, "prefix");
    if (route.kind === "prefix") {
      assert.equal(route.bounds.start, "name");
      assert.equal(route.fieldEquality, null);
    }
  });

  it("keeps a 2-character contains search on the scan", () => {
    const route = routeDeliveryList({ ...open, search: "ab", searchShape: "contains" });
    assert.equal(route.kind, "scan");
    if (route.kind === "scan") assert.ok(route.reasons.includes("contains_search"));
  });
});

describe("prefix fallback before backfill", () => {
  it("scans when any delivery can still lack order_id_lower", () => {
    assert.equal(DELIVERY_SEARCH_BACKFILL_COMPLETE, false);
    assert.equal(deliverySearchUsesPrefix(true, false), false);
    assert.equal(deliverySearchUsesPrefix(false, false), false);
    assert.equal(deliverySearchUsesPrefix(true, true), true);
    const routed = routeDeliveryList({
      ...open,
      search: "1008",
      searchShape: "prefix",
      indexed: deliverySearchUsesPrefix(true, DELIVERY_SEARCH_BACKFILL_COMPLETE),
    });
    assert.equal(routed.kind, "scan");
    if (routed.kind === "scan") assert.ok(routed.reasons.includes("lowercase_field_absent"));
  });

  it("does not treat an empty prefix page as no results before backfill", () => {
    assert.equal(
      prefixPageNeedsFullScan({ backfillComplete: false, rowCount: 0, capped: false }),
      true,
    );
    assert.equal(
      prefixPageDecision({
        backfillComplete: false,
        probeFoundField: true,
        prefixRowCount: 0,
        capped: false,
      }),
      "scan",
    );
    assert.equal(
      prefixPageDecision({
        backfillComplete: false,
        probeFoundField: true,
        prefixRowCount: 4,
        capped: false,
      }),
      "scan",
    );
    assert.equal(
      prefixPageDecision({
        backfillComplete: true,
        probeFoundField: true,
        prefixRowCount: 0,
        capped: false,
      }),
      "prefix",
    );
    assert.equal(
      prefixPageDecision({
        backfillComplete: true,
        probeFoundField: true,
        prefixRowCount: null,
        capped: false,
      }),
      "scan",
    );
  });
});

describe("capPrefixMatchSet", () => {
  it("keeps the newest fetched rows and marks a saturated field truncated", () => {
    const capped = capPrefixMatchSet(
      [
        { id: "old", createdAtMs: 1 },
        { id: "new", createdAtMs: 3 },
        { id: "mid", createdAtMs: 2 },
      ],
      2,
      false,
    );
    assert.equal(capped.truncated, true);
    assert.deepEqual(
      capped.rows.map((row) => row.id),
      ["new", "mid"],
    );
    const saturated = capPrefixMatchSet([{ id: "only", createdAtMs: 1 }], 20_000, true);
    assert.equal(saturated.truncated, true);
    assert.equal(saturated.rows.length, 1);
    const page = pagePrefixMatches(saturated.rows, DELIVERY_SEARCH_CAP, 50);
    assert.deepEqual(page, []);
  });
});

describe("pagePrefixMatches", () => {
  it("sorts the capped set by created_at desc before paging", () => {
    const page = pagePrefixMatches(
      [
        { id: "b", createdAtMs: 1 },
        { id: "a", createdAtMs: 3 },
        { id: "c", createdAtMs: 2 },
      ],
      0,
      2,
    );
    assert.deepEqual(
      page.map((row) => row.id),
      ["a", "c"],
    );
  });
});

describe("gpsInChunks", () => {
  it("splits delivery ids at 30", () => {
    const ids = Array.from({ length: 31 }, (_, index) => `d${index}`);
    const chunks = gpsInChunks(ids);
    assert.equal(GPS_IN_CHUNK, 30);
    assert.deepEqual(
      chunks.map((chunk) => chunk.length),
      [30, 1],
    );
    assert.equal(chunks[0]?.[0], "d0");
    assert.equal(chunks[1]?.[0], "d30");
  });
});
