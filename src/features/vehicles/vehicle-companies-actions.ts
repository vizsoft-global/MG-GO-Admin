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
  COMPANY_KEY_RE,
  type VehicleCompany,
  type VehicleCompanyWithUsage,
} from "./vehicle-companies";

export type VehicleCompanyError =
  | "not_authorized"
  | "invalid_company_key"
  | "invalid_company_label"
  | "save_failed";

const KNOWN = new Set<string>([
  "not_authorized",
  "invalid_company_key",
  "invalid_company_label",
  "invalid_key",
  "missing_fields",
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

function mapCompany(row: Row): VehicleCompany {
  return {
    key: str(row.key) || row.id,
    label_en: str(row.label_en),
    label_ar: str(row.label_ar),
    is_active: row.is_active !== false,
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

export async function listVehicleCompanies(): Promise<VehicleCompany[]> {
  await requireStaff();
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.vehicleCompanies).get();
  return snap.docs
    .map((doc) => mapCompany(asRow(doc.id, doc.data())))
    .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
}

export async function listVehicleCompaniesWithUsage(): Promise<VehicleCompanyWithUsage[]> {
  await requireSlug("vehicles.manage");
  const db = await openDb();
  const [companies, vehiclesSnap] = await Promise.all([
    listVehicleCompanies(),
    db.collection(COLLECTIONS.vehicles).select("company_id", "status").get(),
  ]);
  const counts = new Map<string, number>();
  for (const doc of vehiclesSnap.docs) {
    const data = doc.data();
    if (data.status !== "active") continue;
    const companyId = str(data.company_id);
    if (companyId) counts.set(companyId, (counts.get(companyId) ?? 0) + 1);
  }
  return companies.map((item) => ({
    ...item,
    vehicle_count: counts.get(item.key) ?? 0,
  }));
}

export async function upsertVehicleCompany(input: {
  key: string;
  labelEn: string;
  labelAr: string;
  isActive: boolean;
  isNew: boolean;
}): Promise<{ ok: true } | { error: VehicleCompanyError }> {
  try {
    await requireSlug("vehicles.manage");
  } catch {
    return { error: "not_authorized" };
  }
  const key = input.key.trim().toLowerCase();
  const labelEn = input.labelEn.trim();
  const labelAr = input.labelAr.trim() || labelEn;
  if (!COMPANY_KEY_RE.test(key)) return { error: "invalid_company_key" };
  if (!labelEn || labelEn.length > 80) return { error: "invalid_company_label" };

  const db = await openDb();
  const beforeSnap = await db.collection(COLLECTIONS.vehicleCompanies).doc(key).get();
  if (input.isNew && beforeSnap.exists) return { error: "invalid_company_key" };

  const { error } = await callAdminFunction("admin_upsert_vehicle_company", {
    p_key: key,
    p_label_en: labelEn,
    p_label_ar: labelAr,
    p_is_active: input.isActive,
  });
  if (error) {
    const code = KNOWN.has(error.message) ? error.message : "save_failed";
    return {
      error:
        code === "invalid_key"
          ? "invalid_company_key"
          : code === "missing_fields"
            ? "invalid_company_label"
            : (code as VehicleCompanyError),
    };
  }

  const before = beforeSnap.exists
    ? {
        key,
        label_en: str(beforeSnap.data()?.label_en),
        label_ar: str(beforeSnap.data()?.label_ar),
        is_active: beforeSnap.data()?.is_active !== false,
      }
    : null;

  void logAdminActivity({
    action: input.isNew ? "create" : "update",
    entityType: "vehicle_companies",
    entityId: key,
    routeName: "upsertVehicleCompany",
    before,
    after: { key, label_en: labelEn, label_ar: labelAr, is_active: input.isActive },
  });
  revalidatePath("/[locale]/(dashboard)/settings/vehicle-companies", "page");
  revalidatePath("/[locale]/(dashboard)/vehicles", "page");
  revalidatePath("/[locale]/(dashboard)/fleet", "page");
  return { ok: true };
}
