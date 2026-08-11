"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import type {
  EsignCategoryRow,
  EsignDetail,
  EsignDriverOption,
  EsignListFilters,
  EsignListRow,
  EsignRequestStatus,
} from "./types";

async function requireRequestsManage() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "requests.manage", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapListRow(r: Record<string, unknown>): EsignListRow {
  return {
    id: String(r.id),
    request_code: String(r.request_code ?? ""),
    title: String(r.title ?? ""),
    category_key: r.category_key != null ? String(r.category_key) : null,
    category_label: r.category_label != null ? String(r.category_label) : null,
    driver_id: String(r.driver_id ?? ""),
    driver_name: String(r.driver_name ?? "—"),
    driver_code: String(r.driver_code ?? ""),
    status: String(r.status ?? "pending") as EsignRequestStatus,
    due_at: r.due_at != null ? String(r.due_at) : null,
    screenshot_restricted: Boolean(r.screenshot_restricted),
    signed_at: r.signed_at != null ? String(r.signed_at) : null,
    signer_display_name:
      r.signer_display_name != null ? String(r.signer_display_name) : null,
    created_at: String(r.created_at ?? ""),
  };
}

export async function fetchEsignRequestsList(
  filters: EsignListFilters = {},
): Promise<{ rows: EsignListRow[]; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await (supabase as any).rpc("admin_list_esign_requests", {
    p_status: filters.status ?? undefined,
    p_limit: filters.limit ?? 100,
    p_offset: filters.offset ?? 0,
  });

  if (error) return { rows: [], error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) {
    return { rows: [], error: String(payload.error ?? "failed") };
  }

  const rowsRaw = Array.isArray(payload.rows) ? payload.rows : [];
  await logAdminRead("esign_requests", "esign.list", {
    status: filters.status ?? null,
    count: rowsRaw.length,
  });

  return {
    rows: rowsRaw.map((row) => mapListRow(asRecord(row))),
  };
}

export async function fetchEsignRequestDetail(
  id: string,
): Promise<{ request: EsignDetail | null; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from("esign_requests")
    .select(
      `
      *,
      drivers ( driver_code, profiles ( full_name ) ),
      esign_categories ( label_en )
    `,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) return { request: null, error: error.message };
  if (!data) return { request: null };

  const row = data as Record<string, unknown>;
  const drivers = asRecord(row.drivers);
  const profiles = asRecord(drivers.profiles);
  const category = asRecord(row.esign_categories);

  await logAdminRead("esign_requests", "esign.detail", { id });

  const base = mapListRow({
    ...row,
    driver_name: profiles.full_name ?? "—",
    driver_code: drivers.driver_code ?? "",
    category_label: category.label_en ?? null,
  });

  return {
    request: {
      ...base,
      signer_meta: asRecord(row.signer_meta),
      document_storage_key:
        row.document_storage_key != null ? String(row.document_storage_key) : null,
      signature_storage_key:
        row.signature_storage_key != null ? String(row.signature_storage_key) : null,
      sent_by: row.sent_by != null ? String(row.sent_by) : null,
      updated_at: String(row.updated_at ?? ""),
    },
  };
}

export async function createEsignRequest(input: {
  driver_id: string;
  title: string;
  category_key?: string | null;
  due_at?: string | null;
}): Promise<{ ok: boolean; id?: string; request_code?: string; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await (supabase as any).rpc("admin_create_esign_request", {
    p_driver_id: input.driver_id,
    p_title: input.title.trim(),
    p_category_key: input.category_key || undefined,
    p_due_at: input.due_at || undefined,
  });

  if (error) return { ok: false, error: error.message };
  const result = asRecord(data);
  if (result.ok === false) {
    return { ok: false, error: String(result.error ?? "failed") };
  }

  await logAdminMutation({
    action: "create",
    entityType: "esign_requests",
    entityId: String(result.id ?? ""),
    routeName: "esign.create",
    after: { request_code: result.request_code },
  });

  return {
    ok: true,
    id: result.id != null ? String(result.id) : undefined,
    request_code: result.request_code != null ? String(result.request_code) : undefined,
  };
}

export async function fetchEsignCategories(): Promise<{
  rows: EsignCategoryRow[];
  error?: string;
}> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from("esign_categories")
    .select(
      "id, key, label_en, description, icon_key, screenshot_restricted, is_active, sort_order",
    )
    .order("sort_order")
    .order("label_en");

  if (error) return { rows: [], error: error.message };

  await logAdminRead("esign_categories", "esign.categories.list", {});

  return {
    rows: ((data ?? []) as EsignCategoryRow[]).map((row) => ({
      id: row.id,
      key: row.key,
      label_en: row.label_en,
      description: row.description,
      icon_key: row.icon_key,
      screenshot_restricted: row.screenshot_restricted,
      is_active: row.is_active,
      sort_order: row.sort_order,
    })),
  };
}

export async function upsertEsignCategory(input: {
  id?: string;
  key: string;
  label_en: string;
  description?: string | null;
  screenshot_restricted?: boolean;
  is_active?: boolean;
  sort_order?: number;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const key = input.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const label_en = input.label_en.trim();
  if (!key || !label_en) return { ok: false, error: "missing_fields" };

  const row = {
    key,
    label_en,
    description: input.description?.trim() || null,
    screenshot_restricted: input.screenshot_restricted ?? true,
    is_active: input.is_active ?? true,
    sort_order: input.sort_order ?? 0,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { error } = await (supabase as any)
      .from("esign_categories")
      .update(row)
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    await logAdminMutation({
      action: "update",
      entityType: "esign_categories",
      entityId: input.id,
      routeName: "esign.categories.update",
    });
    return { ok: true, id: input.id };
  }

  const { data, error } = await (supabase as any)
    .from("esign_categories")
    .insert(row)
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await logAdminMutation({
    action: "create",
    entityType: "esign_categories",
    entityId: data.id,
    routeName: "esign.categories.create",
  });
  return { ok: true, id: data.id };
}

export async function deleteEsignCategory(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { error } = await (supabase as any).from("esign_categories").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  await logAdminMutation({
    action: "delete",
    entityType: "esign_categories",
    entityId: id,
    routeName: "esign.categories.delete",
  });
  return { ok: true };
}

export async function fetchEsignScreenshotDefault(): Promise<{
  value: boolean;
  error?: string;
}> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("esign_screenshot_default")
    .eq("id", 1)
    .maybeSingle();

  if (error) return { value: true, error: error.message };
  const settings = data as { esign_screenshot_default?: boolean } | null;
  return { value: settings?.esign_screenshot_default ?? true };
}

export async function updateEsignScreenshotDefault(
  value: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .update({
      esign_screenshot_default: value,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", 1);

  if (error) return { ok: false, error: error.message };

  await logAdminMutation({
    action: "update",
    entityType: "app_settings",
    entityId: "1",
    routeName: "esign.screenshot_default.update",
    after: { esign_screenshot_default: value },
  });
  return { ok: true };
}

export async function fetchEsignDriverOptions(): Promise<{
  rows: EsignDriverOption[];
  error?: string;
}> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("drivers")
    .select("id, driver_code, employee_id, profiles(full_name)")
    .eq("status", "active")
    .is("archived_at", null)
    .order("driver_code");

  if (error) return { rows: [], error: error.message };

  return {
    rows: (data ?? []).map((row) => {
      const profile = asRecord(row.profiles);
      return {
        id: row.id,
        full_name: String(profile.full_name ?? row.driver_code ?? "—"),
        driver_code: row.driver_code ?? "",
        employee_id: row.employee_id,
      };
    }),
  };
}
