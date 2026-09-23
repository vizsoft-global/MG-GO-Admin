"use server";

import { createClient } from "@/lib/supabase/server";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/get-session";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { isEsignDueDateAllowed } from "./esign-due-date";
import { CHUNK_SIZE } from "./render/esign-batch-cap";
import { launchEsignBrowser, renderEsignPdf } from "./render/esign-pdf-renderer";
import type { EsignEmployeeSnapshot } from "./render/esign-placeholders";
import type {
  EsignBatchLine,
  EsignBatchRow,
  EsignBatchRowStatus,
  EsignBatchStatus,
  EsignLocale,
  EsignResolveRow,
  EsignResolveStatus,
  EsignTemplateDetail,
  EsignTemplateFieldRow,
  EsignTemplateFieldType,
  EsignTemplateRow,
} from "./types";
import { ESIGN_RESERVED_FIELD_KEYS } from "./types";

const ESIGN_BUCKET = "esign-documents";

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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v));
}

function mapSnapshot(value: unknown): EsignEmployeeSnapshot | undefined {
  const r = asRecord(value);
  if (!r.employee_id && !r.employee_name) return undefined;
  return {
    company_name: String(r.company_name ?? ""),
    employee_name: String(r.employee_name ?? ""),
    employee_id: String(r.employee_id ?? ""),
    driver_code: String(r.driver_code ?? ""),
    zone: r.zone != null ? String(r.zone) : null,
    project: r.project != null ? String(r.project) : null,
    nationality: r.nationality != null ? String(r.nationality) : null,
  };
}

function mapField(r: Record<string, unknown>): EsignTemplateFieldRow {
  return {
    id: String(r.id),
    template_id: String(r.template_id),
    field_key: String(r.field_key ?? ""),
    label_en: String(r.label_en ?? ""),
    label_ar: r.label_ar != null ? String(r.label_ar) : null,
    field_type: String(r.field_type ?? "text") as EsignTemplateFieldType,
    options: asStringArray(r.options),
    is_required: Boolean(r.is_required),
    sort_order: Number(r.sort_order ?? 0),
  };
}

function mapTemplate(r: Record<string, unknown>, fieldCount = 0): EsignTemplateRow {
  return {
    id: String(r.id),
    category_key: String(r.category_key ?? ""),
    name_en: String(r.name_en ?? ""),
    name_ar: r.name_ar != null ? String(r.name_ar) : null,
    header_en: String(r.header_en ?? ""),
    header_ar: String(r.header_ar ?? ""),
    body_en: String(r.body_en ?? ""),
    body_ar: String(r.body_ar ?? ""),
    declaration_en: String(r.declaration_en ?? ""),
    declaration_ar: String(r.declaration_ar ?? ""),
    default_language: r.default_language === "ar" ? "ar" : "en",
    is_active: r.is_active !== false,
    version: Number(r.version ?? 1),
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
    field_count: fieldCount,
  };
}

export async function fetchEsignTemplates(): Promise<{
  rows: EsignTemplateRow[];
  error?: string;
}> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from("esign_templates")
    .select("*, esign_template_fields(id)")
    .order("name_en");
  if (error) return { rows: [], error: error.message };
  await logAdminRead("esign_templates", "esign.templates.list", {});
  return {
    rows: ((data ?? []) as Record<string, unknown>[]).map((row) => {
      const fields = Array.isArray(row.esign_template_fields)
        ? row.esign_template_fields
        : [];
      return mapTemplate(row, fields.length);
    }),
  };
}

export async function fetchEsignTemplate(
  id: string,
): Promise<{ template: EsignTemplateDetail | null; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from("esign_templates")
    .select("*, esign_template_fields(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) return { template: null, error: error.message };
  if (!data) return { template: null };
  const row = data as Record<string, unknown>;
  const fields = (Array.isArray(row.esign_template_fields) ? row.esign_template_fields : [])
    .map((f) => mapField(asRecord(f)))
    .sort((a, b) => a.sort_order - b.sort_order);
  await logAdminRead("esign_templates", "esign.templates.detail", { id });
  return { template: { ...mapTemplate(row, fields.length), fields } };
}

export async function upsertEsignTemplate(input: {
  id?: string;
  category_key: string;
  name_en: string;
  name_ar?: string | null;
  header_en?: string;
  header_ar?: string;
  body_en?: string;
  body_ar?: string;
  declaration_en?: string;
  declaration_ar?: string;
  default_language?: EsignLocale;
  is_active?: boolean;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await (supabase as any).rpc("admin_upsert_esign_template", {
    p_template: {
      id: input.id ?? null,
      category_key: input.category_key,
      name_en: input.name_en,
      name_ar: input.name_ar ?? "",
      header_en: input.header_en ?? "",
      header_ar: input.header_ar ?? "",
      body_en: input.body_en ?? "",
      body_ar: input.body_ar ?? "",
      declaration_en: input.declaration_en ?? "",
      declaration_ar: input.declaration_ar ?? "",
      default_language: input.default_language ?? "en",
      is_active: input.is_active ?? true,
    },
  });
  if (error) return { ok: false, error: error.message };
  const result = asRecord(data);
  if (result.ok === false) return { ok: false, error: String(result.error ?? "failed") };
  await logAdminMutation({
    action: input.id ? "update" : "create",
    entityType: "esign_templates",
    entityId: String(result.id ?? ""),
    routeName: input.id ? "esign.templates.update" : "esign.templates.create",
  });
  return { ok: true, id: result.id != null ? String(result.id) : undefined };
}

function validFieldKey(key: string): boolean {
  if (!/^[a-z][a-z0-9_]*$/.test(key)) return false;
  return !(ESIGN_RESERVED_FIELD_KEYS as readonly string[]).includes(key);
}

export async function upsertEsignTemplateField(input: {
  id?: string;
  template_id: string;
  field_key: string;
  label_en: string;
  label_ar?: string | null;
  field_type?: EsignTemplateFieldType;
  options?: string[];
  is_required?: boolean;
  sort_order?: number;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  await requireRequestsManage();
  const key = input.field_key.trim().toLowerCase();
  if (!validFieldKey(key)) return { ok: false, error: "invalid_field_key" };
  if (!input.label_en.trim()) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { data, error } = await (supabase as any).rpc("admin_upsert_esign_template_field", {
    p_field: {
      template_id: input.template_id,
      field_key: key,
      label_en: input.label_en.trim(),
      label_ar: input.label_ar ?? "",
      field_type: input.field_type ?? "text",
      options: input.options ?? [],
      is_required: input.is_required ?? false,
      sort_order: input.sort_order ?? 0,
    },
  });
  if (error) return { ok: false, error: error.message };
  const result = asRecord(data);
  if (result.ok === false) return { ok: false, error: String(result.error ?? "failed") };
  await logAdminMutation({
    action: "update",
    entityType: "esign_template_fields",
    entityId: String(result.id ?? ""),
    routeName: "esign.templates.field",
  });
  return { ok: true, id: result.id != null ? String(result.id) : undefined };
}

export async function deleteEsignTemplateField(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { error } = await (supabase as any).from("esign_template_fields").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  await logAdminMutation({
    action: "delete",
    entityType: "esign_template_fields",
    entityId: id,
    routeName: "esign.templates.field.delete",
  });
  return { ok: true };
}

export async function resolveEsignEmployees(
  employeeIds: string[],
): Promise<{ rows: EsignResolveRow[]; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await (supabase as any).rpc("admin_esign_resolve_employees", {
    p_rows: employeeIds.map((employee_id) => ({ employee_id })),
  });
  if (error) return { rows: [], error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) return { rows: [], error: String(payload.error ?? "failed") };
  const raw = Array.isArray(payload.rows) ? payload.rows : [];
  return {
    rows: raw.map((row) => {
      const r = asRecord(row);
      return {
        row_index: Number(r.row_index ?? 0),
        employee_id: String(r.employee_id ?? ""),
        ok: Boolean(r.ok),
        status: String(r.status ?? "invalid") as EsignResolveStatus,
        driver_id: r.driver_id != null ? String(r.driver_id) : undefined,
        snapshot: mapSnapshot(r.snapshot),
      };
    }),
  };
}

export async function fetchEsignSnapshot(
  driverId: string,
): Promise<{ snapshot: EsignEmployeeSnapshot | null; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await (supabase as any).rpc("esign_employee_snapshot", {
    p_driver_id: driverId,
  });
  if (error) return { snapshot: null, error: error.message };
  return { snapshot: mapSnapshot(data) ?? null };
}

function documentForLocale(
  template: EsignTemplateDetail,
  locale: EsignLocale,
  snapshot: EsignEmployeeSnapshot,
  fieldValues: Record<string, string>,
  description: string,
) {
  const fields = template.fields.map((f) => ({
    key: f.field_key,
    label: locale === "ar" ? (f.label_ar || f.label_en) : f.label_en,
    value: fieldValues[f.field_key] ?? "",
  }));
  return {
    language: locale,
    header: locale === "ar" ? template.header_ar : template.header_en,
    body: locale === "ar" ? template.body_ar : template.body_en,
    declaration: locale === "ar" ? template.declaration_ar : template.declaration_en,
    description,
    fields,
    employee: snapshot,
  };
}

async function uploadPdfBytes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  bytes: Uint8Array,
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const key = `admin/${crypto.randomUUID()}.pdf`;
  const { error } = await supabase.storage
    .from(ESIGN_BUCKET)
    .upload(key, Buffer.from(bytes), { contentType: "application/pdf", upsert: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, key };
}

export async function createEsignFromTemplate(input: {
  driver_id: string;
  template_id: string;
  title: string;
  locale: EsignLocale;
  due_at?: string | null;
  description?: string | null;
  field_values?: Record<string, string>;
}): Promise<{ ok: boolean; id?: string; request_code?: string; error?: string }> {
  await requireRequestsManage();
  if (!isEsignDueDateAllowed(input.due_at ?? "", kuwaitTodayYmd())) {
    return { ok: false, error: "due_in_past" };
  }
  const loaded = await fetchEsignTemplate(input.template_id);
  if (loaded.error) return { ok: false, error: loaded.error };
  if (!loaded.template || !loaded.template.is_active) {
    return { ok: false, error: "invalid_template" };
  }
  const snap = await fetchEsignSnapshot(input.driver_id);
  if (!snap.snapshot) return { ok: false, error: snap.error ?? "unknown_id" };

  const fieldValues = input.field_values ?? {};
  for (const field of loaded.template.fields) {
    if (field.is_required && !fieldValues[field.field_key]?.trim()) {
      return { ok: false, error: "field_required" };
    }
  }

  const browser = await launchEsignBrowser();
  const supabase = await createClient();
  try {
    const pdf = await renderEsignPdf(
      documentForLocale(
        loaded.template,
        input.locale,
        snap.snapshot,
        fieldValues,
        input.description ?? "",
      ),
      browser,
    );
    const upload = await uploadPdfBytes(supabase, pdf);
    if (!upload.ok) return { ok: false, error: upload.error };

    const { data, error } = await (supabase as any).rpc("admin_create_esign_request", {
      p_driver_id: input.driver_id,
      p_title: input.title.trim(),
      p_category_key: loaded.template.category_key,
      p_due_at: input.due_at || undefined,
      p_document_storage_key: upload.key,
      p_screenshot_restricted: undefined,
      p_template_id: loaded.template.id,
      p_batch_id: undefined,
      p_batch_row: undefined,
      p_description: input.description || undefined,
      p_field_values: fieldValues,
    });
    if (error) return { ok: false, error: error.message };
    const result = asRecord(data);
    if (result.ok === false) return { ok: false, error: String(result.error ?? "failed") };
    await logAdminMutation({
      action: "create",
      entityType: "esign_requests",
      entityId: String(result.id ?? ""),
      routeName: "esign.create.template",
      after: { request_code: result.request_code, template_id: input.template_id },
    });
    return {
      ok: true,
      id: result.id != null ? String(result.id) : undefined,
      request_code: result.request_code != null ? String(result.request_code) : undefined,
    };
  } finally {
    await browser.close();
  }
}

export async function createEsignBatch(input: {
  template_id: string;
  title: string;
  language: EsignLocale;
  due_at?: string | null;
  source_filename?: string | null;
  rows: Array<{
    driver_id?: string;
    employee_id: string;
    description?: string;
    field_values?: Record<string, string>;
  }>;
}): Promise<{ ok: boolean; id?: string; batch_code?: string; error?: string }> {
  await requireRequestsManage();
  if (!isEsignDueDateAllowed(input.due_at ?? "", kuwaitTodayYmd())) {
    return { ok: false, error: "due_in_past" };
  }
  const supabase = await createClient();
  const { data, error } = await (supabase as any).rpc("admin_create_esign_batch", {
    p_batch: {
      template_id: input.template_id,
      title: input.title,
      language: input.language,
      due_at: input.due_at ?? "",
      source_filename: input.source_filename ?? "",
      rows: input.rows,
    },
  });
  if (error) return { ok: false, error: error.message };
  const result = asRecord(data);
  if (result.ok === false) return { ok: false, error: String(result.error ?? "failed") };
  await logAdminMutation({
    action: "create",
    entityType: "esign_batches",
    entityId: String(result.id ?? ""),
    routeName: "esign.batches.create",
    after: { batch_code: result.batch_code, total: result.total },
  });
  return {
    ok: true,
    id: result.id != null ? String(result.id) : undefined,
    batch_code: result.batch_code != null ? String(result.batch_code) : undefined,
  };
}

function mapBatch(r: Record<string, unknown>): EsignBatchRow {
  const tpl = asRecord(r.esign_templates);
  return {
    id: String(r.id),
    batch_code: String(r.batch_code ?? ""),
    template_id: String(r.template_id ?? ""),
    template_name: tpl.name_en != null ? String(tpl.name_en) : null,
    title: String(r.title ?? ""),
    language: r.language === "ar" ? "ar" : "en",
    status: String(r.status ?? "queued") as EsignBatchStatus,
    total_count: Number(r.total_count ?? 0),
    created_count: Number(r.created_count ?? 0),
    failed_count: Number(r.failed_count ?? 0),
    due_at: r.due_at != null ? String(r.due_at) : null,
    source_filename: r.source_filename != null ? String(r.source_filename) : null,
    created_at: String(r.created_at ?? ""),
  };
}

export async function fetchEsignBatches(): Promise<{
  rows: EsignBatchRow[];
  error?: string;
}> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from("esign_batches")
    .select("*, esign_templates(name_en)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return { rows: [], error: error.message };
  await logAdminRead("esign_batches", "esign.batches.list", {});
  return { rows: ((data ?? []) as Record<string, unknown>[]).map(mapBatch) };
}

export async function fetchEsignBatch(id: string): Promise<{
  batch: EsignBatchRow | null;
  lines: EsignBatchLine[];
  error?: string;
}> {
  await requireRequestsManage();
  const supabase = await createClient();
  const [{ data, error }, lines] = await Promise.all([
    (supabase as any)
      .from("esign_batches")
      .select("*, esign_templates(name_en)")
      .eq("id", id)
      .maybeSingle(),
    (supabase as any)
      .from("esign_batch_rows")
      .select("id, row_index, employee_id, driver_id, status, error, esign_request_id, esign_requests(request_code)")
      .eq("batch_id", id)
      .order("row_index"),
  ]);
  if (error) return { batch: null, lines: [], error: error.message };
  if (!data) return { batch: null, lines: [] };
  await logAdminRead("esign_batches", "esign.batches.detail", { id });
  return {
    batch: mapBatch(data as Record<string, unknown>),
    lines: ((lines.data ?? []) as Record<string, unknown>[]).map((row) => {
      const req = asRecord(row.esign_requests);
      return {
        id: String(row.id),
        row_index: Number(row.row_index ?? 0),
        employee_id: row.employee_id != null ? String(row.employee_id) : null,
        driver_id: row.driver_id != null ? String(row.driver_id) : null,
        status: String(row.status ?? "pending") as EsignBatchRowStatus,
        error: row.error != null ? String(row.error) : null,
        request_id: row.esign_request_id != null ? String(row.esign_request_id) : null,
        request_code: req.request_code != null ? String(req.request_code) : null,
      };
    }),
  };
}

async function recountBatch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  batchId: string,
) {
  const { data } = await (supabase as any)
    .from("esign_batch_rows")
    .select("status")
    .eq("batch_id", batchId);
  const rows = (data ?? []) as { status: string }[];
  const created = rows.filter((r) => r.status === "created").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const pending = rows.filter((r) => r.status === "pending").length;
  const status: EsignBatchStatus =
    pending > 0 ? "processing" : failed > 0 ? "partial" : "completed";
  await (supabase as any)
    .from("esign_batches")
    .update({
      created_count: created,
      failed_count: failed,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId);
  return { created, failed, pending, status };
}

export async function processEsignBatchChunk(batchId: string): Promise<{
  ok: boolean;
  processed: number;
  created: number;
  failed: number;
  remaining: number;
  batch_status?: EsignBatchStatus;
  error?: string;
}> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await (supabase as any).rpc("admin_claim_esign_batch_rows", {
    p_batch_id: batchId,
    p_limit: CHUNK_SIZE,
  });
  if (error) return { ok: false, processed: 0, created: 0, failed: 0, remaining: 0, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) {
    return { ok: false, processed: 0, created: 0, failed: 0, remaining: 0, error: String(payload.error ?? "failed") };
  }
  const claimed = Array.isArray(payload.rows) ? payload.rows.map(asRecord) : [];
  if (claimed.length === 0) {
    const totals = await recountBatch(supabase, batchId);
    return {
      ok: true,
      processed: 0,
      created: totals.created,
      failed: totals.failed,
      remaining: totals.pending,
      batch_status: totals.status,
    };
  }

  const batchRow = await (supabase as any)
    .from("esign_batches")
    .select("template_id, language, title, due_at")
    .eq("id", batchId)
    .maybeSingle();
  const batch = asRecord(batchRow.data);
  const loaded = await fetchEsignTemplate(String(batch.template_id ?? ""));
  if (!loaded.template) {
    return { ok: false, processed: 0, created: 0, failed: 0, remaining: 0, error: loaded.error ?? "invalid_template" };
  }
  const locale: EsignLocale = batch.language === "ar" ? "ar" : "en";
  const title = String(batch.title ?? loaded.template.name_en);
  const dueAt = batch.due_at != null ? String(batch.due_at) : null;

  const browser = await launchEsignBrowser();
  let created = 0;
  let failed = 0;
  try {
    for (const row of claimed) {
      const rowId = String(row.id);
      const rowIndex = Number(row.row_index ?? 0);
      const employeeId = String(row.employee_id ?? "");
      let driverId = row.driver_id != null ? String(row.driver_id) : "";
      let snapshot = driverId ? (await fetchEsignSnapshot(driverId)).snapshot : null;
      if (!snapshot || !driverId) {
        const resolved = await resolveEsignEmployees([employeeId]);
        const hit = resolved.rows[0];
        if (!hit?.ok || !hit.driver_id || !hit.snapshot) {
          await (supabase as any)
            .from("esign_batch_rows")
            .update({
              status: "failed",
              error: hit?.status ?? resolved.error ?? "unknown_id",
              updated_at: new Date().toISOString(),
            })
            .eq("id", rowId);
          failed += 1;
          continue;
        }
        driverId = hit.driver_id;
        snapshot = hit.snapshot;
        await (supabase as any)
          .from("esign_batch_rows")
          .update({ driver_id: driverId })
          .eq("id", rowId);
      }

      const fieldValues = asRecord(row.field_values) as Record<string, string>;
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(fieldValues)) values[k] = String(v ?? "");
      try {
        const pdf = await renderEsignPdf(
          documentForLocale(
            loaded.template,
            locale,
            snapshot,
            values,
            row.description != null ? String(row.description) : "",
          ),
          browser,
        );
        const upload = await uploadPdfBytes(supabase, pdf);
        if (!upload.ok) throw new Error(upload.error);
        const { data: createdRow, error: createError } = await (supabase as any).rpc(
          "admin_create_esign_request",
          {
            p_driver_id: driverId,
            p_title: title,
            p_category_key: loaded.template.category_key,
            p_due_at: dueAt || undefined,
            p_document_storage_key: upload.key,
            p_screenshot_restricted: undefined,
            p_template_id: loaded.template.id,
            p_batch_id: batchId,
            p_batch_row: rowIndex,
            p_description: row.description || undefined,
            p_field_values: values,
          },
        );
        if (createError) throw new Error(createError.message);
        const result = asRecord(createdRow);
        if (result.ok === false) throw new Error(String(result.error ?? "failed"));
        created += 1;
      } catch (err) {
        await (supabase as any)
          .from("esign_batch_rows")
          .update({
            status: "failed",
            error: err instanceof Error ? err.message : "render_failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", rowId);
        failed += 1;
      }
    }
  } finally {
    await browser.close();
  }

  const totals = await recountBatch(supabase, batchId);
  return {
    ok: true,
    processed: claimed.length,
    created: totals.created,
    failed: totals.failed,
    remaining: totals.pending,
    batch_status: totals.status,
  };
}
