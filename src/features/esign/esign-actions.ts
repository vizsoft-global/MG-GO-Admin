"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { effectiveEsignStatus, isEsignDueDateAllowed } from "./esign-due-date";
import { esignDocumentHref } from "./esign-storage-key";
import type {
  EsignCategoryRow,
  EsignDetail,
  EsignDriverOption,
  EsignListFilters,
  EsignListRow,
  EsignRequestStatus,
  EsignStatusCounts,
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
  const storedStatus = String(r.display_status ?? r.status ?? "pending");
  const dueAt = r.due_at != null ? String(r.due_at) : null;
  return {
    id: String(r.id),
    request_code: String(r.request_code ?? ""),
    title: String(r.title ?? ""),
    category_key: r.category_key != null ? String(r.category_key) : null,
    category_label: r.category_label != null ? String(r.category_label) : null,
    driver_id: String(r.driver_id ?? ""),
    driver_name: String(r.driver_name ?? "—"),
    driver_code: String(r.driver_code ?? ""),
    status: effectiveEsignStatus(storedStatus, dueAt, kuwaitTodayYmd()) as EsignRequestStatus,
    due_at: r.due_at != null ? String(r.due_at) : null,
    screenshot_restricted: Boolean(r.screenshot_restricted),
    sent_at: String(r.sent_at ?? r.created_at ?? ""),
    viewed_at: r.viewed_at != null ? String(r.viewed_at) : null,
    declined_at: r.declined_at != null ? String(r.declined_at) : null,
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

/** KPI + tab counts for the Sent requests / E-signatures lists (Figma ESign 01 & 02). */
export async function fetchEsignStatusCounts(): Promise<EsignStatusCounts> {
  await requireRequestsManage();
  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  const [requests, categories] = await Promise.all([
    (supabase as any).from("esign_requests").select("status, due_at, created_at, signed_at"),
    supabase
      .from("esign_categories")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
  ]);

  const today = kuwaitTodayYmd();
  const rows = (requests.data ?? []) as {
    status: string;
    due_at: string | null;
    created_at: string | null;
    signed_at: string | null;
  }[];
  const count = (status: string) =>
    rows.filter((row) => effectiveEsignStatus(row.status, row.due_at, today) === status).length;

  return {
    all: rows.length,
    pending: count("pending"),
    signed: count("signed"),
    declined: count("declined"),
    expired: count("expired"),
    cancelled: count("cancelled"),
    signedLast30d: rows.filter((row) => row.signed_at != null && row.signed_at >= since).length,
    sentLast30d: rows.filter((row) => row.created_at != null && row.created_at >= since).length,
    categories: categories.count ?? 0,
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
      declaration_accepted_at:
        row.declaration_accepted_at != null ? String(row.declaration_accepted_at) : null,
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

const ESIGN_BUCKET = "esign-documents";

function hasStorageKey(value: unknown): boolean {
  return value != null && String(value).trim() !== "";
}

/** Same-origin preview / download links. Storage JWTs are never handed to the browser. */
export async function fetchEsignDocumentLinks(id: string): Promise<{
  documentUrl: string | null;
  signatureUrl: string | null;
  signedDocumentUrl: string | null;
  signedDocumentError: string | null;
  error?: string;
}> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from("esign_requests")
    .select(
      "document_storage_key, signature_storage_key, signed_document_storage_key, signed_document_error",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return {
      documentUrl: null,
      signatureUrl: null,
      signedDocumentUrl: null,
      signedDocumentError: null,
      error: error.message,
    };
  }
  const row = asRecord(data);

  return {
    documentUrl: hasStorageKey(row.document_storage_key)
      ? esignDocumentHref(id, "document", "inline")
      : null,
    signatureUrl: hasStorageKey(row.signature_storage_key)
      ? esignDocumentHref(id, "signature", "inline")
      : null,
    signedDocumentUrl: hasStorageKey(row.signed_document_storage_key)
      ? esignDocumentHref(id, "signed", "inline")
      : null,
    signedDocumentError:
      row.signed_document_error != null ? String(row.signed_document_error) : null,
  };
}

/**
 * WebP is deliberately excluded: `esign-compose-signed-document` rejects it with
 * `unsupported_source_type`, so a WebP source could never produce a signed copy.
 */
const UPLOAD_MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
};
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Uploads the document a driver has to sign and returns its `esign-documents` object key. */
export async function uploadEsignDocument(
  formData: FormData,
): Promise<{ ok: boolean; key?: string; error?: string }> {
  await requireRequestsManage();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "missing_file" };
  const ext = UPLOAD_MIME_EXT[file.type];
  if (!ext) return { ok: false, error: "unsupported_source_type" };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "file_too_large" };

  const supabase = await createClient();
  const key = `admin/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(ESIGN_BUCKET)
    .upload(key, file, { contentType: file.type, upsert: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, key };
}

export async function createEsignRequest(input: {
  driver_id: string;
  title: string;
  category_key?: string | null;
  due_at?: string | null;
  document_storage_key?: string | null;
  screenshot_restricted?: boolean | null;
}): Promise<{ ok: boolean; id?: string; request_code?: string; error?: string }> {
  await requireRequestsManage();
  if (!input.category_key?.trim()) {
    return { ok: false, error: "category_required" };
  }
  if (!isEsignDueDateAllowed(input.due_at ?? "", kuwaitTodayYmd())) {
    return { ok: false, error: "due_in_past" };
  }
  const supabase = await createClient();
  const { data, error } = await (supabase as any).rpc("admin_create_esign_request", {
    p_driver_id: input.driver_id,
    p_title: input.title.trim(),
    p_category_key: input.category_key.trim(),
    p_due_at: input.due_at || undefined,
    p_document_storage_key: input.document_storage_key || undefined,
    p_screenshot_restricted: input.screenshot_restricted ?? undefined,
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

  const { data: signedRows } = await (supabase as any)
    .from("esign_requests")
    .select("category_key")
    .eq("status", "signed");
  const signedByKey = new Map<string, number>();
  for (const row of (signedRows ?? []) as { category_key: string | null }[]) {
    if (!row.category_key) continue;
    signedByKey.set(row.category_key, (signedByKey.get(row.category_key) ?? 0) + 1);
  }

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
      signed_count: signedByKey.get(row.key) ?? 0,
    })),
  };
}

export async function upsertEsignCategory(input: {
  id?: string;
  key: string;
  label_en: string;
  description?: string | null;
  icon_key?: string | null;
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
    icon_key: input.icon_key?.trim().slice(0, 2) || null,
    screenshot_restricted: input.screenshot_restricted ?? false,
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
