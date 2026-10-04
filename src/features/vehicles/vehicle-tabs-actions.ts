"use server";

import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { putObject } from "@/lib/storage/r2-client";
import { buildVehicleFileKey, extensionFromMime } from "@/lib/storage/r2-keys";
import { createClient } from "@/lib/supabase/server";
import { syncIntakeAssetAssignments } from "@/features/assets/assets-actions";

export type VehicleHandoverRow = {
  id: string;
  handed_at: string;
  from_driver_id: string | null;
  to_driver_id: string | null;
  from_name: string | null;
  to_name: string | null;
  notes: string | null;
  storage_key: string | null;
};

export type VehicleAccidentRow = {
  id: string;
  occurred_at: string;
  location_text: string | null;
  severity: string;
  notes: string | null;
  storage_key: string | null;
};

export type VehicleDocumentRow = {
  id: string;
  doc_type: string;
  storage_key: string;
  file_name: string | null;
  expires_at: string | null;
};

export type VehicleServiceRow = {
  id: string;
  serviced_at: string;
  kind: string;
  odometer: number | null;
  vendor: string | null;
  cost_kwd: number | null;
  notes: string | null;
};

export type VehicleAssetRow = {
  id: string;
  name: string;
  code: string | null;
  quantity: number;
  assigned_at: string | null;
};

export type VehicleDriverOption = {
  id: string;
  label: string;
  keywords: string[];
};

async function requireVehicles(permission: "vehicles.view" | "vehicles.manage") {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, permission, session.isSuperAdmin)) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

function empty(value: FormDataEntryValue | null): string {
  return String(value ?? "").trim();
}

/** A calendar date (YYYY-MM-DD) that is later than today in Asia/Kuwait. */
function isFutureYmd(ymd: string): boolean {
  return ymd.localeCompare(kuwaitTodayYmd()) > 0;
}

/** A datetime-local value that is later than now, with a one-minute clock-skew tolerance. */
function isFutureDateTime(value: string): boolean {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() > Date.now() + 60_000;
}

async function uploadOptional(
  vehicleId: string,
  folder: string,
  file: File | null,
  userId: string,
): Promise<{ key: string | null } | { error: string }> {
  if (!file || file.size === 0) return { key: null };
  if (file.size > 8 * 1024 * 1024) return { error: "file_too_large" };
  const ext = extensionFromMime(file.type);
  const key = buildVehicleFileKey(vehicleId, folder, ext);
  try {
    await putObject(key, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream", {
      uploadedBy: userId,
      entityType: "vehicle",
      entityId: vehicleId,
      uploadedVia: "admin",
    });
  } catch {
    return { error: "upload_failed" };
  }
  return { key };
}

export async function listVehicleTabDrivers(): Promise<VehicleDriverOption[]> {
  const auth = await requireVehicles("vehicles.view");
  if ("error" in auth) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("drivers")
    .select("id, driver_code, employee_id, profiles!drivers_id_fkey(full_name)")
    .is("archived_at", null)
    .order("employee_id");
  return ((data ?? []) as Array<{
    id: string;
    driver_code: string | null;
    employee_id: string | null;
    profiles: { full_name: string | null } | { full_name: string | null }[] | null;
  }>).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: row.id,
      label: [profile?.full_name, row.employee_id || row.driver_code].filter(Boolean).join(" · "),
      keywords: [profile?.full_name, row.employee_id, row.driver_code].filter(Boolean) as string[],
    };
  });
}

export type VehicleAssetCatalogOption = {
  id: string;
  label: string;
  keywords: string[];
};

export async function listVehicleAssetCatalog(): Promise<VehicleAssetCatalogOption[]> {
  const session = await getSessionUser();
  if (
    !session ||
    !(
      session.isSuperAdmin ||
      hasPermissionInSet(session.permissions, "assets.view", false) ||
      hasPermissionInSet(session.permissions, "vehicles.manage", false)
    )
  ) {
    return [];
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asset_catalog")
    .select("id, name, code")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    label: row.code ? `${row.name} · ${row.code}` : row.name,
    keywords: [row.name, row.code].filter(Boolean) as string[],
  }));
}

export async function assignVehicleAsset(input: {
  driverId: string;
  catalogItemId: string;
  quantity: number;
}): Promise<{ error?: string }> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "assets.manage", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" };
  }
  const driverId = input.driverId.trim();
  const catalogItemId = input.catalogItemId.trim();
  const quantity = Number.isFinite(input.quantity) ? Math.max(1, Math.floor(input.quantity)) : 1;
  if (!driverId || !catalogItemId) return { error: "missing_fields" };

  const supabase = await createClient();
  const { data: intake, error: intakeError } = await supabase
    .from("driver_intakes")
    .select("id")
    .eq("linked_profile_id", driverId)
    .is("archived_at", null)
    .maybeSingle();
  if (intakeError) return { error: "save_failed" };
  if (!intake) return { error: "missing_fields" };

  const { data: current, error: currentError } = await supabase
    .from("asset_assignments")
    .select("catalog_item_id")
    .eq("intake_id", intake.id)
    .eq("status", "assigned");
  if (currentError) return { error: "save_failed" };

  const nextIds = [...new Set([...(current ?? []).map((row) => row.catalog_item_id), catalogItemId])];
  const synced = await syncIntakeAssetAssignments(
    supabase,
    intake.id,
    nextIds,
    session.id,
    driverId,
  );
  if (synced.error) return { error: synced.error };

  if (quantity !== 1) {
    const { error: qtyError } = await supabase
      .from("asset_assignments")
      .update({ quantity, updated_at: new Date().toISOString() })
      .eq("intake_id", intake.id)
      .eq("catalog_item_id", catalogItemId)
      .eq("status", "assigned");
    if (qtyError) return { error: "save_failed" };
  }

  void logAdminMutation({
    action: "update",
    entityType: "asset_assignment",
    entityId: driverId,
    routeName: "/vehicles",
    after: { catalog_item_id: catalogItemId, quantity },
  });
  return {};
}

function nameMap(
  rows: Array<{ id: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    if (profile?.full_name) map.set(row.id, profile.full_name);
  }
  return map;
}

export async function listVehicleHandovers(vehicleId: string): Promise<VehicleHandoverRow[]> {
  const auth = await requireVehicles("vehicles.view");
  if ("error" in auth) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicle_handovers")
    .select("id, handed_at, from_driver_id, to_driver_id, notes, storage_key")
    .eq("vehicle_id", vehicleId)
    .order("handed_at", { ascending: false });
  if (error) throw new Error(error.message);
  const ids = [
    ...new Set(
      (data ?? []).flatMap((row) => [row.from_driver_id, row.to_driver_id].filter(Boolean) as string[]),
    ),
  ];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: drivers } = await supabase
      .from("drivers")
      .select("id, profiles!drivers_id_fkey(full_name)")
      .in("id", ids);
    for (const [id, name] of nameMap((drivers ?? []) as never)) names.set(id, name);
  }
  return (data ?? []).map((row) => ({
    ...row,
    from_name: row.from_driver_id ? names.get(row.from_driver_id) ?? null : null,
    to_name: row.to_driver_id ? names.get(row.to_driver_id) ?? null : null,
  }));
}

export async function listVehicleAccidents(vehicleId: string): Promise<VehicleAccidentRow[]> {
  const auth = await requireVehicles("vehicles.view");
  if ("error" in auth) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicle_accidents")
    .select("id, occurred_at, location_text, severity, notes, storage_key")
    .eq("vehicle_id", vehicleId)
    .order("occurred_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listVehicleDocuments(vehicleId: string): Promise<VehicleDocumentRow[]> {
  const auth = await requireVehicles("vehicles.view");
  if ("error" in auth) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicle_documents")
    .select("id, doc_type, storage_key, file_name, expires_at")
    .eq("vehicle_id", vehicleId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listVehicleServices(vehicleId: string): Promise<VehicleServiceRow[]> {
  const auth = await requireVehicles("vehicles.view");
  if ("error" in auth) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicle_services")
    .select("id, serviced_at, kind, odometer, vendor, cost_kwd, notes")
    .eq("vehicle_id", vehicleId)
    .order("serviced_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listVehicleAssignedAssets(driverId: string | null): Promise<VehicleAssetRow[]> {
  const auth = await requireVehicles("vehicles.view");
  if ("error" in auth || !driverId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asset_assignments")
    .select("id, quantity, assigned_at, catalog_item_id, asset_catalog(name, code)")
    .eq("driver_id", driverId)
    .eq("status", "assigned")
    .order("assigned_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{
    id: string;
    quantity: number | null;
    assigned_at: string | null;
    asset_catalog: { name: string; code: string | null } | { name: string; code: string | null }[] | null;
  }>).map((row) => {
    const catalog = Array.isArray(row.asset_catalog) ? row.asset_catalog[0] : row.asset_catalog;
    return {
      id: row.id,
      name: catalog?.name ?? "—",
      code: catalog?.code ?? null,
      quantity: row.quantity ?? 1,
      assigned_at: row.assigned_at,
    };
  });
}

export async function createVehicleHandover(formData: FormData): Promise<{ error?: string }> {
  const auth = await requireVehicles("vehicles.manage");
  if ("error" in auth) return auth;
  const vehicleId = empty(formData.get("vehicleId"));
  const handedAt = empty(formData.get("handedAt"));
  const fromDriverId = empty(formData.get("fromDriverId"));
  const toDriverId = empty(formData.get("toDriverId"));
  if (!vehicleId || !handedAt) return { error: "missing_fields" };
  if (!fromDriverId || !toDriverId) return { error: "invalid_drivers" };
  if (fromDriverId === toDriverId) return { error: "same_driver" };
  const file = formData.get("file");
  const uploaded = await uploadOptional(
    vehicleId,
    "handovers",
    file instanceof File ? file : null,
    auth.session.id,
  );
  if ("error" in uploaded) return { error: uploaded.error };
  const supabase = await createClient();
  const { error } = await supabase.from("vehicle_handovers").insert({
    vehicle_id: vehicleId,
    handed_at: new Date(handedAt).toISOString(),
    from_driver_id: fromDriverId,
    to_driver_id: toDriverId,
    notes: empty(formData.get("notes")) || null,
    storage_key: uploaded.key,
    created_by: auth.session.id,
  });
  if (error) return { error: "save_failed" };
  void logAdminMutation({
    action: "create",
    entityType: "vehicle_handover",
    entityId: vehicleId,
    routeName: "/vehicles",
  });
  return {};
}

export async function createVehicleAccident(formData: FormData): Promise<{ error?: string }> {
  const auth = await requireVehicles("vehicles.manage");
  if ("error" in auth) return auth;
  const vehicleId = empty(formData.get("vehicleId"));
  const occurredAt = empty(formData.get("occurredAt"));
  const severity = empty(formData.get("severity")) || "medium";
  if (!vehicleId || !occurredAt) return { error: "missing_fields" };
  if (isFutureDateTime(occurredAt)) return { error: "future_date" };
  const locationText = empty(formData.get("locationText"));
  if (!locationText) return { error: "location_required" };
  if (!["low", "medium", "high"].includes(severity)) return { error: "missing_fields" };
  const file = formData.get("file");
  const uploaded = await uploadOptional(
    vehicleId,
    "accidents",
    file instanceof File ? file : null,
    auth.session.id,
  );
  if ("error" in uploaded) return { error: uploaded.error };
  const supabase = await createClient();
  const { error } = await supabase.from("vehicle_accidents").insert({
    vehicle_id: vehicleId,
    occurred_at: new Date(occurredAt).toISOString(),
    location_text: locationText,
    severity,
    notes: empty(formData.get("notes")) || null,
    storage_key: uploaded.key,
    created_by: auth.session.id,
  });
  if (error) return { error: "save_failed" };
  void logAdminMutation({
    action: "create",
    entityType: "vehicle_accident",
    entityId: vehicleId,
    routeName: "/vehicles",
  });
  return {};
}

export async function createVehicleDocument(formData: FormData): Promise<{ error?: string }> {
  const auth = await requireVehicles("vehicles.manage");
  if ("error" in auth) return auth;
  const vehicleId = empty(formData.get("vehicleId"));
  const docType = empty(formData.get("docType"));
  const file = formData.get("file");
  if (!vehicleId || !docType || !(file instanceof File) || file.size === 0) {
    return { error: "missing_fields" };
  }
  if (!["registration", "insurance", "other"].includes(docType)) {
    return { error: "invalid_option" };
  }
  const uploaded = await uploadOptional(vehicleId, "docs", file, auth.session.id);
  if ("error" in uploaded) return { error: uploaded.error };
  if (!uploaded.key) return { error: "missing_fields" };
  const expiresAt = empty(formData.get("expiresAt"));
  if (expiresAt && expiresAt < kuwaitTodayYmd()) return { error: "expiry_in_past" };
  const supabase = await createClient();
  const { error } = await supabase.from("vehicle_documents").insert({
    vehicle_id: vehicleId,
    doc_type: docType,
    storage_key: uploaded.key,
    file_name: file.name.slice(0, 180),
    expires_at: expiresAt || null,
    created_by: auth.session.id,
  });
  if (error) return { error: "save_failed" };
  void logAdminMutation({
    action: "create",
    entityType: "vehicle_document",
    entityId: vehicleId,
    routeName: "/vehicles",
  });
  return {};
}

export async function createVehicleService(formData: FormData): Promise<{ error?: string }> {
  const auth = await requireVehicles("vehicles.manage");
  if ("error" in auth) return auth;
  const vehicleId = empty(formData.get("vehicleId"));
  const servicedAt = empty(formData.get("servicedAt"));
  const kind = empty(formData.get("kind")) || "service";
  if (!vehicleId || !servicedAt) return { error: "missing_fields" };
  if (isFutureYmd(servicedAt)) return { error: "future_date" };
  const odometerRaw = empty(formData.get("odometer"));
  const costRaw = empty(formData.get("costKwd"));
  const supabase = await createClient();
  const { error } = await supabase.from("vehicle_services").insert({
    vehicle_id: vehicleId,
    serviced_at: new Date(servicedAt).toISOString(),
    kind,
    odometer: odometerRaw ? Number(odometerRaw) : null,
    vendor: empty(formData.get("vendor")) || null,
    cost_kwd: costRaw ? Number(costRaw) : null,
    notes: empty(formData.get("notes")) || null,
    created_by: auth.session.id,
  });
  if (error) return { error: "save_failed" };
  void logAdminMutation({
    action: "create",
    entityType: "vehicle_service",
    entityId: vehicleId,
    routeName: "/vehicles",
  });
  return {};
}
