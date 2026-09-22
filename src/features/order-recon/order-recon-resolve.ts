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
