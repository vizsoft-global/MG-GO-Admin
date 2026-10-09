"use server";

import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { putObject } from "@/lib/storage/r2-client";
import { buildVehicleFileKey, extensionFromMime } from "@/lib/storage/r2-keys";
import { syncIntakeAssetAssignments } from "@/features/assets/assets-actions";
import type { DocumentData, Firestore } from "firebase-admin/firestore";

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
  projectKey: string | null;
};

const HANDOVERS = "vehicle_handovers";
const ACCIDENTS = "vehicle_accidents";
const DOCUMENTS = "vehicle_documents";
const SERVICES = "vehicle_services";

type Row = Record<string, unknown> & { id: string };

function plainValue(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if ("toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(plainValue);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = plainValue(child);
  }
  return out;
}

function asRow(id: string, data: DocumentData | undefined): Row {
  return { id, ...((plainValue(data ?? {}) as Record<string, unknown>) ?? {}) };
}

async function openDb(): Promise<Firestore> {
  const db = await staffDb();
  if (!db) throw new Error("not_configured");
  return db;
}

async function rowsByIds(db: Firestore, collection: string, ids: string[]): Promise<Map<string, Row>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, Row>();
  for (let i = 0; i < unique.length; i += 100) {
    const refs = unique.slice(i, i + 100).map((id) => db.collection(collection).doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) map.set(snap.id, asRow(snap.id, snap.data()));
    }
  }
  return map;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

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

function isFutureYmd(ymd: string): boolean {
  return ymd.localeCompare(kuwaitTodayYmd()) > 0;
}

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

async function byVehicle(db: Firestore, collection: string, vehicleId: string, orderField: string) {
  const snap = await db.collection(collection).where("vehicle_id", "==", vehicleId).get();
  return snap.docs
    .map((doc) => asRow(doc.id, doc.data()))
    .sort((a, b) => str(b[orderField]).localeCompare(str(a[orderField])));
}

export async function listVehicleTabDrivers(): Promise<VehicleDriverOption[]> {
  const auth = await requireVehicles("vehicles.view");
  if ("error" in auth) return [];
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.drivers).where("archived_at", "==", null).get();
  const profiles = await rowsByIds(db, COLLECTIONS.profiles, snap.docs.map((doc) => doc.id));
  return snap.docs
    .map((doc) => asRow(doc.id, doc.data()))
    .sort((a, b) => str(a.employee_id).localeCompare(str(b.employee_id)))
    .map((row) => {
      const name = str(profiles.get(row.id)?.full_name);
      const employeeId = str(row.employee_id);
      const driverCode = str(row.driver_code);
      return {
        id: row.id,
        label: [name, employeeId || driverCode].filter(Boolean).join(" · "),
        keywords: [name, employeeId, driverCode].filter(Boolean),
        projectKey: str(row.project_key) || null,
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
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.assetCatalog).where("is_active", "==", true).get();
  return snap.docs
    .map((doc) => asRow(doc.id, doc.data()))
    .sort((a, b) => str(a.name).localeCompare(str(b.name)))
    .map((row) => ({
      id: row.id,
      label: str(row.code) ? `${str(row.name)} · ${str(row.code)}` : str(row.name),
      keywords: [str(row.name), str(row.code)].filter(Boolean),
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

  const db = await openDb();
  const intakes = await db
    .collection(COLLECTIONS.driverIntakes)
    .where("linked_profile_id", "==", driverId)
    .where("archived_at", "==", null)
    .limit(2)
    .get();
  if (intakes.size !== 1) return { error: intakes.empty ? "missing_fields" : "save_failed" };
  const intake = intakes.docs[0];
  if (!intake) return { error: "missing_fields" };

  const current = await db
    .collection(COLLECTIONS.assetAssignments)
    .where("intake_id", "==", intake.id)
    .where("status", "==", "assigned")
    .get();
  const nextIds = [
    ...new Set([
      ...current.docs.map((doc) => str(doc.data().catalog_item_id)).filter(Boolean),
      catalogItemId,
    ]),
  ];
  const synced = await syncIntakeAssetAssignments(null, intake.id, nextIds, session.id, driverId);
  if (synced.error) return { error: synced.error };

  if (quantity !== 1) {
    const assigned = await db
      .collection(COLLECTIONS.assetAssignments)
      .where("intake_id", "==", intake.id)
      .where("catalog_item_id", "==", catalogItemId)
      .where("status", "==", "assigned")
      .get();
    try {
      await Promise.all(
        assigned.docs.map((doc) =>
          doc.ref.set({ quantity, updated_at: new Date() }, { merge: true }),
        ),
      );
    } catch {
      return { error: "save_failed" };
    }
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

export async function listVehicleHandovers(vehicleId: string): Promise<VehicleHandoverRow[]> {
  const auth = await requireVehicles("vehicles.view");
  if ("error" in auth) return [];
  const db = await openDb();
  const rows = await byVehicle(db, HANDOVERS, vehicleId, "handed_at");
  const ids = [
    ...new Set(rows.flatMap((row) => [str(row.from_driver_id), str(row.to_driver_id)].filter(Boolean))),
  ];
  const profiles = ids.length ? await rowsByIds(db, COLLECTIONS.profiles, ids) : new Map<string, Row>();
  return rows.map((row) => ({
    id: row.id,
    handed_at: str(row.handed_at),
    from_driver_id: str(row.from_driver_id) || null,
    to_driver_id: str(row.to_driver_id) || null,
    from_name: str(profiles.get(str(row.from_driver_id))?.full_name) || null,
    to_name: str(profiles.get(str(row.to_driver_id))?.full_name) || null,
    notes: str(row.notes) || null,
    storage_key: str(row.storage_key) || null,
  }));
}

export async function listVehicleAccidents(vehicleId: string): Promise<VehicleAccidentRow[]> {
  const auth = await requireVehicles("vehicles.view");
  if ("error" in auth) return [];
  const db = await openDb();
  const rows = await byVehicle(db, ACCIDENTS, vehicleId, "occurred_at");
  return rows.map((row) => ({
    id: row.id,
    occurred_at: str(row.occurred_at),
    location_text: str(row.location_text) || null,
    severity: str(row.severity),
    notes: str(row.notes) || null,
    storage_key: str(row.storage_key) || null,
  }));
}

export async function listVehicleDocuments(vehicleId: string): Promise<VehicleDocumentRow[]> {
  const auth = await requireVehicles("vehicles.view");
  if ("error" in auth) return [];
  const db = await openDb();
  const rows = await byVehicle(db, DOCUMENTS, vehicleId, "created_at");
  return rows.map((row) => ({
    id: row.id,
    doc_type: str(row.doc_type),
    storage_key: str(row.storage_key),
    file_name: str(row.file_name) || null,
    expires_at: str(row.expires_at) || null,
  }));
}

export async function listVehicleServices(vehicleId: string): Promise<VehicleServiceRow[]> {
  const auth = await requireVehicles("vehicles.view");
  if ("error" in auth) return [];
  const db = await openDb();
  const rows = await byVehicle(db, SERVICES, vehicleId, "serviced_at");
  return rows.map((row) => ({
    id: row.id,
    serviced_at: str(row.serviced_at),
    kind: str(row.kind),
    odometer: row.odometer == null ? null : Number(row.odometer),
    vendor: str(row.vendor) || null,
    cost_kwd: row.cost_kwd == null ? null : Number(row.cost_kwd),
    notes: str(row.notes) || null,
  }));
}

export async function listVehicleAssignedAssets(driverId: string | null): Promise<VehicleAssetRow[]> {
  const auth = await requireVehicles("vehicles.view");
  if ("error" in auth || !driverId) return [];
  const db = await openDb();
  const snap = await db
    .collection(COLLECTIONS.assetAssignments)
    .where("driver_id", "==", driverId)
    .where("status", "==", "assigned")
    .get();
  const rows = snap.docs
    .map((doc) => asRow(doc.id, doc.data()))
    .sort((a, b) => str(b.assigned_at).localeCompare(str(a.assigned_at)));
  const catalog = await rowsByIds(
    db,
    COLLECTIONS.assetCatalog,
    rows.map((row) => str(row.catalog_item_id)).filter(Boolean),
  );
  return rows.map((row) => {
    const item = catalog.get(str(row.catalog_item_id));
    return {
      id: row.id,
      name: str(item?.name) || "—",
      code: str(item?.code) || null,
      quantity: row.quantity == null ? 1 : Number(row.quantity),
      assigned_at: str(row.assigned_at) || null,
    };
  });
}

async function insertRow(collection: string, data: Record<string, unknown>) {
  const db = await openDb();
  const id = crypto.randomUUID();
  await db.collection(collection).doc(id).set({ id, ...data, created_at: new Date() });
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
  try {
    await insertRow(HANDOVERS, {
      vehicle_id: vehicleId,
      handed_at: new Date(handedAt),
      from_driver_id: fromDriverId,
      to_driver_id: toDriverId,
      notes: empty(formData.get("notes")) || null,
      storage_key: uploaded.key,
      created_by: auth.session.id,
    });
  } catch {
    return { error: "save_failed" };
  }
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
  try {
    await insertRow(ACCIDENTS, {
      vehicle_id: vehicleId,
      occurred_at: new Date(occurredAt),
      location_text: locationText,
      severity,
      notes: empty(formData.get("notes")) || null,
      storage_key: uploaded.key,
      created_by: auth.session.id,
    });
  } catch {
    return { error: "save_failed" };
  }
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
  try {
    await insertRow(DOCUMENTS, {
      vehicle_id: vehicleId,
      doc_type: docType,
      storage_key: uploaded.key,
      file_name: file.name.slice(0, 180),
      expires_at: expiresAt || null,
      created_by: auth.session.id,
    });
  } catch {
    return { error: "save_failed" };
  }
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
  try {
    await insertRow(SERVICES, {
      vehicle_id: vehicleId,
      serviced_at: new Date(servicedAt),
      kind,
      odometer: odometerRaw ? Number(odometerRaw) : null,
      vendor: empty(formData.get("vendor")) || null,
      cost_kwd: costRaw ? Number(costRaw) : null,
      notes: empty(formData.get("notes")) || null,
      created_by: auth.session.id,
    });
  } catch {
    return { error: "save_failed" };
  }
  void logAdminMutation({
    action: "create",
    entityType: "vehicle_service",
    entityId: vehicleId,
    routeName: "/vehicles",
  });
  return {};
}
