import { countryLabel } from "@/lib/geo/countries";
import {
  displayRiderId,
  efficiencyBucket,
  kpiDeltaPct,
  SOURCE_COMPANY_LABEL,
  sourceLabel,
  storeDisplayName,
  type SourceCompanyKey,
} from "./performance-ops-formulas";
import type { OpsRiderRow, OpsRiderView } from "./performance-ops-types";

export function numOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function asInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function asStr(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value);
  return s.length ? s : null;
}

export function formatInt(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

export function formatDpd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

export function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

export function formatDelta(current: number | null, previous: number | null): {
  text: string;
  tone: "up" | "down" | "flat";
} {
  const delta = kpiDeltaPct(current, previous);
  if (delta == null) return { text: "—", tone: "flat" };
  const sign = delta > 0 ? "+" : "";
  return {
    text: `${sign}${delta.toFixed(1)}%`,
    tone: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
}

export function vehicleLabel(key: string | null | undefined): string {
  if (key === "bike") return "Bike";
  if (key === "car") return "Car";
  if (key === "van") return "Van";
  return "—";
}

export function partnerLabel(key: string | null | undefined): string {
  if (key === "keeta") return "Keeta";
  if (key === "americana") return "Americana";
  return "—";
}

export function companyLabel(key: string | null | undefined): string {
  if (!key || key === "—") return "—";
  return SOURCE_COMPANY_LABEL[key as SourceCompanyKey] ?? key.toUpperCase();
}

export function enrichOpsRider(row: OpsRiderRow): OpsRiderView {
  return {
    ...row,
    display_id: displayRiderId({
      sourceCompany: row.source_company,
      employeeId: row.employee_id,
      driverCode: row.driver_code,
    }),
    source: sourceLabel({
      sourceType: row.source_type,
      sourceCompany: row.source_company,
    }),
    store_label: storeDisplayName({
      projectKey: row.project_key,
      storeName: row.store,
    }),
    vehicle_label: vehicleLabel(row.vehicle_key),
    nationality_label: countryLabel(row.nationality),
    partner_label: partnerLabel(row.project_key),
    bucket: efficiencyBucket(row.tgt_eff),
  };
}

export function isoDate(value: unknown): string {
  const s = String(value ?? "");
  return s.slice(0, 10);
}
