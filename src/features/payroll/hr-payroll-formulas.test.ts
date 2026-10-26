import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HR_COLUMNS, hrGroupSpans } from "./hr-payroll-columns";
import {
  buildHrPayrollRows,
  computeHrPayroll,
  filterHrRows,
  formatHrEfficiency,
  hrFooterTotals,
  hrKpis,
  summarizeHr,
} from "./hr-payroll-formulas";
import type { HrRateLine } from "./hr-rate";
import type { HrBundle } from "./hr-payroll-types";
import type { PayrollRiderRow } from "./payroll-types";

function rider(partial: Partial<PayrollRiderRow> & { driverId: string }): PayrollRiderRow {
  return {
    amId: "C-1",
    mgId: "10001",
    name: "Ada",
    restaurant: "KFC",
    restaurantId: null,
    zone: "Hawally",
    zoneId: null,
    zoneCategory: "not_set",
    zoneEfficiency: null,
    zoneDpd: null,
    zoneOrders: null,
    partner: "",
    projectKey: "keeta",
    nationality: "IN",
    nationalityCode: "IN",
    status: "Active",
    vehicleKey: null,
    sourceType: null,
    sourceCompany: "MG",
    days: [],
    dayInfo: [],
    workDays: 14,
    totalHours: 168,
    offDays: 2,
    sickDays: 0,
    accidentDays: 0,
    absentDays: 0,
    reducedDays: 0,
    halfDays: 0,
    actualDays: 14,
    vehicleDays: 0,
    absLhDays: 0,
    absLoDays: 0,
    customDays: 0,
    finalOrders: 140,
    adjustedCells: 0,
    fixedDays: 28,
    offStructureDays: 2,
    offStructureContracted: 2,
    offStructureSource: "manual",
    offStructureHours: 24,
    requiredHoursPerDay: 12,
    requiredHours: 336,
    actualHours: 160,
    efficiency: 1,
    unjustified: 0,
    ...partial,
  } as PayrollRiderRow;
}

function bundle(opsApproved: boolean, extra: Partial<HrBundle["rows"][number]> = {}): HrBundle {
  return {
    month: "2026-10",
    opsApproved,
    rows: [
      {
        driverId: "d1",
        employeeId: "10001",
        driverCode: "10001",
        fullName: "Ada",
        civilId: "290010101010",
        clientId: "C-1",
        clientName: "",
        projectKey: "keeta",
        nationality: "India",
        nationalityCategory: "Asian",
        statusKey: "running",
        statusLabel: "Running",
        section: "Ops",
        sponsor: "MG",
        company: "MG",
        position: "Rider",
        hiringType: "full_time",
        workStart: "2024-01-01",
        jobEnd: "",
        jobEndDescription: "",
        fixedSalary: 336,
        workPermitSalary: 26,
        bankNumber: "123456",
        bankName: "NBK",
        currency: "KWD",
        twoYear: 20,
        fourYear: 0,
        food: 15,
        sick: 2,
        pending: 1,
        traffic: 0.5,
        loan: 0.25,
        allowances: 3,
        deductions: 1,
        incentives: 10,
        ...extra,
      },
    ],
  };
}

describe("computeHrPayroll", () => {
  it("follows the sheet formulas and formats efficiency as a percent", () => {
    const result = computeHrPayroll({
      approved: true,
      monthDays: 30,
      offs: 2,
      requiredHoursPerDay: 12,
      orders: 140,
      workingDays: 14,
      actualHours: 160,
      restaurantDpd: 10,
      fixedSalary: 336,
      workPermitSalary: 26,
      twoYear: 20,
      fourYear: 40,
      food: 15,
      sick: 2,
      incentives: 10,
      pending: 1,
      traffic: 0.5,
      loan: 0.25,
      allowances: 3,
      deductions: 1,
    });
    assert.equal(result.fWorkingDays, 28);
    assert.equal(result.fWorkingHours, 336);
    assert.equal(result.hourlyRate, 1);
    assert.equal(result.riderDpd, 10);
    assert.equal(result.efficiency, 1);
    assert.equal(formatHrEfficiency(result.efficiency), "100.0%");
    assert.equal(result.salaryAsPerHours, 160);
    assert.equal(result.twoYearAmount, 10);
    assert.equal(result.fourYearAmount, 20);
    assert.equal(result.sickReimbursement, 2);
    const total = 160 + 10 + 20 + 10 + 15 + 2 + 1 + 3 - 0.5 - 0.25 - 1;
    assert.equal(result.totalSalary, total);
    assert.equal(result.payment, total);
  });

  it("returns zero instead of NaN when a denominator is zero", () => {
    const result = computeHrPayroll({
      approved: true,
      monthDays: 2,
      offs: 2,
      requiredHoursPerDay: 12,
      orders: 5,
      workingDays: 0,
      actualHours: 8,
      restaurantDpd: 0,
      fixedSalary: 100,
      workPermitSalary: 0,
      twoYear: 20,
      fourYear: 20,
      food: 0,
      sick: 0,
      incentives: 4,
      pending: 0,
      traffic: 0,
      loan: 0,
      allowances: 0,
      deductions: 0,
    });
    assert.equal(result.hourlyRate, 0);
    assert.equal(result.riderDpd, 0);
    assert.equal(result.efficiency, 0);
    assert.equal(result.twoYearAmount, 0);
    assert.equal(result.sickReimbursement, 0);
    assert.equal(Number.isNaN(result.totalSalary), false);
  });

  it("holds operations pay until approval and still pays sick reimbursement", () => {
    const result = computeHrPayroll({
      approved: false,
      monthDays: 30,
      offs: 2,
      requiredHoursPerDay: 12,
      orders: 10,
      workingDays: 5,
      actualHours: 40,
      restaurantDpd: 8,
      fixedSalary: 300,
      workPermitSalary: 26,
      twoYear: 20,
      fourYear: 0,
      food: 15,
      sick: 1,
      incentives: 9,
      pending: 2,
      traffic: 0,
      loan: 0,
      allowances: 0,
      deductions: 0,
    });
    assert.equal(result.hourlyRate, 0);
    assert.equal(result.salaryAsPerHours, 0);
    assert.equal(result.incentivesPaid, 0);
    assert.equal(result.twoYearAmount, 0);
    assert.equal(result.sickReimbursement, 1);
    assert.equal(result.payment, 15 + 1 + 2);
  });
});

describe("buildHrPayrollRows", () => {
  it("shows the payroll tab counts before approval and still dashes the pay cells", () => {
    const rows = buildHrPayrollRows({
      riders: [rider({ driverId: "d1", restaurantClientId: "STORE-9" })],
      bundle: bundle(false),
      monthDays: 30,
    });
    assert.equal(rows[0]?.cells.offs, "2");
    assert.equal(rows[0]?.cells.orders, "140");
    assert.equal(rows[0]?.cells.wd, "14");
    assert.equal(rows[0]?.cells.ah, "160.00");
    assert.equal(rows[0]?.cells.client, "STORE-9");
    assert.equal(rows[0]?.cells.mg, "C-1");
    assert.equal(rows[0]?.identityEdit.clientId, "STORE-9");
    assert.equal(rows[0]?.cells.hourly, "—");
    assert.equal(rows[0]?.cells.incent, "—");
    assert.equal(rows[0]?.cells.sickR, "2.000");
    assert.equal(rows[0]?.cells.fixed, "336.000");
    assert.equal(rows[0]?.cells.nationality, "India");
    assert.equal(rows[0]?.cells.natCat, "Asian");
    assert.equal(rows[0]?.active, true);
  });

  it("searches client id and counts only the inactive statuses out of the active kpi", () => {
    const rows = buildHrPayrollRows({
      riders: [rider({ driverId: "d1", name: "Ada" }), rider({ driverId: "d2", name: "Bea", mgId: "10002", amId: "C-2" })],
      bundle: {
        ...bundle(true),
        rows: [
          { ...bundle(true).rows[0]!, statusKey: "cancelled" },
          { ...bundle(true).rows[0]!, driverId: "d2", employeeId: "10002", clientId: "C-2", fullName: "Bea", statusKey: "" },
        ],
      },
      monthDays: 30,
    });
    const found = filterHrRows(rows, { search: "c-2", statusKey: "", filters: [] });
    assert.deepEqual(found.map((row) => row.driverId), ["d2"]);
    const kpis = hrKpis(rows);
    assert.equal(kpis.riders, 2);
    assert.equal(kpis.active, 1);
    assert.equal(hrFooterTotals(rows).food, 30);
  });

  it("splits the employee band the way the sheet does", () => {
    const spans = hrGroupSpans(HR_COLUMNS);
    assert.equal(spans[0]?.group, "emp");
    assert.equal(spans[0]?.count, 4);
    assert.equal(spans[1]?.group, "emp");
    assert.equal(spans[2]?.group, "pay");
    assert.deepEqual(
      HR_COLUMNS.map((column) => column.key),
      [
        "i", "client", "mg", "name", "civil", "bankNo", "bank", "cur", "payment",
        "clientName", "zone", "rest", "nationality", "natCat", "status", "start",
        "endDate", "endDesc", "company", "sponsor", "position", "hiring", "section",
        "fixed", "wps", "rate", "vtype", "inc2", "inc4", "offs", "fwd", "fwh", "hourly", "orders",
        "wd", "ah", "restDpd", "riderDpd", "eff", "salH", "inc2v", "inc4v", "incent",
        "food", "sick", "sickR", "pending", "traffic", "loan", "allow", "ded", "total",
      ],
    );
    assert.equal(HR_COLUMNS[8]?.key, "payment");
    assert.equal(HR_COLUMNS[23]?.key, "fixed");
    assert.equal(HR_COLUMNS[27]?.key, "inc2");
    assert.equal(HR_COLUMNS[27]?.group, "in");
    assert.equal(HR_COLUMNS.find((column) => column.key === "rate")?.group, "cfg");
    assert.equal(HR_COLUMNS.find((column) => column.key === "vtype")?.group, "cfg");
  });

  it("joins both matching rates and multiplies approved orders by their sum", () => {
    const rates: HrRateLine[] = [
      { id: "r1", vehicle: "Bike", project: "keeta", zones: ["Hawally"], rate: 0.25 },
      { id: "r2", vehicle: "Bike", project: "Keeta", zones: ["Hawally"], rate: 0.5 },
    ];
    const rows = buildHrPayrollRows({
      riders: [rider({ driverId: "d1" })],
      bundle: bundle(true),
      monthDays: 30,
      rates,
    });
    assert.equal(rows[0]?.cells.rate, `${(0.25).toFixed(3)} · ${(0.5).toFixed(3)}`);
    assert.equal(rows[0]?.numbers.revenue, 140 * (0.25 + 0.5));
  });

  it("prints the missing rate when no config matches the rider", () => {
    const rates: HrRateLine[] = [
      { id: "other-zone", vehicle: "Bike", project: "keeta", zones: ["Salmiya"], rate: 0.4 },
    ];
    const rows = buildHrPayrollRows({
      riders: [rider({ driverId: "d1" })],
      bundle: bundle(true),
      monthDays: 30,
      rates,
      noRateLabel: "No rate",
    });
    assert.equal(rows[0]?.cells.rate, "No rate");
    assert.equal(rows[0]?.cells.vtype, "—");
    assert.equal(rows[0]?.numbers.revenue, 0);
  });

  it("ignores a bike-only rate when the vehicle is a car or van", () => {
    const rates: HrRateLine[] = [
      { id: "bike-only", vehicle: "Bike", project: "keeta", zones: ["Hawally"], rate: 0.3 },
    ];
    const rows = buildHrPayrollRows({
      riders: [rider({ driverId: "d1", vehicleKey: "van" })],
      bundle: bundle(true),
      monthDays: 30,
      rates,
      noRateLabel: "No rate",
    });
    assert.equal(rows[0]?.cells.rate, "No rate");
    assert.equal(rows[0]?.cells.vtype, "—");
  });

  it("summarises approved incentives separately from allowances", () => {
    const rows = buildHrPayrollRows({
      riders: [rider({ driverId: "d1" })],
      bundle: bundle(true),
      monthDays: 30,
    });
    const [line] = summarizeHr(rows, "company");
    assert.equal(line?.label, "MG");
    assert.equal(line?.incentives, 10);
    assert.equal(line?.totalAllowances, 3);
    assert.equal(line?.riders, 1);
  });
});
