import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPLIANCE_MAX_ROWS,
  buildComplianceWrites,
  commitComplianceWrites,
  dedupeResolvedRows,
  parseComplianceSheet,
} from "./compliance-parse";
import type { CompliancePreviewRow, ComplianceSheet, ComplianceWrite } from "./types";

const TODAY = "2026-10-16";
const HEADERS = [
  "employee_id",
  "driver_code",
  "day",
  "invalid_days",
  "rejected_orders",
  "cancelled_orders",
];

function parse(sheet: ComplianceSheet) {
  return parseComplianceSheet(sheet, { today: TODAY });
}

describe("parseComplianceSheet", () => {
  it("reads the headers case-insensitively and in any order", () => {
    const { rows, issues } = parse({
      headers: ["Day", "Employee ID", "Driver Code", "Invalid Days", "Rejected Orders", "Cancelled Orders"],
      rows: [["2026-10-12", "40028", "10955", "2", "3", "1"]],
    });
    assert.deepEqual(issues.missingRequiredColumns, []);
    assert.deepEqual(issues.missingOptionalColumns, []);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].employee_id, "40028");
    assert.equal(rows[0].driver_code, "10955");
    assert.equal(rows[0].day, "2026-10-12");
    assert.equal(rows[0].invalid_days, 2);
    assert.equal(rows[0].rejected_orders, 3);
    assert.equal(rows[0].cancelled_orders, 1);
    assert.equal(rows[0].status, "ok");
  });

  it("treats a blank metric as zero and rejects a non-number", () => {
    const { rows } = parse({
      headers: HEADERS,
      rows: [
        ["40028", "", "2026-10-12", "", "", ""],
        ["40029", "", "2026-10-12", "two", "3", "1"],
      ],
    });
    assert.deepEqual(
      [rows[0].invalid_days, rows[0].rejected_orders, rows[0].cancelled_orders],
      [0, 0, 0],
    );
    assert.equal(rows[1].status, "invalid_number");
  });

  it("rejects a metric outside its range", () => {
    const { rows } = parse({
      headers: HEADERS,
      rows: [["40028", "", "2026-10-12", "32", "0", "0"]],
    });
    assert.equal(rows[0].status, "invalid_number");
  });

  it("flags a bad day, a missing identity and a duplicate rider+day", () => {
    const { rows } = parse({
      headers: HEADERS,
      rows: [
        ["40028", "", "12-10-2026", "1", "0", "0"],
        ["", "", "2026-10-12", "1", "0", "0"],
        ["40030", "", "2026-10-12", "1", "0", "0"],
        ["40030", "", "2026-10-12", "2", "0", "0"],
      ],
    });
    assert.equal(rows[0].status, "invalid_day");
    assert.equal(rows[1].status, "unknown_id");
    assert.equal(rows[2].status, "ok");
    assert.equal(rows[3].status, "duplicate");
  });

  it("treats an absent optional metric column as zero, not as a refusal", () => {
    const { rows, issues } = parse({
      headers: ["employee_id", "day"],
      rows: [["40028", "2026-10-12"]],
    });
    assert.deepEqual(issues.missingRequiredColumns, []);
    assert.deepEqual(issues.missingOptionalColumns, [
      "invalid_days",
      "rejected_orders",
      "cancelled_orders",
    ]);
    assert.deepEqual(
      [rows[0].invalid_days, rows[0].rejected_orders, rows[0].cancelled_orders],
      [0, 0, 0],
    );
    assert.equal(rows[0].status, "ok");
  });

  it("blocks a file with no day column", () => {
    const { issues } = parse({
      headers: ["employee_id", "invalid_days"],
      rows: [["40028", "1"]],
    });
    assert.deepEqual(issues.missingRequiredColumns, ["day"]);
  });

  it("blocks a file with neither identity column", () => {
    const { issues } = parse({
      headers: ["day", "invalid_days"],
      rows: [["2026-10-12", "1"]],
    });
    assert.deepEqual(issues.missingRequiredColumns, ["employee_id or driver_code"]);
  });

  it("accepts either identity column on its own", () => {
    const byCode = parse({
      headers: ["driver_code", "day", "invalid_days"],
      rows: [["10955", "2026-10-12", "1"]],
    });
    assert.deepEqual(byCode.issues.missingRequiredColumns, []);
    assert.equal(byCode.rows[0].status, "ok");
  });

  it("accepts KeeTa header names for the same columns", () => {
    const { rows, issues } = parse({
      headers: ["Rider ID", "Date", "Order Rejections", "Cancellations", "Invalid Days"],
      rows: [["40028", "2026-10-12", "4", "5", "1"]],
    });
    assert.deepEqual(issues.missingRequiredColumns, []);
    assert.equal(rows[0].employee_id, "40028");
    assert.equal(rows[0].rejected_orders, 4);
    assert.equal(rows[0].cancelled_orders, 5);
    assert.equal(rows[0].invalid_days, 1);
    assert.equal(rows[0].status, "ok");
  });

  it("normalizes zero-width characters and Arabic-Indic digits", () => {
    const { rows } = parse({
      headers: ["employee_id", "day", "invalid_days", "rejected_orders", "cancelled_orders"],
      rows: [["\uFEFF 40028 \u200F", "2026-10-12", "٢", "٣", "١"]],
    });
    assert.equal(rows[0].employee_id, "40028");
    assert.equal(rows[0].invalid_days, 2);
    assert.equal(rows[0].rejected_orders, 3);
    assert.equal(rows[0].cancelled_orders, 1);
    assert.equal(rows[0].status, "ok");
  });

  it("caps a file at the row limit", () => {
    const { rows } = parse({
      headers: HEADERS,
      rows: Array.from({ length: COMPLIANCE_MAX_ROWS + 1 }, (_, i) => [
        `4${String(i).padStart(4, "0")}`,
        "",
        "2026-10-12",
        "1",
        "0",
        "0",
      ]),
    });
    assert.equal(rows.length, COMPLIANCE_MAX_ROWS);
  });
});

function previewRow(over: Partial<CompliancePreviewRow>): CompliancePreviewRow {
  return {
    row_index: 0,
    employee_id: "",
    driver_code: "",
    day: "2026-10-12",
    invalid_days: 0,
    rejected_orders: 0,
    cancelled_orders: 0,
    status: "ok",
    driver_id: "d1",
    driver_name: "Ali",
    ...over,
  };
}

describe("dedupeResolvedRows", () => {
  it("catches the same rider-day typed through different id columns", () => {
    const { rows, duplicateCount } = dedupeResolvedRows([
      previewRow({ row_index: 0, employee_id: "40028", driver_id: "d1" }),
      previewRow({ row_index: 1, driver_code: "10955", driver_id: "d1" }),
    ]);
    assert.equal(duplicateCount, 1);
    assert.equal(rows[0].status, "ok");
    assert.equal(rows[1].status, "duplicate");
  });

  it("keeps two different days for one rider", () => {
    const { rows, duplicateCount } = dedupeResolvedRows([
      previewRow({ row_index: 0, employee_id: "40028" }),
      previewRow({ row_index: 1, employee_id: "40028", day: "2026-10-13" }),
    ]);
    assert.equal(duplicateCount, 0);
    assert.equal(rows[1].status, "ok");
  });

  it("never re-labels a row the parser already rejected", () => {
    const { rows, duplicateCount } = dedupeResolvedRows([
      previewRow({ row_index: 0, employee_id: "40028" }),
      previewRow({ row_index: 1, employee_id: "40028", status: "unknown_id", driver_id: null }),
    ]);
    assert.equal(duplicateCount, 0);
    assert.equal(rows[1].status, "unknown_id");
  });
});

describe("buildComplianceWrites", () => {
  it("keys every write by resolved driver and Kuwait day, and skips rejects", () => {
    const uploadedAt = new Date("2026-10-16T00:00:00Z");
    const writes = buildComplianceWrites(
      [
        previewRow({
          row_index: 0,
          employee_id: "40028",
          driver_code: "10955",
          driver_id: "d1",
          invalid_days: 1,
          rejected_orders: 2,
          cancelled_orders: 3,
        }),
        previewRow({ row_index: 1, driver_id: "d2", status: "duplicate" }),
      ],
      { batchId: "b1", fileName: "ops.csv", uploadedBy: "u1", uploadedAt },
    );
    assert.equal(writes.length, 1);
    assert.equal(writes[0].id, "d1_2026-10-12");
    assert.deepEqual(writes[0].data, {
      driver_id: "d1",
      employee_id: "40028",
      driver_code: "10955",
      day: "2026-10-12",
      invalid_days: 1,
      rejected_orders: 2,
      cancelled_orders: 3,
      source: "ops_upload",
      batch_id: "b1",
      file_name: "ops.csv",
      uploaded_by: "u1",
      uploaded_at: uploadedAt,
    });
  });
});

describe("commitComplianceWrites", () => {
  const write = (id: string): ComplianceWrite => ({ id, data: { id } });

  it("reports the chunks that committed when a later chunk fails", async () => {
    const attempted: string[][] = [];
    const { committed, failure } = await commitComplianceWrites(
      [write("a"), write("b"), write("c")],
      async (chunk) => {
        attempted.push(chunk.map((item) => item.id));
        if (chunk[0].id === "c") throw new Error("boom");
      },
      2,
    );
    assert.deepEqual(attempted, [["a", "b"], ["c"]]);
    assert.deepEqual(
      committed.map((item) => item.id),
      ["a", "b"],
    );
    assert.ok(failure instanceof Error);
  });

  it("reports nothing committed when the first chunk fails", async () => {
    const { committed, failure } = await commitComplianceWrites(
      [write("a")],
      async () => {
        throw new Error("boom");
      },
      2,
    );
    assert.deepEqual(committed, []);
    assert.ok(failure instanceof Error);
  });

  it("reports no failure when every chunk commits", async () => {
    const { committed, failure } = await commitComplianceWrites(
      [write("a"), write("b"), write("c")],
      async () => {},
      2,
    );
    assert.equal(failure, null);
    assert.equal(committed.length, 3);
  });
});
