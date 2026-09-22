import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveReconRows } from "./order-recon-resolve";

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
