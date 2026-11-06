import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dayColumnLabelKey,
  defaultView,
  hoursForRules,
  projectConfigOf,
  projectCounts,
  projectExportName,
  projectKpis,
  projectRowTotals,
  resolveProjectViews,
  ridersForProject,
  unassignedProjectCount,
  viewOfProjectKey,
} from "./payroll-projects";
import type { PayrollDayInfo, PayrollRiderRow } from "./payroll-types";

/**
 * The client's SOP splits Attendance & Orders by project. These cases pin the
 * three things that make the split real rather than cosmetic: which card a rider
 * lands on, which figure a day is priced on, and what the export is called.
 */

function info(patch: Partial<PayrollDayInfo>): PayrollDayInfo {
  return {
    date: "2026-11-01",
    orders: 0,
    loggedHours: 0,
    workingHours: null,
    workingHoursOverridden: false,
    source: "attendance",
    ruleLabel: null,
    adjusted: false,
    adjustmentStatus: null,
    adjustmentHours: null,
    adjustmentReason: null,
    creditedHours: 0,
    autoStatus: "blank",
    autoHours: 0,
    autoRuleIndex: null,
    autoRuleLabel: null,
    autoSource: "attendance",
    ...patch,
  };
}

function rider(patch: Partial<PayrollRiderRow>): PayrollRiderRow {
  return {
    driverId: "d1",
    amId: "1485",
    mgId: "1300",
    name: "ALI KHAN",
    restaurant: "KFC Jahra",
    restaurantId: null,
    zone: "Jahra",
    zoneId: "z1",
    zoneCategory: "good",
    zoneEfficiency: null,
    zoneDpd: null,
    zoneOrders: null,
    partner: "Americana",
    projectKey: "americana",
    nationality: "Indian",
    nationalityCode: "IN",
    status: "Active",
    vehicleKey: "bike",
    sourceType: "In-house",
    sourceCompany: "MG",
    days: [],
    dayInfo: [],
    workDays: 0,
    totalHours: 0,
    offDays: 0,
    sickDays: 0,
    accidentDays: 0,
    absentDays: 0,
    reducedDays: 0,
    halfDays: 0,
    actualDays: 0,
    vehicleDays: 0,
    absLhDays: 0,
    absLoDays: 0,
    customDays: 0,
    finalOrders: 0,
    adjustedCells: 0,
    fixedDays: 0,
    offStructureDays: 0,
    offStructureContracted: 0,
    offStructureSource: "default",
    offStructureHours: 0,
    requiredHoursPerDay: 12,
    requiredHours: 0,
    actualHours: 0,
    efficiency: 0,
    unjustified: 0,
    ...patch,
  };
}

describe("project cards", () => {
  it("maps a stored project key, including the Five Guys spellings", () => {
    assert.equal(viewOfProjectKey("americana"), "americana");
    assert.equal(viewOfProjectKey("Keeta"), "keeta");
    assert.equal(viewOfProjectKey("five_guys"), "five_guys");
    assert.equal(viewOfProjectKey("Five Guys"), "five_guys");
    // An unset project is its own state, never guessed into a card.
    assert.equal(viewOfProjectKey(""), null);
    assert.equal(viewOfProjectKey(null), null);
    assert.equal(viewOfProjectKey("other_partner"), null);
  });

  it("puts each rider on exactly one card", () => {
    const riders = [
      rider({ driverId: "a", projectKey: "americana" }),
      rider({ driverId: "k", projectKey: "keeta" }),
      rider({ driverId: "f", projectKey: "five_guys" }),
      rider({ driverId: "n", projectKey: null }),
    ];
    assert.deepEqual(projectCounts(riders), { americana: 1, keeta: 1, five_guys: 1 });
    assert.equal(unassignedProjectCount(riders), 1);
    assert.deepEqual(
      ridersForProject(riders, "keeta").map((row) => row.driverId),
      ["k"],
    );
    // A rider with no project is on no card at all.
    assert.equal(ridersForProject(riders, "americana").length, 1);
  });
});

describe("day shape per project", () => {
  it("keeps Americana on orders and gives Keeta / Five Guys hours", () => {
    assert.deepEqual(projectConfigOf("americana").dayColumns, ["payroll", "orders"]);
    assert.deepEqual(projectConfigOf("keeta").dayColumns, ["payroll", "workingHours"]);
    assert.deepEqual(projectConfigOf("five_guys").dayColumns, ["hours"]);
    // Five Guys has no day status, so the chips and the payroll pill are absent.
    assert.equal(projectConfigOf("five_guys").showDayStatus, false);
    assert.equal(projectConfigOf("keeta").showDayStatus, true);
    // Keeta riders work from the pool: no Restaurant column.
    assert.equal(projectConfigOf("keeta").showRestaurant, false);
    assert.equal(projectConfigOf("five_guys").showRestaurant, true);
  });

  it("labels each day column", () => {
    assert.equal(dayColumnLabelKey("payroll"), "ao.payrollShort");
    assert.equal(dayColumnLabelKey("orders"), "ao.ordersShort");
    assert.equal(dayColumnLabelKey("workingHours"), "ao.workingHoursShort");
    assert.equal(dayColumnLabelKey("hours"), "ao.hoursShort");
  });
});

describe("which hours a day is judged on", () => {
  it("prices Keeta and Five Guys on the uploaded figure only", () => {
    assert.equal(hoursForRules("keeta", 6, 9.5), 9.5);
    assert.equal(hoursForRules("five_guys", 6, 8), 8);
    // Nothing loaded: the app session is not a payable length for these projects.
    assert.equal(hoursForRules("keeta", 6, null), 0);
    // A real zero is a zero, not a fallback.
    assert.equal(hoursForRules("keeta", 6, 0), 0);
  });

  it("leaves Americana on the attendance clock", () => {
    assert.equal(hoursForRules("americana", 7.5, 9.5), 7.5);
    assert.equal(hoursForRules("americana", 7.5, null), 7.5);
  });
});

describe("row totals and the four cards", () => {
  it("counts an hours day as worked when hours were loaded", () => {
    const row = rider({
      driverId: "k",
      projectKey: "keeta",
      dayInfo: [
        info({ workingHours: 9, workingHoursOverridden: true }),
        info({ workingHours: 0, workingHoursOverridden: true }),
        info({ workingHours: null }),
      ],
    });
    const totals = projectRowTotals("keeta", row);
    assert.equal(totals.workedDays, 1);
    assert.equal(totals.totalHours, 9);
    // An hours project carries no order count at all.
    assert.equal(totals.totalOrders, 0);
  });

  it("keeps Americana reading the snapshot's own sums", () => {
    const row = rider({ workDays: 18, reducedDays: 3, actualHours: 231.5, finalOrders: 640 });
    const totals = projectRowTotals("americana", row);
    assert.equal(totals.workedDays, 21);
    assert.equal(totals.totalHours, 231.5);
    assert.equal(totals.totalOrders, 640);
  });

  it("averages over worked days, not over riders", () => {
    const riders = [
      rider({
        driverId: "k1",
        projectKey: "keeta",
        dayInfo: [info({ workingHours: 10 }), info({ workingHours: 8 })],
      }),
      rider({
        driverId: "k2",
        projectKey: "keeta",
        dayInfo: [info({ workingHours: 6 })],
      }),
    ];
    const kpis = projectKpis("keeta", riders);
    assert.equal(kpis.riders, 2);
    assert.equal(kpis.totalHours, 24);
    // 24 h over 3 worked days.
    assert.equal(kpis.avgPerWorkedDay, 8);
  });
});

describe("export name", () => {
  it("carries the project and the month", () => {
    assert.equal(projectExportName("americana", "2026-11"), "MGHub-Payroll-Americana-Nov-2026");
    assert.equal(projectExportName("keeta", "2026-11"), "MGHub-Payroll-Keeta-Nov-2026");
    assert.equal(projectExportName("five_guys", "2026-11"), "MGHub-Payroll-FiveGuys-Nov-2026");
  });

describe("catalog-driven cards", () => {
  const clients = [
    { key: "americana", name: "Americana", isActive: true, sortOrder: 10 },
    { key: "keeta", name: "Keeta", usesHours: true, isActive: true, sortOrder: 20 },
    { key: "five_guys", name: "Five Guys", usesHours: true, isActive: true, sortOrder: 30 },
    // A client added in Employee Settings: the Americana-style profile.
    { key: "al_musallam", name: "Al Musallam", usesHours: false, isActive: true, sortOrder: 40 },
  ];

  it("draws a card for every active client, in catalog order", () => {
    assert.deepEqual(
      resolveProjectViews(clients).map((client) => client.key),
      ["americana", "keeta", "five_guys", "al_musallam"],
    );
  });

  it("puts a new client's rider on its own card", () => {
    const riders = [
      rider({ driverId: "a", projectKey: "americana" }),
      rider({ driverId: "m", projectKey: "al_musallam" }),
      rider({ driverId: "n", projectKey: null }),
    ];
    assert.deepEqual(ridersForProject(riders, "al_musallam", clients).map((r) => r.driverId), [
      "m",
    ]);
    assert.equal(projectCounts(riders, clients).al_musallam, 1);
    assert.equal(unassignedProjectCount(riders, clients), 1);
  });

  it("counts a rider on a deactivated client as unassigned, not on a hidden card", () => {
    const withRetired = [
      ...clients,
      { key: "retired", name: "Retired", isActive: false, sortOrder: 50 },
    ];
    const riders = [rider({ driverId: "r", projectKey: "retired" })];
    assert.equal(viewOfProjectKey("retired", withRetired), null);
    assert.equal(unassignedProjectCount(riders, withRetired), 1);
    assert.ok(!resolveProjectViews(withRetired).some((client) => client.key === "retired"));
  });

  it("falls back to the three when the catalog is empty", () => {
    assert.deepEqual(
      resolveProjectViews([]).map((client) => client.key),
      ["americana", "keeta", "five_guys"],
    );
    assert.equal(defaultView([]), "americana");
    assert.equal(defaultView([{ key: "zeta", name: "Zeta" }]), "zeta");
  });

  it("prices a new client on orders unless the catalog says hours", () => {
    assert.equal(projectConfigOf("al_musallam", clients).usesUploadedHours, false);
    assert.deepEqual(projectConfigOf("al_musallam", clients).dayColumns, ["payroll", "orders"]);
    assert.equal(
      projectConfigOf("al_musallam", clients).label,
      "Al Musallam",
    );
  });

  it("names the export after the client and keeps it a valid file stem", () => {
    assert.equal(
      projectExportName("al_musallam", "2026-11", clients),
      "MGHub-Payroll-Al-Musallam-Nov-2026",
    );
    // The seeded names keep their approved spelling.
    assert.equal(projectExportName("five_guys", "2026-11", clients), "MGHub-Payroll-FiveGuys-Nov-2026");
  });
});

});
