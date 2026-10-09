/**
 * Bulk e-sign batches and send drafts.
 *
 * Ports `admin_create_esign_batch`, `admin_esign_batch_kpis`,
 * `admin_update_esign_batch_row`, `admin_remove_esign_batch_row`,
 * `esign_worker_drainable_batches` and the four `admin_*_esign_draft` RPCs.
 * Batch counters are always re-derived from the rows (`_esign_batch_recount`),
 * so the batch header can never print a figure no row supports.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  getFirestore,
  FieldValue,
  Timestamp,
  type DocumentReference,
  type Query,
} from "../core/fs";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { requireStaff } from "../core/staff";
import {
  BATCH_LIMIT,
  SCAN_CAP,
  chunk,
  dataOf,
  isoTimestamp,
  loadDocMap,
  numberOrNull,
  pick,
  pickCount,
  pickDay,
  pickId,
  pickInstant,
  pickObject,
  textOrNull,
  type Dict,
} from "./_shared";

const APP_SETTINGS_DOC_ID = "1";
const BATCH_CODE_COUNTER = "esign_batch_code_seq";
const BATCH_CODE_START = 1000;
const DRAFT_ROW_LIMIT = 2000;
const DRAFT_BYTE_LIMIT = 1048576;

type BatchStatus = "queued" | "processing" | "completed" | "partial";

const textOf = textOrNull;

/** Top-level Timestamps become ISO strings, matching `to_jsonb(row)`. */
function serialise(id: string, data: Dict): Dict {
  const out: Dict = { id };
  for (const [key, value] of Object.entries(data)) {
    out[key] = value instanceof Timestamp ? isoTimestamp(value) : value;
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** The wrapped payload (`batch` / `p_batch`) or, failing that, the call data itself. */
function payloadOf(data: Dict, ...names: string[]): Dict {
  return pickObject(data, ...names) ?? data;
}

/** `_esign_batch_recount` — counts and status read off the rows. */
async function recountBatch(batchId: string): Promise<void> {
  const db = getFirestore();
  const snap = await db
    .collection(COLLECTIONS.esignBatchRows)
    .where("batch_id", "==", batchId)
    .limit(SCAN_CAP + 1)
    .get();
  if (snap.size > SCAN_CAP) throw new HttpsError("out-of-range", "too_many_rows");

  let total = 0;
  let created = 0;
  let failed = 0;
  let pending = 0;
  for (const doc of snap.docs) {
    total += 1;
    const status = doc.get("status");
    if (status === "created") created += 1;
    else if (status === "failed") failed += 1;
    else if (status === "pending") pending += 1;
  }

  let status: BatchStatus;
  if (total === 0) status = "queued";
  else if (pending > 0) status = "processing";
  else if (failed > 0) status = "partial";
  else status = "completed";

  await db.collection(COLLECTIONS.esignBatches).doc(batchId).set(
    {
      total_count: total,
      created_count: created,
      failed_count: failed,
      status,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/** One-row form of `admin_esign_resolve_employees`: the status code and driver. */
async function resolveEmployee(
  employeeId: string,
): Promise<{ status: string; driverId: string | null }> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.drivers)
    .where(FIELDS.drivers.employeeId, "==", employeeId)
    .limit(2)
    .get();
  if (snap.empty) return { status: "unknown_id", driverId: null };
  if (snap.size > 1) return { status: "ambiguous", driverId: null };
  const doc = snap.docs[0];
  const driver = dataOf(doc);
  if (driver[FIELDS.drivers.archivedAt]) return { status: "archived", driverId: null };
  if (driver.is_blocked === true) return { status: "blocked", driverId: null };
  return { status: "ok", driverId: doc.id };
}

/** `admin_create_esign_batch` — header (BAT-####) plus one row per sheet row. */
export const adminCreateEsignBatch = onCall(async (request) => {
  const staff = await requireStaff(request, "requests.manage");
  const data = (request.data ?? {}) as Dict;
  const batch = payloadOf(data, "batch", "p_batch");

  const templateId = pickId(batch, "template_id", "templateId");
  if (!templateId) return { ok: false, error: "invalid_template" };

  const db = getFirestore();
  const tplSnap = await db.collection(COLLECTIONS.esignTemplates).doc(templateId).get();
  const tpl = dataOf(tplSnap);
  if (!tplSnap.exists || tpl.is_active === false) {
    return { ok: false, error: "invalid_template" };
  }

  const rawRows = pick(batch, "rows");
  const rows = Array.isArray(rawRows) ? rawRows : [];

  const counterRef = db.collection(COLLECTIONS.counters).doc(BATCH_CODE_COUNTER);
  const seq = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const last = numberOrNull(snap.get("value"));
    const next = last === null ? BATCH_CODE_START : Math.trunc(last) + 1;
    tx.set(counterRef, { value: next, updated_at: FieldValue.serverTimestamp() }, { merge: true });
    return next;
  });
  const batchCode = `BAT-${String(seq).padStart(4, "0")}`;

  const batchRef = db.collection(COLLECTIONS.esignBatches).doc();
  const now = FieldValue.serverTimestamp();
  const language =
    textOf(pick(batch, "language")) ?? textOf(tpl.default_language) ?? "en";
  const title = textOf(pick(batch, "title")) ?? textOf(tpl.name_en) ?? "";

  const header = {
    batch_code: batchCode,
    template_id: templateId,
    template_version: numberOrNull(tpl.version) ?? 1,
    language,
    title,
    due_at: pickDay(batch, "due_at", "dueAt"),
    source_filename: textOf(pick(batch, "source_filename", "sourceFilename")),
    total_count: rows.length,
    created_count: 0,
    failed_count: 0,
    status: "queued" as BatchStatus,
    created_by: staff.uid,
    created_at: now,
    updated_at: now,
  };

  const writes: Array<{ ref: DocumentReference; body: Dict }> = [
    { ref: batchRef, body: header },
  ];
  rows.forEach((value, index) => {
    const row = typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Dict)
      : {};
    const fieldValues = pickObject(row, "field_values", "fieldValues") ?? {};
    writes.push({
      ref: db.collection(COLLECTIONS.esignBatchRows).doc(),
      body: {
        batch_id: batchRef.id,
        row_index: index,
        driver_id: textOf(pick(row, "driver_id", "driverId")),
        employee_id: textOf(pick(row, "employee_id", "employeeId")),
        description: typeof row.description === "string" && row.description !== ""
          ? row.description
          : null,
        field_values: fieldValues,
        status: "pending",
        error: null,
        esign_request_id: null,
        created_at: now,
        updated_at: now,
      },
    });
  });

  for (const group of chunk(writes, BATCH_LIMIT)) {
    const wb = db.batch();
    for (const write of group) wb.set(write.ref, write.body);
    await wb.commit();
  }

  return { ok: true, id: batchRef.id, batch_code: batchCode, total: rows.length };
});

/** `admin_esign_batch_kpis` — four headline counts over the window. */
export const adminEsignBatchKpis = onCall(async (request) => {
  await requireStaff(request, "requests.view");
  const data = (request.data ?? {}) as Dict;
  const to = pickInstant(data, "to", "p_to") ?? new Date();
  const from = pickInstant(data, "from", "p_from") ?? new Date(Date.now() - 30 * 86400000);
  const fromTs = Timestamp.fromDate(from);
  const toTs = Timestamp.fromDate(to);

  const db = getFirestore();
  const requests = db.collection(COLLECTIONS.esignRequests);
  const count = async (query: Query): Promise<number> =>
    (await query.count().get()).data().count;

  const [batchesSent, waiting, fullySigned, declined] = await Promise.all([
    count(
      db
        .collection(COLLECTIONS.esignBatches)
        .where("created_at", ">=", fromTs)
        .where("created_at", "<", toTs),
    ),
    count(requests.where("status", "==", "pending")),
    count(
      requests
        .where("status", "==", "signed")
        .where("created_at", ">=", fromTs)
        .where("created_at", "<", toTs),
    ),
    count(
      requests
        .where("status", "==", "declined")
        .where("created_at", ">=", fromTs)
        .where("created_at", "<", toTs),
    ),
  ]);

  return {
    ok: true,
    batches_sent: batchesSent,
    waiting_signatures: waiting,
    fully_signed: fullySigned,
    declined,
  };
});

/**
 * `admin_update_esign_batch_row` — re-point a row at a corrected employee id.
 * A row that already produced a document is refused, and an unresolvable id is
 * stored as `failed` with its code so the Retry path treats it like a failed send.
 */
export const adminUpdateEsignBatchRow = onCall(async (request) => {
  await requireStaff(request, "requests.manage");
  const data = (request.data ?? {}) as Dict;
  const rowId = pickId(data, "rowId", "p_row_id");
  if (!rowId) return { ok: false, error: "not_found" };

  const db = getFirestore();
  const rowRef = db.collection(COLLECTIONS.esignBatchRows).doc(rowId);
  const snap = await rowRef.get();
  if (!snap.exists) return { ok: false, error: "not_found" };
  const row = dataOf(snap);
  if (row.status === "created") return { ok: false, error: "already_sent" };

  const employeeId = textOf(pick(data, "employeeId", "p_employee_id"));
  if (!employeeId) return { ok: false, error: "employee_id_required" };

  const resolved = await resolveEmployee(employeeId);
  const fieldValues = pickObject(data, "fieldValues", "p_field_values");

  const update: Dict = {
    employee_id: employeeId,
    driver_id: resolved.driverId,
    status: resolved.status === "ok" ? "pending" : "failed",
    error: resolved.status === "ok" ? null : resolved.status,
    updated_at: FieldValue.serverTimestamp(),
  };
  if (fieldValues) update.field_values = fieldValues;
  await rowRef.update(update);

  const batchId = textOf(row.batch_id);
  if (batchId) await recountBatch(batchId);

  return { ok: true, status: resolved.status };
});

/** `admin_remove_esign_batch_row` — drop an unsent row and recount. */
export const adminRemoveEsignBatchRow = onCall(async (request) => {
  await requireStaff(request, "requests.manage");
  const data = (request.data ?? {}) as Dict;
  const rowId = pickId(data, "rowId", "p_row_id");
  if (!rowId) return { ok: false, error: "not_found" };

  const rowRef = getFirestore().collection(COLLECTIONS.esignBatchRows).doc(rowId);
  const snap = await rowRef.get();
  if (!snap.exists) return { ok: false, error: "not_found" };
  const row = dataOf(snap);
  if (row.status === "created") return { ok: false, error: "already_sent" };

  await rowRef.delete();
  const batchId = textOf(row.batch_id);
  if (batchId) await recountBatch(batchId);

  return { ok: true };
});

/**
 * `esign_worker_drainable_batches` — queued/processing batches with pending rows
 * that no tab has touched inside the idle window, oldest first. The SQL is
 * service-role only; the nearest callable gate is a super admin.
 */
export const esignWorkerDrainableBatches = onCall(async (request) => {
  const staff = await requireStaff(request);
  if (!staff.isSuperAdmin) throw new HttpsError("permission-denied", "not_authorized");
  const data = (request.data ?? {}) as Dict;
  const limit = clamp(pickCount(data, 20, "limit", "p_limit"), 1, 50);

  const db = getFirestore();
  const explicitStale = pick(data, "staleMinutes", "p_stale_minutes");
  let stale: number;
  if (explicitStale !== undefined) {
    stale = Math.trunc(numberOrNull(explicitStale) ?? 10);
  } else {
    const settingsSnap = await db
      .collection(COLLECTIONS.appSettings)
      .doc(APP_SETTINGS_DOC_ID)
      .get();
    stale = Math.trunc(numberOrNull(settingsSnap.get("esign_batch_worker_minutes")) ?? 10);
  }

  let query: Query = db
    .collection(COLLECTIONS.esignBatches)
    .where("status", "in", ["queued", "processing"]);
  if (stale > 0) {
    const cutoff = Timestamp.fromMillis(Date.now() - stale * 60000);
    query = query.where("updated_at", "<", cutoff);
  }
  const snap = await query.orderBy("updated_at").limit(SCAN_CAP + 1).get();

  const rows: Dict[] = [];
  for (const doc of snap.docs.slice(0, SCAN_CAP)) {
    if (rows.length >= limit) break;
    const pendingCount = (
      await db
        .collection(COLLECTIONS.esignBatchRows)
        .where("batch_id", "==", doc.id)
        .where("status", "==", "pending")
        .count()
        .get()
    ).data().count;
    if (pendingCount <= 0) continue;
    const batch = dataOf(doc);
    rows.push({
      batch_id: doc.id,
      batch_code: batch.batch_code ?? null,
      status: batch.status ?? null,
      created_by: batch.created_by ?? null,
      updated_at: isoTimestamp(batch.updated_at),
      pending_count: pendingCount,
    });
  }
  if (rows.length < limit && snap.size > SCAN_CAP) {
    throw new HttpsError("out-of-range", "too_many_batches");
  }

  return { ok: true, rows };
});

/**
 * `admin_save_esign_draft` — create or replace a send draft. Nothing is rendered
 * and no code is allocated; the rows payload is capped here so the operator gets
 * an actionable code rather than a write failure.
 */
export const adminSaveEsignDraft = onCall(async (request) => {
  const staff = await requireStaff(request, "requests.manage");
  const data = (request.data ?? {}) as Dict;
  const draft = payloadOf(data, "draft", "p_draft");

  const id = pickId(draft, "id");
  const kind = draft.kind === "bulk" ? "bulk" : "single";
  const rawRows = draft.rows === undefined || draft.rows === null ? [] : draft.rows;
  if (!Array.isArray(rawRows)) return { ok: false, error: "rows_not_array" };
  const rowCount = rawRows.length;
  if (rowCount > DRAFT_ROW_LIMIT) {
    return { ok: false, error: "too_many_rows", limit: DRAFT_ROW_LIMIT };
  }

  const fieldValues = pickObject(draft, "field_values", "fieldValues") ?? {};
  const bytes =
    Buffer.byteLength(JSON.stringify(rawRows), "utf8") +
    Buffer.byteLength(JSON.stringify(fieldValues), "utf8");
  if (bytes > DRAFT_BYTE_LIMIT) {
    return { ok: false, error: "draft_too_large", bytes };
  }

  const templateVersion = numberOrNull(pick(draft, "template_version", "templateVersion"));
  const body: Dict = {
    kind,
    template_id: pickId(draft, "template_id", "templateId"),
    template_version: templateVersion === null ? null : Math.trunc(templateVersion),
    title: textOf(draft.title),
    due_at: pickDay(draft, "due_at", "dueAt"),
    description: textOf(draft.description),
    field_values: fieldValues,
    rows: rawRows,
    source_filename: textOf(pick(draft, "source_filename", "sourceFilename")),
    updated_at: FieldValue.serverTimestamp(),
  };
  const language = textOf(draft.language);

  const db = getFirestore();
  const drafts = db.collection(COLLECTIONS.esignDrafts);

  if (!id) {
    const ref = drafts.doc();
    await ref.set({
      ...body,
      language: language ?? "en",
      created_by: staff.uid,
      created_at: FieldValue.serverTimestamp(),
    });
    return { ok: true, id: ref.id, rows: rowCount };
  }

  const ref = drafts.doc(id);
  const updated = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    tx.update(ref, language ? { ...body, language } : body);
    return true;
  });
  if (!updated) return { ok: false, error: "not_found" };
  return { ok: true, id, rows: rowCount };
});

/** `admin_list_esign_drafts` — newest first, without the row payloads. */
export const adminListEsignDrafts = onCall(async (request) => {
  await requireStaff(request, "requests.manage");
  const data = (request.data ?? {}) as Dict;
  const limit = clamp(pickCount(data, 50, "limit", "p_limit"), 1, 200);

  const snap = await getFirestore()
    .collection(COLLECTIONS.esignDrafts)
    .orderBy("updated_at", "desc")
    .limit(limit)
    .get();

  const drafts = snap.docs.map((doc) => ({ id: doc.id, data: dataOf(doc) }));
  const [templates, profiles] = await Promise.all([
    loadDocMap(
      COLLECTIONS.esignTemplates,
      drafts.map((d) => textOf(d.data.template_id) ?? ""),
    ),
    loadDocMap(
      COLLECTIONS.profiles,
      drafts.map((d) => textOf(d.data.created_by) ?? ""),
    ),
  ]);

  const rows = drafts.map(({ id, data: d }) => {
    const templateId = textOf(d.template_id);
    const createdBy = textOf(d.created_by);
    return {
      id,
      kind: d.kind ?? "single",
      template_id: templateId,
      template_version: d.template_version ?? null,
      language: d.language ?? "en",
      title: d.title ?? null,
      due_at: d.due_at ?? null,
      description: d.description ?? null,
      source_filename: d.source_filename ?? null,
      created_by: createdBy,
      created_at: isoTimestamp(d.created_at),
      updated_at: isoTimestamp(d.updated_at),
      template_name: templateId ? (templates.get(templateId)?.name_en ?? null) : null,
      row_count: Array.isArray(d.rows) ? d.rows.length : 0,
      created_by_id: createdBy,
      created_by_name: createdBy ? (profiles.get(createdBy)?.full_name ?? null) : null,
    };
  });

  return { ok: true, rows };
});

/** `admin_get_esign_draft` — the full draft plus its template name. */
export const adminGetEsignDraft = onCall(async (request) => {
  await requireStaff(request, "requests.manage");
  const data = (request.data ?? {}) as Dict;
  const id = pickId(data, "id", "p_id");
  if (!id) return { ok: false, error: "not_found" };

  const db = getFirestore();
  const snap = await db.collection(COLLECTIONS.esignDrafts).doc(id).get();
  if (!snap.exists) return { ok: false, error: "not_found" };
  const draft = dataOf(snap);

  const templateId = textOf(draft.template_id);
  let templateName: unknown = null;
  if (templateId) {
    const tplSnap = await db.collection(COLLECTIONS.esignTemplates).doc(templateId).get();
    templateName = tplSnap.exists ? (tplSnap.get("name_en") ?? null) : null;
  }

  return { ok: true, draft: { ...serialise(snap.id, draft), template_name: templateName } };
});

/** `admin_delete_esign_draft` — idempotent delete. */
export const adminDeleteEsignDraft = onCall(async (request) => {
  await requireStaff(request, "requests.manage");
  const data = (request.data ?? {}) as Dict;
  const id = pickId(data, "id", "p_id");
  if (id) await getFirestore().collection(COLLECTIONS.esignDrafts).doc(id).delete();
  return { ok: true };
});
