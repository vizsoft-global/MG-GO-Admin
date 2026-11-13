import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PAYROLL_COLUMN_LABELS,
  PAYROLL_STATUS_LABELS,
  payrollColumnLabel,
  payrollStatusDisplayLabel,
  payrollStatusDisplayLabelOfKey,
} from "./payroll-column-labels";
import { hrSalaryShortfall } from "./hr-payroll-formulas";
import { kpiSelected, nextKpiSelection, riderMatchesKpi, type PayrollKpiRow } from "./payroll-kpi-selection";
import { rangeBoundsLabel } from "./payroll-column-filter";
import { PAYROLL_SUMMARY_COLUMNS, COMBINED_IDENTITY_COLUMNS, AO_LEAD_COLUMNS, APP_ATTENDANCE_LEAD_COLUMNS } from "./payroll-rider-columns";
import { HR_COLUMNS } from "./hr-payroll-columns";
import { identityRank } from "./payroll-table-identity";

const KPI_ROW: PayrollKpiRow = {
  status: "Active",
  // Percent, not fraction: the card counts `efficiency >= 100`.
  efficiency: 104,
  unjustified: 0,
  days: ["work", "reduced3"],
  adjusted: false,
};

describe("payroll column labels", () => {
  it("prints one wording for the shared fields", () => {
    assert.equal(payrollColumnLabel("amId", "MG ID"), PAYROLL_COLUMN_LABELS.amId);
    assert.equal(payrollColumnLabel("amId", "MG ID"), "MG ID");
    // Client ID on both sheets: the client read Driver ID and Client ID as one field.
    assert.equal(payrollColumnLabel("mgId", "Driver ID"), "Client ID");
    assert.equal(payrollColumnLabel("mgId", "Client ID"), "Client ID");
    assert.equal(payrollColumnLabel("mg", "MG ID"), "MG ID");
    assert.equal(payrollColumnLabel("client", "Client"), "Client ID");
    assert.equal(payrollColumnLabel("name", "Name"), "Employee Name");
    assert.equal(payrollColumnLabel("serial", ""), "#");
    // An unowned column keeps the caller's translated text.
    assert.equal(payrollColumnLabel("restaurant", "Restaurant"), "Restaurant");
  });

  it("owns the wording the HR sheet shares with the Payroll tabs", () => {
    // The same catalog row was "Client" on one sheet and "Client Name" on the other.
    assert.equal(payrollColumnLabel("partner", "Client Name"), "Client");
    assert.equal(payrollColumnLabel("clientName", "Client"), "Client");
    // A restaurant's client id and the person's client id are one column name.
    assert.equal(payrollColumnLabel("restaurantId", "Client ID"), "Client ID");
    // Catalog casing and the two-word total were the other two disagreements.
    assert.equal(payrollColumnLabel("vtype", "Vehicle type"), "Vehicle Type");
    assert.equal(payrollColumnLabel("total", "Total"), "Total Salary");
  });

  it("prints the HR sheet's identity headers exactly as the Payroll tabs do", () => {
    // This is the resolution the HR tab performs: the canonical map first, the
    // HR catalogue's own word as the fallback.
    const resolveHr = (key: string, fallback: string) => payrollColumnLabel(key, fallback);
    assert.deepEqual(
      HR_COLUMNS.slice(0, 4).map((column) => resolveHr(column.key, column.header)),
      ["#", "MG ID", "Client ID", "Employee Name"],
    );
    // The two labels that used to disagree with Payroll.
    assert.equal(
      resolveHr("status", HR_COLUMNS.find((column) => column.key === "status")?.header ?? ""),
      "Status",
    );
    assert.equal(
      resolveHr("vtype", HR_COLUMNS.find((column) => column.key === "vtype")?.header ?? ""),
      "Vehicle Type",
    );
  });

  it("reads Running, not Active, for a working rider", () => {
    assert.equal(PAYROLL_STATUS_LABELS.active, "Running");
    assert.equal(payrollStatusDisplayLabel("Active"), "Running");
    assert.equal(payrollStatusDisplayLabel("active"), "Running");
    assert.equal(payrollStatusDisplayLabel("Running"), "Running");
    // Only the `active` word is renamed.
    assert.equal(payrollStatusDisplayLabel("Active Payroll"), "Active Payroll");
    assert.equal(payrollStatusDisplayLabel("Leave Return"), "Leave Return");
    assert.equal(payrollStatusDisplayLabel(""), "");
    assert.equal(payrollStatusDisplayLabelOfKey("active"), "Running");
    assert.equal(payrollStatusDisplayLabelOfKey("cancelled"), "Cancelled");
  });
});

describe("payroll sheet order", () => {
  it("leads every rider catalogue with MG ID then Client ID then Employee Name", () => {
    for (const columns of [
      PAYROLL_SUMMARY_COLUMNS,
      COMBINED_IDENTITY_COLUMNS,
      AO_LEAD_COLUMNS,
      APP_ATTENDANCE_LEAD_COLUMNS,
    ]) {
      assert.deepEqual(
        columns.slice(0, 3).map((column) => column.id),
        ["amId", "mgId", "name"],
      );
      assert.deepEqual(
        columns.slice(0, 3).map((column) => payrollColumnLabel(column.id, "")),
        ["MG ID", "Client ID", "Employee Name"],
      );
    }
  });

  it("leads the HR sheet with #, MG ID, Client ID, Employee Name", () => {
    assert.deepEqual(
      HR_COLUMNS.slice(0, 4).map((column) => column.key),
      ["i", "mg", "client", "name"],
    );
    for (const column of HR_COLUMNS.slice(0, 4)) {
      assert.ok(identityRank(column.key) >= 0, `${column.key} should be an identity column`);
    }
  });
});

describe("numeric range filter", () => {
  it("prints the bounds a range is applying", () => {
    assert.equal(rangeBoundsLabel({ kind: "range", min: 10, max: 20 }), "10 – 20");
    assert.equal(rangeBoundsLabel({ kind: "range", min: 10, max: null }), "10 – …");
    assert.equal(rangeBoundsLabel({ kind: "range", min: null, max: 20 }), "… – 20");
    assert.equal(rangeBoundsLabel({ kind: "range", min: null, max: null }), null);
    assert.equal(rangeBoundsLabel({ kind: "text", text: "abc" }), null);
  });
});

describe("salary below work permit", () => {
  it("flags only a real shortfall", () => {
    assert.equal(hrSalaryShortfall(180, 250), 70);
    assert.equal(hrSalaryShortfall(250, 250), null);
    assert.equal(hrSalaryShortfall(260, 250), null);
  });

  it("treats a missing or zero permit salary as not recorded", () => {
    assert.equal(hrSalaryShortfall(0, 0), null);
    assert.equal(hrSalaryShortfall(100, 0), null);
    assert.equal(hrSalaryShortfall(Number.NaN, 250), null);
  });
});

describe("KPI card to table filter", () => {
  it("toggles off when the active card is pressed again", () => {
    assert.equal(nextKpiSelection(null, "active"), "active");
    assert.equal(nextKpiSelection("active", "active"), null);
    assert.equal(nextKpiSelection("active", "unjustified"), "unjustified");
    assert.equal(kpiSelected("active", "active"), true);
    assert.equal(kpiSelected("active", "unjustified"), false);
  });

  it("matches the same figure the card prints", () => {
    assert.equal(riderMatchesKpi(KPI_ROW, null), true);
    assert.equal(riderMatchesKpi(KPI_ROW, "active"), true);
    assert.equal(riderMatchesKpi(KPI_ROW, "atOrAbove100"), true);
    assert.equal(riderMatchesKpi(KPI_ROW, "unjustified"), false);
    assert.equal(riderMatchesKpi(KPI_ROW, "reduced3Days"), true);
    assert.equal(riderMatchesKpi(KPI_ROW, "manualAdjustments"), false);
    assert.equal(riderMatchesKpi({ ...KPI_ROW, status: "Inactive" }, "active"), false);
    assert.equal(riderMatchesKpi({ ...KPI_ROW, efficiency: 99.8 }, "atOrAbove100"), false);
    assert.equal(riderMatchesKpi({ ...KPI_ROW, efficiency: 1 }, "atOrAbove100"), false);
    assert.equal(riderMatchesKpi({ ...KPI_ROW, unjustified: 2 }, "unjustified"), true);
    assert.equal(riderMatchesKpi({ ...KPI_ROW, adjusted: true }, "manualAdjustments"), true);
  });
});
