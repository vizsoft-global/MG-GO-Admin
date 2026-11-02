import type { ServiceDoneRecord, ServicePart } from "./types";
import { serviceCategoryLabel, type ServiceCategoryKey } from "./service-types";

export type OwnershipKind = "contract" | "service";

/**
 * The client's two series, straight from their screenshot:
 *   Contract = a leased / rented vehicle (`vehicles.car_type = "rent"`)
 *   Service  = a company-owned vehicle (`company` or `maintenance`)
 * A vehicle with no `car_type` stored is treated as company-owned, because the
 * fleet's own vehicles are the default and a lease is always recorded as rent.
 */
export function ownershipOf(carType: string | null | undefined): OwnershipKind {
  return (carType ?? "").trim().toLowerCase() === "rent" ? "contract" : "service";
}

export type MonthlyPoint = {
  month: string;
  contractKwd: number;
  serviceKwd: number;
  totalKwd: number;
  records: number;
};

export type BreakdownRow = {
  key: string;
  label: string;
  totalKwd: number;
  records: number;
};

export type PartRow = {
  name: string;
  qty: number;
  totalKwd: number;
  avgUnitKwd: number;
  records: number;
  monthly: { month: string; totalKwd: number }[];
};

export type ServiceReport = {
  monthly: MonthlyPoint[];
  byCategory: BreakdownRow[];
  byServiceType: BreakdownRow[];
  byVendor: BreakdownRow[];
  byVehicle: BreakdownRow[];
  byOwnership: { ownership: OwnershipKind; totalKwd: number; records: number }[];
  parts: PartRow[];
  kpis: {
    totalKwd: number;
    records: number;
    avgPerRecordKwd: number;
    mostExpensiveVehicle: BreakdownRow | null;
    mostReplacedPart: PartRow | null;
  };
};

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function monthOf(day: string): string {
  return day.slice(0, 7);
}

function addToBucket(
  map: Map<string, BreakdownRow>,
  key: string,
  label: string,
  cost: number,
): void {
  const existing = map.get(key);
  if (existing) {
    existing.totalKwd = round3(existing.totalKwd + cost);
    existing.records += 1;
    return;
  }
  map.set(key, { key, label, totalKwd: round3(cost), records: 1 });
}

export function sortBreakdown(rows: BreakdownRow[]): BreakdownRow[] {
  return [...rows].sort(
    (a, b) => b.totalKwd - a.totalKwd || a.label.localeCompare(b.label),
  );
}

export type ReportInput = {
  records: readonly ServiceDoneRecord[];
  /** vehicle id → `vehicles.car_type` (null when the vehicle is gone or blank). */
  carTypeByVehicleId: ReadonlyMap<string, string | null>;
  locale?: string;
  /** Restrict/complete the month axis, e.g. every month of the selected year. */
  months?: readonly string[];
};

/**
 * A single service invoice above this figure cannot be real, so it is treated
 * as "unknown" in the aggregates. Legacy `vehicle_services` rows were written
 * before this module, from a free-text cost field: one production row
 * (`32b331a9-…`, vehicle 5/6767, 2026-10-16) holds `2.3e75` KWD, which made
 * Total spend print as a 76-digit number and pushed the chart axis to `4e+75`.
 * The record itself still lists with its stored figure and opens normally —
 * only the totals, the chart and the breakdowns ignore it.
 */
export const MAX_PLAUSIBLE_RECORD_COST_KWD = 1_000_000;

/** Stored cost, or 0 when it is missing, negative or physically impossible. */
export function plausibleCost(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value) || value < 0) return 0;
  return value > MAX_PLAUSIBLE_RECORD_COST_KWD ? 0 : value;
}

export function buildServiceReport(input: ReportInput): ServiceReport {
  const locale = input.locale ?? "en";
  const monthly = new Map<string, MonthlyPoint>();
  for (const month of input.months ?? []) {
    monthly.set(month, { month, contractKwd: 0, serviceKwd: 0, totalKwd: 0, records: 0 });
  }

  const byCategory = new Map<string, BreakdownRow>();
  const byServiceType = new Map<string, BreakdownRow>();
  const byVendor = new Map<string, BreakdownRow>();
  const byVehicle = new Map<string, BreakdownRow>();
  const partRows = new Map<string, PartRow>();
  const ownershipTotals: Record<OwnershipKind, { totalKwd: number; records: number }> = {
    contract: { totalKwd: 0, records: 0 },
    service: { totalKwd: 0, records: 0 },
  };

  for (const record of input.records) {
    const month = monthOf(record.doneDay);
    const ownership = ownershipOf(input.carTypeByVehicleId.get(record.vehicleId) ?? null);
    const cost = plausibleCost(record.costKwd);

    const point =
      monthly.get(month) ??
      ({ month, contractKwd: 0, serviceKwd: 0, totalKwd: 0, records: 0 } as MonthlyPoint);
    if (ownership === "contract") point.contractKwd = round3(point.contractKwd + cost);
    else point.serviceKwd = round3(point.serviceKwd + cost);
    point.totalKwd = round3(point.totalKwd + cost);
    point.records += 1;
    monthly.set(month, point);

    ownershipTotals[ownership].totalKwd = round3(ownershipTotals[ownership].totalKwd + cost);
    ownershipTotals[ownership].records += 1;

    const categoryKey = (record.category ?? "other") as ServiceCategoryKey;
    addToBucket(byCategory, categoryKey, serviceCategoryLabel(categoryKey, locale), cost);
    addToBucket(
      byServiceType,
      record.serviceTypeKey || record.serviceTypeLabel || "unknown",
      record.serviceTypeLabel || record.serviceTypeKey || "—",
      cost,
    );
    addToBucket(byVendor, record.vendor || "unknown", record.vendor || "—", cost);
    addToBucket(byVehicle, record.vehicleId, record.vehiclePlate || record.vehicleId, cost);

    const counted = new Set<string>();
    for (const part of record.parts) {
      const key = part.name.trim().toLowerCase();
      if (!key) continue;
      const existing = partRows.get(key);
      if (existing) {
        existing.qty = round3(existing.qty + part.qty);
        existing.totalKwd = round3(existing.totalKwd + part.total_kwd);
        const monthRow = existing.monthly.find((row) => row.month === month);
        if (monthRow) monthRow.totalKwd = round3(monthRow.totalKwd + part.total_kwd);
        else existing.monthly.push({ month, totalKwd: round3(part.total_kwd) });
        if (!counted.has(key)) existing.records += 1;
      } else {
        partRows.set(key, {
          name: part.name.trim(),
          qty: part.qty,
          totalKwd: round3(part.total_kwd),
          avgUnitKwd: 0,
          records: 1,
          monthly: [{ month, totalKwd: round3(part.total_kwd) }],
        });
      }
      counted.add(key);
    }
  }

  const parts = [...partRows.values()]
    .map((row) => ({
      ...row,
      avgUnitKwd: row.qty > 0 ? round3(row.totalKwd / row.qty) : 0,
      monthly: [...row.monthly].sort((a, b) => a.month.localeCompare(b.month)),
    }))
    .sort((a, b) => b.totalKwd - a.totalKwd || a.name.localeCompare(b.name));

  const monthlyRows = [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month));
  const totalKwd = round3(ownershipTotals.contract.totalKwd + ownershipTotals.service.totalKwd);
  const records = input.records.length;
  const byVehicleRows = sortBreakdown([...byVehicle.values()]);

  return {
    monthly: monthlyRows,
    byCategory: sortBreakdown([...byCategory.values()]),
    byServiceType: sortBreakdown([...byServiceType.values()]),
    byVendor: sortBreakdown([...byVendor.values()]),
    byVehicle: byVehicleRows,
    byOwnership: [
      { ownership: "contract", ...ownershipTotals.contract },
      { ownership: "service", ...ownershipTotals.service },
    ],
    parts,
    kpis: {
      totalKwd,
      records,
      avgPerRecordKwd: records > 0 ? round3(totalKwd / records) : 0,
      mostExpensiveVehicle: byVehicleRows[0] ?? null,
      mostReplacedPart:
        parts.length > 0
          ? ([...parts].sort((a, b) => b.qty - a.qty || b.totalKwd - a.totalKwd)[0] ?? null)
          : null,
    },
  };
}

export type DrillDownInput = {
  month?: string | null;
  vehicleId?: string | null;
  serviceTypeKey?: string | null;
  category?: string | null;
  vendor?: string | null;
};

/**
 * The report is the door to the ledger: a bar or a breakdown row becomes a URL
 * on the records tab, never a hidden piece of client state.
 */
export function reportDrillDownParams(input: DrillDownInput): Record<string, string> {
  const params: Record<string, string> = { tab: "records" };
  if (input.month) {
    params.from = `${input.month}-01`;
    params.to = `${input.month}-31`;
  }
  if (input.vehicleId) params.vehicle = input.vehicleId;
  if (input.serviceTypeKey) params.type = input.serviceTypeKey;
  if (input.category) params.category = input.category;
  if (input.vendor) params.vendor = input.vendor;
  return params;
}

export function sumPartTotals(parts: readonly ServicePart[]): number {
  return round3(parts.reduce((sum, part) => sum + part.total_kwd, 0));
}

