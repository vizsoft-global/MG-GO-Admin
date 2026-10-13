/**
 * Rider request callables — ports of `driver_list_my_requests`,
 * `driver_get_request`, `driver_create_request` (20261026100000),
 * `driver_submit_clarification` (20261010100000),
 * `driver_acknowledge_request` (20261011100000) and
 * `driver_respond_reschedule` (20260908140000).
 *
 * Domain errors keep the SQL `{ ok: false, error }` envelope so Flutter's
 * `SupportService` parsers still read the same keys. Auth is `requireRider`.
 */
import { onCall, type CallableRequest } from "firebase-functions/v2/https";
import { Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import { requireRider, riderError, type RiderContext } from "../core/rider";
import { requestSearchStamp } from "../core/search-text";
import {
  dataOf,
  isoTimestamp,
  logDriverOperation,
  numberOrNull,
  pick,
  pickCount,
  pickDay,
  pickId,
  pickIdList,
  pickText,
  pickTriBool,
  textOrNull,
  type Dict,
} from "./_shared";
import {
  allocateRequestCode,
  materializeApprovalSteps,
  validateRequestInput,
  type RequestInput,
} from "./requests-core";

export { riderError };

const VEHICLE_SNAPSHOT_TYPES = new Set(["fuel", "fuel_refund", "asset"]);
const ACK_BLOCKED = new Set(["rejected", "solved", "responded", "closed"]);
export const FUEL_REFUND_REQUIRED_KINDS = ["cash_invoice", "vehicle_photo", "odometer"] as const;

const LIST_FIELDS = [
  "request_code",
  "request_type",
  "status",
  "current_step_label",
  "current_step_order",
  "amount_kwd",
  "start_date",
  "end_date",
  "created_at",
  "updated_at",
  "completed_at",
  "severity",
  "payload",
] as const;

function asData(request: CallableRequest<unknown>): Dict {
  return (request.data ?? {}) as Dict;
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function archived(ctx: RiderContext): boolean {
  return ctx.driver.archived_at != null;
}

function instantOf(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function dayOf(value: unknown): string | null {
  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    return match ? match[1] : null;
  }
  const instant = instantOf(value);
  return instant ? kuwaitDayString(instant) : null;
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === "object" && value !== null) {
    const out: Dict = {};
    for (const [key, inner] of Object.entries(value as Dict)) out[key] = serializeValue(inner);
    return out;
  }
  return value ?? null;
}

function serializeRequest(id: string, data: Dict, fields?: readonly string[]): Dict {
  const source = fields
    ? Object.fromEntries(fields.map((key) => [key, data[key]]))
    : { ...data };
  const out = serializeValue(source) as Dict;
  out.id = id;
  if ("start_date" in source) out.start_date = dayOf(source.start_date);
  if ("end_date" in source) out.end_date = dayOf(source.end_date);
  if ("created_at" in source) out.created_at = isoTimestamp(source.created_at);
  if ("updated_at" in source) out.updated_at = isoTimestamp(source.updated_at);
  if ("completed_at" in source) out.completed_at = isoTimestamp(source.completed_at);
  return out;
}

export function attachmentsOf(data: Dict): unknown[] {
  const value = pick(data, "attachments", "p_attachments");
  return Array.isArray(value) ? value : [];
}

export function fileNameFromKey(key: string): string {
  const trimmed = key.trim();
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

export function fuelRefundMissingKind(attachments: unknown[]): string | null {
  const kinds = new Set<string>();
  for (const raw of attachments) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as Dict;
    const kind = textOrNull(row.kind);
    if (kind) kinds.add(kind);
  }
  for (const required of FUEL_REFUND_REQUIRED_KINDS) {
    if (!kinds.has(required)) return required;
  }
  return null;
}

function attachmentKeysOf(data: Dict): string[] {
  return pickIdList(data, "attachmentKeys", "p_attachment_keys") ?? [];
}

async function loadByRequestId(collection: string, requestId: string): Promise<Array<{ id: string; data: Dict }>> {
  const snap = await getFirestore().collection(collection).where("request_id", "==", requestId).get();
  return snap.docs.map((doc) => ({ id: doc.id, data: dataOf(doc) }));
}

export const driverListMyRequests = onCall(async (request) => {
  const ctx = await requireRider(request);
  const data = asData(request);
  const status = pickText(data, "status", "p_status");
  const limit = Math.max(pickCount(data, 50, "limit", "p_limit"), 1);
  const offset = Math.max(pickCount(data, 0, "offset", "p_offset"), 0);

  const snap = await getFirestore()
    .collection(COLLECTIONS.requests)
    .where("driver_id", "==", ctx.uid)
    .get();

  const rows = snap.docs
    .map((doc) => ({ id: doc.id, data: dataOf(doc) }))
    .filter((row) => status === null || String(row.data.status ?? "") === status)
    .sort((a, b) => {
      const left = instantOf(a.data.created_at)?.getTime() ?? 0;
      const right = instantOf(b.data.created_at)?.getTime() ?? 0;
      return right - left;
    })
    .slice(offset, offset + limit)
    .map((row) => serializeRequest(row.id, row.data, LIST_FIELDS));

  return { ok: true, rows };
});

export const driverGetRequest = onCall(async (request) => {
  const ctx = await requireRider(request);
  const id = pickId(asData(request), "requestId", "p_request_id");
  if (!id) return fail("not_found");

  const snap = await getFirestore().collection(COLLECTIONS.requests).doc(id).get();
  const data = dataOf(snap);
  if (!snap.exists || data.driver_id !== ctx.uid) return fail("not_found");

  const [steps, clarifications, attachments] = await Promise.all([
    loadByRequestId(COLLECTIONS.requestApprovalSteps, id),
    loadByRequestId(COLLECTIONS.requestClarifications, id),
    loadByRequestId(COLLECTIONS.requestAttachments, id),
  ]);

  steps.sort((a, b) => (numberOrNull(a.data.step_order) ?? 0) - (numberOrNull(b.data.step_order) ?? 0));
  clarifications.sort((a, b) => {
    return (instantOf(a.data.asked_at)?.getTime() ?? 0) - (instantOf(b.data.asked_at)?.getTime() ?? 0);
  });
  attachments.sort((a, b) => {
    return (instantOf(a.data.created_at)?.getTime() ?? 0) - (instantOf(b.data.created_at)?.getTime() ?? 0);
  });

  return {
    ok: true,
    request: serializeRequest(id, data),
    steps: steps.map((row) => serializeRequest(row.id, row.data)),
    clarifications: clarifications.map((row) => serializeRequest(row.id, row.data)),
    attachments: attachments.map((row) => serializeRequest(row.id, row.data)),
  };
});

export const driverCreateRequest = onCall(async (request) => {
  const ctx = await requireRider(request);
  if (archived(ctx)) return fail("not_a_driver");

  const data = asData(request);
  const rawPayload = pick(data, "payload", "p_payload");
  const payload =
    typeof rawPayload === "object" && rawPayload !== null && !Array.isArray(rawPayload)
      ? (rawPayload as Dict)
      : {};
  const attachments = attachmentsOf(data);
  const input: RequestInput = {
    type: pickText(data, "type", "p_type"),
    payload,
    attachments,
    amountKwd: numberOrNull(pick(data, "amountKwd", "p_amount_kwd")),
    startDate: pickDay(data, "startDate", "p_start_date"),
    endDate: pickDay(data, "endDate", "p_end_date"),
    details: pickText(data, "details", "p_details"),
    severity: pickText(data, "severity", "p_severity"),
  };

  const error = await validateRequestInput(input);
  if (error !== null) {
    await logDriverOperation({
      driverId: ctx.uid,
      module: "request",
      action: "request.create",
      actor: "driver_create_request",
      success: false,
      recordType: "request",
      detail: { request_type: input.type, error },
    });
    return fail(error);
  }

  const type = input.type as string;
  if (type === "fuel_refund" && fuelRefundMissingKind(attachments) !== null) {
    await logDriverOperation({
      driverId: ctx.uid,
      module: "request",
      action: "request.create",
      actor: "driver_create_request",
      success: false,
      recordType: "request",
      detail: { request_type: type, missing_kind: fuelRefundMissingKind(attachments) },
    });
    return fail("fuel_refund_attachments_required");
  }

  const db = getFirestore();
  const vehicleId = VEHICLE_SNAPSHOT_TYPES.has(type) ? textOrNull(ctx.driver.vehicle_id) : null;
  const code = await allocateRequestCode(type);
  const now = new Date();
  const nowTs = Timestamp.fromDate(now);
  const reqRef = db.collection(COLLECTIONS.requests).doc();

  await reqRef.set({
    request_code: code,
    driver_id: ctx.uid,
    request_type: type,
    status: "submitted",
    payload,
    amount_kwd: input.amountKwd,
    start_date: input.startDate,
    end_date: input.endDate,
    details: input.details,
    severity: input.severity,
    needs_attention: true,
    attention_at: nowTs,
    attention_reason: "new_request",
    vehicle_id: vehicleId,
    driver_name: textOrNull(ctx.profile.full_name) ?? textOrNull(ctx.driver.name),
    driver_code: textOrNull(ctx.driver.driver_code),
    employee_id: textOrNull(ctx.driver.employee_id),
    ...requestSearchStamp({
      requestCode: code,
      driverName: textOrNull(ctx.profile.full_name) ?? textOrNull(ctx.driver.name),
      driverCode: textOrNull(ctx.driver.driver_code),
      employeeId: textOrNull(ctx.driver.employee_id),
    }),
    created_day: kuwaitDayString(now),
    created_at: nowTs,
    updated_at: nowTs,
  });

  await materializeApprovalSteps(reqRef.id);

  if (attachments.length > 0) {
    const batch = db.batch();
    for (const raw of attachments) {
      const att = typeof raw === "object" && raw !== null ? (raw as Dict) : {};
      const capturedAt = instantOf(att.captured_at);
      const byteSize = numberOrNull(att.byte_size);
      batch.set(db.collection(COLLECTIONS.requestAttachments).doc(), {
        request_id: reqRef.id,
        storage_key: textOrNull(att.storage_key) ?? textOrNull(att.storageKey),
        file_name: textOrNull(att.file_name) ?? textOrNull(att.fileName),
        content_type: textOrNull(att.content_type) ?? textOrNull(att.contentType),
        byte_size: byteSize === null ? null : Math.trunc(byteSize),
        uploaded_by: ctx.uid,
        title: textOrNull(att.title),
        kind: textOrNull(att.kind),
        captured_at: capturedAt ? Timestamp.fromDate(capturedAt) : null,
        source: textOrNull(att.source),
        created_at: nowTs,
      });
    }
    await batch.commit();
  }

  await logDriverOperation({
    driverId: ctx.uid,
    module: "request",
    action: "request.create",
    actor: "driver_create_request",
    recordType: "request",
    recordId: reqRef.id,
    detail: {
      request_code: code,
      request_type: type,
      amount_kwd: input.amountKwd,
      vehicle_id: vehicleId,
      attachment_count: attachments.length,
    },
  });

  return { ok: true, id: reqRef.id, request_code: code };
});

async function submitClarification(request: CallableRequest<unknown>) {
  const ctx = await requireRider(request);
  const data = asData(request);
  const id = pickId(data, "requestId", "p_request_id");
  const answer = pickText(data, "answer", "p_answer");
  const keys = attachmentKeysOf(data);
  if (!id) return fail("not_found");

  const db = getFirestore();
  const reqRef = db.collection(COLLECTIONS.requests).doc(id);
  const snap = await reqRef.get();
  const req = dataOf(snap);
  if (!snap.exists || req.driver_id !== ctx.uid) return fail("not_found");

  if (String(req.status ?? "") !== "needs_clarification") {
    await logDriverOperation({
      driverId: ctx.uid,
      module: "request",
      action: "request.clarify",
      actor: "driver_submit_clarification",
      success: false,
      recordType: "request",
      recordId: id,
      detail: { request_code: req.request_code, status: req.status },
    });
    return fail("wrong_status");
  }

  if (answer === null) return fail("answer_required");

  const clarifications = await loadByRequestId(COLLECTIONS.requestClarifications, id);
  const open = clarifications
    .filter((row) => row.data.answered_at == null)
    .sort((a, b) => (instantOf(b.data.asked_at)?.getTime() ?? 0) - (instantOf(a.data.asked_at)?.getTime() ?? 0))[0];

  if (!open) {
    await logDriverOperation({
      driverId: ctx.uid,
      module: "request",
      action: "request.clarify",
      actor: "driver_submit_clarification",
      success: false,
      recordType: "request",
      recordId: id,
      detail: { request_code: req.request_code },
    });
    return fail("no_open_clarification");
  }

  const nowTs = Timestamp.now();
  await db.collection(COLLECTIONS.requestClarifications).doc(open.id).update({
    answered_at: nowTs,
    answer,
    answer_attachment_keys: keys,
  });

  if (keys.length > 0) {
    const batch = db.batch();
    for (const key of keys) {
      batch.set(db.collection(COLLECTIONS.requestAttachments).doc(), {
        request_id: id,
        storage_key: key,
        file_name: fileNameFromKey(key),
        content_type: "image/jpeg",
        uploaded_by: ctx.uid,
        created_at: nowTs,
      });
    }
    await batch.commit();
  }

  await reqRef.update({
    status: "in_review",
    needs_attention: true,
    attention_at: nowTs,
    attention_cleared_at: null,
    attention_reason: "clarification_submitted",
    updated_at: nowTs,
  });

  await logDriverOperation({
    driverId: ctx.uid,
    module: "request",
    action: "request.clarify",
    actor: "driver_submit_clarification",
    recordType: "request",
    recordId: id,
    detail: {
      request_code: req.request_code,
      clarification_id: open.id,
      attachment_count: keys.length,
    },
  });

  return { ok: true, clarification_id: open.id };
}

export const driverSubmitClarification = onCall(submitClarification);
/** Alias — the brief named this; Flutter calls `driver_submit_clarification`. */
export const driverClarifyRequest = onCall(submitClarification);

export const driverAcknowledgeRequest = onCall(async (request) => {
  const ctx = await requireRider(request);
  if (archived(ctx)) return fail("not_a_driver");

  const data = asData(request);
  const id = pickId(data, "requestId", "p_request_id");
  const note = pickText(data, "note", "p_note");
  const keys = attachmentKeysOf(data);
  if (!id) return fail("not_found");

  const db = getFirestore();
  const reqRef = db.collection(COLLECTIONS.requests).doc(id);
  const snap = await reqRef.get();
  const req = dataOf(snap);
  if (!snap.exists || req.driver_id !== ctx.uid) return fail("not_found");

  const status = String(req.status ?? "");
  if (ACK_BLOCKED.has(status)) {
    await logDriverOperation({
      driverId: ctx.uid,
      module: "request",
      action: "request.acknowledge",
      actor: "driver_acknowledge_request",
      success: false,
      recordType: "request",
      recordId: id,
      detail: { request_code: req.request_code, status },
    });
    return fail("wrong_status");
  }

  const nowTs = Timestamp.now();
  const payload = typeof req.payload === "object" && req.payload !== null ? { ...(req.payload as Dict) } : {};
  payload.driver_ack_at = nowTs.toDate().toISOString();
  payload.driver_ack_note = note;
  payload.awaiting_driver_ack = false;

  await reqRef.update({
    payload,
    acknowledged_at: nowTs,
    needs_attention: true,
    attention_at: nowTs,
    attention_reason: "driver_ack",
    updated_at: nowTs,
  });

  if (keys.length > 0) {
    const batch = db.batch();
    for (const key of keys) {
      batch.set(db.collection(COLLECTIONS.requestAttachments).doc(), {
        request_id: id,
        storage_key: key,
        file_name: fileNameFromKey(key),
        content_type: "image/jpeg",
        uploaded_by: ctx.uid,
        created_at: nowTs,
      });
    }
    await batch.commit();
  }

  await logDriverOperation({
    driverId: ctx.uid,
    module: "request",
    action: "request.acknowledge",
    actor: "driver_acknowledge_request",
    recordType: "request",
    recordId: id,
    detail: {
      request_code: req.request_code,
      request_type: req.request_type,
      has_note: note !== null,
      attachment_count: keys.length,
    },
  });

  return { ok: true, id };
});

export const driverRespondReschedule = onCall(async (request) => {
  const ctx = await requireRider(request);
  const data = asData(request);
  const id = pickId(data, "requestId", "p_request_id");
  const accept = pickTriBool(data, "accept", "p_accept") ?? false;
  const note = pickText(data, "note", "p_note");
  if (!id) return fail("not_found");

  const db = getFirestore();
  const reqRef = db.collection(COLLECTIONS.requests).doc(id);
  const snap = await reqRef.get();
  const req = dataOf(snap);
  if (!snap.exists || req.driver_id !== ctx.uid) return fail("not_found");

  if (String(req.status ?? "") !== "rescheduled") {
    await logDriverOperation({
      driverId: ctx.uid,
      module: "request",
      action: "request.reschedule_respond",
      actor: "driver_respond_reschedule",
      success: false,
      recordType: "request",
      recordId: id,
      detail: { request_code: req.request_code, status: req.status },
    });
    return fail("wrong_status");
  }

  const payload = typeof req.payload === "object" && req.payload !== null ? { ...(req.payload as Dict) } : {};
  const reschedule =
    typeof payload.reschedule === "object" && payload.reschedule !== null
      ? { ...(payload.reschedule as Dict) }
      : {};
  const proposedStart = typeof reschedule.proposed_start_date === "string" ? reschedule.proposed_start_date : null;
  const proposedEnd = typeof reschedule.proposed_end_date === "string" ? reschedule.proposed_end_date : null;
  reschedule.accepted = accept;
  reschedule.responded_at = new Date().toISOString();
  reschedule.driver_note = note;
  payload.awaiting_driver_reschedule = false;
  payload.reschedule = reschedule;

  const nowTs = Timestamp.now();
  const update: Dict = {
    status: "in_review",
    payload,
    needs_attention: true,
    attention_at: nowTs,
    attention_reason: accept ? "reschedule_accepted" : "reschedule_declined",
    updated_at: nowTs,
  };
  if (accept && proposedStart) update.start_date = proposedStart;
  if (accept && proposedEnd) update.end_date = proposedEnd;
  await reqRef.update(update);

  await logDriverOperation({
    driverId: ctx.uid,
    module: "request",
    action: "request.reschedule_respond",
    actor: "driver_respond_reschedule",
    recordType: "request",
    recordId: id,
    detail: {
      request_code: req.request_code,
      accepted: accept,
      proposed_start_date: proposedStart,
      proposed_end_date: proposedEnd,
    },
  });

  return { ok: true, id, accepted: accept };
});
