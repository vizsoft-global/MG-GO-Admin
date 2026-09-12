import { addDays } from "./performance-formulas";

export const SOURCE_COMPANY_KEYS = [
  "mg",
  "kn",
  "rvd",
  "sadeeq",
  "brk",
  "hs",
  "ar",
  "zk",
] as const;

export type SourceCompanyKey = (typeof SOURCE_COMPANY_KEYS)[number];

export const SOURCE_COMPANY_LABEL: Record<SourceCompanyKey, string> = {
  mg: "MG",
  kn: "KN",
  rvd: "RVD",
  sadeeq: "Sadeeq",
  brk: "BRK",
  hs: "HS",
  ar: "AR",
  zk: "ZK",
};

/** Display-ID prefix from the stored company. Never parsed from the rider code. */
export const SOURCE_COMPANY_PREFIX: Record<SourceCompanyKey, string> = {
  mg: "",
  kn: "KN",
  rvd: "RVD",
  sadeeq: "SD",
  brk: "BRK",
  hs: "HS",
  ar: "AR",
  zk: "ZK",
};

export const DEFAULT_TARGET_DPD = 25;
export const OPS_RANGE_MAX_DAYS = 400;

export const OPS_RANGE_PRESETS = [
  "all",
  "last7",
  "thisMonth",
  "lastMonth",
] as const;

export type OpsRangePreset = (typeof OPS_RANGE_PRESETS)[number];

export const OPS_GRANULARITIES = ["daily", "weekly", "monthly"] as const;
export type OpsGranularity = (typeof OPS_GRANULARITIES)[number];

export const EFFICIENCY_BUCKETS = [
  "well_above",
  "above",
  "near",
  "below",
  "well_below",
] as const;

export type EfficiencyBucket = (typeof EFFICIENCY_BUCKETS)[number];

export function isSourceCompanyKey(
  value: string | null | undefined,
): value is SourceCompanyKey {
  return SOURCE_COMPANY_KEYS.includes(value as SourceCompanyKey);
}

/** Accepts stored keys, display prefixes, or labels. Blank is null. */
export function parseSourceCompany(
  raw: string | null | undefined,
): SourceCompanyKey | "invalid" | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  if (isSourceCompanyKey(value)) return value;
  const byPrefix = (Object.entries(SOURCE_COMPANY_PREFIX) as Array<
    [SourceCompanyKey, string]
  >).find(([, prefix]) => prefix && prefix.toLowerCase() === value);
  if (byPrefix) return byPrefix[0];
  const byLabel = (Object.entries(SOURCE_COMPANY_LABEL) as Array<
    [SourceCompanyKey, string]
  >).find(([, label]) => label.toLowerCase() === value);
  if (byLabel) return byLabel[0];
  return "invalid";
}

export function riderDpd(
  orders: number,
  workingDays: number,
): number | null {
  if (!Number.isFinite(orders) || !Number.isFinite(workingDays)) return null;
  if (workingDays <= 0) return null;
  return orders / workingDays;
}

/** SUM(orders) / SUM(working days). Not the mean of rider DPDs. */
export function overallDpd(
  totalOrders: number,
  totalWorkingDays: number,
): number | null {
  return riderDpd(totalOrders, totalWorkingDays);
}

export function partnerFilterMode(
  projectKeys: readonly string[],
): "all" | "americana" | "keeta" {
  const set = new Set(projectKeys.filter(Boolean));
  const hasAm = set.has("americana");
  const hasKe = set.has("keeta");
  if (set.size === 0 || (hasAm && hasKe)) return "all";
  if (hasAm) return "americana";
  if (hasKe) return "keeta";
  return "all";
}

/**
 * SOP: Americana → Store DPD; Keeta → Zone-Vehicle DPD; no Partner filter →
 * average of both. Assumption #2: if a side is missing, use the side that
 * exists; if neither exists, null (never 0).
 */
export function resolveBenchmark(input: {
  projectKey: string | null;
  partnerKeys: readonly string[];
  storeDpd: number | null;
  zoneVehicleDpd: number | null;
}): number | null {
  const mode = partnerFilterMode(input.partnerKeys);
  const store = finiteOrNull(input.storeDpd);
  const zv = finiteOrNull(input.zoneVehicleDpd);

  if (mode === "americana") return store;
  if (mode === "keeta") return zv;

  if (store != null && zv != null) return (store + zv) / 2;
  return store ?? zv;
}

export function dpdEfficiencyPct(
  riderDpdValue: number | null,
  benchmark: number | null,
): number | null {
  if (riderDpdValue == null || benchmark == null) return null;
  if (!Number.isFinite(riderDpdValue) || !Number.isFinite(benchmark)) return null;
  if (benchmark <= 0) return null;
  return (riderDpdValue / benchmark) * 100;
}

export function targetEfficiencyPct(
  riderDpdValue: number | null,
  targetDpd: number,
): number | null {
  if (riderDpdValue == null || !Number.isFinite(riderDpdValue)) return null;
  if (!Number.isFinite(targetDpd) || targetDpd <= 0) return null;
  return (riderDpdValue / targetDpd) * 100;
}

export function meanFinite(values: Array<number | null | undefined>): number | null {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    sum += v;
    n += 1;
  }
  if (n === 0) return null;
  return sum / n;
}

/**
 * Plan boundaries: >120 well above; 100–120 above (100 inclusive);
 * 80–100 near (80 inclusive, 100 exclusive); 60–80 below (60 inclusive);
 * <60 well below.
 */
export function efficiencyBucket(
  targetEffPct: number | null,
): EfficiencyBucket | null {
  if (targetEffPct == null || !Number.isFinite(targetEffPct)) return null;
  if (targetEffPct > 120) return "well_above";
  if (targetEffPct >= 100) return "above";
  if (targetEffPct >= 80) return "near";
  if (targetEffPct >= 60) return "below";
  return "well_below";
}

/** clamp(round(count/10), 2, 10). Empty set → 0 (no charts). */
export function topBottomN(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(10, Math.max(2, Math.round(count / 10)));
}

/** Assumption #1: (current − previous) / previous on the card value itself. */
export function kpiDeltaPct(
  current: number | null,
  previous: number | null,
): number | null {
  if (current == null || previous == null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function inclusiveDayCount(from: string, to: string): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

export function previousWindow(
  from: string,
  to: string,
): { from: string; to: string } {
  const n = inclusiveDayCount(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(from, -n);
  return { from: prevFrom, to: prevTo };
}

export function rangeSpanDays(from: string, to: string): number {
  return inclusiveDayCount(from, to);
}

export function assertOpsRange(from: string, to: string): void {
  if (to < from) throw new Error("invalid_date_range");
  if (rangeSpanDays(from, to) > OPS_RANGE_MAX_DAYS) {
    throw new Error("range_too_large");
  }
}

export function monthStart(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

export function resolveOpsRange(
  preset: OpsRangePreset,
  today: string,
  firstDeliveryDate: string | null,
): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");

  switch (preset) {
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "thisMonth":
      return { from: `${y}-${pad(m)}-01`, to: today };
    case "lastMonth": {
      const firstThis = `${y}-${pad(m)}-01`;
      const lastPrev = addDays(firstThis, -1);
      return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev };
    }
    case "all": {
      if (!firstDeliveryDate) return { from: today, to: today };
      const next = { from: firstDeliveryDate, to: today };
      assertOpsRange(next.from, next.to);
      return next;
    }
    default: {
      const _never: never = preset;
      return _never;
    }
  }
}

/** Store slicer is empty unless All partners or the set includes Americana. */
export function storesVisibleForPartners(partnerKeys: readonly string[]): boolean {
  return partnerFilterMode(partnerKeys) !== "keeta";
}

export function displayRiderId(input: {
  sourceCompany: string | null;
  employeeId: string | null;
  driverCode: string | null;
}): string {
  const digits = (input.employeeId?.trim() || input.driverCode?.trim() || "").replace(
    /\s+/g,
    "",
  );
  if (!digits) return "—";
  if (!isSourceCompanyKey(input.sourceCompany) || input.sourceCompany === "mg") {
    return digits;
  }
  return `${SOURCE_COMPANY_PREFIX[input.sourceCompany]}${digits}`;
}

export function sourceLabel(input: {
  sourceType: string | null;
  sourceCompany: string | null;
}): string {
  const company = isSourceCompanyKey(input.sourceCompany)
    ? SOURCE_COMPANY_LABEL[input.sourceCompany]
    : null;
  if (input.sourceType === "outsourced") {
    return company ? `Outsourced (${company})` : "Outsourced";
  }
  if (input.sourceType === "in_house") {
    return company ? `In-house (${company})` : "In-house (MG)";
  }
  return company ?? "—";
}

export function storeDisplayName(input: {
  projectKey: string | null;
  storeName: string | null;
}): string {
  if (input.projectKey === "keeta") return "(Pool)";
  return input.storeName?.trim() || "—";
}

function finiteOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
