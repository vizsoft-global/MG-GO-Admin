"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  isDriverProjectKey,
  isVehicleFuelType,
  type DriverProjectKey,
  type VehicleFuelType,
} from "@/features/fleet/fleet-labels";
import { parseFuelFillRow } from "./fuel-week";
import type { FuelFillListItem } from "./types";

async function requireFuelView() {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, "fuel.view", session.isSuperAdmin)) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

export async function fetchFuelFillAttachmentUrl(
  storageKey: string,
): Promise<{ url: string | null; error?: string }> {
  const auth = await requireFuelView();
  if ("error" in auth) throw new Error(auth.error);

  const normalized = storageKey.trim().replace(/^\/+/, "");
  if (!normalized) return { url: null };
  const objectKey = normalized.startsWith("fuel-fills/")
    ? normalized.slice("fuel-fills/".length)
    : normalized;

  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("fuel-fills").createSignedUrl(objectKey, 300);
  if (error) return { url: null, error: error.message };
  return { url: data?.signedUrl ?? null };
}

export async function listFuelFills(input: {
  from: string;
  to: string;
  search?: string;
  projectKey?: string | null;
  driverId?: string;
}): Promise<FuelFillListItem[]> {
  const auth = await requireFuelView();
  if ("error" in auth) throw new Error(auth.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_fuel_fills", {
    p_from: input.from,
    p_to: input.to,
    p_search: input.search?.trim() || undefined,
    p_project_key: input.projectKey || undefined,
    p_limit: 2000,
    p_offset: 0,
  });
  if (error) throw new Error(error.message);

  const payload = data as { ok?: boolean; rows?: unknown } | null;
  if (!payload?.ok || !Array.isArray(payload.rows)) return [];

  void logAdminRead("fuel_fills", input.driverId ? `/fuel/drivers/${input.driverId}` : "/fuel");
  const rows = payload.rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const parsed = parseFuelFillRow(row as Record<string, unknown>);
    return parsed ? [parsed] : [];
  });
  if (input.driverId) return rows.filter((row) => row.driver_id === input.driverId);
  return rows;
}

const MONTH_KEY = /^\d{4}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FuelDriverHeader = {
  driverId: string;
  driverName: string | null;
  employeeId: string | null;
  plate: string | null;
  projectKey: DriverProjectKey | null;
  zone: string | null;
  monthlyLimit: number;
  fuelType: VehicleFuelType | null;
};

export async function getFuelDriverHeader(driverId: string): Promise<FuelDriverHeader | null> {
  const auth = await requireFuelView();
  if ("error" in auth) throw new Error(auth.error);
  if (!UUID.test(driverId)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("drivers")
    .select("id, employee_id, project_key, vehicle_id, zones(name), profiles!drivers_id_fkey(full_name)")
    .eq("id", driverId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const vehicleId = typeof data.vehicle_id === "string" ? data.vehicle_id : null;
  const vehicle = vehicleId
    ? await supabase
        .from("vehicles")
        .select("reg_number, fuel_type, fuel_monthly_limit_kwd")
        .eq("id", vehicleId)
        .maybeSingle()
    : { data: null, error: null };
  if (vehicle.error) throw new Error(vehicle.error.message);

  const zoneRaw = data.zones;
  const zoneRow = Array.isArray(zoneRaw) ? zoneRaw[0] : zoneRaw;
  const profileRaw = data.profiles;
  const profileRow = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw;
  const name =
    profileRow && typeof profileRow === "object" && "full_name" in profileRow
      ? typeof (profileRow as { full_name?: unknown }).full_name === "string"
        ? (profileRow as { full_name: string }).full_name
        : null
      : null;
  const zoneName =
    zoneRow && typeof zoneRow === "object" && "name" in zoneRow
      ? typeof (zoneRow as { name?: unknown }).name === "string"
        ? (zoneRow as { name: string }).name
        : null
      : null;
  const limitRaw = vehicle.data?.fuel_monthly_limit_kwd;
  const limit = typeof limitRaw === "number" ? limitRaw : Number(limitRaw);
  const fuelTypeRaw = vehicle.data?.fuel_type;

  return {
    driverId,
    driverName: name,
    employeeId: typeof data.employee_id === "string" ? data.employee_id : null,
    plate: typeof vehicle.data?.reg_number === "string" ? vehicle.data.reg_number : null,
    projectKey: isDriverProjectKey(data.project_key) ? data.project_key : null,
    zone: zoneName,
    monthlyLimit: Number.isFinite(limit) ? limit : 0,
    fuelType: isVehicleFuelType(fuelTypeRaw) ? fuelTypeRaw : null,
  };
}

export type FuelWithdrawnOverride = {
  driverId: string;
  vehicleId: string;
  amountKwd: number;
};

export async function listFuelWithdrawnOverrides(monthKey: string): Promise<FuelWithdrawnOverride[]> {
  const auth = await requireFuelView();
  if ("error" in auth) throw new Error(auth.error);
  if (!MONTH_KEY.test(monthKey)) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fuel_withdrawn_overrides")
    .select("driver_id, vehicle_id, amount_kwd")
    .eq("month_key", monthKey);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((row) => {
    const amount = Number(row.amount_kwd);
    if (!row.driver_id || !row.vehicle_id || !Number.isFinite(amount)) return [];
    return [{ driverId: row.driver_id, vehicleId: row.vehicle_id, amountKwd: amount }];
  });
}

export async function saveFuelWithdrawnOverride(input: {
  driverId: string;
  vehicleId: string;
  monthKey: string;
  amountKwd: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFuelView();
  if ("error" in auth) return { ok: false, error: auth.error ?? "not_authorized" };
  if (!UUID.test(input.driverId) || !UUID.test(input.vehicleId) || !MONTH_KEY.test(input.monthKey)) {
    return { ok: false, error: "invalid" };
  }
  if (!Number.isFinite(input.amountKwd) || input.amountKwd < 0 || input.amountKwd > 999_999) {
    return { ok: false, error: "invalid_amount" };
  }
  const amountKwd = Math.round(input.amountKwd * 1000) / 1000;

  const supabase = await createClient();
  const { error } = await supabase.from("fuel_withdrawn_overrides").upsert(
    {
      driver_id: input.driverId,
      vehicle_id: input.vehicleId,
      month_key: input.monthKey,
      amount_kwd: amountKwd,
      updated_at: new Date().toISOString(),
      updated_by: auth.session.id,
    },
    { onConflict: "driver_id,vehicle_id,month_key" },
  );
  if (error) return { ok: false, error: error.message };

  await logAdminMutation({
    action: "update",
    entityType: "fuel_withdrawn_overrides",
    entityId: input.vehicleId,
    routeName: "/fuel",
    after: { driverId: input.driverId, monthKey: input.monthKey, amountKwd },
  });
  return { ok: true };
}
