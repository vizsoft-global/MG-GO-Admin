import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMBINED_COLUMNS,
  COMBINED_COLUMN_ORDER,
  COMBINED_DAYS_COLUMN_ID,
  COMBINED_IDENTITY_TRIPLE,
  COMBINED_NUMERIC_IDS,
  combinedColumn,
  combinedColumnListLabel,
  combinedDayCellText,
  combinedFilterText,
  combinedRowValues,
  formatCombinedValue,
  normalizeCombinedColumns,
} from "./combined-columns";
import { matchesColumnFilter } from "./payroll-column-filter";
import type { DayStatus } from "./payroll-formulas";
import type { PayrollRiderRow } from "./payroll-types";

const DATES = Array.from(
  { length: 6 },
  (_, index) => `2026-10-${String(index + 1).padStart(2, "0")}`,
);

function riderRow(input: {
  days: readonly DayStatus[];
  projectKey?: string | null;
  actualHours?: number;
  requiredHours?: number;
}): PayrollRiderRow {
  return {
    driverId: "d1",
    amId: "108899",
    mgId: "10001",
    name: "Test Rider",
    restaurant: "KFC FAHAHEEL",
    restaurantId: "r1",
    zone: "Fahaheel",
    zoneId: "z1",
    zoneCategory: "good",
    partner: "Americana",
    projectKey: input.projectKey ?? "americana",
    vehicleKey: "bike",
    status: "Active",
    days: [...input.days],
    dayInfo: DATES.map((date) => ({
      date,
      orders: 0,
      loggedHours: 0,
      source: "app",
      ruleLabel: null,
      adjusted: false,
      adjustmentStatus: null,
      adjustmentHours: null,
      adjustmentReason: null,
      creditedHours: 12,
      autoStatus: "work",
      autoHours: 12,
      autoRuleIndex: null,
      autoRuleLabel: null,
      autoSource: "app",
    })),
    workDays: 5,
    totalHours: 60,
    finalOrders: 40,
    reducedDays: 0,
    halfDays: 0,
    actualDays: 0,
    offDays: 0,
    sickDays: 0,
    accidentDays: 0,
    vehicleDays: 0,
    absentDays: 1,
    absLhDays: 0,
    absLoDays: 0,
    customDays: 0,
    adjustedCells: 0,
    actualHours: input.actualHours ?? 48,
    requiredHours: input.requiredHours ?? 120,
  } as unknown as PayrollRiderRow;
}

describe("Combined column catalogue", () => {
  it("puts the day block straight after Status, as the SOP sheet does", () => {
    assert.deepEqual(COMBINED_COLUMN_ORDER.slice(0, 7), [
      "rest",
      "zone",
      "zcat",
      "proj",
      "veh",
      "status",
      COMBINED_DAYS_COLUMN_ID,
    ]);
  });

  it("orders the summary columns Required Hours → Actual Hours → Efficiency", () => {
    const index = (id: string) => COMBINED_COLUMN_ORDER.indexOf(id);
    assert.ok(index("ord") < index("req"));
    assert.ok(index("req") < index("act"));
    assert.ok(index("act") < index("eff"));
    assert.equal(COMBINED_COLUMN_ORDER.at(-1), "lo");
  });

  it("exposes one id per summary column and keeps the day block as a single id", () => {
    const ids = COMBINED_COLUMNS.map((column) => column.id);
    assert.equal(ids.length, COMBINED_COLUMN_ORDER.length - 1);
    assert.ok(ids.includes("req"));
    assert.ok(ids.includes("eff"));
    assert.ok(!ids.includes(COMBINED_DAYS_COLUMN_ID));
    assert.equal(combinedColumn(COMBINED_DAYS_COLUMN_ID), undefined);
  });

  it("counts the day block in the menu total, so the Columns counter cannot read 23/22", () => {
    assert.equal(COMBINED_COLUMN_ORDER.length, COMBINED_COLUMNS.length + 1);
    assert.ok(COMBINED_COLUMN_ORDER.includes(COMBINED_DAYS_COLUMN_ID));
    // Every id the menu lists must be labelable; `days` has no catalogue row.
    assert.equal(combinedColumn(COMBINED_DAYS_COLUMN_ID), undefined);
  });

  it("keeps the pinned trio out of the catalogue", () => {
    const ids = COMBINED_COLUMNS.map((column) => column.id);
    for (const id of COMBINED_IDENTITY_TRIPLE) assert.ok(!ids.includes(id), id);
    assert.deepEqual([...COMBINED_IDENTITY_TRIPLE], ["amId", "mgId", "name"]);
  });

  it("treats Required Hours, Actual Hours and Efficiency as numbers", () => {
    for (const id of ["req", "act", "eff"]) assert.ok(COMBINED_NUMERIC_IDS.has(id), id);
    assert.ok(!COMBINED_NUMERIC_IDS.has("rest"));
  });
});

describe("normalizeCombinedColumns", () => {
  it("fills a missing id in SOP position and drops an unknown one", () => {
    const { order, visible } = normalizeCombinedColumns(["eff", "gone", "rest"], ["eff", "gone"]);
    assert.equal(order[0], "eff");
    assert.equal(order[1], "rest");
    assert.ok(!order.includes("gone"));
    assert.equal(order.length, COMBINED_COLUMN_ORDER.length);
    assert.ok(visible.has("eff"));
    assert.ok(!visible.has("gone"));
    assert.ok(!visible.has(COMBINED_DAYS_COLUMN_ID));
  });

  it("shows everything when the saved preference hid every column", () => {
    const { visible } = normalizeCombinedColumns(undefined, []);
    assert.equal(visible.size, COMBINED_COLUMN_ORDER.length);
  });

  it("keeps the saved order for the ids it knows", () => {
    const { order } = normalizeCombinedColumns(["lo", "lh", "ua"], ["lo"]);
    assert.deepEqual(order.slice(0, 3), ["lo", "lh", "ua"]);
  });
});


describe("Combined row values", () => {
  const ctx = { dates: DATES, today: "2026-10-05" };

  it("counts five Americana days as 60 required hours", () => {
    const row = riderRow({ days: ["work", "work", "work", "work", "work", "blank"] });
    assert.equal(combinedRowValues(row, ctx).req, 60);
  });

  it("counts Keeta at 10 hours a day", () => {
    const row = riderRow({
      days: ["work", "work", "work", "work", "work", "blank"],
      projectKey: "keeta",
    });
    assert.equal(combinedRowValues(row, ctx).req, 50);
  });

  it("divides Actual by Required for the Efficiency percentage", () => {
    const row = riderRow({
      days: ["work", "work", "work", "work", "work", "blank"],
      actualHours: 30,
    });
    assert.equal(combinedRowValues(row, ctx).eff, 50);
  });

  it("leaves a day after today out of Required Hours", () => {
    const row = riderRow({ days: ["work", "work", "work", "work", "work", "work"] });
    assert.equal(combinedRowValues(row, ctx).req, 60);
    assert.equal(combinedRowValues(row, { dates: DATES, today: "2026-10-06" }).req, 72);
  });

  it("carries the day cells so one funnel can filter a whole day", () => {
    const row = riderRow({ days: ["off", "work", "blank", "blank", "blank", "blank"] });
    const values = combinedRowValues(row, ctx);
    assert.equal(values.d1, "OFF");
    assert.equal(values.d3, "");
  });
});

describe("combinedDayCellText", () => {
  const ctx = { dates: DATES, today: "2026-10-02" };

  it("prints the credited hours at one decimal for a worked day", () => {
    const row = riderRow({ days: ["work", "blank", "blank", "blank", "blank", "blank"] });
    assert.equal(combinedDayCellText(row, 0, ctx), "12.0");
  });

  it("prints the status word for an OFF day", () => {
    const row = riderRow({ days: ["off", "blank", "blank", "blank", "blank", "blank"] });
    assert.equal(combinedDayCellText(row, 0, ctx), "OFF");
  });

  it("prints nothing for a blank day and an en dash after today", () => {
    const row = riderRow({ days: ["blank", "work", "work", "work", "work", "work"] });
    assert.equal(combinedDayCellText(row, 0, ctx), "");
    assert.equal(combinedDayCellText(row, 2, ctx), "–");
  });
});

describe("Combined cell printers", () => {
  it("prints Efficiency as a one-decimal percentage", () => {
    assert.equal(formatCombinedValue("eff", 100), "100.0%");
    assert.equal(formatCombinedValue("eff", 74.02), "74.0%");
  });

  it("prints Required and Actual Hours at their own precision", () => {
    assert.equal(formatCombinedValue("req", 60), "60.0");
    assert.equal(formatCombinedValue("act", 47.5), "47.50");
    assert.equal(formatCombinedValue("ord", 40), "40");
  });

  it("prints an em dash for a missing value", () => {
    assert.equal(formatCombinedValue("req", null), "—");
    assert.equal(formatCombinedValue("req", ""), "—");
  });

  it("labels the Efficiency funnel with the printed percentage", () => {
    const label = combinedColumnListLabel("eff");
    assert.ok(label);
    assert.equal(label("74"), "74.0%");
    assert.equal(combinedColumnListLabel("ord"), undefined);
  });

  it("matches Efficiency Text mode against the printed percentage (SOP §10)", () => {
    const text = (columnId: string, value: string | number | null) =>
      combinedFilterText(columnId, value);
    const value = 91.00000000000001;
    assert.equal(text("eff", value), "91.0%");
    // The example from the SOP: "9" finds 91.0% and 89.9%.
    assert.equal(matchesColumnFilter(value, { kind: "text", text: "9" }, true, text("eff", value)), true);
    assert.equal(
      matchesColumnFilter(89.9, { kind: "text", text: "9" }, true, text("eff", 89.9)),
      true,
    );
    assert.equal(
      matchesColumnFilter(value, { kind: "text", text: "91.0%" }, true, text("eff", value)),
      true,
    );
    // A raw-float match is no longer enough on its own.
    assert.equal(
      matchesColumnFilter(value, { kind: "text", text: "91.0000000000" }, true, text("eff", value)),
      false,
    );
    // Every other column still matches its stored text.
    assert.equal(text("ord", 40), "40");
  });
});

