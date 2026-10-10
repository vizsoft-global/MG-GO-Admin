"use server";

import type { DocumentData, Firestore, Query } from "firebase-admin/firestore";
import { callAdminFunction } from "@/lib/firebase/callable";
import { getFirebaseStorage } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { effectiveEsignStatus, isEsignDueDateAllowed } from "./esign-due-date";
import { esignDocumentHref } from "./esign-storage-key";
import { esignRecipientStage, isEsignRecipientStage } from "./esign-recipient-stage";
import type {
  EsignCategoryRow,
  EsignDetail,
  EsignDriverOption,
  EsignListFilters,
  EsignListRow,
  EsignRequestStatus,
  EsignStatusCounts,
} from "./types";

async function requireRequestsView() {
  const session = await getSessionUser();
  if (
    !session ||
    (!hasPermissionInSet(session.permissions, "requests.view", session.isSuperAdmin) &&
      !hasPermissionInSet(session.permissions, "employeedesk.view", session.isSuperAdmin) &&
      !hasPermissionInSet(session.permissions, "requests.manage", session.isSuperAdmin))
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

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
const APP_SETTINGS_DOC_ID = "1";

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

async function countDocs(
  name: string,
  filters: Array<[string, unknown]>,
): Promise<{ count: number; error: string | null }> {
  const db = await openDb();
  if (!db) return { count: 0, error: "not_configured" };
  try {
    let q: Query = db.collection(name);
    for (const [field, value] of filters) q = q.where(field, "==", value);
    const snap = await q.count().get();
    return { count: snap.data().count, error: null };
  } catch {
    const listed = await queryDocs(name, filters);
    return { count: listed.rows.length, error: listed.error };
  }
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

async function insertDoc(
  name: string,
  data: Record<string, unknown>,
): Promise<{ id?: string; error?: string }> {
  const db = await openDb();
  if (!db) return { error: "not_configured" };
  const id = crypto.randomUUID();
  try {
    await db.collection(name).doc(id).set({ ...data, id });
    return { id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "write_failed" };
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
    template_id: r.template_id != null ? String(r.template_id) : null,
    template_name: r.template_name != null ? String(r.template_name) : null,
    batch_id: r.batch_id != null ? String(r.batch_id) : null,
    batch_code: r.batch_code != null ? String(r.batch_code) : null,
    description: r.description != null ? String(r.description) : null,
    // The server derives the recipient stage in `admin_list_esign_requests`
    // beside `display_status`. Read when present so the tracker and the RPC
    // cannot disagree, and left undefined when a caller's payload predates the
    // column — `esignRecipientStage` then derives the same answer locally.
    recipient_stage: isEsignRecipientStage(r.recipient_stage)
      ? r.recipient_stage
      : undefined,
    last_reminded_at: r.last_reminded_at != null ? String(r.last_reminded_at) : null,
    reminder_count: Number(r.reminder_count ?? 0),
  };
}

export async function fetchEsignRequestsList(
  filters: EsignListFilters = {},
): Promise<{ rows: EsignListRow[]; error?: string }> {
  await requireRequestsManage();
  const { data, error } = await callAdminFunction("admin_list_esign_requests", {
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
  let rows = rowsRaw.map((row) => mapListRow(asRecord(row)));

  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    const extras = await docsByIds(COLLECTIONS.esignRequests, ids);
    const templates = await docsByIds(
      COLLECTIONS.esignTemplates,
      extras.map((row) => (row.template_id != null ? String(row.template_id) : "")),
    );
    const batches = await docsByIds(
      COLLECTIONS.esignBatches,
      extras.map((row) => (row.batch_id != null ? String(row.batch_id) : "")),
    );
    const byId = new Map(extras.map((row) => [row.id, row]));
    const templateName = new Map(
      templates.map((row) => [row.id, row.name_en != null ? String(row.name_en) : null]),
    );
    const batchCode = new Map(
      batches.map((row) => [row.id, row.batch_code != null ? String(row.batch_code) : null]),
    );
    rows = rows.map((row) => {
      const extra = byId.get(row.id);
      if (!extra) return row;
      const templateId = extra.template_id != null ? String(extra.template_id) : null;
      const batchId = extra.batch_id != null ? String(extra.batch_id) : null;
      return {
        ...row,
        template_id: templateId,
        template_name: templateId ? (templateName.get(templateId) ?? null) : null,
        batch_id: batchId,
        batch_code: batchId ? (batchCode.get(batchId) ?? null) : null,
        description: extra.description != null ? String(extra.description) : null,
      };
    });
  }

  if (filters.template_id) {
    rows = rows.filter((r) => r.template_id === filters.template_id);
  }
  if (filters.batch_id) {
    rows = rows.filter((r) => r.batch_id === filters.batch_id);
  }

  await logAdminRead("esign_requests", "esign.list", {
    status: filters.status ?? null,
    count: rows.length,
  });

  return { rows };
}

/** KPI + tab counts for the Sent requests / E-signatures lists (Figma ESign 01 & 02). */
export async function fetchEsignStatusCounts(): Promise<EsignStatusCounts> {
  await requireRequestsManage();
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  const [requests, categories] = await Promise.all([
    listDocs(COLLECTIONS.esignRequests),
    countDocs(COLLECTIONS.esignCategories, [["is_active", true]]),
  ]);

  const today = kuwaitTodayYmd();
  const rows = requests.rows.map((row) => ({
    status: String(row.status ?? ""),
    due_at: row.due_at != null ? String(row.due_at) : null,
    created_at: row.created_at != null ? String(row.created_at) : null,
    signed_at: row.signed_at != null ? String(row.signed_at) : null,
    viewed_at: row.viewed_at != null ? String(row.viewed_at) : null,
  }));
  const count = (status: string) =>
    rows.filter((row) => effectiveEsignStatus(row.status, row.due_at, today) === status).length;
  /**
   * The opened / not-opened split, derived exactly the way the list RPC derives
   * it: terminal status first, then expiry, then the `viewed_at` test.
   *
   * Taking the effective status first is what keeps the tile honest — an
   * overdue-but-unopened row is `expired` on both sides, so it is in neither
   * half rather than inflating "not opened" with work that is no longer the
   * operator's to chase. `esignRecipientStage` is the same helper the tracker
   * and the batch detail use, so there is one rule and not three.
   */
  const recipientStageCount = (stage: "opened" | "not_opened") =>
    rows.filter(
      (row) =>
        esignRecipientStage({
          status: effectiveEsignStatus(row.status, row.due_at, today),
          viewed_at: row.viewed_at,
        }) === stage,
    ).length;

  return {
    all: rows.length,
    pending: count("pending"),
    signed: count("signed"),
    declined: count("declined"),
    expired: count("expired"),
    cancelled: count("cancelled"),
    opened: recipientStageCount("opened"),
    notOpened: recipientStageCount("not_opened"),
    signedLast30d: rows.filter((row) => row.signed_at != null && row.signed_at >= since).length,
    sentLast30d: rows.filter((row) => row.created_at != null && row.created_at >= since).length,
    categories: categories.count,
  };
}

export async function fetchEsignRequestDetail(
  id: string,
): Promise<{ request: EsignDetail | null; error?: string }> {
  await requireRequestsManage();
  const loaded = await getDoc(COLLECTIONS.esignRequests, id);
  if (loaded.error) return { request: null, error: loaded.error };
  if (!loaded.row) return { request: null };

  const row = loaded.row;
  const driverId = row.driver_id != null ? String(row.driver_id) : "";
  const [driver, profile, categories] = await Promise.all([
    driverId ? getDoc(COLLECTIONS.drivers, driverId) : Promise.resolve({ row: null, error: null }),
    driverId ? getDoc(COLLECTIONS.profiles, driverId) : Promise.resolve({ row: null, error: null }),
    row.category_key != null
      ? queryDocs(COLLECTIONS.esignCategories, [["key", String(row.category_key)]])
      : Promise.resolve({ rows: [] as DocRow[], error: null }),
  ]);
  const drivers: DocRow = driver.row ?? { id: "" };
  const profiles: DocRow = profile.row ?? { id: "" };
  const category: DocRow = categories.rows[0] ?? { id: "" };

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
const COMPOSE_TIMEOUT_MS = 120_000;

async function maybeComposeSignedCopy(id: string, row: DocRow): Promise<DocRow> {
  if (String(row.status ?? "") !== "signed") return row;
  if (hasStorageKey(row.signed_document_storage_key)) return row;
  if (row.signed_document_error != null && String(row.signed_document_error).trim() !== "") return row;
  const composed = await callAdminFunction(
    "esign_compose_signed_document",
    { p_request_id: id },
    { timeoutMs: COMPOSE_TIMEOUT_MS },
  );
  if (composed.error) return row;
  const again = await getDoc(COLLECTIONS.esignRequests, id);
  return again.row ?? row;
}

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
  const loaded = await getDoc(COLLECTIONS.esignRequests, id);
  if (loaded.error) {
    return {
      documentUrl: null,
      signatureUrl: null,
      signedDocumentUrl: null,
      signedDocumentError: null,
      error: loaded.error,
    };
  }
  let row: DocRow = loaded.row ?? { id: "" };
  row = await maybeComposeSignedCopy(id, row);

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

  const storage = await getFirebaseStorage();
  if (!storage) return { ok: false, error: "not_configured" };
  const key = `admin/${crypto.randomUUID()}.${ext}`;
  try {
    const object = storage.bucket().file(`${ESIGN_BUCKET}/${key}`);
    const [exists] = await object.exists();
    if (exists) return { ok: false, error: "already_exists" };
    await object.save(Buffer.from(await file.arrayBuffer()), {
      contentType: file.type,
      resumable: false,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "upload_failed" };
  }
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
  const { data, error } = await callAdminFunction("admin_create_esign_request", {
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
  await requireRequestsView();
  const listed = await listDocs(COLLECTIONS.esignCategories);
  if (listed.error) return { rows: [], error: listed.error };

  const signedRows = await queryDocs(COLLECTIONS.esignRequests, [["status", "signed"]]);
  const signedByKey = new Map<string, number>();
  for (const row of signedRows.rows) {
    if (row.category_key == null) continue;
    const key = String(row.category_key);
    signedByKey.set(key, (signedByKey.get(key) ?? 0) + 1);
  }

  await logAdminRead("esign_categories", "esign.categories.list", {});

  return {
    rows: sortRows(listed.rows, [
      ["sort_order", "asc"],
      ["label_en", "asc"],
    ]).map((row) => ({
      id: row.id,
      key: String(row.key ?? ""),
      label_en: String(row.label_en ?? ""),
      description: row.description != null ? String(row.description) : null,
      icon_key: row.icon_key != null ? String(row.icon_key) : null,
      screenshot_restricted: Boolean(row.screenshot_restricted),
      is_active: Boolean(row.is_active),
      sort_order: Number(row.sort_order ?? 0),
      parent_key: row.parent_key != null ? String(row.parent_key) : null,
      signed_count: signedByKey.get(String(row.key ?? "")) ?? 0,
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
  const key = input.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const label_en = input.label_en.trim();
  if (!key || !label_en) return { ok: false, error: "missing_fields" };

  const existing = await queryDocs(COLLECTIONS.esignCategories, [["key", key]]);
  if (existing.rows.some((row) => row.id !== input.id)) {
    return { ok: false, error: "key_exists" };
  }

  const row = {
    key,
    label_en,
    description: input.description?.trim() || null,
    icon_key: input.icon_key?.trim().slice(0, 2) || null,
    screenshot_restricted: input.screenshot_restricted ?? false,
    is_active: input.is_active ?? true,
    sort_order: input.sort_order ?? 0,
    updated_at: new Date(),
  };

  if (input.id) {
    const error = await patchDoc(COLLECTIONS.esignCategories, input.id, row);
    if (error) return { ok: false, error };
    await logAdminMutation({
      action: "update",
      entityType: "esign_categories",
      entityId: input.id,
      routeName: "esign.categories.update",
    });
    return { ok: true, id: input.id };
  }

  const created = await insertDoc(COLLECTIONS.esignCategories, row);
  if (created.error || !created.id) return { ok: false, error: created.error ?? "write_failed" };

  await logAdminMutation({
    action: "create",
    entityType: "esign_categories",
    entityId: created.id,
    routeName: "esign.categories.create",
  });
  return { ok: true, id: created.id };
}

export async function deleteEsignCategory(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const error = await deleteDoc(COLLECTIONS.esignCategories, id);
  if (error) return { ok: false, error };

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
  const loaded = await getDoc(COLLECTIONS.appSettings, APP_SETTINGS_DOC_ID);
  if (loaded.error) return { value: true, error: loaded.error };
  return { value: loaded.row?.esign_screenshot_default !== false };
}

export async function updateEsignScreenshotDefault(
  value: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const error = await patchDoc(COLLECTIONS.appSettings, APP_SETTINGS_DOC_ID, {
    esign_screenshot_default: value,
    updated_at: new Date(),
  });
  if (error) return { ok: false, error };

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
  const listed = await queryDocs(COLLECTIONS.drivers, [["status", "active"]]);
  if (listed.error) return { rows: [], error: listed.error };
  const live = sortRows(
    listed.rows.filter((row) => row.archived_at == null),
    [["driver_code", "asc"]],
  );
  const profiles = await docsByIds(
    COLLECTIONS.profiles,
    live.map((row) => row.id),
  );
  const profileById = new Map(profiles.map((row) => [row.id, row]));

  return {
    rows: live.map((row) => {
      const profile = profileById.get(row.id);
      return {
        id: row.id,
        full_name: String(profile?.full_name ?? row.driver_code ?? "—"),
        driver_code: row.driver_code != null ? String(row.driver_code) : "",
        employee_id: row.employee_id != null ? String(row.employee_id) : null,
      };
    }),
  };
}
