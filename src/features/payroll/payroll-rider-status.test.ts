import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kuwaitToday } from "@/features/performance/performance-formulas";
import {
  APP_ATTENDANCE_LEAD_COLUMNS,
  AO_LEAD_COLUMNS,
  COMBINED_IDENTITY_COLUMNS,
  PAYROLL_SUMMARY_COLUMNS,
  resolveRiderStatus,
  riderColumnValue,
  riderStatusHex,
  riderStatusLabel,
} from "./payroll-rider-columns";
import { PAYROLL_STATUS_CHIP, type DayStatus } from "./payroll-formulas";
import type { PayrollRiderRow } from "./payroll-types";

/** Only the fields the status resolver reads; the rest of the row is unrelated. */
function riderRow(input: {
  dates?: readonly string[];
  days?: readonly DayStatus[];
  status?: "Active" | "Inactive";
}): PayrollRiderRow {
  const dates = input.dates ?? ["2026-10-21", "2026-10-22"];
  return {
    driverId: "d1",
    status: input.status ?? "Active",
    days: input.days ?? dates.map(() => "blank" as DayStatus),
    dayInfo: dates.map((date) => ({ date })),
  } as unknown as PayrollRiderRow;
}

describe("rider status", () => {
  it("reads today's cell when the month contains today", () => {
    const row = riderRow({
      dates: ["2026-10-21", "2026-10-22", "2026-10-23"],
      days: ["work", "sick", "blank"],
    });
    const status = resolveRiderStatus(row, "2026-10-22");
    assert.equal(status.kind, "day");
    assert.equal(status.status, "sick");
    assert.equal(status.label, "Sick");
    assert.equal(status.hex, PAYROLL_STATUS_CHIP.sick.hex);
    assert.equal(status.date, "2026-10-22");
  });

  it("falls back to the account status when today's cell is blank", () => {
    const row = riderRow({ days: ["work", "blank"], status: "Inactive" });
    const status = resolveRiderStatus(row, "2026-10-22");
    assert.equal(status.kind, "account");
    assert.equal(status.status, "inactive");
    assert.equal(status.label, "Inactive");
    assert.equal(status.hex, null);
  });

  it("falls back to the account status for a past month with no today cell", () => {
    const row = riderRow({ dates: ["2026-09-01", "2026-09-02"], days: ["sick", "work"] });
    const status = resolveRiderStatus(row, "2026-10-22");
    assert.equal(status.kind, "account");
    assert.equal(status.label, "Active");
  });

  it("defaults to the Kuwait date, so the grid and an export that omits it agree", () => {
    const today = kuwaitToday();
    const row = riderRow({ dates: [today], days: ["accident"] });
    assert.equal(resolveRiderStatus(row).label, "Accident");
    assert.equal(riderColumnValue(row, "status", today), "Accident");
  });

  it("names the work and suspension days the way the column is read", () => {
    assert.equal(riderStatusLabel("work"), "Work");
    assert.equal(riderStatusLabel("id_suspended"), "ID Suspended");
    assert.equal(riderStatusLabel("off"), "OFF");
    assert.equal(riderStatusLabel("blank"), "");
    assert.equal(riderStatusHex("blank"), null);
    assert.equal(riderStatusHex("absent"), PAYROLL_STATUS_CHIP.absent.hex);
  });

  it("puts a non-numeric Status column on every payroll view", () => {
    for (const columns of [
      PAYROLL_SUMMARY_COLUMNS,
      COMBINED_IDENTITY_COLUMNS,
      AO_LEAD_COLUMNS,
      APP_ATTENDANCE_LEAD_COLUMNS,
    ]) {
      const status = columns.find((column) => column.id === "status");
      assert.ok(status, "status column missing");
      assert.equal(status.numeric, false);
      assert.equal(status.labelKey, "status");
    }
  });
});
