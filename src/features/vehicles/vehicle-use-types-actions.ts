"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import { logAdminActivity } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import {
  USE_TYPE_KEY_RE,
  type VehicleUseType,
  type VehicleUseTypeWithUsage,
} from "./vehicle-use-types";

export type VehicleUseTypeError =
  | "not_authorized"
  | "invalid_use_type_key"
  | "invalid_use_type_label"
  | "vehicle_use_type_in_use"
  | "vehicle_use_type_system_locked"
  | "save_failed";

const KNOWN = new Set<string>([
  "not_authorized",
  "invalid_use_type_key",
  "invalid_use_type_label",
  "vehicle_use_type_in_use",
  "vehicle_use_type_system_locked",
]);

async function requireSlug(slug: Permission) {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, slug, session.isSuperAdmin)) {
    throw new Error("not_authorized");
  }
}

export async function listVehicleUseTypes(): Promise<VehicleUseType[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicle_use_types")
    .select("key, label_en, label_ar, is_active, is_system, sort_order")
    .order("sort_order", { ascending: true })
    .order("key", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as VehicleUseType[];
}

export async function listVehicleUseTypesWithUsage(): Promise<VehicleUseTypeWithUsage[]> {
  await requireSlug("settings.view");
  const supabase = await createClient();
  const [types, { data: vehicles, error }] = await Promise.all([
    listVehicleUseTypes(),
    supabase.from("vehicles").select("type_of_use"),
  ]);
  if (error) throw new Error(error.message);
  const counts = new Map<string, number>();
  for (const row of vehicles ?? []) {
    if (row.type_of_use) counts.set(row.type_of_use, (counts.get(row.type_of_use) ?? 0) + 1);
  }
  return types.map((item) => ({ ...item, vehicle_count: counts.get(item.key) ?? 0 }));
}

export async function upsertVehicleUseType(input: {
  key: string;
  labelEn: string;
  labelAr: string;
  isActive: boolean;
  isNew: boolean;
}): Promise<{ ok: true } | { error: VehicleUseTypeError }> {
  try {
    await requireSlug("settings.manage");
  } catch {
    return { error: "not_authorized" };
  }
  const key = input.key.trim().toLowerCase();
  const labelEn = input.labelEn.trim();
  const labelAr = input.labelAr.trim() || labelEn;
  if (!USE_TYPE_KEY_RE.test(key)) return { error: "invalid_use_type_key" };
  if (!labelEn || labelEn.length > 80) return { error: "invalid_use_type_label" };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("vehicle_use_types")
    .select("key, label_en, label_ar, is_active")
    .eq("key", key)
    .maybeSingle();
  if (input.isNew && before) return { error: "invalid_use_type_key" };

  const { error } = await supabase.rpc("admin_upsert_vehicle_use_type", {
    p_key: key,
    p_label_en: labelEn,
    p_label_ar: labelAr,
    p_is_active: input.isActive,
  });
  if (error) {
    const code = KNOWN.has(error.message) ? error.message : "save_failed";
    return { error: code as VehicleUseTypeError };
  }

  void logAdminActivity({
    action: input.isNew ? "create" : "update",
    entityType: "vehicle_use_types",
    entityId: key,
    routeName: "upsertVehicleUseType",
    before: before ?? null,
    after: { key, label_en: labelEn, label_ar: labelAr, is_active: input.isActive },
  });
  revalidatePath("/[locale]/(dashboard)/settings/vehicle-uses", "page");
  return { ok: true };
}
