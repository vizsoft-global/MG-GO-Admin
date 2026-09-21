import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import {
  ASSISTANT_EXPORT_KINDS,
  ASSISTANT_TOOL_ALLOWLIST,
  ASSISTANT_V1_MAX_STEPS,
  ASSISTANT_V1_OUT_OF_SCOPE,
  isAssistantExportKind,
} from "./assistant-contract";
import { lastUserText, refuseCopy } from "./assistant-copy";
import {
  kuwaitDayCreatedAtBounds,
  kuwaitWeekStartSaturday,
  resolveAssistantDateRange,
  resolveAssistantLiveDate,
} from "./assistant-dates";
import { exportSpecFromUnknown } from "./assistant-export-spec";
import { assistantModuleAllowed } from "./assistant-gates";
import {
  assertNoOrderRows,
  looksArabic,
  refuseToolArgs,
  refuseUserText,
} from "./assistant-refuse";
import { summarizeIncentiveDaily } from "./assistant-wrappers";
import {
  buildDeliveryCountsWorkbook,
  DELIVERY_COUNTS_STATUS_HEADERS,
  deliveryCountsWorkbookHasOrderColumns,
} from "./delivery-counts-xlsx";
import type { IncentiveDailyReport } from "@/features/earnings/incentive-daily-report";

describe("assistant contract", () => {
  it("locks A–D tools and refuses Orders Report", () => {
    assert.deepEqual(
      ASSISTANT_TOOL_ALLOWLIST.map((tool) => tool.key),
      [
        "dpd_efficiency",
        "deliveries_counts",
        "incentive_daily",
        "performance_bands",
        "performance_live",
      ],
    );
    assert.ok(ASSISTANT_V1_OUT_OF_SCOPE.includes("report_delivery_orders"));
    assert.ok(ASSISTANT_V1_OUT_OF_SCOPE.includes("writes"));
    assert.equal(ASSISTANT_V1_MAX_STEPS, 8);
    assert.ok(!isAssistantExportKind("report_delivery_orders"));
    assert.deepEqual([...ASSISTANT_EXPORT_KINDS], ASSISTANT_TOOL_ALLOWLIST.map((t) => t.key));
  });
});

describe("assistant dates", () => {
  it("resolves Kuwait presets with Saturday week start", () => {
    const today = "2026-09-21";
    assert.equal(kuwaitWeekStartSaturday(today), "2026-09-19");
    assert.deepEqual(resolveAssistantDateRange({ preset: "today" }, today), {
      from: today,
      to: today,
    });
    assert.deepEqual(resolveAssistantDateRange({ preset: "yesterday" }, today), {
      from: "2026-09-20",
      to: "2026-09-20",
    });
    assert.deepEqual(resolveAssistantDateRange({ preset: "this_week" }, today), {
      from: "2026-09-19",
      to: today,
    });
    assert.deepEqual(resolveAssistantDateRange({ preset: "this_month" }, today), {
      from: "2026-09-01",
      to: today,
    });
    assert.deepEqual(kuwaitDayCreatedAtBounds("2026-09-21", "2026-09-21"), {
      dateFrom: "2026-09-21T00:00:00.000+03:00",
      dateTo: "2026-09-21T23:59:59.999+03:00",
    });
  });

  it("keeps explicit from/to and rejects inverted ranges", () => {
    assert.deepEqual(
      resolveAssistantDateRange({ from: "2026-09-01", to: "2026-09-10" }, "2026-09-21"),
      { from: "2026-09-01", to: "2026-09-10" },
    );
    assert.throws(
      () => resolveAssistantDateRange({ from: "2026-09-10", to: "2026-09-01" }, "2026-09-21"),
      /invalid_date_range/,
    );
  });

  it("lets a preset win over invented from/to", () => {
    const today = "2026-09-21";
    assert.deepEqual(
      resolveAssistantDateRange(
        { preset: "this_week", from: "2023-10-01", to: "2023-10-07" },
        today,
      ),
      { from: "2026-09-19", to: today },
    );
    assert.deepEqual(
      resolveAssistantDateRange(
        { preset: "this_month", from: "2023-10-01", to: "2023-10-07" },
        today,
      ),
      { from: "2026-09-01", to: today },
    );
    assert.equal(resolveAssistantLiveDate("2023-10-06", today), today);
    assert.equal(resolveAssistantLiveDate("2026-09-20", today), "2026-09-20");
    assert.equal(resolveAssistantLiveDate(undefined, today), today);
  });
});

describe("assistant refuse", () => {
  it("refuses Orders Report, SQL, and write-shaped tool args", () => {
    assert.equal(refuseToolArgs({ kind: "report_delivery_orders" }), "report_delivery_orders");
    assert.equal(refuseToolArgs({ sql: "select * from deliveries" }), "freeform_sql");
    assert.equal(refuseToolArgs({ note: "verify this delivery" }), "write_shaped");
    assert.equal(refuseUserText("Please generate the Orders Report"), "report_delivery_orders");
    assert.equal(refuseUserText("run sql select 1 from drivers"), "freeform_sql");
    assert.equal(looksArabic("مرحبا"), true);
    assert.equal(looksArabic("hello"), false);
  });

  it("counts payload never includes order rows", () => {
    assert.doesNotThrow(() =>
      assertNoOrderRows({ total: 3, verified: 2, pending: 1 }),
    );
    assert.throws(() => assertNoOrderRows({ rows: [{ id: "x" }] }), /order_rows_leaked/);
    assert.throws(() => assertNoOrderRows({ order_ids: ["1"] }), /order_ids_leaked/);
  });
});

describe("assistant permissions", () => {
  it("fails a tool without both assistant.view and the module view", () => {
    assert.equal(assistantModuleAllowed(new Set(), false, "deliveries.view"), false);
    assert.equal(
      assistantModuleAllowed(new Set(["assistant.view"]), false, "deliveries.view"),
      false,
    );
    assert.equal(
      assistantModuleAllowed(new Set(["deliveries.view"]), false, "deliveries.view"),
      false,
    );
    assert.equal(
      assistantModuleAllowed(
        new Set(["assistant.view", "deliveries.view"]),
        false,
        "deliveries.view",
      ),
      true,
    );
    assert.equal(assistantModuleAllowed(new Set(), true, "earnings.view"), true);
  });
});

describe("assistant B excel", () => {
  it("writes counts only — no order ids — and totals match chat", async () => {
    const counts = {
      total: 12,
      verified: 7,
      pending: 2,
      rejected: 1,
      cancelled: 1,
      in_transit: 1,
      under_review: 0,
      filters: {
        dateFrom: "2026-09-21T00:00:00.000+03:00",
        dateTo: "2026-09-21T23:59:59.999+03:00",
      },
    };
    const buffer = await buildDeliveryCountsWorkbook(counts, {
      from: "2026-09-21",
      to: "2026-09-21",
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet("Delivery counts");
    assert.ok(sheet);
    const headers: string[] = [];
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === "string") headers.push(cell.value);
      });
    });
    assert.equal(deliveryCountsWorkbookHasOrderColumns(headers), false);
    assert.deepEqual(
      [sheet.getRow(7).getCell(1).value, sheet.getRow(7).getCell(2).value],
      [...DELIVERY_COUNTS_STATUS_HEADERS],
    );
    const byStatus = new Map<string, number>();
    for (let r = 8; r <= 14; r += 1) {
      byStatus.set(String(sheet.getRow(r).getCell(1).value), Number(sheet.getRow(r).getCell(2).value));
    }
    assert.equal(byStatus.get("total"), counts.total);
    assert.equal(byStatus.get("verified"), counts.verified);
    assert.equal(byStatus.get("pending"), counts.pending);
    assert.equal(byStatus.get("rejected"), counts.rejected);
    assert.equal(byStatus.get("cancelled"), counts.cancelled);
    assert.equal(byStatus.get("in_transit"), counts.in_transit);
    assert.equal(byStatus.get("under_review"), counts.under_review);
  });
});

describe("assistant helpers", () => {
  it("summarises fleet incentive days without dumping every rider row", () => {
    const report: IncentiveDailyReport = {
      from: "2026-09-01",
      to: "2026-09-02",
      rows: [
        {
          id: "1",
          driver_id: "a",
          driver_name: "A",
          employee_id: "10001",
          driver_code: "10001",
          earn_date: "2026-09-01",
          restaurant_name: "R",
          zone_name: "Z",
          deliveries: 3,
          applied_rule: "rule-a",
          daily_amount_kwd: 1.5,
          period_total_kwd: 2,
        },
        {
          id: "2",
          driver_id: "b",
          driver_name: "B",
          employee_id: "10002",
          driver_code: "10002",
          earn_date: "2026-09-01",
          restaurant_name: "R",
          zone_name: "Z",
          deliveries: 2,
          applied_rule: "rule-a",
          daily_amount_kwd: 0.5,
          period_total_kwd: 0.5,
        },
      ],
    };
    const fleet = summarizeIncentiveDaily(report, false);
    assert.equal(fleet.total_kwd, 2);
    assert.equal(fleet.rider_day_rows, 2);
    assert.equal(fleet.daily.length, 1);
    assert.equal(fleet.daily[0]?.amount_kwd, 2);
    assert.ok(!("days" in fleet));
  });

  it("reads export metadata and last user text", () => {
    assert.deepEqual(
      exportSpecFromUnknown({
        export: { kind: "deliveries_counts", from: "2026-09-21", to: "2026-09-21", filters: {} },
      }),
      { kind: "deliveries_counts", from: "2026-09-21", to: "2026-09-21", filters: {} },
    );
    assert.equal(exportSpecFromUnknown({ kind: "report_delivery_orders" }), null);
    assert.equal(
      lastUserText([
        { role: "user", parts: [{ type: "text", text: "hello" }] },
        { role: "assistant", parts: [{ type: "text", text: "hi" }] },
      ]),
      "hello",
    );
    assert.match(refuseCopy("report_delivery_orders"), /Orders Report/);
  });
});
