"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { logAdminActivity } from "@/lib/audit/log-admin-activity";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  previewSponsorshipImport,
  type SponsorshipImportFileError,
} from "./sponsorship-import";
import {
  deleteSponsorshipLogoFiles,
  resolveSponsorshipLogoUrl,
  uploadSponsorshipLogoFile,
  type SponsorshipLogoError,
} from "./sponsorship-logo";
import {
  catalogKeyReForKind,
  mergeCatalogRows,
  normalizeCatalogKey,
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
  job_positions: COLLECTIONS.jobPositions,
  sponsorships: COLLECTIONS.sponsorships,
  hiring_types: COLLECTIONS.hiringTypes,
  job_end_descriptions: COLLECTIONS.jobEndDescriptions,
  nationalities: COLLECTIONS.nationalities,
  payment_currencies: COLLECTIONS.paymentCurrencies,
};

export type EmployeeCatalogError =
  | "not_authorized"
  | "not_configured"
  | "invalid_key"
  | "missing_fields"
  | "system_status_locked"
  | "system_row_locked"
  | "not_found"
  | "save_failed"
  | "delete_failed"
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
    const key = normalizeCatalogKey(input.kind, input.key);
  const labelEn = input.labelEn.trim();
  if (!catalogKeyReForKind(input.kind).test(key)) return { error: "invalid_key" };  if (!labelEn) return { error: "missing_fields" };

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
  revalidateCatalogPages();

  if (input.kind === "sponsorships") {
    const logoError = await writeSponsorshipLogo(key, input, actorId);
    if (logoError) return { error: logoError };
  }
  return { ok: true };
}

export type SponsorshipImportApplyError = EmployeeCatalogError | SponsorshipImportFileError | "nothing_to_apply";

/**
 * Delete one catalog row.
 *
 * A **system** row is refused: `mergeCatalogRows` would put it straight back
 * from the compiled seeds, so deleting it would look like a failure rather than
 * a decision. Deactivating is the operation that exists for those.
 */
export async function deleteEmployeeCatalog(input: {
  kind: EmployeeCatalogKind;
  key: string;
}): Promise<{ ok: true } | { error: EmployeeCatalogError }> {
  try {
    await requireManage(input.kind);
  } catch {
    return { error: "not_authorized" };
  }
  const db = await staffDb();
  if (!db) return { error: "not_configured" };

  const key = normalizeCatalogKey(input.kind, input.key);
  const ref = db.collection(KIND_COLLECTION[input.kind]).doc(key);
  const snap = await ref.get();
  if (!snap.exists) {
    const seeded = seedsForKind(input.kind).some((row) => row.key === key && row.is_system);
    return { error: seeded ? "system_row_locked" : "not_found" };
  }
  if (snap.get("is_system") === true) return { error: "system_row_locked" };

  try {
    await ref.delete();
  } catch {
    return { error: "delete_failed" };
  }
  if (input.kind === "sponsorships") await deleteSponsorshipLogoFiles(key);

  void logAdminActivity({
    action: "delete",
    entityType: "employee_catalog",
    entityId: `${input.kind}:${key}`,
    context: { kind: input.kind, key },
  });
  revalidateCatalogPages();
  return { ok: true };
}

function revalidateCatalogPages(): void {
  revalidatePath("/operations");
  revalidatePath("/drivers");
  revalidatePath("/settings/employee-statuses");
  revalidatePath("/settings/employee-sections");
  revalidatePath("/settings/nationality-categories");
  revalidatePath("/settings/bank-codes");
  revalidatePath("/settings/job-positions");
  revalidatePath("/settings/sponsorships");
  revalidatePath("/settings/hiring-types");
  revalidatePath("/settings/job-end-descriptions");
  revalidatePath("/settings/nationalities");
  revalidatePath("/settings/payment-currencies");
  revalidatePath("/payroll");
  revalidatePath("/payroll/hr");
  revalidatePath("/payroll-hub");
}

export async function importSponsorships(input: {
  headers: string[];
  rows: string[][];
}): Promise<{ ok: true; created: number; updated: number } | { error: SponsorshipImportApplyError }> {
  try {
    await requireManage("sponsorships");
  } catch {
    return { error: "not_authorized" };
  }
  const db = await staffDb();
  if (!db) return { error: "not_configured" };

  const snap = await db.collection(KIND_COLLECTION.sponsorships).get();
  const stored = snap.docs
    .map((doc) => parseCatalogRow({ key: doc.id, ...doc.data() }))
    .filter((row): row is EmployeeCatalogRow => row !== null);
  const existing = mergeCatalogRows(stored, seedsForKind("sponsorships"));
  const preview = previewSponsorshipImport({
    headers: input.headers,
    rows: input.rows,
    existing,
  });
  if (preview.error) return { error: preview.error };

  const ready = preview.rows.filter((row) => row.payload);
  if (ready.length === 0) return { error: "nothing_to_apply" };

  const batch = db.batch();
  let created = 0;
  let updated = 0;
  for (const row of ready) {
    const payload = row.payload;
    if (!payload) continue;
    batch.set(
      db.collection(KIND_COLLECTION.sponsorships).doc(payload.key),
      {
        key: payload.key,
        label_en: payload.label_en,
        label_ar: payload.label_ar,
        is_active: payload.is_active,
        is_system: payload.is_system,
        sort_order: payload.sort_order,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    if (row.status === "create") created += 1;
    else updated += 1;
  }
  try {
    await batch.commit();
  } catch {
    return { error: "save_failed" };
  }

  void logAdminActivity({
    action: "update",
    entityType: "employee_catalog",
    entityId: "sponsorships:import",
    context: { kind: "sponsorships", created, updated },
  });
  revalidatePath("/settings/sponsorships");
  revalidatePath("/operations");
  revalidatePath("/payroll");
  revalidatePath("/payroll-hub");
  return { ok: true, created, updated };
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
