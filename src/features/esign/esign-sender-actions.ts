"use server";

import type { DocumentData, Firestore, Query } from "firebase-admin/firestore";
import { callAdminFunction, callCronFunction } from "@/lib/firebase/callable";
import { getFirebaseStorage } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
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
  EsignDocumentKind,
  EsignDraftDetail,
  EsignDraftKind,
  EsignDraftRow,
  EsignFieldSection,
  EsignFieldSource,
  EsignLocale,
  EsignReminderState,
  EsignResolveRow,
  EsignResolveStatus,
  EsignTemplateDetail,
  EsignTemplateFieldRow,
  EsignTemplateFieldType,
  EsignTemplateRow,
  EsignTrackerRecipient,
} from "./types";
import { normalizeDocumentKind } from "./document-kind";
import { effectiveEsignStatus } from "./esign-due-date";
import { parseEsignBatchKpis, type EsignBatchKpis } from "./esign-batch-kpis";
import { esignRecipientStage } from "./esign-recipient-stage";
import { ESIGN_RESERVED_FIELD_KEYS } from "./types";

const ESIGN_BUCKET = "esign-documents";

async function requireRequestsManage() {
  const session = await getSessionUser();
  // EmployeeDesk V2 is gated on `employeedesk.manage` and reuses these reads and
  // writes verbatim, so the gate accepts either slug rather than forcing a
  // second, drifting copy of every action for the new module.
  if (
    !session ||
    (!hasPermissionInSet(session.permissions, "requests.manage", session.isSuperAdmin) &&
      !hasPermissionInSet(
        session.permissions,
        "employeedesk.manage",
        session.isSuperAdmin,
      ))
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

type DocRow = Record<string, unknown> & { id: string };

function cell(value: unknown): unknown {
  if (value == null) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (Array.isArray(value)) return value.map(cell);
  return value;
}

function docRow(id: string, data: DocumentData | undefined): DocRow | null {
  if (!data) return null;
  const row: DocRow = { id };
  for (const [key, value] of Object.entries(data)) row[key] = cell(value);
  return row;
}

async function openDb(): Promise<Firestore | null> {
  return staffDb();
}

function callRpc(asWorker: boolean) {
  return asWorker ? callCronFunction : callAdminFunction;
}

async function getDoc(name: string, id: string): Promise<{ row: DocRow | null; error: string | null }> {
  const db = await openDb();
  if (!db) return { row: null, error: "not_configured" };
  try {
    const snap = await db.collection(name).doc(id).get();
    return { row: snap.exists ? docRow(snap.id, snap.data()) : null, error: null };
  } catch (e) {
    return { row: null, error: e instanceof Error ? e.message : "read_failed" };
  }
}

async function listDocs(name: string): Promise<{ rows: DocRow[]; error: string | null }> {
  const db = await openDb();
  if (!db) return { rows: [], error: "not_configured" };
  try {
    const snap = await db.collection(name).get();
    return { rows: snap.docs.map((doc) => docRow(doc.id, doc.data())!), error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : "read_failed" };
  }
}

async function queryDocs(
  name: string,
  filters: Array<[string, unknown]>,
): Promise<{ rows: DocRow[]; error: string | null }> {
  const db = await openDb();
  if (!db) return { rows: [], error: "not_configured" };
  try {
    let q: Query = db.collection(name);
    for (const [field, value] of filters) q = q.where(field, "==", value);
    const snap = await q.get();
    return { rows: snap.docs.map((doc) => docRow(doc.id, doc.data())!), error: null };
  } catch {
    const all = await listDocs(name);
    if (all.error) return all;
    return {
      rows: all.rows.filter((row) => filters.every(([field, value]) => row[field] === value)),
      error: null,
    };
  }
}

async function docsByIds(name: string, ids: string[]): Promise<DocRow[]> {
  const db = await openDb();
  if (!db) return [];
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  const out: DocRow[] = [];
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const snaps = await db.getAll(...chunk.map((docId) => db.collection(name).doc(docId)));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const row = docRow(snap.id, snap.data());
      if (row) out.push(row);
    }
  }
  return out;
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function sortRows(rows: DocRow[], keys: Array<[string, "asc" | "desc"]>): DocRow[] {
  return [...rows].sort((left, right) => {
    for (const [key, dir] of keys) {
      const c = compareValues(left[key], right[key]);
      if (c !== 0) return dir === "asc" ? c : -c;
    }
    return 0;
  });
}

async function patchDoc(
  name: string,
  id: string,
  data: Record<string, unknown>,
): Promise<string | null> {
  const db = await openDb();
  if (!db) return "not_configured";
  try {
    const ref = db.collection(name).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    await ref.set(data, { merge: true });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "write_failed";
  }
}

async function deleteDoc(name: string, id: string): Promise<string | null> {
  const db = await openDb();
  if (!db) return "not_configured";
  try {
    await db.collection(name).doc(id).delete();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "delete_failed";
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v));
}

function mapSnapshot(value: unknown): EsignEmployeeSnapshot | undefined {
  const r = asRecord(value);
  if (!r.employee_id && !r.employee_name) return undefined;
  // Keys added by EmployeeDesk V2 read as null on a snapshot stored before that
  // migration, which is what they are: the document did not carry them.
  return {
    company_name: String(r.company_name ?? ""),
    employee_name: String(r.employee_name ?? ""),
    employee_id: String(r.employee_id ?? ""),
    driver_code: String(r.driver_code ?? ""),
    civil_id: r.civil_id != null ? String(r.civil_id) : null,
    joined_at: r.joined_at != null ? String(r.joined_at) : null,
    accommodation: r.accommodation != null ? String(r.accommodation) : null,
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
    // Defaults mirror the column defaults, so a row written before
    // 20261115000000 reads as the free-text field it actually behaves as.
    source_kind: (["system", "entry", "fixed", "signature"].includes(
      String(r.source_kind),
    )
      ? String(r.source_kind)
      : "entry") as EsignTemplateFieldRow["source_kind"],
    section_key: (String(r.section_key) === "employee"
      ? "employee"
      : "document") as EsignTemplateFieldRow["section_key"],
    options_source: r.options_source != null ? String(r.options_source) : null,
    preview_value:
      r.preview_value != null && String(r.preview_value).trim() !== ""
        ? String(r.preview_value)
        : null,
  };
}

/**
 * The document kind, validated against the one canonical list in
 * `./document-kind` — this file used to carry its own copy of that allowlist and
 * silently rewrote a `payslip` row to `general`.
 */
function mapTemplate(r: Record<string, unknown>, fieldCount = 0): EsignTemplateRow {
  const kind = normalizeDocumentKind(r.document_kind);
  const fields = Array.isArray(r.esign_template_fields)
    ? (r.esign_template_fields as Record<string, unknown>[])
    : [];
  const sourceCounts: Partial<Record<EsignFieldSource, number>> = {};
  for (const field of fields) {
    const source = mapField({
      ...field,
      template_id: r.id,
      id: field.id ?? "0",
    }).source_kind;
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
  }
  return {
    id: String(r.id),
    category_key: String(r.category_key ?? ""),
    // The library card leads with the category's own name. `esign_templates`
    // only stores the slug, and the reference shows an operator-readable label
    // where a card would otherwise print `accommodation_penalties`. It rides the
    // embedded FK row (`esign_categories`), so the card costs no second read.
    category_label: (() => {
      const cat = r.esign_categories;
      const label =
        cat && typeof cat === "object" && !Array.isArray(cat)
          ? (cat as Record<string, unknown>).label_en
          : null;
      return label != null ? String(label) : null;
    })(),
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
    document_kind: kind,
    is_draft: r.is_draft === true,
    version: Number(r.version ?? 1),
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
    field_count: fieldCount,
    ...(fields.length
      ? {
          source_counts: sourceCounts,
          has_signature_rows: (sourceCounts.signature ?? 0) > 0,
        }
      : {}),
  };
}

export async function fetchEsignTemplates(): Promise<{
  rows: EsignTemplateRow[];
  error?: string;
}> {
  await requireRequestsManage();
  const [listed, fields, categories] = await Promise.all([
    listDocs(COLLECTIONS.esignTemplates),
    listDocs(COLLECTIONS.esignTemplateFields),
    listDocs(COLLECTIONS.esignCategories),
  ]);
  if (listed.error) return { rows: [], error: listed.error };
  const fieldsByTemplate = new Map<string, DocRow[]>();
  for (const field of fields.rows) {
    const templateId = String(field.template_id ?? "");
    const group = fieldsByTemplate.get(templateId) ?? [];
    group.push(field);
    fieldsByTemplate.set(templateId, group);
  }
  const categoryByKey = new Map(
    categories.rows.map((row) => [String(row.key ?? row.id), row]),
  );
  await logAdminRead("esign_templates", "esign.templates.list", {});
  return {
    rows: sortRows(listed.rows, [["name_en", "asc"]]).map((row) => {
      const attachedFields = (fieldsByTemplate.get(row.id) ?? []).map((field) => ({
        id: field.id,
        field_key: field.field_key,
        source_kind: field.source_kind,
      }));
      const category = categoryByKey.get(String(row.category_key ?? ""));
      return mapTemplate(
        {
          ...row,
          esign_template_fields: attachedFields,
          esign_categories: category ? { label_en: category.label_en } : null,
        },
        attachedFields.length,
      );
    }),
  };
}

async function loadEsignTemplate(
  id: string,
): Promise<{ template: EsignTemplateDetail | null; error?: string }> {
  const loaded = await getDoc(COLLECTIONS.esignTemplates, id);
  if (loaded.error) return { template: null, error: loaded.error };
  if (!loaded.row) return { template: null };
  const fields = await queryDocs(COLLECTIONS.esignTemplateFields, [["template_id", id]]);
  const category = loaded.row.category_key
    ? await queryDocs(COLLECTIONS.esignCategories, [["key", String(loaded.row.category_key)]])
    : { rows: [] as DocRow[], error: null };
  const row = {
    ...loaded.row,
    esign_template_fields: fields.rows,
    esign_categories: category.rows[0] ? { label_en: category.rows[0].label_en } : null,
  };
  const mapped = fields.rows
    .map((field) => mapField(field))
    .sort((a, b) => a.sort_order - b.sort_order);
  return { template: { ...mapTemplate(row, mapped.length), fields: mapped } };
}

export async function fetchEsignTemplate(
  id: string,
): Promise<{ template: EsignTemplateDetail | null; error?: string }> {
  await requireRequestsManage();
  const loaded = await loadEsignTemplate(id);
  if (loaded.template) {
    await logAdminRead("esign_templates", "esign.templates.detail", { id });
  }
  return loaded;
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
  document_kind?: EsignDocumentKind;
  is_draft?: boolean;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  await requireRequestsManage();
  const { data, error } = await callAdminFunction("admin_upsert_esign_template", {
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
      document_kind: input.document_kind ?? "general",
      is_draft: input.is_draft ?? false,
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
  source_kind?: EsignFieldSource;
  section_key?: EsignFieldSection;
  options_source?: string | null;
  /** Sample printed by the builder's preview only; never sent. */
  preview_value?: string | null;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  await requireRequestsManage();
  const key = input.field_key.trim().toLowerCase();
  if (!validFieldKey(key)) return { ok: false, error: "invalid_field_key" };
  if (!input.label_en.trim()) return { ok: false, error: "invalid_input" };
  const { data, error } = await callAdminFunction("admin_upsert_esign_template_field", {
    p_field: {
      template_id: input.template_id,
      field_key: key,
      label_en: input.label_en.trim(),
      label_ar: input.label_ar ?? "",
      field_type: input.field_type ?? "text",
      options: input.options ?? [],
      is_required: input.is_required ?? false,
      sort_order: input.sort_order ?? 0,
      source_kind: input.source_kind ?? "entry",
      section_key: input.section_key ?? "document",
      options_source: input.options_source ?? "",
      preview_value: input.preview_value ?? "",
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
  const error = await deleteDoc(COLLECTIONS.esignTemplateFields, id);
  if (error) return { ok: false, error };
  await logAdminMutation({
    action: "delete",
    entityType: "esign_template_fields",
    entityId: id,
    routeName: "esign.templates.field.delete",
  });
  return { ok: true };
}

async function resolveEmployeesOnClient(
  employeeIds: string[],
  asWorker: boolean,
): Promise<{ rows: EsignResolveRow[]; error?: string }> {
  const { data, error } = await callRpc(asWorker)(
    asWorker ? "esign_worker_resolve_employees" : "admin_esign_resolve_employees",
    { p_rows: employeeIds.map((employee_id) => ({ employee_id })) },
  );
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

export async function resolveEsignEmployees(
  employeeIds: string[],
): Promise<{ rows: EsignResolveRow[]; error?: string }> {
  await requireRequestsManage();
  return resolveEmployeesOnClient(employeeIds, false);
}

export async function fetchEsignSnapshot(
  driverId: string,
): Promise<{ snapshot: EsignEmployeeSnapshot | null; error?: string }> {
  await requireRequestsManage();
  const { data, error } = await callAdminFunction("esign_employee_snapshot", {
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
    // Carried through so a row the author placed in the employee tab prints in
    // the employee block, which is where the builder's preview draws it.
    section: f.section_key,
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
  bytes: Uint8Array,
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const storage = await getFirebaseStorage();
  if (!storage) return { ok: false, error: "not_configured" };
  const key = `admin/${crypto.randomUUID()}.pdf`;
  try {
    const file = storage.bucket().file(`${ESIGN_BUCKET}/${key}`);
    const [exists] = await file.exists();
    if (exists) return { ok: false, error: "already_exists" };
    await file.save(Buffer.from(bytes), { contentType: "application/pdf", resumable: false });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "upload_failed" };
  }
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
  resent_from_id?: string | null;
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
    const upload = await uploadPdfBytes(pdf);
    if (!upload.ok) return { ok: false, error: upload.error };

    const { data, error } = await callAdminFunction("admin_create_esign_request", {
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
    const id = result.id != null ? String(result.id) : undefined;
    if (id && input.resent_from_id) {
      const linked = await callAdminFunction("admin_link_esign_resend", {
        p_id: id,
        p_from_id: input.resent_from_id,
      });
      if (linked.error) return { ok: false, error: linked.error.message };
      const linkPayload = asRecord(linked.data);
      if (linkPayload.ok === false) {
        return { ok: false, error: String(linkPayload.error ?? "invalid_resend") };
      }
    }
    return {
      ok: true,
      id,
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
  const { data, error } = await callAdminFunction("admin_create_esign_batch", {
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

/**
 * Reminds the riders holding an unfinished document.
 *
 * The RPC skips anything that is already `signed`, `declined`, `expired` or
 * `cancelled`, and it enforces `app_settings.esign_reminder_cooldown_hours`
 * against `last_reminded_at` — the server is the lock, so a "Remind all" pressed
 * twice sends once. It also delivers the reminder through
 * `notify_driver_transactional`, which is why the count returned here is
 * reminders that actually reached an inbox rather than rows whose counter moved.
 *
 * The two skip buckets are returned rather than folded into `sent`. An operator
 * who asked for twelve reminders and got nine deserves to know whether the other
 * three had already signed or had been reminded this morning — those are
 * different follow-ups, and "sent: 9" alone reads as a failure.
 */
export async function remindEsignRequests(
  ids: string[],
  message?: string | null,
): Promise<{
  ok: boolean;
  sent: number;
  skippedStage: number;
  skippedCooldown: number;
  cooldownHours: number;
  error?: string;
}> {
  await requireRequestsManage();
  if (ids.length === 0) {
    return {
      ok: false,
      sent: 0,
      skippedStage: 0,
      skippedCooldown: 0,
      cooldownHours: 0,
      error: "no_ids",
    };
  }
  const { data, error } = await callAdminFunction("admin_remind_esign_requests", {
    p_ids: ids,
    p_message: message?.trim() || undefined,
  });
  if (error) {
    return {
      ok: false,
      sent: 0,
      skippedStage: 0,
      skippedCooldown: 0,
      cooldownHours: 0,
      error: error.message,
    };
  }
  const payload = asRecord(data);
  if (payload.ok === false) {
    return {
      ok: false,
      sent: 0,
      skippedStage: 0,
      skippedCooldown: 0,
      cooldownHours: 0,
      error: String(payload.error ?? "failed"),
    };
  }
  await logAdminMutation({
    action: "update",
    entityType: "esign_requests",
    entityId: ids[0],
    routeName: "esign.remind",
    after: {
      sent: payload.sent,
      skipped_stage: payload.skipped_stage,
      skipped_cooldown: payload.skipped_cooldown,
    },
  });
  return {
    ok: true,
    sent: Number(payload.sent ?? 0),
    skippedStage: Number(payload.skipped_stage ?? 0),
    skippedCooldown: Number(payload.skipped_cooldown ?? 0),
    cooldownHours: Number(payload.cooldown_hours ?? 0),
  };
}

/**
 * The reminder cooldown, per recipient, from the same predicate the send uses.
 *
 * Read rather than computed from `last_reminded_at` in the browser: the window
 * is a setting, and a countdown derived on the client would keep offering a
 * button the server refuses the moment an operator changes
 * `esign_reminder_cooldown_hours`.
 */
export async function fetchEsignReminderState(
  ids: string[],
): Promise<{ state: EsignReminderState; error?: string }> {
  await requireRequestsManage();
  const empty: EsignReminderState = { cooldownHours: 0, rows: [] };
  if (ids.length === 0) return { state: empty };
  const { data, error } = await callAdminFunction("admin_esign_reminder_state", {
    p_ids: ids,
  });
  if (error) return { state: empty, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) return { state: empty, error: String(payload.error ?? "failed") };
  const raw = Array.isArray(payload.rows) ? payload.rows : [];
  return {
    state: {
      cooldownHours: Number(payload.cooldown_hours ?? 0),
      rows: raw.map((row) => {
        const r = asRecord(row);
        return {
          id: String(r.id),
          request_code: String(r.request_code ?? ""),
          status: String(r.status ?? "pending"),
          viewed_at: r.viewed_at != null ? String(r.viewed_at) : null,
          last_reminded_at: r.last_reminded_at != null ? String(r.last_reminded_at) : null,
          reminder_count: Number(r.reminder_count ?? 0),
          hours_left: Number(r.hours_left ?? 0),
        };
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Tracker reads
// ---------------------------------------------------------------------------

/**
 * Every recipient a batch tracker needs to draw its progress, in one read.
 *
 * Deliberately a separate, narrow select rather than `fetchEsignRequestsList`:
 * the tracker list shows twenty-five batches, each with a progress cell and a
 * stage, and the full list row carries a title, category, description, signer
 * name and screenshot flag per recipient — a screen of text none of those cells
 * render. One read of four columns is what makes the tracker's first paint cheap
 * enough to sit above a table.
 */
export async function fetchEsignTrackerRecipients(
  limit = 4000,
): Promise<{ recipients: EsignTrackerRecipient[]; error?: string }> {
  await requireRequestsManage();
  const listed = await listDocs(COLLECTIONS.esignRequests);
  if (listed.error) return { recipients: [], error: listed.error };
  const cap = Math.max(1, Math.min(limit, 20000));
  const data = sortRows(
    listed.rows.filter((row) => row.batch_id != null && String(row.batch_id) !== ""),
    [["created_at", "desc"]],
  ).slice(0, cap);
  const todayYmd = kuwaitTodayYmd();
  return {
    recipients: data.map((row) => ({
      id: String(row.id),
      batch_id: String(row.batch_id),
      request_code: String(row.request_code ?? ""),
      // Resolved through the same helper the list RPC's `display_status` uses,
      // so a recipient that is old and unopened reads `expired` in both places
      // and the stage the tracker draws is the stage the server derived.
      status: effectiveEsignStatus(
        String(row.status ?? "pending"),
        row.due_at != null ? String(row.due_at) : null,
        todayYmd,
      ),
      viewed_at: row.viewed_at != null ? String(row.viewed_at) : null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Batch row repair (F3) and failed-chunk retry (F10)
// ---------------------------------------------------------------------------

/**
 * Fix a row that failed to send, and let it be claimed again.
 *
 * The RPC refuses a row that already produced a document (`already_sent`).
 * That refusal is the feature: `created` means a `SIG-####` exists, has been
 * pushed to a rider and may be signed, so rewriting its employee id would not
 * edit a document — it would detach the row from one.
 */
export async function updateEsignBatchRow(input: {
  row_id: string;
  employee_id: string;
  field_values?: Record<string, string> | null;
}): Promise<{ ok: boolean; status?: string; error?: string }> {
  await requireRequestsManage();
  const { data, error } = await callAdminFunction("admin_update_esign_batch_row", {
    p_row_id: input.row_id,
    p_employee_id: input.employee_id,
    p_field_values: input.field_values ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) return { ok: false, error: String(payload.error ?? "failed") };
  await logAdminMutation({
    action: "update",
    entityType: "esign_batch_rows",
    entityId: input.row_id,
    routeName: "esign.batch.row.update",
    after: { status: payload.status },
  });
  return { ok: true, status: payload.status != null ? String(payload.status) : undefined };
}

export async function removeEsignBatchRow(
  rowId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const { data, error } = await callAdminFunction("admin_remove_esign_batch_row", {
    p_row_id: rowId,
  });
  if (error) return { ok: false, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) return { ok: false, error: String(payload.error ?? "failed") };
  await logAdminMutation({
    action: "delete",
    entityType: "esign_batch_rows",
    entityId: rowId,
    routeName: "esign.batch.row.remove",
  });
  return { ok: true };
}

export type EsignBatchChunkMode = "pending" | "failed" | "all";

export async function fetchEsignBatches(): Promise<{
  rows: EsignBatchRow[];
  error?: string;
}> {
  await requireRequestsManage();
  const listed = await listDocs(COLLECTIONS.esignBatches);
  if (listed.error) return { rows: [], error: listed.error };
  const templates = await docsByIds(
    COLLECTIONS.esignTemplates,
    listed.rows.map((row) => String(row.template_id ?? "")),
  );
  const templateById = new Map(templates.map((row) => [row.id, row]));
  await logAdminRead("esign_batches", "esign.batches.list", {});
  return {
    rows: sortRows(listed.rows, [["created_at", "desc"]])
      .slice(0, 200)
      .map((row) => {
        const template = templateById.get(String(row.template_id ?? ""));
        return mapBatch({
          ...row,
          esign_templates: template ? { name_en: template.name_en } : null,
        });
      }),
  };
}

export async function fetchEsignBatchKpis(): Promise<{
  kpis: EsignBatchKpis | null;
  error?: string;
}> {
  await requireRequestsManage();
  const { data, error } = await callAdminFunction("admin_esign_batch_kpis");
  if (error) return { kpis: null, error: error.message };
  const kpis = parseEsignBatchKpis(asRecord(data));
  return { kpis };
}

export async function fetchEsignBatch(id: string): Promise<{
  batch: EsignBatchRow | null;
  lines: EsignBatchLine[];
  error?: string;
}> {
  await requireRequestsManage();
  const [batchLoaded, lineRows] = await Promise.all([
    getDoc(COLLECTIONS.esignBatches, id),
    queryDocs(COLLECTIONS.esignBatchRows, [["batch_id", id]]),
  ]);
  if (batchLoaded.error) return { batch: null, lines: [], error: batchLoaded.error };
  if (!batchLoaded.row) return { batch: null, lines: [] };
  const template = batchLoaded.row.template_id
    ? await getDoc(COLLECTIONS.esignTemplates, String(batchLoaded.row.template_id))
    : { row: null as DocRow | null, error: null };
  const requests = await docsByIds(
    COLLECTIONS.esignRequests,
    lineRows.rows.map((row) => String(row.esign_request_id ?? "")),
  );
  const requestById = new Map(requests.map((row) => [row.id, row]));
  const data = {
    ...batchLoaded.row,
    esign_templates: template.row ? { name_en: template.row.name_en } : null,
  };
  const lines = sortRows(lineRows.rows, [["row_index", "asc"]]).map((row) => ({
    ...row,
    esign_requests: row.esign_request_id
      ? (requestById.get(String(row.esign_request_id)) ?? null)
      : null,
  }));
  await logAdminRead("esign_batches", "esign.batches.detail", { id });
  const todayYmd = kuwaitTodayYmd();
  return {
    batch: mapBatch(data),
    lines: lines.map((line) => {
      const row: DocRow = line;
      const req = asRecord(row.esign_requests);
      const recipientStatus = req.status != null ? String(req.status) : null;
      const recipientDue = req.due_at != null ? String(req.due_at) : null;
      const recipientViewed = req.viewed_at != null ? String(req.viewed_at) : null;
      // The recipient's stage is derived from the row's existing
      // `esign_requests` embed rather than a second query: the batch detail
      // draws the uploaded row *and* the state its recipient reached, and those
      // have to come from one read or the two columns can describe two
      // different attempts. `esignRecipientStage` is the same helper the tracker
      // list uses, and it reads the status *after* expiry has been applied, so
      // an overdue unopened row reads `expired` here exactly as the RPC reads
      // it for the tracker.
      const stage = recipientStatus
        ? esignRecipientStage({
            status: effectiveEsignStatus(recipientStatus, recipientDue, todayYmd),
            viewed_at: recipientViewed,
          })
        : undefined;
      return {
        id: String(row.id),
        row_index: Number(row.row_index ?? 0),
        employee_id: row.employee_id != null ? String(row.employee_id) : null,
        driver_id: row.driver_id != null ? String(row.driver_id) : null,
        status: String(row.status ?? "pending") as EsignBatchRowStatus,
        error: row.error != null ? String(row.error) : null,
        request_id: row.esign_request_id != null ? String(row.esign_request_id) : null,
        request_code: req.request_code != null ? String(req.request_code) : null,
        field_values: (() => {
          const raw = asRecord(row.field_values);
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(raw)) out[k] = String(v ?? "");
          return Object.keys(out).length ? out : undefined;
        })(),
        description: row.description != null ? String(row.description) : null,
        recipient_stage: stage,
        last_reminded_at: req.last_reminded_at != null ? String(req.last_reminded_at) : null,
        reminder_count: Number(req.reminder_count ?? 0),
        recipient_status: recipientStatus,
        recipient_viewed_at: recipientViewed,
        recipient_due_at: recipientDue,
        signer_display_name:
          req.signer_display_name != null ? String(req.signer_display_name) : null,
        declined_reason: (() => {
          const meta = asRecord(req.signer_meta);
          const reason = meta.declined_reason;
          return reason != null && String(reason).trim() !== "" ? String(reason) : null;
        })(),
      };
    }),
  };
}

async function recountBatch(batchId: string) {
  const listed = await queryDocs(COLLECTIONS.esignBatchRows, [["batch_id", batchId]]);
  const rows = listed.rows;
  const created = rows.filter((r) => r.status === "created").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const pending = rows.filter((r) => r.status === "pending").length;
  const status: EsignBatchStatus =
    pending > 0 ? "processing" : failed > 0 ? "partial" : "completed";
  await patchDoc(COLLECTIONS.esignBatches, batchId, {
    created_count: created,
    failed_count: failed,
    status,
    updated_at: new Date(),
  });
  return { created, failed, pending, status };
}

/**
 * Send one chunk of a batch's rows, or re-send one chunk of the ones that failed.
 *
 * `mode` is passed straight through to the claim, which is the only thing that
 * decides which rows move. It is a real argument rather than a client-side
 * filter because the claim is what holds the row lock: filtering in TypeScript
 * would hand the worker rows another concurrent claim had already taken.
 */
export async function runEsignBatchChunk(input: {
  batchId: string;
  mode?: EsignBatchChunkMode;
  asWorker?: boolean;
  actorId?: string | null;
}): Promise<{
  ok: boolean;
  processed: number;
  created: number;
  failed: number;
  remaining: number;
  batch_status?: EsignBatchStatus;
  error?: string;
}> {
  const mode = input.mode ?? "pending";
  const { data, error } = await callRpc(Boolean(input.asWorker))(
    input.asWorker ? "esign_worker_claim_batch_rows" : "admin_claim_esign_batch_rows",
    {
      p_batch_id: input.batchId,
      p_limit: CHUNK_SIZE,
      p_mode: mode,
      ...(input.asWorker ? { p_actor: input.actorId ?? null } : {}),
    },
  );
  if (error) return { ok: false, processed: 0, created: 0, failed: 0, remaining: 0, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) {
    return { ok: false, processed: 0, created: 0, failed: 0, remaining: 0, error: String(payload.error ?? "failed") };
  }
  const claimed = Array.isArray(payload.rows) ? payload.rows.map(asRecord) : [];
  if (claimed.length === 0) {
    const totals = await recountBatch(input.batchId);
    return {
      ok: true,
      processed: 0,
      created: totals.created,
      failed: totals.failed,
      remaining: totals.pending,
      batch_status: totals.status,
    };
  }

  const batchRow = await getDoc(COLLECTIONS.esignBatches, input.batchId);
  const batch: DocRow = batchRow.row ?? { id: input.batchId };
  const loaded = await loadEsignTemplate(String(batch.template_id ?? ""));
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
      let snapshot = null as EsignEmployeeSnapshot | null | undefined;
      if (driverId && !input.asWorker) {
        const { data: snapData, error: snapError } = await callAdminFunction(
          "esign_employee_snapshot",
          { p_driver_id: driverId },
        );
        if (!snapError) snapshot = mapSnapshot(snapData) ?? null;
      }
      if (!snapshot || !driverId) {
        const resolved = await resolveEmployeesOnClient([employeeId], Boolean(input.asWorker));
        const hit = resolved.rows[0];
        if (!hit?.ok || !hit.driver_id || !hit.snapshot) {
          await patchDoc(COLLECTIONS.esignBatchRows, rowId, {
            status: "failed",
            error: hit?.status ?? resolved.error ?? "unknown_id",
            updated_at: new Date(),
          });
          failed += 1;
          continue;
        }
        driverId = hit.driver_id;
        snapshot = hit.snapshot;
        await patchDoc(COLLECTIONS.esignBatchRows, rowId, { driver_id: driverId });
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
        const upload = await uploadPdfBytes(pdf);
        if (!upload.ok) throw new Error(upload.error);
        const { data: createdRow, error: createError } = await callRpc(Boolean(input.asWorker))(
          input.asWorker ? "esign_worker_create_request" : "admin_create_esign_request",
          {
            p_driver_id: driverId,
            p_title: title,
            p_category_key: loaded.template.category_key,
            p_due_at: dueAt || undefined,
            p_document_storage_key: upload.key,
            p_screenshot_restricted: undefined,
            p_template_id: loaded.template.id,
            p_batch_id: input.batchId,
            p_batch_row: rowIndex,
            p_description: row.description || undefined,
            p_field_values: values,
            ...(input.asWorker ? { p_actor: input.actorId ?? null } : {}),
          },
        );
        if (createError) throw new Error(createError.message);
        const result = asRecord(createdRow);
        if (result.ok === false) throw new Error(String(result.error ?? "failed"));
        created += 1;
      } catch (err) {
        await patchDoc(COLLECTIONS.esignBatchRows, rowId, {
          status: "failed",
          error: err instanceof Error ? err.message : "render_failed",
          updated_at: new Date(),
        });
        failed += 1;
      }
    }
  } finally {
    await browser.close();
  }

  const totals = await recountBatch(input.batchId);
  return {
    ok: true,
    processed: claimed.length,
    created: totals.created,
    failed: totals.failed,
    remaining: totals.pending,
    batch_status: totals.status,
  };
}

export async function processEsignBatchChunk(
  batchId: string,
  mode: EsignBatchChunkMode = "pending",
): Promise<{
  ok: boolean;
  processed: number;
  created: number;
  failed: number;
  remaining: number;
  batch_status?: EsignBatchStatus;
  error?: string;
}> {
  await requireRequestsManage();
  return runEsignBatchChunk({ batchId, mode });
}

/**
 * Re-send every row that failed, in chunks, and stop when the failures stop
 * shrinking.
 *
 * The loop is bounded by an input hash rather than a count, because a row that
 * fails identically every time (an employee id that does not exist) would
 * otherwise spin until the request budget ran out and the operator would never
 * learn which row was the problem. Termination is "the failed set did not get
 * smaller", which is the property the operator actually cares about.
 */
export async function retryFailedEsignBatchRows(batchId: string): Promise<{
  ok: boolean;
  attempted: number;
  created: number;
  failed: number;
  remaining: number;
  batch_status?: EsignBatchStatus;
  error?: string;
}> {
  await requireRequestsManage();
  const before = await queryDocs(COLLECTIONS.esignBatchRows, [
    ["batch_id", batchId],
    ["status", "failed"],
  ]);
  let previous = before.rows.length;

  let attempted = 0;
  let created = 0;
  let failed = previous;
  let remaining = 0;
  let batchStatus: EsignBatchStatus | undefined;
  let maxChunks = 40;

  while (previous > 0 && maxChunks > 0) {
    const chunk = await processEsignBatchChunk(batchId, "failed");
    if (!chunk.ok) {
      return {
        ok: false,
        attempted,
        created,
        failed,
        remaining,
        batch_status: batchStatus,
        error: chunk.error,
      };
    }
    attempted += chunk.processed;
    created = chunk.created;
    failed = chunk.failed;
    remaining = chunk.remaining;
    batchStatus = chunk.batch_status;
    const after = await queryDocs(COLLECTIONS.esignBatchRows, [
      ["batch_id", batchId],
      ["status", "failed"],
    ]);
    const now = after.rows.length;
    if (now >= previous) break;
    previous = now;
    maxChunks -= 1;
  }

  return { ok: true, attempted, created, failed, remaining, batch_status: batchStatus };
}

// ---------------------------------------------------------------------------
// Drafts (F11)
// ---------------------------------------------------------------------------

function mapDraft(r: Record<string, unknown>): EsignDraftRow {
  return {
    id: String(r.id),
    kind: r.kind === "bulk" ? "bulk" : "single",
    template_id: r.template_id != null ? String(r.template_id) : null,
    template_name: r.template_name != null ? String(r.template_name) : null,
    template_version: r.template_version != null ? Number(r.template_version) : null,
    language: r.language === "ar" ? "ar" : "en",
    title: r.title != null ? String(r.title) : null,
    due_at: r.due_at != null ? String(r.due_at) : null,
    description: r.description != null ? String(r.description) : null,
    source_filename: r.source_filename != null ? String(r.source_filename) : null,
    row_count: Number(r.row_count ?? 0),
    created_by_id: r.created_by_id != null ? String(r.created_by_id) : null,
    created_by_name: r.created_by_name != null ? String(r.created_by_name) : null,
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

/**
 * Save (create or update) a draft.
 *
 * Nothing is rendered, nothing is uploaded and no `SIG-####` is allocated — a
 * draft that reserved codes would burn the sequence on work that never gets
 * sent and would put requests in riders' inboxes for documents nobody sent. The
 * row count and payload caps live in the RPC, which is where they can return an
 * actionable sentence rather than a constraint name.
 */
export async function saveEsignDraft(input: {
  id?: string | null;
  kind: EsignDraftKind;
  template_id?: string | null;
  template_version?: number | null;
  language: EsignLocale;
  title?: string | null;
  due_at?: string | null;
  description?: string | null;
  field_values?: Record<string, string>;
  rows?: Array<{
    employee_id: string;
    driver_id?: string;
    description?: string;
    field_values?: Record<string, string>;
  }>;
  source_filename?: string | null;
}): Promise<{ ok: boolean; id?: string; rows?: number; error?: string }> {
  await requireRequestsManage();
  const { data, error } = await callAdminFunction("admin_save_esign_draft", {
    p_draft: {
      id: input.id ?? null,
      kind: input.kind,
      template_id: input.template_id ?? null,
      template_version: input.template_version ?? null,
      language: input.language,
      title: input.title ?? "",
      due_at: input.due_at ?? "",
      description: input.description ?? "",
      field_values: input.field_values ?? {},
      rows: input.rows ?? [],
      source_filename: input.source_filename ?? "",
    },
  });
  if (error) return { ok: false, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) return { ok: false, error: String(payload.error ?? "failed") };
  return {
    ok: true,
    id: payload.id != null ? String(payload.id) : undefined,
    rows: Number(payload.rows ?? 0),
  };
}

export async function fetchEsignDrafts(
  limit = 50,
): Promise<{ rows: EsignDraftRow[]; error?: string }> {
  await requireRequestsManage();
  const { data, error } = await callAdminFunction("admin_list_esign_drafts", {
    p_limit: limit,
  });
  if (error) return { rows: [], error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) return { rows: [], error: String(payload.error ?? "failed") };
  const raw = Array.isArray(payload.rows) ? payload.rows : [];
  return { rows: raw.map((row) => mapDraft(asRecord(row))) };
}

export async function fetchEsignDraft(
  id: string,
): Promise<{ draft: EsignDraftDetail | null; error?: string }> {
  await requireRequestsManage();
  const { data, error } = await callAdminFunction("admin_get_esign_draft", { p_id: id });
  if (error) return { draft: null, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) return { draft: null, error: String(payload.error ?? "failed") };
  const raw = asRecord(payload.draft);
  if (!raw.id) return { draft: null, error: "not_found" };
  const fieldValues = asRecord(raw.field_values);
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(fieldValues)) values[k] = String(v ?? "");
  const rowsRaw = Array.isArray(raw.rows) ? raw.rows : [];
  return {
    draft: {
      ...mapDraft(raw),
      field_values: values,
      rows: rowsRaw.map((row) => {
        const r = asRecord(row);
        const fv = asRecord(r.field_values);
        const rowValues: Record<string, string> = {};
        for (const [k, v] of Object.entries(fv)) rowValues[k] = String(v ?? "");
        return {
          employee_id: String(r.employee_id ?? ""),
          driver_id: r.driver_id != null ? String(r.driver_id) : undefined,
          description: r.description != null ? String(r.description) : undefined,
          field_values: rowValues,
        };
      }),
    },
  };
}

export async function deleteEsignDraft(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const { data, error } = await callAdminFunction("admin_delete_esign_draft", { p_id: id });
  if (error) return { ok: false, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) return { ok: false, error: String(payload.error ?? "failed") };
  await logAdminMutation({
    action: "delete",
    entityType: "esign_drafts",
    entityId: id,
    routeName: "esign.drafts.delete",
  });
  return { ok: true };
}
