import { countryLabel } from "@/lib/geo/countries";
import { partnerLabel } from "@/features/performance/performance-ops-format";
import {
  applyCover,
  assertPayrollMonth,
  classifyRiderMonth,
  computePayrollKpis,
  computeRequestKpis,
  coverKindFor,
  emptyCover,
  isJustifyingStatus,
  kuwaitMonthBounds,
  mapLiveStatusToUi,
  requestOverlapsMonth,
  payrollMonths,
  payrollTileFor,
  requestCoversDate,
  restaurantLabel,
  reviewingDeptLabel,
  riderMatchesSlicers,
  workflowStats,
  type DayCoverFlags,
  type PayrollMonthMeta,
} from "./payroll-formulas";
import type {
  PayrollOptions,
  PayrollRequestRow,
  PayrollRiderRow,
  PayrollSlicers,
  PayrollSnapshot,
} from "./payroll-types";

export type RawPayrollDriver = {
  id: string;
  name: string;
  employeeId: string | null;
  driverCode: string | null;
  zoneId: string | null;
  zoneName: string | null;
  projectKey: string | null;
  nationality: string | null;
  sourceType: string | null;
  sourceCompany: string | null;
  status: string | null;
  vehicleKey: string | null;
  restaurantId: string | null;
  restaurantName: string | null;
};

export type RawPayrollRequest = {
  id: string;
  code: string;
  driverId: string;
  requestType: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  createdDate: string;
  leaveType: string | null;
  leaveSubtype: string | null;
  currentStepLabel: string | null;
  roleKey: string | null;
};

export function kuwaitYmdFromIso(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuwait" }).format(
    new Date(iso),
  );
}

function dateRangeForRequest(req: RawPayrollRequest, month: PayrollMonthMeta): string[] {
  const dates: string[] = [];
  for (let d = 1; d <= month.days; d += 1) {
    const date = `${month.key}-${String(d).padStart(2, "0")}`;
    if (
      requestCoversDate({
        startDate: req.startDate,
        endDate: req.endDate,
        createdDate: req.createdDate,
        date,
      })
    ) {
      dates.push(date);
    }
  }
  return dates;
}

function requestDay(req: RawPayrollRequest, month: PayrollMonthMeta): string {
  const covered = dateRangeForRequest(req, month);
  if (covered[0]) return covered[0];
  return req.startDate || req.createdDate;
}

export function buildPayrollOptions(roster: readonly RawPayrollDriver[]): PayrollOptions {
  const zones = new Map<string, string>();
  const restaurants = new Map<string, string>();
  const nationalities = new Set<string>();
  const sourceCompanies = new Set<string>();
  for (const r of roster) {
    if (r.zoneId && r.zoneName) zones.set(r.zoneId, r.zoneName);
    if (r.restaurantId && r.restaurantName && r.projectKey !== "keeta") {
      restaurants.set(r.restaurantId, r.restaurantName);
    }
    if (r.nationality) nationalities.add(r.nationality);
    if (r.sourceCompany) sourceCompanies.add(r.sourceCompany);
  }
  return {
    zones: [...zones.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    restaurants: [...restaurants.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    nationalities: [...nationalities].sort((a, b) => a.localeCompare(b)),
    sourceCompanies: [...sourceCompanies].sort((a, b) => a.localeCompare(b)),
  };
}

export function decoratePayrollSnapshot(snapshot: PayrollSnapshot): PayrollSnapshot {
  return {
    ...snapshot,
    riders: snapshot.riders.map((r) => ({
      ...r,
      nationality: r.nationalityCode ? countryLabel(r.nationalityCode) : r.nationality,
    })),
  };
}

export function assemblePayrollSnapshot(input: {
  today: string;
  monthKey: string;
  slicers: PayrollSlicers;
  roster: RawPayrollDriver[];
  checkIns: Array<{ driverId: string; date: string }>;
  requests: RawPayrollRequest[];
}): PayrollSnapshot {
  const months = payrollMonths(input.today);
  const month = assertPayrollMonth(input.monthKey, input.today);
  kuwaitMonthBounds(month.key);

  const options = buildPayrollOptions(input.roster);
  const filteredRoster = input.roster.filter((r) =>
    riderMatchesSlicers(
      {
        zoneId: r.zoneId,
        projectKey: r.projectKey,
        vehicleKey: r.vehicleKey,
        nationality: r.nationality,
        sourceType: r.sourceType,
        sourceCompany: r.sourceCompany,
        restaurantId: r.restaurantId,
      },
      input.slicers,
    ),
  );
  const rosterIds = new Set(filteredRoster.map((r) => r.id));

  const checkInByDriver = new Map<string, Set<string>>();
  for (const row of input.checkIns) {
    if (!rosterIds.has(row.driverId)) continue;
    const set = checkInByDriver.get(row.driverId) ?? new Set<string>();
    set.add(row.date);
    checkInByDriver.set(row.driverId, set);
  }

  const coversByDriver = new Map<string, Map<string, DayCoverFlags>>();
  const requestRows: PayrollRequestRow[] = [];

  for (const req of input.requests) {
    if (
      !requestOverlapsMonth(
        {
          startDate: req.startDate,
          endDate: req.endDate,
          createdDate: req.createdDate,
        },
        month.key,
      )
    ) {
      continue;
    }
    if (!rosterIds.has(req.driverId)) continue;
    const tile = payrollTileFor({
      requestType: req.requestType,
      leaveType: req.leaveType,
      leaveSubtype: req.leaveSubtype,
    });
    if (!tile) continue;
    const rider = filteredRoster.find((r) => r.id === req.driverId);
    if (!rider) continue;

    const kind = coverKindFor({
      requestType: req.requestType,
      leaveType: req.leaveType,
      leaveSubtype: req.leaveSubtype,
    });
    const approved = isJustifyingStatus(req.status);
    if (kind) {
      const perDate = coversByDriver.get(req.driverId) ?? new Map<string, DayCoverFlags>();
      for (const date of dateRangeForRequest(req, month)) {
        const flags = perDate.get(date) ?? emptyCover();
        applyCover(flags, kind, approved);
        perDate.set(date, flags);
      }
      coversByDriver.set(req.driverId, perDate);
    }

    requestRows.push({
      id: req.id,
      code: req.code,
      driverId: req.driverId,
      riderName: rider.name,
      riderCode: rider.driverCode ?? rider.employeeId ?? "—",
      tile,
      day: requestDay(req, month),
      zone: rider.zoneName ?? "—",
      partner: partnerLabel(rider.projectKey),
      reviewingDept: reviewingDeptLabel({
        stepName: req.currentStepLabel,
        roleKey: req.roleKey,
      }),
      liveStatus: req.status,
      uiStatus: mapLiveStatusToUi(req.status),
    });
  }

  const riders: PayrollRiderRow[] = filteredRoster
    .map((r) => {
      const classified = classifyRiderMonth({
        month,
        today: input.today,
        checkInDates: checkInByDriver.get(r.id) ?? new Set(),
        coversByDate: coversByDriver.get(r.id) ?? new Map(),
      });
      return {
        driverId: r.id,
        amId: r.employeeId?.trim() || "—",
        mgId: r.driverCode?.trim() || "—",
        name: r.name,
        restaurant: restaurantLabel({
          projectKey: r.projectKey,
          storeName: r.restaurantName,
        }),
        restaurantId: r.restaurantId,
        zone: r.zoneName ?? "—",
        zoneId: r.zoneId,
        partner: partnerLabel(r.projectKey),
        projectKey: r.projectKey,
        nationality: r.nationality ? countryLabel(r.nationality) : "—",
        nationalityCode: r.nationality,
        status: r.status === "active" ? "Active" : "Inactive",
        vehicleKey: r.vehicleKey,
        sourceType: r.sourceType,
        sourceCompany: r.sourceCompany,
        days: classified.days,
        workDays: classified.workDays,
        totalHours: classified.totalHours,
        offDays: classified.offDays,
        sickDays: classified.sickDays,
        accidentDays: classified.accidentDays,
        absentDays: classified.absentDays,
        fixedDays: classified.fixedDays,
        efficiency: classified.efficiency,
        unjustified: classified.unjustified,
      } satisfies PayrollRiderRow;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  requestRows.sort((a, b) => {
    const order = { pending: 0, under_review: 1, approved: 2, rejected: 3 };
    const d = order[a.uiStatus] - order[b.uiStatus];
    if (d !== 0) return d;
    return a.day.localeCompare(b.day);
  });

  return {
    today: input.today,
    month,
    months,
    options,
    riders,
    requests: requestRows,
    payrollKpis: computePayrollKpis(riders),
    requestKpis: computeRequestKpis(requestRows),
    workflow: workflowStats(requestRows, riders.length),
  };
}
