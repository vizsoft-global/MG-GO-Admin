/**
 * E-sign request lifecycle — the Firestore port of
 *
 *   admin_list_esign_requests        (20261117000200)
 *   admin_create_esign_request       (20261117000300)
 *   admin_expire_esign_requests      (20260931100000)
 *   admin_remind_esign_requests      (20261118000400)
 *   admin_esign_reminder_state       (20261116000700)
 *   admin_link_esign_resend          (20261118000400)
 *   esign_employee_snapshot          (20261115000200)
 *   admin_upsert_esign_template      (20261116000000)
 *   admin_upsert_esign_template_field(20261116000200)
 *
 * `esign_requests.status` stays the employee's own signature; the staff
 * counter-signature is derived from `esign_request_signers` rows that carry a
 * `staff_user_id`, exactly as the SQL derives it.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  FieldValue,
  Timestamp,
  getFirestore,
  type DocumentReference,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import { COLLECTIONS, FIELDS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import { requireStaff } from "../core/staff";
import {
  IN_FILTER_LIMIT,
  SCAN_CAP,
  chunk,
  dataOf,
  loadDocMap,
  logAdminActivity,
  numberOrNull,
  pick,
  pickCount,
  pickDay,
  pickId,
  pickIdList,
  pickObject,
  pickText,
  pickTriBool,
  textOrNull,
  type Dict,
} from "./_shared";
import { asDate, dayTextOf, notifyDriverTransactional } from "./visits-shared";

const APP_SETTINGS_DOC_ID = "1";
const REQUEST_CODE_COUNTER = "esign_code_seq";
const REQUEST_CODE_START = 1400;
const DEFAULT_REMINDER_COOLDOWN_HOURS = 24;
const LIST_PAGE_SIZE = 500;
const LIST_SCAN_CAP = 20_000;
const EXPIRE_SCAN_CAP = 20_000;
const SIGN_DEEP_LINK_PREFIX = "musallam:///profile/support/sign/";
const SIGN_ROUTE_PREFIX = "/profile/support/sign/";

const TEMPLATE_DOCUMENT_KINDS = ["penalty", "loan", "payslip", "general"] as const;
const FIELD_SOURCE_KINDS = ["system", "entry", "fixed", "signature"] as const;
const FIELD_SECTION_KEYS = ["employee", "document"] as const;

type CounterSignatureState = "none" | "pending" | "signed" | "declined";

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** `to_jsonb(row)`: Timestamps become ISO strings at every depth. */
function serialiseValue(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialiseValue);
  if (value !== null && typeof value === "object") {
    const out: Dict = {};
    for (const [key, inner] of Object.entries(value as Dict)) out[key] = serialiseValue(inner);
    return out;
  }
  return value;
}

function serialiseDoc(id: string, data: Dict): Dict {
  return { ...(serialiseValue(data) as Dict), id };
}

function todayKuwait(): string {
  return kuwaitDayString(new Date());
}

/** `status = 'pending' AND due_at < Kuwait today`. */
function isPastDue(data: Dict, today: string): boolean {
  const due = dayTextOf(data.due_at);
  return due !== null && due < today;
}

function displayStatusOf(data: Dict, today: string): string {
  const status = String(data.status ?? "");
  return status === "pending" && isPastDue(data, today) ? "expired" : status;
}

function recipientStageOf(data: Dict, today: string): string {
  const status = String(data.status ?? "");
  if (status !== "pending") return status;
  if (isPastDue(data, today)) return "expired";
  return data.viewed_at ? "opened" : "not_opened";
}

async function loadAppSettings(): Promise<Dict> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.appSettings)
    .doc(APP_SETTINGS_DOC_ID)
    .get();
  return snap.exists ? dataOf(snap) : {};
}

async function reminderCooldownHours(): Promise<number> {
  const settings = await loadAppSettings();
  const hours = numberOrNull(settings.esign_reminder_cooldown_hours);
  return hours === null ? DEFAULT_REMINDER_COOLDOWN_HOURS : hours;
}

/** Categories are looked up by key: the doc id first, then a `key` field. */
async function loadCategory(key: string): Promise<Dict | null> {
  const col = getFirestore().collection(COLLECTIONS.esignCategories);
  const byId = await col.doc(key).get();
  if (byId.exists) return dataOf(byId);
  const byKey = await col.where("key", "==", key).limit(1).get();
  return byKey.empty ? null : dataOf(byKey.docs[0]);
}

async function loadCategoryLabels(keys: readonly string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(keys.filter((k) => k !== ""))];
  const out = new Map<string, string | null>();
  if (unique.length === 0) return out;
  const col = getFirestore().collection(COLLECTIONS.esignCategories);
  for (const group of chunk(unique, IN_FILTER_LIMIT)) {
    const snap = await col.where("key", "in", group).get();
    for (const doc of snap.docs) {
      const data = dataOf(doc);
      out.set(String(data.key ?? doc.id), textOrNull(data.label_en));
    }
  }
  const missing = unique.filter((k) => !out.has(k));
  if (missing.length > 0) {
    const byId = await loadDocMap(COLLECTIONS.esignCategories, missing);
    for (const [id, data] of byId) out.set(id, textOrNull(data.label_en));
  }
  return out;
}

type CounterSignature = { awaiting: boolean; state: CounterSignatureState };

/**
 * `_esign_awaiting_counter_signature` + `counter_signature_state`, computed per
 * request from the staff signer rows only. A request with no staff signer is
 * `none`, which is what the column means to every reader.
 */
async function loadCounterSignatures(
  requests: ReadonlyArray<{ id: string; status: string }>,
): Promise<Map<string, CounterSignature>> {
  const staffStatuses = new Map<string, string[]>();
  const ids = requests.map((r) => r.id);
  const col = getFirestore().collection(COLLECTIONS.esignRequestSigners);
  for (const group of chunk(ids, IN_FILTER_LIMIT)) {
    if (group.length === 0) continue;
    const snap = await col.where("request_id", "in", group).get();
    for (const doc of snap.docs) {
      const data = dataOf(doc);
      if (!textOrNull(data.staff_user_id)) continue;
      const requestId = String(data.request_id ?? "");
      const list = staffStatuses.get(requestId) ?? [];
      list.push(String(data.status ?? ""));
      staffStatuses.set(requestId, list);
    }
  }

  const out = new Map<string, CounterSignature>();
  for (const request of requests) {
    const statuses = staffStatuses.get(request.id) ?? [];
    const hasPending = statuses.includes("pending");
    let state: CounterSignatureState;
    if (statuses.length === 0) state = "none";
    else if (statuses.includes("declined")) state = "declined";
    else if (hasPending) state = "pending";
    else state = "signed";
    out.set(request.id, { awaiting: request.status === "signed" && hasPending, state });
  }
  return out;
}

async function allocateRequestCode(
  tx: FirebaseFirestore.Transaction,
  counterRef: DocumentReference,
): Promise<string> {
  const snap = await tx.get(counterRef);
  const last = numberOrNull(snap.get("value"));
  const next = last === null ? REQUEST_CODE_START : Math.trunc(last) + 1;
  tx.set(counterRef, { value: next, updated_at: FieldValue.serverTimestamp() }, { merge: true });
  return `SIG-${String(next).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// esign_employee_snapshot
// ---------------------------------------------------------------------------

/**
 * The employee block frozen onto a request at send time. `null` when the driver
 * does not exist, which `admin_create_esign_request` coalesces to `{}`.
 */
export async function esignEmployeeSnapshotFor(driverId: string): Promise<Dict | null> {
  const db = getFirestore();
  const driverSnap = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
  if (!driverSnap.exists) return null;
  const driver = dataOf(driverSnap);

  const zoneId = textOrNull(driver[FIELDS.drivers.zoneId]);
  const [profileSnap, zoneSnap, settings] = await Promise.all([
    db.collection(COLLECTIONS.profiles).doc(driverId).get(),
    zoneId ? db.collection(COLLECTIONS.zones).doc(zoneId).get() : Promise.resolve(null),
    loadAppSettings(),
  ]);
  const profile = profileSnap.exists ? dataOf(profileSnap) : {};
  const zone = zoneSnap && zoneSnap.exists ? dataOf(zoneSnap) : null;

  const driverCode = textOrNull(driver[FIELDS.drivers.driverCode]);
  const joinedAt = asDate(driver.joined_at);

  return {
    company_name:
      trimmedOrNull(driver[FIELDS.drivers.sourceCompany]) ??
      trimmedOrNull(settings.app_name) ??
      "DPD",
    employee_name: trimmedOrNull(profile.full_name) ?? driverCode ?? "",
    employee_id: textOrNull(driver[FIELDS.drivers.employeeId]) ?? "",
    driver_code: driverCode ?? "",
    civil_id: trimmedOrNull(driver.civil_id),
    joined_at: joinedAt ? kuwaitDayString(joinedAt) : null,
    accommodation: trimmedOrNull(driver.accommodation),
    zone: zone ? textOrNull(zone.name) : null,
    project: textOrNull(driver[FIELDS.drivers.projectKey]),
    nationality: textOrNull(driver.nationality),
  };
}

export const esignEmployeeSnapshot = onCall(async (request) => {
  await requireStaff(request);
  const data = (request.data ?? {}) as Dict;
  const driverId = pickId(data, "driverId", "p_driver_id", "driver_id");
  if (!driverId) return null;
  return esignEmployeeSnapshotFor(driverId);
});

// ---------------------------------------------------------------------------
// admin_expire_esign_requests
// ---------------------------------------------------------------------------

/**
 * Pending requests whose `due_at` is before Kuwait today become `expired`. The
 * primary signer row (sort_order 0) follows, as the projection trigger did.
 */
export async function expireEsignRequestsNow(): Promise<number> {
  const db = getFirestore();
  const today = todayKuwait();
  const toExpire: QueryDocumentSnapshot[] = [];

  let cursor: QueryDocumentSnapshot | null = null;
  let scanned = 0;
  for (;;) {
    let query = db
      .collection(COLLECTIONS.esignRequests)
      .where("status", "==", "pending")
      .orderBy("__name__")
      .limit(LIST_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) {
      if (isPastDue(dataOf(doc), today)) toExpire.push(doc);
    }
    scanned += page.size;
    if (page.size < LIST_PAGE_SIZE) break;
    if (scanned >= EXPIRE_SCAN_CAP) {
      throw new HttpsError("out-of-range", "too_many_pending_requests");
    }
    cursor = page.docs[page.docs.length - 1];
  }
  if (toExpire.length === 0) return 0;

  const ids = toExpire.map((d) => d.id);
  const signerRefs: DocumentReference[] = [];
  for (const group of chunk(ids, IN_FILTER_LIMIT)) {
    const snap = await db
      .collection(COLLECTIONS.esignRequestSigners)
      .where("request_id", "in", group)
      .get();
    for (const doc of snap.docs) {
      const data = dataOf(doc);
      if (numberOrNull(data.sort_order) === 0 && !textOrNull(data.staff_user_id)) {
        signerRefs.push(doc.ref);
      }
    }
  }

  const writes: Array<{ ref: DocumentReference; body: Dict }> = [
    ...toExpire.map((d) => ({
      ref: d.ref,
      body: { status: "expired", updated_at: FieldValue.serverTimestamp() },
    })),
    ...signerRefs.map((ref) => ({
      ref,
      body: { status: "expired", updated_at: FieldValue.serverTimestamp() },
    })),
  ];
  for (const group of chunk(writes, 400)) {
    const batch = db.batch();
    for (const write of group) batch.update(write.ref, write.body);
    await batch.commit();
  }
  return toExpire.length;
}

export const adminExpireEsignRequests = onCall(async (request) => {
  await requireStaff(request, "requests.manage");
  return expireEsignRequestsNow();
});

// ---------------------------------------------------------------------------
// admin_list_esign_requests
// ---------------------------------------------------------------------------

export const adminListEsignRequests = onCall(async (request) => {
  await requireStaff(request, "requests.manage");
  const data = (request.data ?? {}) as Dict;
  const statusFilter = pickText(data, "status", "p_status");
  const limit = Math.max(pickCount(data, 50, "limit", "p_limit"), 1);
  const offset = Math.max(pickCount(data, 0, "offset", "p_offset"), 0);

  await expireEsignRequestsNow();

  const db = getFirestore();
  const today = todayKuwait();
  const matches = (doc: QueryDocumentSnapshot): boolean => {
    if (statusFilter === null) return true;
    const row = dataOf(doc);
    if (statusFilter === "opened" || statusFilter === "not_opened") {
      return recipientStageOf(row, today) === statusFilter;
    }
    return displayStatusOf(row, today) === statusFilter;
  };

  const wanted = offset + limit;
  const matched: QueryDocumentSnapshot[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  let scanned = 0;
  while (matched.length < wanted) {
    let query = db
      .collection(COLLECTIONS.esignRequests)
      .orderBy("created_at", "desc")
      .limit(statusFilter === null ? wanted : LIST_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) if (matches(doc)) matched.push(doc);
    scanned += page.size;
    if (statusFilter === null || page.size < LIST_PAGE_SIZE) break;
    if (scanned >= LIST_SCAN_CAP) throw new HttpsError("out-of-range", "scan_cap_exceeded");
    cursor = page.docs[page.docs.length - 1];
  }

  const pageDocs = matched.slice(offset, offset + limit);
  const raws = pageDocs.map((doc) => ({ id: doc.id, data: dataOf(doc) }));
  const driverIds = raws.map((r) => String(r.data.driver_id ?? ""));

  const [profiles, drivers, labels, counter] = await Promise.all([
    loadDocMap(COLLECTIONS.profiles, driverIds),
    loadDocMap(COLLECTIONS.drivers, driverIds),
    loadCategoryLabels(raws.map((r) => String(r.data.category_key ?? ""))),
    loadCounterSignatures(raws.map((r) => ({ id: r.id, status: String(r.data.status ?? "") }))),
  ]);

  const rows = raws.map(({ id, data: row }) => {
    const driverId = String(row.driver_id ?? "");
    const sig = counter.get(id) ?? { awaiting: false, state: "none" as CounterSignatureState };
    return {
      ...serialiseDoc(id, row),
      driver_name: textOrNull(profiles.get(driverId)?.full_name) ?? textOrNull(row.driver_name),
      driver_code:
        textOrNull(drivers.get(driverId)?.[FIELDS.drivers.driverCode]) ??
        textOrNull(row.driver_code),
      category_label:
        labels.get(String(row.category_key ?? "")) ?? textOrNull(row.category_label),
      display_status: displayStatusOf(row, today),
      recipient_stage: recipientStageOf(row, today),
      awaiting_counter_signature: sig.awaiting,
      counter_signature_state: sig.state,
    };
  });

  return { ok: true, rows };
});

// ---------------------------------------------------------------------------
// admin_create_esign_request
// ---------------------------------------------------------------------------

export type CreateEsignRequestInput = {
  driverId: string | null;
  title: string | null;
  categoryKey: string | null;
  dueAt: string | null;
  documentStorageKey: string | null;
  screenshotRestricted: boolean | undefined;
  templateId: string | null;
  batchId: string | null;
  batchRow: number | null;
  description: string | null;
  fieldValues: Dict;
};

export function parseCreateEsignRequestInput(data: Dict): CreateEsignRequestInput {
  return {
    driverId: pickId(data, "driverId", "p_driver_id", "driver_id"),
    title: pickText(data, "title", "p_title"),
    categoryKey: pickText(data, "categoryKey", "p_category_key", "category_key"),
    dueAt: pickDay(data, "dueAt", "p_due_at", "due_at"),
    documentStorageKey: pickText(
      data,
      "documentStorageKey",
      "p_document_storage_key",
      "document_storage_key",
    ),
    screenshotRestricted: pickTriBool(
      data,
      "screenshotRestricted",
      "p_screenshot_restricted",
      "screenshot_restricted",
    ),
    templateId: pickId(data, "templateId", "p_template_id", "template_id"),
    batchId: pickId(data, "batchId", "p_batch_id", "batch_id"),
    batchRow: numberOrNull(pick(data, "batchRow", "p_batch_row", "batch_row")),
    description: pickText(data, "description", "p_description"),
    fieldValues: pickObject(data, "fieldValues", "p_field_values", "field_values") ?? {},
  };
}

function fieldValueFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "object") return JSON.stringify(value).trim() !== "";
  return String(value).trim() !== "";
}

/**
 * The create body without the staff gate, so the batch drain can call it with
 * the batch creator as the actor (the SQL's `esign.worker_mode` bypass).
 */
export async function createEsignRequestCore(
  input: CreateEsignRequestInput,
  actorUid: string,
): Promise<Dict> {
  const db = getFirestore();
  const title = input.title?.trim() ?? "";
  if (!input.driverId || title === "") return { ok: false, error: "invalid_input" };
  const driverId = input.driverId;

  const batchRow = input.batchRow === null ? null : Math.trunc(input.batchRow);
  const batched = input.batchId !== null && batchRow !== null;

  if (batched) {
    const existing = await db
      .collection(COLLECTIONS.esignRequests)
      .where("batch_id", "==", input.batchId)
      .where("batch_row", "==", batchRow)
      .limit(1)
      .get();
    if (!existing.empty) {
      const doc = existing.docs[0];
      return { ok: true, id: doc.id, request_code: doc.get("request_code") ?? null, idempotent: true };
    }
  }

  const categoryKey = input.categoryKey?.trim() ?? "";
  if (categoryKey === "") return { ok: false, error: "category_required" };
  if (input.dueAt !== null && input.dueAt < todayKuwait()) {
    return { ok: false, error: "due_in_past" };
  }

  const category = await loadCategory(categoryKey);
  if (!category || category.is_active !== true) return { ok: false, error: "invalid_category" };

  let templateVersion: number | null = null;
  if (input.templateId) {
    const templateSnap = await db.collection(COLLECTIONS.esignTemplates).doc(input.templateId).get();
    const template = templateSnap.exists ? dataOf(templateSnap) : null;
    if (!template || template.is_active !== true) return { ok: false, error: "invalid_template" };
    if (String(template.category_key ?? "") !== categoryKey) {
      return { ok: false, error: "template_category_mismatch" };
    }
    templateVersion = numberOrNull(template.version);

    const fields = await db
      .collection(COLLECTIONS.esignTemplateFields)
      .where("template_id", "==", input.templateId)
      .get();
    const required = fields.docs
      .map((doc) => dataOf(doc))
      .filter((field) => field.is_required === true)
      .sort((a, b) => (numberOrNull(a.sort_order) ?? 0) - (numberOrNull(b.sort_order) ?? 0));
    for (const field of required) {
      const key = String(field.field_key ?? "");
      if (!fieldValueFilled(input.fieldValues[key])) {
        return { ok: false, error: "field_required", field: key };
      }
    }
  }

  const driverSnap = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
  if (!driverSnap.exists) throw new HttpsError("not-found", "driver_not_found");
  const driver = dataOf(driverSnap);

  const restricted = input.screenshotRestricted ?? category.screenshot_restricted === true;
  const snapshot = (await esignEmployeeSnapshotFor(driverId)) ?? {};
  const profileSnap = await db.collection(COLLECTIONS.profiles).doc(driverId).get();
  const description = input.description?.trim() ?? "";

  const requestRef = batched
    ? db.collection(COLLECTIONS.esignRequests).doc(`b_${input.batchId}_${batchRow}`)
    : db.collection(COLLECTIONS.esignRequests).doc();
  const signerRef = db.collection(COLLECTIONS.esignRequestSigners).doc(`${requestRef.id}_signer_0`);
  const counterRef = db.collection(COLLECTIONS.counters).doc(REQUEST_CODE_COUNTER);

  const outcome = await db.runTransaction(async (tx) => {
    if (batched) {
      const existing = await tx.get(requestRef);
      if (existing.exists) {
        return { id: existing.id, code: String(existing.get("request_code") ?? ""), idempotent: true };
      }
    }
    const code = await allocateRequestCode(tx, counterRef);
    const now = FieldValue.serverTimestamp();
    tx.create(requestRef, {
      request_code: code,
      title,
      category_key: categoryKey,
      category_label: textOrNull(category.label_en),
      driver_id: driverId,
      driver_name: textOrNull(profileSnap.get("full_name")),
      driver_code: textOrNull(driver[FIELDS.drivers.driverCode]),
      document_storage_key: input.documentStorageKey,
      status: "pending",
      due_at: input.dueAt,
      screenshot_restricted: restricted,
      sent_by: actorUid,
      signed_at: null,
      signature_storage_key: null,
      signed_document_storage_key: null,
      signer_display_name: null,
      signer_meta: {},
      template_id: input.templateId,
      template_version: templateVersion,
      batch_id: input.batchId,
      batch_row: batchRow,
      description: description === "" ? null : description,
      field_values: input.fieldValues,
      employee_snapshot: snapshot,
      sent_at: now,
      viewed_at: null,
      declined_at: null,
      declaration_accepted_at: null,
      reminder_count: 0,
      last_reminded_at: null,
      resent_from_id: null,
      created_at: now,
      updated_at: now,
    });
    tx.set(signerRef, {
      request_id: requestRef.id,
      driver_id: driverId,
      staff_user_id: null,
      role: "signer",
      sort_order: 0,
      status: "pending",
      viewed_at: null,
      signed_at: null,
      declined_at: null,
      signature_storage_key: null,
      signed_document_storage_key: null,
      signer_display_name: null,
      signer_meta: {},
      created_at: now,
      updated_at: now,
    });
    return { id: requestRef.id, code, idempotent: false };
  });

  if (outcome.idempotent) {
    return { ok: true, id: outcome.id, request_code: outcome.code, idempotent: true };
  }

  if (batched && input.batchId) {
    const rows = await db
      .collection(COLLECTIONS.esignBatchRows)
      .where("batch_id", "==", input.batchId)
      .where("row_index", "==", batchRow)
      .get();
    const batch = db.batch();
    for (const row of rows.docs) {
      batch.update(row.ref, {
        status: "created",
        esign_request_id: outcome.id,
        error: null,
        updated_at: FieldValue.serverTimestamp(),
      });
    }
    batch.set(
      db.collection(COLLECTIONS.esignBatches).doc(input.batchId),
      { created_count: FieldValue.increment(1), updated_at: FieldValue.serverTimestamp() },
      { merge: true },
    );
    await batch.commit();
  }

  await notifyDriverTransactional({
    driverId,
    title: `Document to sign — ${outcome.code}`,
    body: title,
    deepLink: `${SIGN_DEEP_LINK_PREFIX}${outcome.id}`,
    category: "operations",
    priority: "high",
    actionParams: {
      record_type: "esign",
      record_id: outcome.id,
      route: `${SIGN_ROUTE_PREFIX}${outcome.id}`,
    },
    createdBy: actorUid,
  });

  return { ok: true, id: outcome.id, request_code: outcome.code };
}

export const adminCreateEsignRequest = onCall(async (request) => {
  const staff = await requireStaff(request, "requests.manage");
  const data = (request.data ?? {}) as Dict;
  return createEsignRequestCore(parseCreateEsignRequestInput(data), staff.uid);
});

// ---------------------------------------------------------------------------
// admin_remind_esign_requests
// ---------------------------------------------------------------------------

export const adminRemindEsignRequests = onCall(async (request) => {
  const staff = await requireStaff(request, "requests.manage");
  const data = (request.data ?? {}) as Dict;
  const ids = pickIdList(data, "ids", "p_ids") ?? [];
  if (ids.length === 0) return { ok: false, error: "no_ids" };
  const message = trimmedOrNull(pick(data, "message", "p_message"));

  const db = getFirestore();
  const cooldownHours = await reminderCooldownHours();
  const cooldownMs = cooldownHours * 3_600_000;
  let sent = 0;
  let skippedStage = 0;
  let skippedCooldown = 0;

  for (const id of [...new Set(ids)]) {
    const ref = db.collection(COLLECTIONS.esignRequests).doc(id);
    const snap: DocumentSnapshot = await ref.get();
    if (!snap.exists) continue;
    const row = dataOf(snap);
    if (row.status !== "pending") {
      skippedStage += 1;
      continue;
    }
    const last = asDate(row.last_reminded_at);
    if (cooldownHours > 0 && last && last.getTime() + cooldownMs > Date.now()) {
      skippedCooldown += 1;
      continue;
    }

    await ref.update({
      reminder_count: FieldValue.increment(1),
      last_reminded_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });

    const code = textOrNull(row.request_code);
    await notifyDriverTransactional({
      driverId: textOrNull(row.driver_id),
      title: "Reminder — document to sign",
      body: message ?? trimmedOrNull(row.title) ?? code,
      deepLink: `${SIGN_DEEP_LINK_PREFIX}${id}`,
      category: "operations",
      priority: "high",
      actionParams: {
        record_type: "esign",
        record_id: id,
        route: `${SIGN_ROUTE_PREFIX}${id}`,
        kind: "esign_reminder",
      },
      createdBy: staff.uid,
    });
    sent += 1;
  }

  await logAdminActivity({
    actorId: staff.uid,
    action: "esign.remind",
    entity: "esign_requests",
    detail: {
      request_ids: ids,
      sent,
      skipped_stage: skippedStage,
      skipped_cooldown: skippedCooldown,
      cooldown_hours: cooldownHours,
      custom_message: message !== null,
    },
  });

  return {
    ok: true,
    sent,
    skipped_stage: skippedStage,
    skipped_cooldown: skippedCooldown,
    cooldown_hours: cooldownHours,
  };
});

// ---------------------------------------------------------------------------
// admin_esign_reminder_state
// ---------------------------------------------------------------------------

export const adminEsignReminderState = onCall(async (request) => {
  await requireStaff(request, "requests.view");
  const data = (request.data ?? {}) as Dict;
  const ids = pickIdList(data, "ids", "p_ids") ?? [];
  const cooldownHours = await reminderCooldownHours();
  const cooldownMs = cooldownHours * 3_600_000;
  if (ids.length > SCAN_CAP) throw new HttpsError("out-of-range", "too_many_ids");

  const docs = await loadDocMap(COLLECTIONS.esignRequests, ids);
  const now = Date.now();
  const rows = [...docs.entries()]
    .map(([id, row]) => {
      const last = asDate(row.last_reminded_at);
      const hoursLeft = last
        ? Math.max(Math.ceil((last.getTime() + cooldownMs - now) / 3_600_000), 0)
        : 0;
      return {
        id,
        request_code: textOrNull(row.request_code),
        status: textOrNull(row.status),
        viewed_at: isoOrNull(row.viewed_at),
        last_reminded_at: last ? last.toISOString() : null,
        reminder_count: numberOrNull(row.reminder_count) ?? 0,
        hours_left: hoursLeft,
      };
    })
    .sort((a, b) => (a.request_code ?? "").localeCompare(b.request_code ?? ""));

  return { ok: true, cooldown_hours: cooldownHours, rows };
});

function isoOrNull(value: unknown): string | null {
  const date = asDate(value);
  return date ? date.toISOString() : null;
}

// ---------------------------------------------------------------------------
// admin_link_esign_resend
// ---------------------------------------------------------------------------

export const adminLinkEsignResend = onCall(async (request) => {
  await requireStaff(request, "requests.manage");
  const data = (request.data ?? {}) as Dict;
  const id = pickId(data, "id", "p_id");
  const fromId = pickId(data, "fromId", "p_from_id", "from_id");
  if (!id || !fromId || id === fromId) return { ok: false, error: "invalid_resend" };

  const db = getFirestore();
  const fromSnap = await db.collection(COLLECTIONS.esignRequests).doc(fromId).get();
  if (!fromSnap.exists) return { ok: false, error: "not_found" };
  if (fromSnap.get("status") !== "declined") return { ok: false, error: "not_declined" };

  const ref = db.collection(COLLECTIONS.esignRequests).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "not_found" };
  await ref.update({ resent_from_id: fromId, updated_at: FieldValue.serverTimestamp() });
  return { ok: true };
});

// ---------------------------------------------------------------------------
// admin_upsert_esign_template
// ---------------------------------------------------------------------------

function isTemplateDocumentKind(value: string): value is (typeof TEMPLATE_DOCUMENT_KINDS)[number] {
  return (TEMPLATE_DOCUMENT_KINDS as readonly string[]).includes(value);
}

export const adminUpsertEsignTemplate = onCall(async (request) => {
  const staff = await requireStaff(request, "requests.manage");
  const data = (request.data ?? {}) as Dict;
  const template = pickObject(data, "template", "p_template") ?? data;

  const id = pickId(template, "id");
  const nameEn = trimmedOrNull(pick(template, "name_en", "nameEn"));
  const categoryKey = trimmedOrNull(pick(template, "category_key", "categoryKey"));
  if (!nameEn || !categoryKey) return { ok: false, error: "invalid_input" };

  const category = await loadCategory(categoryKey);
  if (!category || category.is_active !== true) return { ok: false, error: "invalid_category" };

  const kind = trimmedOrNull(pick(template, "document_kind", "documentKind")) ?? "general";
  if (!isTemplateDocumentKind(kind)) return { ok: false, error: "invalid_document_kind" };

  const nameAr = trimmedOrNull(pick(template, "name_ar", "nameAr"));
  const optional = (snake: string, camel: string): unknown => pick(template, snake, camel);
  const db = getFirestore();
  const col = db.collection(COLLECTIONS.esignTemplates);

  if (!id) {
    const ref = col.doc();
    const textOr = (snake: string, camel: string, fallback: string): string => {
      const value = optional(snake, camel);
      return typeof value === "string" ? value : fallback;
    };
    const flagOr = (snake: string, camel: string, fallback: boolean): boolean => {
      const value = optional(snake, camel);
      return typeof value === "boolean" ? value : fallback;
    };
    await ref.set({
      category_key: categoryKey,
      name_en: nameEn,
      name_ar: nameAr,
      header_en: textOr("header_en", "headerEn", ""),
      header_ar: textOr("header_ar", "headerAr", ""),
      body_en: textOr("body_en", "bodyEn", ""),
      body_ar: textOr("body_ar", "bodyAr", ""),
      declaration_en: textOr("declaration_en", "declarationEn", ""),
      declaration_ar: textOr("declaration_ar", "declarationAr", ""),
      default_language: textOr("default_language", "defaultLanguage", "en"),
      document_kind: kind,
      is_active: flagOr("is_active", "isActive", true),
      is_draft: flagOr("is_draft", "isDraft", false),
      version: 1,
      created_by: staff.uid,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
    return { ok: true, id: ref.id, version: 1 };
  }

  const ref = col.doc(id);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const existing = dataOf(snap);
    const keep = (snake: string, camel: string, kindOf: "string" | "boolean"): unknown => {
      const value = optional(snake, camel);
      return typeof value === kindOf ? value : existing[snake] ?? null;
    };
    const version = (numberOrNull(existing.version) ?? 0) + 1;
    tx.update(ref, {
      category_key: categoryKey,
      name_en: nameEn,
      name_ar: nameAr,
      header_en: keep("header_en", "headerEn", "string"),
      header_ar: keep("header_ar", "headerAr", "string"),
      body_en: keep("body_en", "bodyEn", "string"),
      body_ar: keep("body_ar", "bodyAr", "string"),
      declaration_en: keep("declaration_en", "declarationEn", "string"),
      declaration_ar: keep("declaration_ar", "declarationAr", "string"),
      default_language: keep("default_language", "defaultLanguage", "string"),
      document_kind: kind,
      is_active: keep("is_active", "isActive", "boolean"),
      is_draft: keep("is_draft", "isDraft", "boolean"),
      version,
      updated_at: FieldValue.serverTimestamp(),
    });
    return version;
  });
  if (result === null) return { ok: false, error: "not_found" };
  return { ok: true, id, version: result };
});

// ---------------------------------------------------------------------------
// admin_upsert_esign_template_field
// ---------------------------------------------------------------------------

function isFieldSourceKind(value: string): value is (typeof FIELD_SOURCE_KINDS)[number] {
  return (FIELD_SOURCE_KINDS as readonly string[]).includes(value);
}

function isFieldSectionKey(value: string): value is (typeof FIELD_SECTION_KEYS)[number] {
  return (FIELD_SECTION_KEYS as readonly string[]).includes(value);
}

export const adminUpsertEsignTemplateField = onCall(async (request) => {
  await requireStaff(request, "requests.manage");
  const data = (request.data ?? {}) as Dict;
  const field = pickObject(data, "field", "p_field") ?? data;

  const templateId = pickId(field, "template_id", "templateId");
  const fieldKey = trimmedOrNull(pick(field, "field_key", "fieldKey"));
  const labelEn = trimmedOrNull(pick(field, "label_en", "labelEn"));
  if (!templateId || !fieldKey || !labelEn) return { ok: false, error: "invalid_input" };

  const fieldType = trimmedOrNull(pick(field, "field_type", "fieldType")) ?? "text";
  const sourceKind = trimmedOrNull(pick(field, "source_kind", "sourceKind")) ?? "entry";
  const sectionKey = trimmedOrNull(pick(field, "section_key", "sectionKey")) ?? "document";
  if (!isFieldSourceKind(sourceKind)) return { ok: false, error: "invalid_source_kind" };
  if (!isFieldSectionKey(sectionKey)) return { ok: false, error: "invalid_section_key" };

  const rawOptions = pick(field, "options");
  const options = Array.isArray(rawOptions) ? rawOptions : [];
  if (sourceKind === "fixed" && options.length < 1) {
    return { ok: false, error: "fixed_requires_value" };
  }
  if (sourceKind === "signature" && fieldType === "select") {
    return { ok: false, error: "signature_not_dropdown" };
  }

  const isRequired = pick(field, "is_required", "isRequired");
  const sortOrder = numberOrNull(pick(field, "sort_order", "sortOrder"));
  const body: Dict = {
    template_id: templateId,
    field_key: fieldKey,
    label_en: labelEn,
    label_ar: trimmedOrNull(pick(field, "label_ar", "labelAr")),
    field_type: fieldType,
    options,
    is_required: typeof isRequired === "boolean" ? isRequired : false,
    sort_order: sortOrder === null ? 0 : Math.trunc(sortOrder),
    source_kind: sourceKind,
    section_key: sectionKey,
    options_source: trimmedOrNull(pick(field, "options_source", "optionsSource")),
    preview_value: trimmedOrNull(pick(field, "preview_value", "previewValue")),
    updated_at: FieldValue.serverTimestamp(),
  };

  const db = getFirestore();
  const templateRef = db.collection(COLLECTIONS.esignTemplates).doc(templateId);
  const templateSnap = await templateRef.get();
  if (!templateSnap.exists) return { ok: false, error: "not_found" };

  const existing = await db
    .collection(COLLECTIONS.esignTemplateFields)
    .where("template_id", "==", templateId)
    .where("field_key", "==", fieldKey)
    .limit(1)
    .get();
  const fieldRef = existing.empty
    ? db.collection(COLLECTIONS.esignTemplateFields).doc()
    : existing.docs[0].ref;

  const batch = db.batch();
  if (existing.empty) {
    batch.set(fieldRef, { ...body, created_at: FieldValue.serverTimestamp() });
  } else {
    batch.set(fieldRef, body, { merge: true });
  }
  batch.update(templateRef, {
    version: FieldValue.increment(1),
    updated_at: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return { ok: true, id: fieldRef.id };
});
