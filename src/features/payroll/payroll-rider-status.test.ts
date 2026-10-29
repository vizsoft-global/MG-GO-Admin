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
import { payrollStatusChoiceFromLabel, statusFilterLabels } from "./payroll-status-options";
import type { PayrollRiderRow } from "./payroll-types";

/** Only the fields the status resolver reads; the rest of the row is unrelated. */
function riderRow(input: {
  dates?: readonly string[];
  days?: readonly DayStatus[];
  status?: "Active" | "Inactive";
  employeeStatusKey?: string | null;
  jobEndDescription?: string | null;
}): PayrollRiderRow {
  const dates = input.dates ?? ["2026-10-21", "2026-10-22"];
  return {
    driverId: "d1",
    status: input.status ?? "Active",
    employeeStatusKey: input.employeeStatusKey ?? null,
    jobEndDescription: input.jobEndDescription ?? null,
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
    assert.equal(status.status, "leave");
    assert.equal(status.label, "Leave");
    assert.equal(status.hex, PAYROLL_STATUS_CHIP.leave.hex);
    assert.equal(status.date, "2026-10-22");
  });

  it("folds a worked day into Active and an absence into Absent", () => {
    const work = riderRow({ dates: ["2026-10-22"], days: ["work"] });
    const worked = resolveRiderStatus(work, "2026-10-22");
    assert.equal(worked.status, "active");
    assert.equal(worked.label, "Active");
    assert.equal(worked.hex, null);
    const off = riderRow({ dates: ["2026-10-22"], days: ["off"] });
    assert.equal(resolveRiderStatus(off, "2026-10-22").label, "Active");
    const absent = riderRow({ dates: ["2026-10-22"], days: ["abs_lo"] });
    const folded = resolveRiderStatus(absent, "2026-10-22");
    assert.equal(folded.status, "absent");
    assert.equal(folded.label, "Absent");
  });

  it("lets a hand-set status replace today's cell", () => {
    const row = riderRow({ dates: ["2026-10-22"], days: ["work"] });
    row.statusOverride = { key: "active_payroll", label: "Active Payroll" };
    const status = resolveRiderStatus(row, "2026-10-22");
    assert.equal(status.kind, "manual");
    assert.equal(status.label, "Active Payroll");
    assert.equal(riderColumnValue(row, "status", "2026-10-22"), "Active Payroll");
  });

  it("lists the seven cores and a custom, and hides the retired day words", () => {
    const labels = statusFilterLabels(["Night desk"], ["Night desk"]);
    assert.deepEqual(labels.slice(0, 7), [
      "Active",
      "Absent",
      "Leave",
      "Active Payroll",
      "Accident",
      "Terminated",
      "Cancelled",
    ]);
    assert.equal(labels.includes("Night desk"), true);
    assert.equal(labels.includes("Work"), false);
    assert.equal(labels.includes("Sick"), false);
    assert.equal(labels.includes("Inactive"), false);
    assert.equal(statusFilterLabels([], ["Desk"]).at(-1), "Desk");
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

  it("lets the employee catalog win over today's folded cell", () => {
    const row = riderRow({
      dates: ["2026-10-22"],
      days: ["work"],
      employeeStatusKey: "leave_return",
    });
    const status = resolveRiderStatus(row, "2026-10-22");
    assert.equal(status.kind, "catalog");
    assert.equal(status.status, "leave_return");
    assert.equal(status.label, "Leave Return");
    assert.equal(status.hex, "#BFE4F8");
    assert.equal(status.paint.fill, "#BFE4F8");
  });

  it("prints Running with no fill even when today is a worked day", () => {
    const row = riderRow({
      dates: ["2026-10-22"],
      days: ["work"],
      employeeStatusKey: "running",
    });
    const status = resolveRiderStatus(row, "2026-10-22");
    assert.equal(status.label, "Running");
    assert.equal(status.hex, null);
    assert.equal(status.paint.fill, "transparent");
    assert.equal(status.paint.bordered, true);
  });

  it("paints Cancelled dark green only for End of Contract", () => {
    const green = resolveRiderStatus(
      riderRow({
        dates: ["2026-10-22"],
        days: ["work"],
        employeeStatusKey: "cancelled",
        jobEndDescription: "End of Contract",
      }),
      "2026-10-22",
    );
    assert.equal(green.hex, "#1E6B3A");
    const red = resolveRiderStatus(
      riderRow({
        dates: ["2026-10-22"],
        days: ["work"],
        employeeStatusKey: "cancelled",
        jobEndDescription: "resigned",
      }),
      "2026-10-22",
    );
    assert.equal(red.hex, "#D13B3B");
  });

  it("keeps overlapping day-legend hexes on the HR fills", () => {
    assert.equal(PAYROLL_STATUS_CHIP.accident.hex, "#FFE45C");
    assert.equal(PAYROLL_STATUS_CHIP.absent.hex, "#D13B3B");
    assert.equal(PAYROLL_STATUS_CHIP.cancelled.hex, "#D13B3B");
    assert.equal(PAYROLL_STATUS_CHIP.leave.hex, "#F28C28");
    assert.equal(PAYROLL_STATUS_CHIP.new_hire.hex, "#DCCDF6");
    assert.equal(PAYROLL_STATUS_CHIP.training.hex, "#FFD9B0");
    // SOP v1.0: Active is a plain white cell, not a grey dot; 3 Hours takes
    // leave-return blue and Half keeps the dark frame. All from PAYROLL_DAY_PAINT.
    assert.equal(PAYROLL_STATUS_CHIP.work.hex, "#FFFFFF");
    assert.equal(PAYROLL_STATUS_CHIP.work.border, null);
    assert.equal(PAYROLL_STATUS_CHIP.reduced3.hex, "#BFE4F8");
    assert.equal(PAYROLL_STATUS_CHIP.half.hex, "#FFFFFF");
    assert.equal(PAYROLL_STATUS_CHIP.half.border, "#292A3F");
    assert.equal(PAYROLL_STATUS_CHIP.off.hex, "#C9EEC4");
    assert.equal(PAYROLL_STATUS_CHIP.vehicle.hex, "#D13B3B");
    assert.equal(PAYROLL_STATUS_CHIP.id_suspended.hex, "#D13B3B");
    assert.equal(PAYROLL_STATUS_CHIP.phone_issue.hex, "#D13B3B");
    assert.equal(PAYROLL_STATUS_CHIP.terminated.hex, "#D13B3B");
  });

  it("lists catalog labels after the seven cores", () => {
    const labels = statusFilterLabels([]);
    assert.equal(labels[7], "Leave Return");
    assert.equal(labels.includes("Absent from MOSAL"), true);
    assert.equal(labels.includes("On Hold"), true);
    assert.equal(labels.includes("Transfer from Company"), true);
    assert.equal(labels.includes("Running"), true);
    assert.equal(labels.includes("Extension"), true);
    assert.deepEqual(payrollStatusChoiceFromLabel("New hire"), { key: "new", label: "New" });
    assert.deepEqual(payrollStatusChoiceFromLabel("Leave Return"), {
      key: "leave_return",
      label: "Leave Return",
    });
  });
});
