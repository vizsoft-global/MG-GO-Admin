"use server";

import { staffClient, type StaffClient } from "./driver-uniqueness";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import { logAdminActivity } from "@/lib/audit/log-admin-activity";
import {
  CLIENT_CODE_RE,
  COMPANY_KEY_RE,
  normalizeClientCode,
  type SourceCompany,
  type SourceCompanyWithUsage,
} from "./source-companies";
import {
  deleteSourceCompanyLogoFiles,
  resolveSourceCompanyLogoUrls,
  uploadSourceCompanyLogoFile,
} from "./source-company-logo";

export type SourceCompanyError =
  | "not_authorized"
  | "invalid_company_key"
  | "company_key_taken"
  | "invalid_company_name"
  | "invalid_client_code"
  | "client_code_taken"
  | "source_company_system_locked"
  | "source_company_in_use"
  | "invalid_dpd_target"
  | "invalid_incentive_rate"
  | "incentive_effective_from_required"
  | "logo_file_too_large"
  | "logo_invalid_type"
  | "logo_upload_failed"
  | "save_failed";

const KNOWN_ERRORS = new Set<string>([
  "not_authorized",
  "invalid_company_key",
  "company_key_taken",
  "invalid_company_name",
  "invalid_client_code",
  "client_code_taken",
  "source_company_system_locked",
  "source_company_in_use",
  "invalid_dpd_target",
  "invalid_incentive_rate",
  "incentive_effective_from_required",
  "invalid_logo_key",
]);

const LOGO_ERRORS: Record<string, SourceCompanyError> = {
  file_too_large: "logo_file_too_large",
  invalid_type: "logo_invalid_type",
  upload_failed: "logo_upload_failed",
};

async function requirePermission(slug: Permission) {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, slug, session.isSuperAdmin)) {
    throw new Error("not_authorized");
  }
  return session;
}

async function loadCompanies(
  db: StaffClient,
): Promise<SourceCompany[]> {
  const { data, error } = await db
    .from("source_companies")
    .select(
      "key, name, client_code, is_active, is_system, logo_url, sort_order, dpd_target, incentive_enabled, incentive_above_kwd, incentive_below_kwd, effective_from",
    )
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listSourceCompanies(): Promise<SourceCompany[]> {
  await requirePermission("drivers.view");
  return loadCompanies(await staffClient());
}

/** Settings list: every company plus how many live riders reference it. */
export async function listSourceCompaniesWithUsage(): Promise<SourceCompanyWithUsage[]> {
  await requirePermission("companies.view");
  const db = await staffClient();
  const [companies, { data: intakes, error }] = await Promise.all([
    loadCompanies(db),
    db
      .from("driver_intakes")
      .select("source_company, rider_category")
      .is("archived_at", null),
  ]);
  if (error) throw new Error(error.message);
  const counts = new Map<string, number>();
  const system = companies.find((c) => c.is_system)?.key ?? null;
  for (const row of intakes ?? []) {
    const key =
      (row.rider_category ?? "in_house") === "in_house" ? system : row.source_company;
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return resolveSourceCompanyLogoUrls(
    companies.map((c) => ({ ...c, driver_count: counts.get(c.key) ?? 0 })),
  );
}

export async function upsertSourceCompany(input: {
  key: string;
  name: string;
  clientCode: string;
  isActive: boolean;
  isNew: boolean;
  dpdTarget: number | null;
  incentiveEnabled: boolean;
  incentiveAboveKwd: number | null;
  incentiveBelowKwd: number | null;
  effectiveFrom: string | null;
  /** New logo picked in the modal; uploaded before the row is saved. */
  logoFile?: File | null;
  /** Clear the stored logo and delete its R2 object. */
  removeLogo?: boolean;
}): Promise<{ ok: true } | { error: SourceCompanyError }> {
  let session;
  try {
    session = await requirePermission(input.isNew ? "companies.create" : "companies.edit");
  } catch {
    return { error: "not_authorized" };
  }
  const key = input.key.trim().toLowerCase();
  const name = input.name.trim();
  const clientCode = normalizeClientCode(input.clientCode);
  if (!COMPANY_KEY_RE.test(key)) return { error: "invalid_company_key" };
  if (!name || name.length > 120) return { error: "invalid_company_name" };
  if (clientCode && !CLIENT_CODE_RE.test(clientCode)) return { error: "invalid_client_code" };

  const db = await staffClient();
  const { data: before } = await db
    .from("source_companies")
    .select(
      "key, name, client_code, is_active, logo_url, dpd_target, incentive_enabled, incentive_above_kwd, incentive_below_kwd, effective_from",
    )
    .eq("key", key)
    .maybeSingle();
  if (input.isNew && before) return { error: "company_key_taken" };

  // A picked file wins over the stored key; `removeLogo` clears it. Absent both
  // we send nothing, so a name-only save cannot wipe an existing logo.
  let logoUrl: string | null | undefined;
  const beforeLogo = (before as { logo_url?: string | null } | null)?.logo_url ?? null;
  if (input.removeLogo) {
    await deleteSourceCompanyLogoFiles(key);
    logoUrl = null;
  } else if (input.logoFile && input.logoFile.size > 0) {
    await deleteSourceCompanyLogoFiles(key);
    const upload = await uploadSourceCompanyLogoFile(key, input.logoFile, session.id);
    if (upload.error) return { error: LOGO_ERRORS[upload.error] ?? "logo_upload_failed" };
    logoUrl = upload.logoUrl ?? null;
  }

  // `adminUpsertSourceCompany` (functions/src/rpcs/rules.ts) reads the camelCase
  // names, not the `p_*` SQL spelling — sending `p_key` left `key` empty and
  // every save failed as `invalid_company_key`.
  const { error } = await db.rpc("admin_upsert_source_company", {
    key,
    name,
    clientCode: clientCode ?? "",
    isActive: input.isActive,
    dpdTarget: input.dpdTarget ?? undefined,
    incentiveEnabled: input.incentiveEnabled,
    incentiveAboveKwd: input.incentiveAboveKwd ?? undefined,
    incentiveBelowKwd: input.incentiveBelowKwd ?? undefined,
    effectiveFrom: input.effectiveFrom ?? undefined,
    logoUrl,
  });
  if (error) {
    // The row never moved, so a freshly uploaded object would be orphaned.
    if (logoUrl !== undefined) await deleteSourceCompanyLogoFiles(key);
    const code = KNOWN_ERRORS.has(error.message) ? error.message : "save_failed";
    return { error: code as SourceCompanyError };
  }

  void logAdminActivity({
    action: input.isNew ? "create" : "update",
    entityType: "source_companies",
    entityId: key,
    routeName: "upsertSourceCompany",
    before: before ?? null,
    after: {
      key,
      name,
      client_code: clientCode,
      is_active: input.isActive,
      logo_url: logoUrl !== undefined ? logoUrl : beforeLogo,
      dpd_target: input.dpdTarget,
      incentive_enabled: input.incentiveEnabled,
      incentive_above_kwd: input.incentiveAboveKwd,
      incentive_below_kwd: input.incentiveBelowKwd,
      effective_from: input.effectiveFrom,
    },
  });
  revalidatePath("/[locale]/(dashboard)/settings/source-companies", "page");
  return { ok: true };
}
