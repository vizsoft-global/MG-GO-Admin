import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collapseReconIssues, resolveReconRows } from "./order-recon-resolve";

describe("resolveReconRows", () => {
  it("matches store names case-insensitively and flags a name warning", () => {
    const rows = resolveReconRows(
      [
        {
          employee_id: "10001",
          employee_name: "Ada Different",
          store_name: "crystal tower",
          work_date: "2026-09-01",
          excel_orders: 2,
        },
      ],
      [{ id: "d1", employee_id: "10001", full_name: "Ada Test" }],
      [{ id: "r1", name: "Crystal Tower" }],
      [],
    );
    assert.equal(rows[0]?.status, "ready");
    assert.equal(rows[0]?.restaurant_id, "r1");
    assert.equal(rows[0]?.name_warning, true);
  });

  it("uses an alias after a name miss", () => {
    const rows = resolveReconRows(
      [
        {
          employee_id: "10001",
          employee_name: "Ada",
          store_name: "CT",
          work_date: "2026-09-01",
          excel_orders: 1,
        },
      ],
      [{ id: "d1", employee_id: "10001", full_name: "Ada" }],
      [{ id: "r1", name: "Crystal Tower" }],
      [{ alias: "CT", restaurant_id: "r1" }],
    );
    assert.equal(rows[0]?.restaurant_id, "r1");
    assert.equal(rows[0]?.status, "ready");
  });

  it("marks unknown IDs and stores unresolved", () => {
    const rows = resolveReconRows(
      [
        {
          employee_id: "99999",
          employee_name: "Ghost",
          store_name: "No Such Place",
          work_date: "2026-09-01",
          excel_orders: 1,
        },
      ],
      [],
      [],
      [],
    );
    assert.equal(rows[0]?.status, "unresolved");
    assert.equal(rows[0]?.unresolved_reason, "unknown_id");
  });
});

describe("collapseReconIssues", () => {
  const issue = (over: Partial<Parameters<typeof collapseReconIssues>[0][number]> = {}) => ({
    employee_id: "99999",
    employee_name: "Ghost",
    store_name: "Crystal Tower",
    work_date: "2026-09-01",
    excel_orders: 1,
    driver_id: null,
    restaurant_id: null,
    status: "unresolved" as const,
    name_warning: false,
    unresolved_reason: "unknown_id" as const,
    ...over,
  });

  it("folds a wide workbook's date columns into one entry per rider and store", () => {
    const issues = collapseReconIssues([
      issue({ work_date: "2026-09-03", excel_orders: 4 }),
      issue({ work_date: "2026-09-01", excel_orders: 2 }),
      issue({ work_date: "2026-09-02", excel_orders: 3 }),
    ]);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.days, 3);
    assert.equal(issues[0]?.excel_orders, 9);
    assert.equal(issues[0]?.first_date, "2026-09-01");
    assert.equal(issues[0]?.last_date, "2026-09-03");
  });

  it("keeps distinct riders, stores and reasons apart", () => {
    const issues = collapseReconIssues([
      issue(),
      issue({ employee_id: "88888" }),
      issue({ store_name: "Other Branch" }),
      issue({ unresolved_reason: "unknown_store" }),
    ]);
    assert.equal(issues.length, 4);
    assert.deepEqual(
      issues.map((row) => row.employee_id),
      ["88888", "99999", "99999", "99999"],
    );
  });

  it("does not merge two different unknown IDs, which normalizeEmployeeId nulls alike", () => {
    const issues = collapseReconIssues([
      issue({ employee_id: "ABC" }),
      issue({ employee_id: "XYZ" }),
    ]);
    assert.equal(issues.length, 2);
  });

  it("ignores ready rows", () => {
    assert.deepEqual(
      collapseReconIssues([
        issue({ status: "ready", driver_id: "d1", restaurant_id: "r1", unresolved_reason: null }),
      ]),
      [],
    );
  });
});
