import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeClientPortal } from "./shape";

/**
 * The dashboard's rider table reads `riders[].bucket`, which the Cloud Function
 * computes in the same pass as the KPI cards. An older build sends no array at
 * all, so the parser must answer `[]` rather than inventing a bucket — a rider
 * filed under the wrong card is worse than one missing from the table.
 */
describe("normalizeClientPortal riders", () => {
  it("keeps one row per rider with its bucket", () => {
    const dashboard = normalizeClientPortal({
      riders: [
        { employeeId: "1001", name: "A", zone: "Salmiya", bucket: "working", status: "running" },
        { employeeId: "1002", name: "B", zone: "Jahra", bucket: "sick", status: "running" },
      ],
    });
    assert.deepEqual(
      dashboard.riders.map((row) => [row.employeeId, row.bucket]),
      [
        ["1001", "working"],
        ["1002", "sick"],
      ],
    );
  });

  it("drops a row whose bucket is unknown instead of guessing", () => {
    const dashboard = normalizeClientPortal({
      riders: [
        { employeeId: "1001", name: "A", bucket: "working" },
        { employeeId: "1002", name: "B", bucket: "something-new" },
        { employeeId: "1003", name: "C" },
      ],
    });
    assert.deepEqual(
      dashboard.riders.map((row) => row.employeeId),
      ["1001"],
    );
  });

  it("an old function build sends no riders array", () => {
    assert.deepEqual(normalizeClientPortal({ kpis: { assigned: 3 } }).riders, []);
  });

  it("emptyClientPortal carries the field so the table never reads undefined", () => {
    assert.deepEqual(normalizeClientPortal(null).riders, []);
  });
});
