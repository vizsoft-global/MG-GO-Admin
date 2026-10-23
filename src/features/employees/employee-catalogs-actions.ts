"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { logAdminActivity } from "@/lib/audit/log-admin-activity";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  CATALOG_KEY_RE,
  mergeCatalogRows,
  parseCatalogRow,
  seedsForKind,
  type EmployeeCatalogKind,
  type EmployeeCatalogRow,
} from "./employee-catalogs";

const KIND_COLLECTION: Record<EmployeeCatalogKind, string> = {
  employee_statuses: COLLECTIONS.employeeStatuses,
  employee_sections: COLLECTIONS.employeeSections,
  nationality_categories: COLLECTIONS.nationalityCategories,
  bank_codes: COLLECTIONS.bankCodes,
  sponsorships: COLLECTIONS.sponsorships,
};

export type EmployeeCatalogError =
  | "not_authorized"
  | "not_configured"
  | "invalid_key"
  | "missing_fields"
  | "system_status_locked"
  | "save_failed";

async function requireManage() {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, "drivers.manage", session.isSuperAdmin)) {
    throw new Error("not_authorized");
  }
}

async function requireView() {
  const session = await getSessionUser();
  if (!session) throw new Error("not_authorized");
}

export async function listEmployeeCatalog(kind: EmployeeCatalogKind): Promise<EmployeeCatalogRow[]> {
  await requireView();
  const db = await staffDb();
  if (!db) return mergeCatalogRows([], seedsForKind(kind));
  const snap = await db.collection(KIND_COLLECTION[kind]).get();
  const stored = snap.docs
    .map((doc) => parseCatalogRow({ key: doc.id, ...doc.data() }))
    .filter((row): row is EmployeeCatalogRow => row !== null);
  return mergeCatalogRows(stored, seedsForKind(kind));
}

export async function upsertEmployeeCatalog(input: {
  kind: EmployeeCatalogKind;
  key: string;
  labelEn: string;
  labelAr: string;
  isActive: boolean;
  sortOrder?: number;
  color?: string | null;
  /** `employee_sections` only: false removes the zone/restaurant requirement. */
  isOperational?: boolean;
}): Promise<{ ok: true } | { error: EmployeeCatalogError }> {
  try {
    await requireManage();
  } catch {
    return { error: "not_authorized" };
  }
  const key = input.key.trim().toLowerCase();
  const labelEn = input.labelEn.trim();
  if (!CATALOG_KEY_RE.test(key)) return { error: "invalid_key" };
  if (!labelEn) return { error: "missing_fields" };

  const { error } = await callAdminFunction("admin_upsert_employee_catalog", {
    kind: input.kind,
    key,
    labelEn,
    labelAr: input.labelAr.trim() || labelEn,
    isActive: input.isActive,
    sortOrder: input.sortOrder ?? 100,
    color: input.color ?? null,
    isOperational: input.isOperational,
  });
  if (error) {
    const code = error.message;
    if (code === "system_status_locked" || code === "invalid_key" || code === "missing_fields") {
      return { error: code };
    }
    return { error: "save_failed" };
  }

  void logAdminActivity({
    action: "update",
    entityType: "employee_catalog",
    entityId: `${input.kind}:${key}`,
    context: { kind: input.kind, key, is_active: input.isActive },
  });
  revalidatePath("/operations");
  revalidatePath("/settings/employee-statuses");
  revalidatePath("/settings/employee-sections");
  revalidatePath("/settings/nationality-categories");
  revalidatePath("/settings/bank-codes");
  return { ok: true };
}
