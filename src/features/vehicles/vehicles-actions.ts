"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import type { VehicleListRow, VehicleProjectType, VehicleStatus, VehicleTypeRow } from "./types";

function formatError(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error?.message) return "save_failed";
  if (error.code === "23505") return "duplicate_bike_id";
  return error.code ? `${error.code} — ${error.message}` : error.message;
}

async function requireVehicles(permission: "vehicles.view" | "vehicles.manage") {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, permission, session.isSuperAdmin)) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

export async function listVehicleTypes(): Promise<VehicleTypeRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicle_types")
    .select("key, label_en, label_ar, sort_order, is_active")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as VehicleTypeRow[];
}

export async function listVehicles(): Promise<VehicleListRow[]> {
  const auth = await requireVehicles("vehicles.view");
  if ("error" in auth) throw new Error(auth.error);

  const supabase = await createClient();
  const [vehiclesRes, typesRes, driversRes] = await Promise.all([
    supabase
      .from("vehicles")
      .select(
        "id, bike_id, reg_number, make, model, project_type, status, vehicle_type_key, created_at",
      )
      .order("bike_id"),
    supabase.from("vehicle_types").select("key, label_en, label_ar"),
    supabase
      .from("drivers")
      .select("id, driver_code, vehicle_id, profiles(full_name)")
      .not("vehicle_id", "is", null)
      .is("archived_at", null),
  ]);

  if (vehiclesRes.error) throw new Error(vehiclesRes.error.message);

  const typeLabels = new Map(
    ((typesRes.data ?? []) as Array<{ key: string; label_en: string; label_ar: string }>).map(
      (row) => [row.key, row],
    ),
  );
  const assigned = new Map<
    string,
    { id: string; driver_code: string; name: string | null }
  >();
  for (const row of (driversRes.data ?? []) as Array<{
    id: string;
    driver_code: string;
    vehicle_id: string | null;
    profiles: { full_name: string | null } | { full_name: string | null }[] | null;
  }>) {
    if (!row.vehicle_id) continue;
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    assigned.set(row.vehicle_id, {
      id: row.id,
      driver_code: row.driver_code,
      name: profile?.full_name ?? null,
    });
  }

  void logAdminRead("vehicles", "/vehicles");

  return ((vehiclesRes.data ?? []) as Array<{
    id: string;
    bike_id: string;
    reg_number: string | null;
    make: string | null;
    model: string | null;
    project_type: VehicleProjectType;
    status: VehicleStatus;
    vehicle_type_key: string;
    created_at: string;
  }>).map((row) => {
    const driver = assigned.get(row.id);
    const type = typeLabels.get(row.vehicle_type_key);
    return {
      ...row,
      vehicle_type_label: type?.label_en ?? row.vehicle_type_key,
      assigned_driver_id: driver?.id ?? null,
      assigned_driver_name: driver?.name ?? null,
      assigned_driver_code: driver?.driver_code ?? null,
    };
  });
}

export async function getVehicle(id: string): Promise<VehicleListRow | null> {
  const rows = await listVehicles();
  return rows.find((row) => row.id === id) ?? null;
}

export async function saveVehicle(
  formData: FormData,
): Promise<{ error?: string; id?: string }> {
  const auth = await requireVehicles("vehicles.manage");
  if ("error" in auth) return auth;

  const id = String(formData.get("id") ?? "").trim();
  const bikeId = String(formData.get("bikeId") ?? "").trim();
  const regNumber = String(formData.get("regNumber") ?? "").trim();
  const make = String(formData.get("make") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const vehicleTypeKey = String(formData.get("vehicleTypeKey") ?? "bike").trim() || "bike";
  const projectType = String(formData.get("projectType") ?? "group") as VehicleProjectType;
  const status = String(formData.get("status") ?? "active") as VehicleStatus;

  if (!bikeId) return { error: "missing_fields" };

  const supabase = await createClient();
  const payload = {
    bike_id: bikeId,
    reg_number: regNumber || null,
    make: make || null,
    model: model || null,
    vehicle_type_key: vehicleTypeKey,
    project_type: projectType,
    status,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    const { error } = await supabase.from("vehicles").update(payload).eq("id", id);
    if (error) return { error: formatError(error) };
    void logAdminMutation({
      action: "update",
      entityType: "vehicle",
      entityId: id,
      routeName: "/vehicles",
      after: payload,
    });
    return { id };
  }

  const { data, error } = await supabase
    .from("vehicles")
    .insert({ ...payload, created_by: auth.session.id })
    .select("id")
    .single();
  if (error) return { error: formatError(error) };
  void logAdminMutation({
    action: "create",
    entityType: "vehicle",
    entityId: data.id,
    routeName: "/vehicles",
    after: payload,
  });
  return { id: data.id };
}

export async function updateVehicleTypeLabel(formData: FormData): Promise<{ error?: string }> {
  const auth = await requireVehicles("vehicles.manage");
  if ("error" in auth) return auth;

  const key = String(formData.get("key") ?? "").trim();
  const labelEn = String(formData.get("labelEn") ?? "").trim();
  const labelAr = String(formData.get("labelAr") ?? "").trim();
  if (!key || !labelEn || !labelAr) return { error: "missing_fields" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("vehicle_types")
    .update({ label_en: labelEn, label_ar: labelAr })
    .eq("key", key);
  if (error) return { error: formatError(error) };

  void logAdminMutation({
    action: "update",
    entityType: "vehicle_type",
    entityId: key,
    routeName: "/settings/vehicle-types",
    after: { label_en: labelEn, label_ar: labelAr },
  });
  return {};
}
