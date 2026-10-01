import { countryLabel } from "@/lib/geo/countries";
import { partnerLabel } from "@/features/performance/performance-ops-format";
import {
  applyCover,
  assertPayrollMonth,
  computePayrollKpis,
  computeRequestKpis,
  coverKindFor,
  emptyCover,
  efficiencyPct,
  isJustifyingStatus,
  kuwaitMonthBounds,
  mapLiveStatusToUi,
  offStructureHoursFor,
  PAYROLL_DAY_HOURS,
  PAYROLL_DEFAULT_OFF_DAYS,
  requestOverlapsMonth,
  payrollMonths,
  payrollTileFor,
  requestCoversDate,
  requiredHoursFor,
  restaurantLabel,
  reviewingDeptLabel,
  riderMatchesSlicers,
  workflowStats,
  type DayCoverFlags,
  type DayStatus,
  type PayrollMonthMeta,
} from "./payroll-formulas";
import {
  evalDay,
  normaliseRuleKind,
  parseRuleResult,
  parseRules,
  rulesForClient,
  zoneCategoryFor,
  type AdjustmentStatus,
  type PayrollClientConfig,
  type PayrollRule,
  type ZoneCategory,
} from "./payroll-rules-engine";
import { categoryForZone } from "./payroll-zone-metrics";
import type {
  OffStructureSource,
  PayrollAdjustmentCell,
  PayrollDayInfo,
  PayrollOptions,
  PayrollRequestRow,
  PayrollRiderRow,
  PayrollSlicers,
  PayrollSnapshot,
  PayrollZoneMetricRow,
} from "./payroll-types";

export type RawPayrollDriver = {
  id: string;
  name: string;
  employeeId: string | null;
  driverCode: string | null;
  zoneId: string | null;
  zoneName: string | null;
  /** Zone of the first restaurant the rider serves, used for Americana. */
  restaurantZoneId?: string | null;
  projectKey: string | null;
  nationality: string | null;
  sourceType: string | null;
  sourceCompany: string | null;
  status: string | null;
  vehicleKey: string | null;
  restaurantId: string | null;
  restaurantName: string | null;
};

export type RawPayrollCheckIn = {
  driverId: string;
  date: string;
  hours?: number;
};

export type RawOffStructure = {
  driverId: string;
  offDays: number;
  source: Exclude<OffStructureSource, "default">;
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

/** Daily final adjusted orders (Order Reconciliation) keyed on the MG ID. */
export type RawPayrollOrders = {
  mgId: string;
  date: string;
  orders: number;
};

export type RawPayrollCover = {
  driverId: string;
  date: string;
  cover: "off" | "sick" | "accident";
  approved: boolean;
};

export type RawPayrollAdjustment = {
  driverId: string;
  date: string;
  status: AdjustmentStatus;
  hours: number | null;
  reason: string | null;
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

/* ------------------------------------------------------------------ */
/* RPC payload                                                        */
/* ------------------------------------------------------------------ */

type RawDayRow = {
  d: string;
  h: number | string | null;
  o: number | string | null;
  /** Operations cover on the date, from a request. */
  c: string | null;
  /** True when that cover is approved (a pending request covers nothing). */
  ca: boolean | null;
  /** True when an attendance log exists for the date. */
  k: boolean | null;
  x: string | null;
  xh: number | string | null;
};

export type RawRpcRider = {
  driverId: string;
  amId: string;
  mgId: string;
  name: string;
  employeeId: string | null;
  restaurant: string;
  restaurantId: string | null;
  zone: string;
  zoneId: string | null;
  zoneName: string | null;
  partner: string;
  projectKey: string | null;
  nationality: string;
  nationalityCode: string | null;
  status: string;
  vehicleKey: string | null;
  sourceType: string | null;
  sourceCompany: string | null;
  offStructureDays: number;
  offStructureSource: string;
  days: RawDayRow[];
};

export type RawPayrollRuleSnapshot = {
  today: string;
  month: {
    key: string;
    year: number;
    month: number;
    days: number;
    label: string;
    fixedDays: number;
  };
  months: PayrollMonthMeta[];
  zoneMonth?: string;
  options: PayrollOptions;
  clients: unknown;
  rules: unknown;
  zoneMetrics: unknown;
  canManage?: boolean;
  riders: RawRpcRider[];
  requests: PayrollRequestRow[];
  requestKpis: PayrollSnapshot["requestKpis"];
};

function num(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = num(value, Number.NaN);
  return Number.isFinite(n) ? n : null;
}

export function parseClientConfig(raw: unknown): PayrollClientConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const key = String(o.key ?? "").trim();
  if (!key) return null;
  return {
    key,
    name: String(o.name ?? key),
    usesZone: Boolean(o.usesZone),
    usesOrders: o.usesOrders === undefined ? true : Boolean(o.usesOrders),
    usesHours: Boolean(o.usesHours),
    fullDayHours: num(o.fullDayHours, PAYROLL_DAY_HOURS),
    halfDayHours: num(o.halfDayHours, 6),
    reducedHours: num(o.reducedHours, 3),
    requiredHoursPerDay: num(o.requiredHoursPerDay, PAYROLL_DAY_HOURS),
    defaultOffDays: num(o.defaultOffDays, PAYROLL_DEFAULT_OFF_DAYS),
    defaultResult: parseRuleResult(o.defaultResult ?? { kind: "12" }),
    goodThreshold: num(o.goodThreshold, 110),
    averageThreshold: num(o.averageThreshold, 70),
    isSystem: Boolean(o.isSystem),
    sortOrder: num(o.sortOrder, 100),
  };
}

export function parseZoneMetrics(raw: unknown): PayrollZoneMetricRow[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const zoneId = String(o.zoneId ?? "").trim();
      if (!zoneId) return null;
      const categoryOverride = String(o.categoryOverride ?? "").trim().toLowerCase();
      return {
        zoneId,
        zoneName: String(o.zoneName ?? "—"),
        orders: num(o.orders),
        riderDays: num(o.riderDays),
        dpd: nullableNum(o.dpd),
        targetDpd: nullableNum(o.targetDpd),
        dpdUsed: nullableNum(o.dpdUsed),
        targetDpdUsed: nullableNum(o.targetDpdUsed),
        efficiency: nullableNum(o.efficiency),
        categoryAuto: (String(o.categoryAuto ?? "").trim().toLowerCase() || "not_set") as ZoneCategory,
        categoryOverride:
          categoryOverride === "good" ||
          categoryOverride === "average" ||
          categoryOverride === "low"
            ? (categoryOverride as "good" | "average" | "low")
            : null,
        goodThreshold: num(o.goodThreshold, 110),
        averageThreshold: num(o.averageThreshold, 70),
        computedAt: o.computedAt ? String(o.computedAt) : null,
      } satisfies PayrollZoneMetricRow;
    })
    .filter((m): m is PayrollZoneMetricRow => m !== null);
}

export function parseAdjustmentStatus(raw: unknown): AdjustmentStatus | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  const map: Record<string, AdjustmentStatus> = {
    auto: "auto",
    "12": "12",
    "3h": "3h",
    half: "half",
    act: "actual",
    actual: "actual",
    off: "off",
    abs: "absent",
    absent: "absent",
    alh: "abs_lh",
    abs_lh: "abs_lh",
    alo: "abs_lo",
    abs_lo: "abs_lo",
    sick: "sick",
    accident: "accident",
    vehicle: "vehicle",
    vehicle_issue: "vehicle",
    cus: "custom",
    custom: "custom",
  };
  return map[value] ?? null;
}

/* ------------------------------------------------------------------ */
/* The core: roster + per-day facts → riders                          */
/* ------------------------------------------------------------------ */

type DayFactsInput = {
  date: string;
  loggedHours: number;
  orders: number;
  cover: "off" | "sick" | "accident" | null;
  coverApproved: boolean;
  hasCheckIn: boolean;
  adjustment: RawPayrollAdjustment | null;
};

function dayInfoFrom(
  date: string,
  facts: DayFactsInput,
  ctx: { today: string; client: PayrollClientConfig | null; rules: PayrollRule[]; zoneName: string | null; zoneCategory: ZoneCategory },
): { status: DayStatus; info: PayrollDayInfo; unjustified: boolean } {
  const outcome = evalDay({
    date,
    today: ctx.today,
    client: ctx.client,
    rules: ctx.rules,
    zoneName: ctx.zoneName,
    zoneCategory: ctx.zoneCategory,
    loggedHours: facts.loggedHours,
    orders: facts.orders,
    cover: facts.cover,
    coverApproved: facts.coverApproved,
    hasCheckIn: facts.hasCheckIn,
    adjustment: facts.adjustment
      ? { status: facts.adjustment.status, hours: facts.adjustment.hours }
      : null,
  });
  return {
    status: outcome.status,
    unjustified: outcome.unjustified,
    info: {
      orders: facts.orders,
      loggedHours: Math.round(facts.loggedHours * 100) / 100,
      source: outcome.source,
      ruleLabel: outcome.ruleLabel,
      adjusted: outcome.adjusted,
      adjustmentStatus: facts.adjustment?.status ?? null,
      adjustmentHours: facts.adjustment?.hours ?? null,
      adjustmentReason: facts.adjustment?.reason ?? null,
      creditedHours: outcome.hours,
    },
  };
}

function payrollZoneFor(
  rider: RawPayrollDriver,
  zoneNames: ReadonlyMap<string, string>,
): { zoneId: string | null; zoneName: string | null } {
  // SOP: an Americana rider belongs to their restaurant's zone, falling back to
  // their own. Every other client uses the driver zone.
  const restaurantZone =
    rider.projectKey === "americana" ? (rider.restaurantZoneId ?? null) : null;
  const zoneId = restaurantZone ?? rider.zoneId;
  const zoneName = zoneId
    ? (zoneNames.get(zoneId) ?? (zoneId === rider.zoneId ? rider.zoneName : null))
    : null;
  return { zoneId, zoneName };
}

export function assemblePayrollSnapshot(input: {
  today: string;
  monthKey: string;
  slicers: PayrollSlicers;
  roster: RawPayrollDriver[];
  checkIns: RawPayrollCheckIn[];
  requests: RawPayrollRequest[];
  offStructures?: RawOffStructure[];
  orders?: RawPayrollOrders[];
  covers?: RawPayrollCover[];
  adjustments?: RawPayrollAdjustment[];
  clients?: PayrollClientConfig[];
  rules?: PayrollRule[];
  zoneMetrics?: PayrollZoneMetricRow[];
  zoneMonth?: string;
  canManage?: boolean;
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
  const hoursByDriver = new Map<string, Map<string, number>>();
  for (const row of input.checkIns) {
    if (!rosterIds.has(row.driverId)) continue;
    const set = checkInByDriver.get(row.driverId) ?? new Set<string>();
    set.add(row.date);
    checkInByDriver.set(row.driverId, set);
    const hours = Number.isFinite(row.hours) ? (row.hours as number) : 0;
    const perDate = hoursByDriver.get(row.driverId) ?? new Map<string, number>();
    perDate.set(row.date, (perDate.get(row.date) ?? 0) + hours);
    hoursByDriver.set(row.driverId, perDate);
  }

  const coverByDriver = new Map<string, Map<string, RawPayrollCover>>();
  for (const row of input.covers ?? []) {
    if (!rosterIds.has(row.driverId)) continue;
    const perDate = coverByDriver.get(row.driverId) ?? new Map<string, RawPayrollCover>();
    perDate.set(row.date, row);
    coverByDriver.set(row.driverId, perDate);
  }

  const ordersByMgId = new Map<string, Map<string, number>>();
  for (const row of input.orders ?? []) {
    const perDate = ordersByMgId.get(row.mgId) ?? new Map<string, number>();
    perDate.set(row.date, (perDate.get(row.date) ?? 0) + num(row.orders));
    ordersByMgId.set(row.mgId, perDate);
  }

  const adjustmentByDriver = new Map<string, Map<string, RawPayrollAdjustment>>();
  for (const row of input.adjustments ?? []) {
    if (!rosterIds.has(row.driverId)) continue;
    const perDate = adjustmentByDriver.get(row.driverId) ?? new Map<string, RawPayrollAdjustment>();
    perDate.set(row.date, row);
    adjustmentByDriver.set(row.driverId, perDate);
  }

  const offByDriver = new Map<string, RawOffStructure>();
  for (const row of input.offStructures ?? []) {
    if (!rosterIds.has(row.driverId)) continue;
    offByDriver.set(row.driverId, row);
  }

  const zoneNames = new Map<string, string>(
    options.zones.map((z) => [z.id, z.name] as [string, string]),
  );
  const clientByKey = new Map((input.clients ?? []).map((c) => [c.key, c]));
  const zoneMetrics = input.zoneMetrics ?? [];

  // Requests still drive the Requests tab and the coverage flags.
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
    if (kind && !coverByDriver.has(req.driverId)) {
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
      const off = offByDriver.get(r.id);
      const offStructureDays = Number.isFinite(off?.offDays)
        ? (off?.offDays as number)
        : PAYROLL_DEFAULT_OFF_DAYS;
      const hoursByDate = hoursByDriver.get(r.id);
      const client = r.projectKey ? (clientByKey.get(r.projectKey) ?? null) : null;
      const rules = rulesForClient(input.rules ?? [], client?.key ?? null);
      const { zoneId, zoneName } = payrollZoneFor(r, zoneNames);
      const zoneCategory = categoryForZone(zoneMetrics, zoneId);
      const metric = zoneId ? zoneMetrics.find((m) => m.zoneId === zoneId) ?? null : null;

      const coverPerDate = coverByDriver.get(r.id) ?? new Map<string, RawPayrollCover>();
      const legacyCover = coversByDriver.get(r.id) ?? new Map<string, DayCoverFlags>();
      const adjustmentPerDate = adjustmentByDriver.get(r.id) ?? new Map<string, RawPayrollAdjustment>();
      const ordersPerDate = ordersByMgId.get((r.employeeId ?? "").trim().toLowerCase()) ?? new Map();

      const days: DayStatus[] = [];
      const dayInfo: PayrollDayInfo[] = [];
      let totalHours = 0;
      let actualHours = 0;
      let unjustified = 0;

      for (let d = 1; d <= month.days; d += 1) {
        const date = `${month.key}-${String(d).padStart(2, "0")}`;
        const logged = hoursByDate?.get(date) ?? 0;
        const coverRow = coverPerDate.get(date);
        const flags = legacyCover.get(date);
        const cover: "off" | "sick" | "accident" | null = coverRow
          ? coverRow.cover
          : flags?.accident
            ? "accident"
            : flags?.sick
              ? "sick"
              : flags?.off
                ? "off"
                : null;
        const coverApproved = coverRow
          ? coverRow.approved
          : cover === "accident"
            ? Boolean(flags?.approvedAccident)
            : cover === "sick"
              ? Boolean(flags?.approvedSick)
              : cover === "off"
                ? Boolean(flags?.approvedOff)
                : false;

        const facts: DayFactsInput = {
          date,
          loggedHours: logged,
          orders: ordersPerDate.get(date) ?? 0,
          cover,
          coverApproved,
          hasCheckIn: Boolean(hoursByDate?.has(date)),
          adjustment: adjustmentPerDate.get(date) ?? null,
        };
        const resolved = dayInfoFrom(date, facts, {
          today: input.today,
          client,
          rules,
          zoneName,
          zoneCategory,
        });
        days.push(resolved.status);
        dayInfo.push(resolved.info);
        totalHours += resolved.info.creditedHours;
        actualHours += logged;
        if (resolved.unjustified) unjustified += 1;
      }

      const requiredHoursPerDay = client?.requiredHoursPerDay || PAYROLL_DAY_HOURS;
      return riderRow({
        r,
        zoneId,
        zoneName,
        zoneCategory,
        metric,
        offStructureSource: off?.source ?? "default",
        offStructureDays,
        requiredHours: Math.max(
          0,
          (month.days - offStructureDays) * requiredHoursPerDay,
        ),
        days,
        dayInfo,
        requiredHoursPerDay,
        totalHours: Math.round(totalHours * 100) / 100,
        actualHours: Math.round(actualHours * 100) / 100,
        unjustified,
      });
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
    zoneMonth: input.zoneMonth ?? month.key,
    clients: input.clients ?? [],
    rules: input.rules ?? [],
    zoneMetrics,
    canManage: input.canManage ?? false,
  };
}

function riderRow(input: {
  r: RawPayrollDriver;
  zoneId: string | null;
  zoneName: string | null;
  zoneCategory: ZoneCategory;
  metric: PayrollZoneMetricRow | null;
  offStructureSource: OffStructureSource;
  offStructureDays: number;
  requiredHours: number;
  requiredHoursPerDay: number;
  days: readonly DayStatus[];
  dayInfo: readonly PayrollDayInfo[];
  totalHours: number;
  actualHours: number;
  unjustified: number;
}): PayrollRiderRow {
  const count = (status: DayStatus) => input.days.filter((s) => s === status).length;
  const r = input.r;
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
    zone: input.zoneName ?? "—",
    zoneId: input.zoneId,
    zoneCategory: input.zoneCategory,
    zoneEfficiency: input.metric?.efficiency ?? null,
    zoneDpd: input.metric?.dpd ?? null,
    partner: partnerLabel(r.projectKey),
    projectKey: r.projectKey,
    nationality: r.nationality ? countryLabel(r.nationality) : "—",
    nationalityCode: r.nationality,
    status: r.status === "active" ? "Active" : "Inactive",
    vehicleKey: r.vehicleKey,
    sourceType: r.sourceType,
    sourceCompany: r.sourceCompany,
    days: [...input.days],
    dayInfo: [...input.dayInfo],
    workDays: count("work"),
    totalHours: input.totalHours,
    offDays: count("off"),
    sickDays: count("sick"),
    accidentDays: count("accident"),
    absentDays: count("absent"),
    reducedDays: count("reduced3"),
    halfDays: count("half"),
    actualDays: count("actual"),
    vehicleDays: count("vehicle"),
    absLhDays: count("abs_lh"),
    absLoDays: count("abs_lo"),
    customDays: count("custom"),
    finalOrders: input.dayInfo.reduce((sum, d) => sum + d.orders, 0),
    adjustedCells: input.dayInfo.filter((d) => d.adjusted).length,
    fixedDays: input.days.length - PAYROLL_DEFAULT_OFF_DAYS,
    offStructureDays: input.offStructureDays,
    offStructureSource: input.offStructureSource,
    offStructureHours: offStructureHoursFor(input.offStructureDays),
    requiredHours: input.requiredHours,
    actualHours: input.actualHours,
    efficiency: efficiencyPct(input.actualHours, input.requiredHours),
    unjustified: input.unjustified,
  };
}

/**
 * The RPC path. `admin_payroll_rule_snapshot` returns the raw per-day inputs and
 * this resolves them through the same engine the table fallback uses, so the two
 * cannot disagree.
 */
export function snapshotFromRpc(raw: RawPayrollRuleSnapshot): PayrollSnapshot {
  const clients = (Array.isArray(raw.clients) ? raw.clients : [])
    .map(parseClientConfig)
    .filter((c): c is PayrollClientConfig => c !== null);
  const rules = parseRules(raw.rules);
  const zoneMetrics = parseZoneMetrics(raw.zoneMetrics);
  const today = raw.today;
  const monthKey = raw.month.key;
  const month: PayrollMonthMeta = {
    key: monthKey,
    year: num(raw.month.year),
    month: num(raw.month.month),
    days: num(raw.month.days, 30),
    label: String(raw.month.label ?? monthKey),
    fixedDays: num(raw.month.fixedDays, num(raw.month.days, 30) - PAYROLL_DEFAULT_OFF_DAYS),
  };
  const months = (Array.isArray(raw.months) ? raw.months : []).map((m) => ({
    key: String(m.key),
    year: num(m.year),
    month: num(m.month),
    days: num(m.days, 30),
    label: String(m.label ?? m.key),
    fixedDays: num(m.fixedDays, 0),
  }));

  const clientByKey = new Map(clients.map((c) => [c.key, c]));
  const zoneNameById = new Map<string, string>(
    (raw.options?.zones ?? []).map((z) => [z.id, z.name]),
  );
  for (const m of zoneMetrics) zoneNameById.set(m.zoneId, m.zoneName);

  const riders: PayrollRiderRow[] = (raw.riders ?? []).map((row) => {
    const client = row.projectKey ? (clientByKey.get(row.projectKey) ?? null) : null;
    const rulesFor = rulesForClient(rules, client?.key ?? null);
    const zoneCategory = categoryForZone(zoneMetrics, row.zoneId);
    const metric = row.zoneId ? zoneMetrics.find((m) => m.zoneId === row.zoneId) ?? null : null;
    const days: DayStatus[] = [];
    const dayInfo: PayrollDayInfo[] = [];
    let totalHours = 0;
    let actualHours = 0;
    let unjustified = 0;
    const offStructureDays = num(row.offStructureDays, PAYROLL_DEFAULT_OFF_DAYS);

    for (const day of row.days ?? []) {
      const logged = num(day.h);
      const cover =
        day.c === "off" || day.c === "sick" || day.c === "accident" ? day.c : null;
      const adjustmentStatus = parseAdjustmentStatus(day.x);
      const facts: DayFactsInput = {
        date: String(day.d),
        loggedHours: logged,
        orders: num(day.o),
        cover,
        coverApproved: Boolean(day.ca),
        hasCheckIn: Boolean(day.k) || logged > 0,
        adjustment: adjustmentStatus
          ? {
              driverId: row.driverId,
              date: String(day.d),
              status: adjustmentStatus,
              hours: nullableNum(day.xh),
              reason: null,
            }
          : null,
      };
      const resolved = dayInfoFrom(facts.date, facts, {
        today,
        client,
        rules: rulesFor,
        zoneName: row.zoneName,
        zoneCategory,
      });
      days.push(resolved.status);
      dayInfo.push(resolved.info);
      totalHours += resolved.info.creditedHours;
      actualHours += logged;
      if (resolved.unjustified) unjustified += 1;
    }

    const requiredHoursPerDay = client?.requiredHoursPerDay || PAYROLL_DAY_HOURS;
    return riderRow({
      r: {
        id: row.driverId,
        name: row.name,
        employeeId: row.employeeId,
        driverCode: row.mgId === "—" ? null : row.mgId,
        zoneId: row.zoneId,
        zoneName: row.zoneName,
        projectKey: row.projectKey,
        nationality: row.nationalityCode,
        sourceType: row.sourceType,
        sourceCompany: row.sourceCompany,
        status: row.status === "Active" ? "active" : "inactive",
        vehicleKey: row.vehicleKey,
        restaurantId: row.restaurantId,
        restaurantName: row.restaurant,
      },
      zoneId: row.zoneId,
      zoneName: row.zoneName ?? zoneNameById.get(row.zoneId ?? "") ?? null,
      zoneCategory,
      metric,
      offStructureSource:
        row.offStructureSource === "bulk_upload"
          ? "bulk_upload"
          : row.offStructureSource === "manual"
            ? "manual"
            : "default",
      offStructureDays,
      requiredHours: Math.max(
        0,
        (month.days - offStructureDays) * requiredHoursPerDay,
      ),
      requiredHoursPerDay,
      days,
      dayInfo,
      totalHours: Math.round(totalHours * 100) / 100,
      actualHours: Math.round(actualHours * 100) / 100,
      unjustified,
    });
  });

  riders.sort((a, b) => a.name.localeCompare(b.name));

  const requests = (raw.requests ?? []).map((r) => ({
    ...r,
    uiStatus: mapLiveStatusToUi(r.liveStatus),
  }));
  const requestKpis = raw.requestKpis ?? computeRequestKpis(requests);

  return {
    today,
    month,
    months: months.length ? months : payrollMonths(today),
    options: raw.options ?? { zones: [], restaurants: [], nationalities: [], sourceCompanies: [] },
    riders,
    requests,
    payrollKpis: computePayrollKpis(riders),
    requestKpis,
    workflow: workflowStats(requests, riders.length),
    zoneMonth: raw.zoneMonth ?? monthKey,
    clients,
    rules,
    zoneMetrics,
    canManage: Boolean(raw.canManage),
  };
}

/**
 * Kept for the RPC path's historical callers: fills anything the payload left
 * blank. `snapshotFromRpc` already resolves every field, so this is now a
 * defensive pass rather than the main one.
 */
export function decoratePayrollSnapshot(snapshot: PayrollSnapshot): PayrollSnapshot {
  return {
    ...snapshot,
    riders: snapshot.riders.map((r) => {
      const offStructureDays = Number.isFinite(r.offStructureDays)
        ? r.offStructureDays
        : PAYROLL_DEFAULT_OFF_DAYS;
      const requiredHours = Number.isFinite(r.requiredHours)
        ? r.requiredHours
        : requiredHoursFor(snapshot.month.days, offStructureDays);
      const hasLoggedHours = Number.isFinite(r.actualHours);
      const actualHours = hasLoggedHours ? r.actualHours : r.workDays * PAYROLL_DAY_HOURS;
      return {
        ...r,
        nationality: r.nationalityCode ? countryLabel(r.nationalityCode) : r.nationality,
        zoneCategory: r.zoneCategory ?? zoneCategoryFor(r.zoneEfficiency, 110, 70),
        offStructureDays,
        offStructureSource: r.offStructureSource ?? "default",
        offStructureHours: Number.isFinite(r.offStructureHours)
          ? r.offStructureHours
          : offStructureHoursFor(offStructureDays),
        requiredHours,
        actualHours,
        efficiency: hasLoggedHours ? r.efficiency : efficiencyPct(actualHours, requiredHours),
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Adjustment batches                                                  */
/* ------------------------------------------------------------------ */

/**
 * Parse the clipboard/selection batch the grid hands to the RPC. Excel text
 * such as `12`, `3h`, `OFF`, `6.5h` and `CUS` is accepted because that is what
 * an operator will have copied.
 */
export function parseAdjustmentCellText(
  text: string,
  currentHours: number,
): { status: AdjustmentStatus; hours: number | null } | null {
  const raw = text.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (["auto", "reset", "clear", "-"].includes(lower)) {
    return { status: "auto", hours: null };
  }
  if (lower === "12" || lower === "work" || lower === "full") return { status: "12", hours: null };
  if (lower === "3h" || lower === "3" || lower === "reduced") return { status: "3h", hours: null };
  if (lower === "half" || lower === "6" || lower === "6h") return { status: "half", hours: null };
  if (lower === "off") return { status: "off", hours: null };
  if (lower === "absent" || lower === "abs") return { status: "absent", hours: null };
  if (lower === "abs.lh" || lower === "abs_lh" || lower === "alh") return { status: "abs_lh", hours: null };
  if (lower === "abs.lo" || lower === "abs_lo" || lower === "alo") return { status: "abs_lo", hours: null };
  if (lower === "sick") return { status: "sick", hours: null };
  if (lower === "accident") return { status: "accident", hours: null };
  if (["vehicle", "vehicle issue", "vehicle_issue"].includes(lower)) {
    return { status: "vehicle", hours: null };
  }
  if (lower === "act" || lower === "actual") {
    return { status: "actual", hours: null };
  }
  const hours = Number(lower.replace(/h$/, ""));
  if (Number.isFinite(hours) && hours >= 0 && hours <= 24) {
    if (hours === 12) return { status: "12", hours: null };
    if (hours === 3) return { status: "3h", hours: null };
    if (hours === 6) return { status: "half", hours: null };
    return { status: "custom", hours };
  }
  void currentHours;
  return null;
}

export function cellsFromSelection(
  inputs: ReadonlyArray<{
    driverId: string;
    date: string;
    text: string;
    currentHours: number;
  }>,
): { cells: PayrollAdjustmentCell[]; rejected: number } {
  const cells: PayrollAdjustmentCell[] = [];
  let rejected = 0;
  for (const input of inputs) {
    const parsed = parseAdjustmentCellText(input.text, input.currentHours);
    if (!parsed) {
      rejected += 1;
      continue;
    }
    cells.push({
      driverId: input.driverId,
      date: input.date,
      status: parsed.status,
      hours: parsed.hours,
    });
  }
  return { cells, rejected };
}

export { normaliseRuleKind };
export { zoneCategoryFor };
