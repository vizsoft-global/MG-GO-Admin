"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import { logAdminActivity } from "@/lib/audit/log-admin-activity";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
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

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function mapUseType(row: Row): VehicleUseType {
  return {
    key: str(row.key) || row.id,
    label_en: str(row.label_en),
    label_ar: str(row.label_ar),
    is_active: row.is_active !== false,
    is_system: row.is_system === true,
    sort_order: Number(row.sort_order ?? 0),
  };
}

async function requireSlug(slug: Permission) {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, slug, session.isSuperAdmin)) {
    throw new Error("not_authorized");
  }
}

async function requireStaff() {
  const session = await getSessionUser();
  if (!session) throw new Error("not_authorized");
}

export async function listVehicleUseTypes(): Promise<VehicleUseType[]> {
  await requireStaff();
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.vehicleUseTypes).get();
  return snap.docs
    .map((doc) => mapUseType(asRow(doc.id, doc.data())))
    .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
}

export async function listVehicleUseTypesWithUsage(): Promise<VehicleUseTypeWithUsage[]> {
  await requireSlug("vehicles.manage");
  const db = await openDb();
  const [types, vehiclesSnap] = await Promise.all([
    listVehicleUseTypes(),
    db.collection(COLLECTIONS.vehicles).select("type_of_use").get(),
  ]);
  const counts = new Map<string, number>();
  for (const doc of vehiclesSnap.docs) {
    const typeOfUse = str(doc.data().type_of_use);
    if (typeOfUse) counts.set(typeOfUse, (counts.get(typeOfUse) ?? 0) + 1);
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
    await requireSlug("vehicles.manage");
  } catch {
    return { error: "not_authorized" };
  }
  const key = input.key.trim().toLowerCase();
  const labelEn = input.labelEn.trim();
  const labelAr = input.labelAr.trim() || labelEn;
  if (!USE_TYPE_KEY_RE.test(key)) return { error: "invalid_use_type_key" };
  if (!labelEn || labelEn.length > 80) return { error: "invalid_use_type_label" };

  const db = await openDb();
  const beforeSnap = await db.collection(COLLECTIONS.vehicleUseTypes).doc(key).get();
  let before = beforeSnap.exists
    ? {
        key,
        label_en: str(beforeSnap.data()?.label_en),
        label_ar: str(beforeSnap.data()?.label_ar),
        is_active: beforeSnap.data()?.is_active !== false,
      }
    : null;
  if (!before) {
    const byField = await db
      .collection(COLLECTIONS.vehicleUseTypes)
      .where("key", "==", key)
      .limit(1)
      .get();
    const data = byField.docs[0]?.data();
    if (data) {
      before = {
        key,
        label_en: str(data.label_en),
        label_ar: str(data.label_ar),
        is_active: data.is_active !== false,
      };
    }
  }
  if (input.isNew && before) return { error: "invalid_use_type_key" };

  const { error } = await callAdminFunction("admin_upsert_vehicle_use_type", {
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
