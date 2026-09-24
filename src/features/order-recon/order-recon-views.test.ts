import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrderReconTableRow, ReconRowStatus } from "./order-recon-types";
import {
  buildReconViews,
  buildRunEmployees,
  buildRunProgress,
  dailyForEmployee,
  dailyPreservesComparedTotals,
  rollupDaily,
  unresolvedRows,
  unusedAppRiders,
} from "./order-recon-views";
import type { OrderReconRunSummary } from "./order-recon-types";

function row(partial: Partial<OrderReconTableRow> & Pick<OrderReconTableRow, "status">): OrderReconTableRow {
  return {
    id: partial.id ?? `${partial.employee_id}-${partial.restaurant_name}-${partial.work_date}`,
    employee_id: partial.employee_id ?? "1304",
    employee_name: partial.employee_name ?? "Ada",
    restaurant_name: partial.restaurant_name ?? "Store",
    work_date: partial.work_date ?? "2026-09-01",
    excel_orders: partial.excel_orders ?? 0,
    app_orders: partial.app_orders ?? 0,
    difference: partial.difference ?? (partial.app_orders ?? 0) - (partial.excel_orders ?? 0),
    status: partial.status,
    driver_id: partial.driver_id,
    restaurant_id: partial.restaurant_id,
  };
}

describe("rollupDaily", () => {
  it("one rider, one day, two restaurants (+2 / -2) is a daily match, not a mismatch", () => {
    const rows: OrderReconTableRow[] = [
      row({
        restaurant_name: "A",
        excel_orders: 5,
        app_orders: 7,
        status: "mismatch",
      }),
      row({
        restaurant_name: "B",
        excel_orders: 5,
        app_orders: 3,
        status: "mismatch",
      }),
    ];
    const daily = rollupDaily(rows);
    const views = buildReconViews(rows);
    assert.equal(daily.length, 1);
    assert.equal(daily[0]?.excel_orders, 10);
    assert.equal(daily[0]?.app_orders, 10);
    assert.equal(daily[0]?.difference, 0);
    assert.equal(daily[0]?.status, "match");
    assert.equal(views.kpi.compared, 1);
    assert.equal(views.kpi.mismatches, 0);
  });

  it("does not combine two days into one period total", () => {
    const rows: OrderReconTableRow[] = [
      row({ work_date: "2026-09-01", excel_orders: 4, app_orders: 1, status: "mismatch" }),
      row({ work_date: "2026-09-02", excel_orders: 1, app_orders: 4, status: "mismatch" }),
    ];
    const daily = rollupDaily(rows);
    assert.equal(daily.length, 2);
    assert.equal(daily[0]?.difference, -3);
    assert.equal(daily[1]?.difference, 3);
    assert.equal(buildReconViews(rows).kpi.mismatches, 2);
  });

  it("hides excel 0 / app > 0 from daily and counts them as app_only kpi", () => {
    const rows = [row({ excel_orders: 0, app_orders: 2, status: "app_only" })];
    assert.equal(rollupDaily(rows).length, 0);
    assert.equal(buildReconViews(rows).kpi.app_only, 1);
    assert.equal(buildReconViews(rows).kpi.compared, 0);
  });

  it("does not put empty employee_id app-only rows on daily", () => {
    const rows: OrderReconTableRow[] = [
      row({
        id: "anon-a",
        employee_id: "",
        employee_name: "",
        restaurant_name: "X",
        excel_orders: 0,
        app_orders: 3,
        status: "app_only",
      }),
      row({
        id: "anon-b",
        employee_id: "",
        employee_name: "",
        restaurant_name: "Y",
        excel_orders: 0,
        app_orders: 5,
        status: "app_only",
      }),
    ];
    const daily = rollupDaily(rows);
    assert.equal(daily.length, 0);
    assert.equal(buildReconViews(rows).kpi.app_only, 2);
  });
});

describe("unusedAppRiders", () => {
  it("lists riders with excel orders and zero app logs, and drops them from daily", () => {
    const rows: OrderReconTableRow[] = [
      row({
        employee_id: "1401",
        employee_name: "Omar",
        work_date: "2026-09-01",
        restaurant_name: "A",
        excel_orders: 6,
        app_orders: 0,
        status: "mismatch",
      }),
      row({
        employee_id: "1401",
        employee_name: "Omar",
        work_date: "2026-09-02",
        restaurant_name: "A",
        excel_orders: 4,
        app_orders: 0,
        status: "mismatch",
      }),
      row({
        employee_id: "1304",
        excel_orders: 2,
        app_orders: 2,
        status: "match",
      }),
    ];
    const unused = unusedAppRiders(rows);
    const views = buildReconViews(rows);
    assert.equal(unused.length, 1);
    assert.equal(unused[0]?.employee_id, "1401");
    assert.equal(unused[0]?.excel_orders, 10);
    assert.equal(unused[0]?.days_with_excel, 2);
    assert.equal(unused[0]?.app_orders, 0);
    assert.equal(views.daily.every((r) => r.employee_id !== "1401"), true);
    assert.equal(views.store.every((r) => r.employee_id !== "1401"), true);
    assert.equal(views.kpi.not_using_app, 1);
    assert.equal(views.kpi.compared, 1);
    assert.equal(views.kpi.mismatches, 0);
  });

  it("does not treat unresolved identity rows as not using the app", () => {
    const rows: OrderReconTableRow[] = [
      row({
        employee_id: "99999",
        employee_name: "Ghost",
        restaurant_name: "No Such Place",
        excel_orders: 8,
        app_orders: 0,
        status: "unresolved",
      }),
    ];
    assert.equal(unusedAppRiders(rows).length, 0);
    assert.equal(unresolvedRows(rows).length, 1);
    assert.equal(unresolvedRows(rows)[0]?.employee_id, "99999");
    assert.equal(rollupDaily(rows).length, 0);
    assert.equal(buildReconViews(rows).kpi.unresolved, 1);
    assert.equal(buildReconViews(rows).kpi.not_using_app, 0);
  });
});

describe("run employees and dailyForEmployee", () => {
  it("puts a resolved rider in app and an unknown id in blank, not unused", () => {
    const rows: OrderReconTableRow[] = [
      row({
        employee_id: "1304",
        employee_name: "Ada",
        excel_orders: 4,
        app_orders: 4,
        status: "match",
        driver_id: "drv-1",
      }),
      row({
        id: "u-1",
        employee_id: "99999",
        employee_name: "Ghost",
        restaurant_name: "No Such Place",
        excel_orders: 8,
        app_orders: 0,
        status: "unresolved",
      }),
    ];
    const employees = buildRunEmployees(rows);
    assert.equal(employees.in_app.length, 1);
    assert.equal(employees.in_app[0]?.employee_id, "1304");
    assert.equal(employees.blank.length, 1);
    assert.equal(employees.blank[0]?.employee_id, "99999");
    assert.equal(employees.blank[0]?.status, "unresolved");
    assert.equal(unusedAppRiders(rows).length, 0);
  });

  it("dailyForEmployee returns only that rider's dates", () => {
    const rows: OrderReconTableRow[] = [
      row({ employee_id: "1304", work_date: "2026-09-01", excel_orders: 4, app_orders: 1, status: "mismatch" }),
      row({ employee_id: "1304", work_date: "2026-09-02", excel_orders: 1, app_orders: 4, status: "mismatch" }),
      row({ employee_id: "1401", work_date: "2026-09-01", excel_orders: 9, app_orders: 9, status: "match" }),
    ];
    const daily = dailyForEmployee(rows, "1304");
    assert.equal(daily.length, 2);
    assert.equal(daily.every((r) => r.rider_key === "1304"), true);
    assert.equal(daily[0]?.difference, -3);
    assert.equal(daily[1]?.difference, 3);
  });

  it("run progress card is one upload, not employees", () => {
    const run: OrderReconRunSummary = {
      id: "run-1",
      file_name: "Adjusted.xlsx",
      from_date: "2026-09-01",
      to_date: "2026-09-18",
      created_at: "2026-09-22T00:00:00Z",
      status: "applied",
      undo_seq: null,
      redoable: true,
      kpi: {
        compared: 10,
        mismatches: 2,
        unresolved: 1,
        app_only: 5,
        not_using_app: 3,
        matched_days: 8,
        sheet_days: 13,
      },
    };
    const progress = buildRunProgress(run);
    assert.equal(progress.id, "run-1");
    assert.equal(progress.file_name, "Adjusted.xlsx");
    assert.equal(progress.matched_days, 8);
    assert.equal(progress.sheet_days, 13);
    assert.equal(progress.pct, 62);
    assert.equal(progress.unused, 3);
  });
});

describe("dailyPreservesComparedTotals", () => {
  it("daily + unused excel/app equal the stored compared grain", () => {
    const rows: OrderReconTableRow[] = [
      row({ restaurant_name: "A", excel_orders: 5, app_orders: 7, status: "mismatch" }),
      row({ restaurant_name: "B", excel_orders: 5, app_orders: 3, status: "mismatch" }),
      row({
        employee_id: "1401",
        restaurant_name: "C",
        excel_orders: 9,
        app_orders: 0,
        status: "mismatch",
      }),
      row({
        id: "u-1",
        employee_id: "x",
        status: "unresolved" as ReconRowStatus,
        excel_orders: 3,
        app_orders: 0,
      }),
    ];
    assert.equal(dailyPreservesComparedTotals(rows), true);
  });
});
