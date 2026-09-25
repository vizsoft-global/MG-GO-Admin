import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeListColumnPreference } from "./merge";

const knownIds = ["driverId", "employeeId", "riderCategory", "companyClientId", "companyName", "name", "clientId", "actions"];
const system = {
  order: knownIds,
  visible: knownIds.filter((id) => id !== "clientId"),
  sort: null,
};

describe("normalizeListColumnPreference", () => {
  it("slots a newly added column beside its neighbour with its default visibility", () => {
    const saved = {
      order: ["driverId", "employeeId", "riderCategory", "name", "actions"],
      visible: ["driverId", "riderCategory", "name", "actions"],
      sort: null,
    };
    const out = normalizeListColumnPreference(saved, knownIds, system);
    assert.deepEqual(out.order, [
      "driverId", "employeeId", "riderCategory", "companyClientId", "companyName", "name", "clientId", "actions",
    ]);
    assert.ok(out.visible.includes("companyClientId"));
    assert.ok(out.visible.includes("companyName"));
    // Default-hidden stays hidden; a column the user hid stays hidden.
    assert.ok(!out.visible.includes("clientId"));
    assert.ok(!out.visible.includes("employeeId"));
  });

  it("leaves a preference that already knows every column untouched", () => {
    const saved = { order: [...knownIds].reverse(), visible: ["name"], sort: null };
    const out = normalizeListColumnPreference(saved, knownIds, system);
    assert.deepEqual(out.order, [...knownIds].reverse());
    assert.deepEqual(out.visible, ["name"]);
  });
});
