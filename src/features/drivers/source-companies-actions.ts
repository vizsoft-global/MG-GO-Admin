"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { logAdminActivity } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import {
  CLIENT_CODE_RE,
  COMPANY_KEY_RE,
  normalizeClientCode,
  type SourceCompany,
  type SourceCompanyWithUsage,
} from "./source-companies";

export type SourceCompanyError =
  | "not_authorized"
  | "invalid_company_key"
  | "invalid_company_name"
  | "invalid_client_code"
  | "client_code_taken"
  | "source_company_system_locked"
  | "source_company_in_use"
  | "save_failed";

const KNOWN_ERRORS = new Set<string>([
  "not_authorized",
  "invalid_company_key",
  "invalid_company_name",
  "invalid_client_code",
  "client_code_taken",
  "source_company_system_locked",
  "source_company_in_use",
]);

async function requirePermission(slug: string) {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, slug, session.isSuperAdmin)) {
    throw new Error("not_authorized");
  }
}

async function loadCompanies(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<SourceCompany[]> {
  const { data, error } = await supabase
    .from("source_companies")
    .select("key, name, client_code, is_active, is_system, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listSourceCompanies(): Promise<SourceCompany[]> {
  await requirePermission("drivers.view");
  return loadCompanies(await createClient());
}

/** Settings list: every company plus how many live riders reference it. */
export async function listSourceCompaniesWithUsage(): Promise<SourceCompanyWithUsage[]> {
  await requirePermission("settings.manage");
  const supabase = await createClient();
  const [companies, { data: intakes, error }] = await Promise.all([
    loadCompanies(supabase),
    supabase
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
  return companies.map((c) => ({ ...c, driver_count: counts.get(c.key) ?? 0 }));
}

export async function upsertSourceCompany(input: {
  key: string;
  name: string;
  clientCode: string;
  isActive: boolean;
  isNew: boolean;
}): Promise<{ ok: true } | { error: SourceCompanyError }> {
  try {
    await requirePermission("settings.manage");
  } catch {
    return { error: "not_authorized" };
  }
  const key = input.key.trim().toLowerCase();
  const name = input.name.trim();
  const clientCode = normalizeClientCode(input.clientCode);
  if (!COMPANY_KEY_RE.test(key)) return { error: "invalid_company_key" };
  if (!name || name.length > 120) return { error: "invalid_company_name" };
  if (clientCode && !CLIENT_CODE_RE.test(clientCode)) return { error: "invalid_client_code" };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("source_companies")
    .select("key, name, client_code, is_active")
    .eq("key", key)
    .maybeSingle();
  if (input.isNew && before) return { error: "invalid_company_key" };

  const { error } = await supabase.rpc("admin_upsert_source_company", {
    p_key: key,
    p_name: name,
    p_client_code: clientCode ?? "",
    p_is_active: input.isActive,
  });
  if (error) {
    const code = KNOWN_ERRORS.has(error.message) ? error.message : "save_failed";
    return { error: code as SourceCompanyError };
  }

  void logAdminActivity({
    action: input.isNew ? "create" : "update",
    entityType: "source_companies",
    entityId: key,
    routeName: "upsertSourceCompany",
    before: before ?? null,
    after: { key, name, client_code: clientCode, is_active: input.isActive },
  });
  revalidatePath("/[locale]/(dashboard)/settings/source-companies", "page");
  return { ok: true };
}
