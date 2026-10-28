"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { logAdminActivity } from "@/lib/audit/log-admin-activity";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  deleteSponsorshipLogoFiles,
  resolveSponsorshipLogoUrl,
  uploadSponsorshipLogoFile,
  type SponsorshipLogoError,
} from "./sponsorship-logo";
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
  | "save_failed"
  | "logo_file_too_large"
  | "logo_invalid_type"
  | "logo_upload_failed";

async function requireManage(kind?: EmployeeCatalogKind) {
  const session = await getSessionUser();
  if (!session) throw new Error("not_authorized");
  const drivers = hasPermissionInSet(session.permissions, "drivers.manage", session.isSuperAdmin);
  const payroll =
    kind === "sponsorships" &&
    hasPermissionInSet(session.permissions, "payroll.manage", session.isSuperAdmin);
  if (!drivers && !payroll) throw new Error("not_authorized");
  return session;
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
  const merged = mergeCatalogRows(stored, seedsForKind(kind));
  if (kind !== "sponsorships") return merged;
  return Promise.all(
    merged.map(async (row) => ({
      ...row,
      logo_display_url: await resolveSponsorshipLogoUrl(row.logo_url),
    })),
  );
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
  /** `sponsorships` only. */
  logoFile?: File | null;
  removeLogo?: boolean;
}): Promise<{ ok: true } | { error: EmployeeCatalogError }> {
  let actorId = "staff";
  try {
    actorId = (await requireManage(input.kind)).id;
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
  revalidatePath("/settings/sponsorships");
  revalidatePath("/payroll");
  revalidatePath("/payroll-hub");

  if (input.kind === "sponsorships") {
    const logoError = await writeSponsorshipLogo(key, input, actorId);
    if (logoError) return { error: logoError };
  }
  return { ok: true };
}

const LOGO_ERROR: Record<SponsorshipLogoError, EmployeeCatalogError> = {
  file_too_large: "logo_file_too_large",
  invalid_type: "logo_invalid_type",
  upload_failed: "logo_upload_failed",
};

async function writeSponsorshipLogo(
  key: string,
  input: { logoFile?: File | null; removeLogo?: boolean },
  uploadedBy: string,
): Promise<EmployeeCatalogError | null> {
  const db = await staffDb();
  if (!db) return "not_configured";
  let logoUrl: string | null | undefined;
  if (input.removeLogo) {
    await deleteSponsorshipLogoFiles(key);
    logoUrl = null;
  } else if (input.logoFile instanceof File && input.logoFile.size > 0) {
    await deleteSponsorshipLogoFiles(key);
    const upload = await uploadSponsorshipLogoFile(key, input.logoFile, uploadedBy);
    if (upload.error) return LOGO_ERROR[upload.error];
    logoUrl = upload.logoUrl ?? null;
  }
  if (logoUrl === undefined) return null;
  await db.collection(COLLECTIONS.sponsorships).doc(key).set({ logo_url: logoUrl }, { merge: true });
  return null;
}
