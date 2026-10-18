import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canDeferDriverJoin,
  canonicalDriversGroupBy,
  canonicalDriversSearchField,
  dedupeRestaurantEdges,
  rosterKpis,
} from "./driver-list-plan";

describe("driver list plan", () => {
  it("defers the driver join only for the intake-sorted default page", () => {
    const open = { tab: "all", search: null, filterCount: 0, sortKey: "name" };
    assert.equal(canDeferDriverJoin(open), true);
    assert.equal(canDeferDriverJoin({ ...open, sortKey: "phone" }), true);
    assert.equal(canDeferDriverJoin({ ...open, tab: "pending" }), false);
    assert.equal(canDeferDriverJoin({ ...open, tab: "on_duty" }), false);
    assert.equal(canDeferDriverJoin({ ...open, tab: "multi_device" }), false);
    assert.equal(canDeferDriverJoin({ ...open, tab: "archived" }), false);
    assert.equal(canDeferDriverJoin({ ...open, search: "jen" }), false);
    assert.equal(canDeferDriverJoin({ ...open, filterCount: 1 }), false);
    assert.equal(canDeferDriverJoin({ ...open, sortKey: "zone" }), false);
    assert.equal(canDeferDriverJoin({ ...open, sortKey: "status" }), false);
    assert.equal(canDeferDriverJoin({ ...open, sortKey: "todayDeliveries" }), false);
    assert.equal(canDeferDriverJoin({ ...open, sortKey: "mgId" }), false);
    assert.equal(canDeferDriverJoin({ ...open, sortKey: "cf:shirt" }), false);
  });

  it("maps the panel's snake_case search and group keys", () => {
    assert.equal(canonicalDriversSearchField("employee_id"), "employeeId");
    assert.equal(canonicalDriversSearchField("civil_id"), "civilId");
    assert.equal(canonicalDriversSearchField("not-a-field"), "all");
    assert.equal(canonicalDriversGroupBy("employee_status"), "employeeStatus");
    assert.equal(canonicalDriversGroupBy("nationality_category"), "nationalityCategory");
    assert.equal(canonicalDriversGroupBy("made-up"), "none");
  });

  it("counts each intake once, including overlapping pending flags", () => {
    const kpis = rosterKpis([
      { linkedProfileId: null, workflowStatus: "pending", accountStatus: "pending", onDuty: false },
      { linkedProfileId: "d1", workflowStatus: "approved", accountStatus: "active", onDuty: true },
      { linkedProfileId: "d2", workflowStatus: "approved", accountStatus: "active", onDuty: false },
      { linkedProfileId: "d3", workflowStatus: "pending", accountStatus: "pending", onDuty: false },
      { linkedProfileId: "d4", workflowStatus: "approved", accountStatus: "suspended", onDuty: false },
    ]);
    assert.deepEqual(kpis, {
      total: 5,
      activeToday: 2,
      onlineNow: 1,
      inactive: 1,
      pendingVerification: 2,
      suspended: 1,
    });
  });

  it("keeps one restaurant edge when the same link is read twice", () => {
    const edges = dedupeRestaurantEdges([
      { owner: "drv", restaurantId: "r1", name: "KFC" },
      { owner: "drv", restaurantId: "r1", name: "KFC" },
      { owner: "drv", restaurantId: "r2", name: "Burger" },
    ]);
    assert.deepEqual(edges.get("drv"), [
      { id: "r2", name: "Burger" },
      { id: "r1", name: "KFC" },
    ]);
  });
});
