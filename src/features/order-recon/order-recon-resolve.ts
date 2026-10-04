import { normalizeEmployeeId } from "@/features/drivers/driver-errors";
import type { ReconMeltRow } from "./parse-recon-xlsx";

export type ReconResolvedRow = {
  employee_id: string;
  employee_name: string;
  store_name: string;
  work_date: string;
  excel_orders: number;
  driver_id: string | null;
  restaurant_id: string | null;
  status: "ready" | "unresolved";
  name_warning: boolean;
  unresolved_reason: "unknown_id" | "unknown_store" | null;
};

export function normalizeStoreKey(name: string): string {
  return name.trim().toLowerCase();
}

export function resolveReconRows(
  rows: ReconMeltRow[],
  drivers: { id: string; employee_id: string | null; full_name: string | null }[],
  restaurants: { id: string; name: string }[],
  aliases: { alias: string; restaurant_id: string }[],
): ReconResolvedRow[] {
  const driverById = new Map<string, (typeof drivers)[number]>();
  for (const d of drivers) {
    const key = normalizeEmployeeId(d.employee_id ?? "");
    if (key) driverById.set(key.toLowerCase(), d);
  }
  const storeByName = new Map<string, string>();
  for (const r of restaurants) {
    storeByName.set(normalizeStoreKey(r.name), r.id);
  }
  const storeByAlias = new Map<string, string>();
  for (const a of aliases) {
    storeByAlias.set(normalizeStoreKey(a.alias), a.restaurant_id);
  }

  return rows.map((row) => {
    const empKey = normalizeEmployeeId(row.employee_id);
    const driver = empKey ? driverById.get(empKey.toLowerCase()) : undefined;
    const restaurantId =
      storeByName.get(normalizeStoreKey(row.store_name)) ??
      storeByAlias.get(normalizeStoreKey(row.store_name)) ??
      null;
    const name_warning = Boolean(
      driver &&
        row.employee_name.trim() &&
        driver.full_name &&
        normalizeStoreKey(driver.full_name) !== normalizeStoreKey(row.employee_name),
    );
    if (!driver) {
      return {
        ...row,
        driver_id: null,
        restaurant_id: restaurantId,
        status: "unresolved",
        name_warning,
        unresolved_reason: "unknown_id",
      };
    }
    if (!restaurantId) {
      return {
        ...row,
        driver_id: driver.id,
        restaurant_id: null,
        status: "unresolved",
        name_warning,
        unresolved_reason: "unknown_store",
      };
    }
    return {
      ...row,
      driver_id: driver.id,
      restaurant_id: restaurantId,
      status: "ready",
      name_warning,
      unresolved_reason: null,
    };
  });
}

export function excelPayloadForRpc(rows: ReconResolvedRow[]) {
  return rows
    .filter((r) => r.status === "ready" && r.driver_id && r.restaurant_id)
    .map((r) => ({
      driver_id: r.driver_id,
      restaurant_id: r.restaurant_id,
      work_date: r.work_date,
      excel_orders: r.excel_orders,
    }));
}

/**
 * One preview entry per (rider, store, reason) instead of one per melted cell.
 *
 * The AM workbook is wide — one column per Kuwait day — so the melt produces a
 * row for every date. A single unknown ID therefore listed the same line thirty
 * times and the preview read as thirty problems when it was one. Dates are
 * folded into a span and the day count travels with the entry, so nothing is
 * hidden: only the repetition is.
 */
export type ReconIssueRow = {
  employee_id: string;
  employee_name: string;
  store_name: string;
  unresolved_reason: "unknown_id" | "unknown_store";
  days: number;
  first_date: string;
  last_date: string;
  excel_orders: number;
};

export function collapseReconIssues(rows: ReconResolvedRow[]): ReconIssueRow[] {
  const groups = new Map<string, ReconIssueRow>();
  for (const row of rows) {
    if (row.status !== "unresolved" || !row.unresolved_reason) continue;
    // Captured as a const: TS drops the property narrowing across the map call below.
    const reason = row.unresolved_reason;
    // Grouped on the raw value the operator sees, not on `normalizeEmployeeId`:
    // that returns null for exactly the IDs that land here, which would merge
    // every unknown rider into a single line.
    const key = [
      row.employee_id.trim().toLowerCase(),
      normalizeStoreKey(row.store_name),
      reason,
    ].join("\u0000");
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        store_name: row.store_name,
        unresolved_reason: reason,
        days: 1,
        first_date: row.work_date,
        last_date: row.work_date,
        excel_orders: row.excel_orders,
      });
      continue;
    }
    existing.days += 1;
    existing.excel_orders += row.excel_orders;
    // work_date is YYYY-MM-DD, so a plain string compare is the date order.
    if (row.work_date < existing.first_date) existing.first_date = row.work_date;
    if (row.work_date > existing.last_date) existing.last_date = row.work_date;
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.employee_id.localeCompare(b.employee_id) ||
      a.store_name.localeCompare(b.store_name) ||
      a.unresolved_reason.localeCompare(b.unresolved_reason) ||
      a.first_date.localeCompare(b.first_date),
  );
}
