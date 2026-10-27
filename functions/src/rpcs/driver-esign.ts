/**
 * Rider e-sign + appointment callables.
 *
 * E-sign: `driver_list_esign_requests` / `driver_get_esign_request`
 * (20261117000200), `driver_submit_esignature` / `driver_decline_esignature`
 * / `driver_mark_esign_viewed` (20260908150000).
 * Appointments live here because the task allows only these three modules:
 * `driver_list_appointments` (20260827104100),
 * `driver_respond_appointment` (20260908150000).
 *
 * Signed-PDF compose runs in-process from `driverSubmitEsignature` via
 * `composeSignedEsignRequest`, so the rider download includes their ink
 * before HR countersigns. Staff still call `esignComposeSignedDocument`.
 */
import { onCall, type CallableRequest } from "firebase-functions/v2/https";
import { Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import { requireRider, riderError } from "../core/rider";
import { composeSignedEsignRequest } from "./esign-compose";
import { voidPendingStaffSigners } from "./esign-signer-void";
import {
  dataOf,
  isoTimestamp,
  loadDocMap,
  logDriverOperation,
  numberOrNull,
  pickCount,
  pickId,
  pickInstant,
  pickObject,
  pickText,
  textOrNull,
  type Dict,
} from "./_shared";
import { notifyDriverTransactional } from "./visits-shared";
import { presignR2Get } from "../core/r2-esign";
import {
  canAddEsignAttachment,
  esignAttachmentPath,
  isOwnRiderAttachmentKey,
} from "./esign-attachments";

export { riderError };

const APPOINTMENTS = "appointments";
const ATTACHMENT_URL_TTL_SECONDS = 900;

export type CounterSignatureState = "none" | "declined" | "pending" | "signed";
export type AppointmentAction = "accept" | "reject" | "propose";

function asData(request: CallableRequest<unknown>): Dict {
  return (request.data ?? {}) as Dict;
}

function fail(error: string, message?: string): { ok: false; error: string; message?: string } {
  return message ? { ok: false, error, message } : { ok: false, error };
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

export function declarationAccepted(meta: Dict | null): boolean {
  if (!meta) return false;
  return meta.declaration_accepted === true || meta.declaration_accepted === "true";
}

/** Supporting documents, with a short-lived download URL for each. */
async function loadAttachments(requestId: string) {
  const snap = await getFirestore()
    .collection(COLLECTIONS.esignRequestAttachments)
    .where("request_id", "==", requestId)
    .get();
  return Promise.all(
    snap.docs.map(async (doc) => {
      const row = dataOf(doc);
      const key = textOrNull(row.storage_key);
      let url: string | null = null;
      if (key) {
        try {
          url = await presignR2Get(esignAttachmentPath(key), ATTACHMENT_URL_TTL_SECONDS);
        } catch {
          url = null;
        }
      }
      return {
        id: doc.id,
        name: textOrNull(row.name) ?? "Attachment",
        content_type: textOrNull(row.content_type),
        size: numberOrNull(row.size) ?? 0,
        source: textOrNull(row.source),
        created_at: isoTimestamp(row.created_at),
        storage_key: key,
        url,
      };
    }),
  );
}

/** Batched count for the list; the full URLs stay on the detail call. */
async function loadAttachmentCounts(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const col = getFirestore().collection(COLLECTIONS.esignRequestAttachments);
  for (let i = 0; i < unique.length; i += 30) {
    const group = unique.slice(i, i + 30);
    const snap = await col.where("request_id", "in", group).get();
    for (const doc of snap.docs) {
      const requestId = String(dataOf(doc).request_id ?? "");
      out.set(requestId, (out.get(requestId) ?? 0) + 1);
    }
  }
  return out;
}

export function esignListStatus(status: string, dueAt: string | null, today: string): string {
  if (status === "pending" && dueAt !== null && dueAt < today) return "expired";
  return status;
}

export function esignRecipientStage(
  status: string,
  dueAt: string | null,
  viewedAt: unknown,
  today: string,
): string {
  if (status !== "pending") return status;
  if (dueAt !== null && dueAt < today) return "expired";
  if (viewedAt != null) return "opened";
  return "not_opened";
}

export function counterSignatureState(staffStatuses: readonly string[]): CounterSignatureState {
  if (staffStatuses.length === 0) return "none";
  if (staffStatuses.includes("declined")) return "declined";
  if (staffStatuses.includes("pending")) return "pending";
  return "signed";
}

export function awaitingCounterSignature(
  requestStatus: string,
  staffStatuses: readonly string[],
): boolean {
  return requestStatus === "signed" && staffStatuses.includes("pending");
}

export function parseAppointmentAction(raw: string | null): AppointmentAction | null {
  if (raw === null) return null;
  const action = raw.trim().toLowerCase();
  switch (action) {
    case "accept":
    case "reject":
    case "propose":
      return action;
    default:
      return null;
  }
}

async function loadStaffSignerStatuses(requestIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (requestIds.length === 0) return out;
  const col = getFirestore().collection(COLLECTIONS.esignRequestSigners);
  for (const id of requestIds) {
    const snap = await col.where("request_id", "==", id).get();
    const statuses: string[] = [];
    for (const doc of snap.docs) {
      const data = dataOf(doc);
      if (!textOrNull(data.staff_user_id)) continue;
      statuses.push(String(data.status ?? ""));
    }
    out.set(id, statuses);
  }
  return out;
}

async function loadCategoryByKey(key: string | null): Promise<Dict | null> {
  if (!key) return null;
  const db = getFirestore();
  const byId = await db.collection(COLLECTIONS.esignCategories).doc(key).get();
  if (byId.exists) return dataOf(byId);
  const snap = await db.collection(COLLECTIONS.esignCategories).where("key", "==", key).limit(1).get();
  return snap.empty ? null : dataOf(snap.docs[0]);
}

export const driverListEsignRequests = onCall(async (request) => {
  const ctx = await requireRider(request);
  const data = asData(request);
  const limit = Math.max(pickCount(data, 50, "limit", "p_limit"), 1);
  const offset = Math.max(pickCount(data, 0, "offset", "p_offset"), 0);

  const snap = await getFirestore()
    .collection(COLLECTIONS.esignRequests)
    .where("driver_id", "==", ctx.uid)
    .get();

  const today = kuwaitDayString(new Date());
  const docs = snap.docs.map((doc) => ({ id: doc.id, data: dataOf(doc) }));
  const signerMap = await loadStaffSignerStatuses(docs.map((row) => row.id));
  const attachmentCounts = await loadAttachmentCounts(docs.map((row) => row.id));

  const rows = docs
    .map((row) => {
      const status = String(row.data.status ?? "");
      const dueAt = dayOf(row.data.due_at);
      const listed = esignListStatus(status, dueAt, today);
      const pendingLive = status === "pending" && listed !== "expired";
      return { row, status, dueAt, listed, pendingLive };
    })
    .sort((a, b) => {
      const rank = Number(b.pendingLive) - Number(a.pendingLive);
      if (rank !== 0) return rank;
      return (instantOf(b.row.data.created_at)?.getTime() ?? 0) - (instantOf(a.row.data.created_at)?.getTime() ?? 0);
    })
    .slice(offset, offset + limit);

  const categoryKeys = [
    ...new Set(rows.map((item) => textOrNull(item.row.data.category_key)).filter((key): key is string => key !== null)),
  ];
  const categories = new Map<string, Dict>();
  await Promise.all(
    categoryKeys.map(async (key) => {
      const cat = await loadCategoryByKey(key);
      if (cat) categories.set(key, cat);
    }),
  );

  return {
    ok: true,
    rows: rows.map((item) => {
      const categoryKey = textOrNull(item.row.data.category_key);
      const category = categoryKey ? categories.get(categoryKey) : undefined;
      const staff = signerMap.get(item.row.id) ?? [];
      const restricted = category?.screenshot_restricted ?? item.row.data.screenshot_restricted;
      return {
        id: item.row.id,
        request_code: item.row.data.request_code ?? null,
        title: item.row.data.title ?? null,
        status: item.listed,
        due_at: item.dueAt,
        signed_at: isoTimestamp(item.row.data.signed_at),
        viewed_at: isoTimestamp(item.row.data.viewed_at),
        recipient_stage: esignRecipientStage(item.status, item.dueAt, item.row.data.viewed_at, today),
        screenshot_restricted: restricted === true,
        category_key: categoryKey,
        category_label: category ? textOrNull(category.label_en) : null,
        awaiting_counter_signature: awaitingCounterSignature(item.status, staff),
        attachment_count: attachmentCounts.get(item.row.id) ?? 0,
        review_status: textOrNull(item.row.data.review_status),
        created_at: isoTimestamp(item.row.data.created_at),
      };
    }),
  };
});

export const driverGetEsignRequest = onCall(async (request) => {
  const ctx = await requireRider(request);
  const id = pickId(asData(request), "id", "p_id");
  if (!id) return fail("not_found");

  const snap = await getFirestore().collection(COLLECTIONS.esignRequests).doc(id).get();
  const data = dataOf(snap);
  if (!snap.exists || data.driver_id !== ctx.uid) return fail("not_found");

  const categoryKey = textOrNull(data.category_key);
  const templateId = textOrNull(data.template_id);
  const [category, template, fieldsSnap, staffMap, attachments] = await Promise.all([
    loadCategoryByKey(categoryKey),
    templateId
      ? getFirestore().collection(COLLECTIONS.esignTemplates).doc(templateId).get()
      : Promise.resolve(null),
    templateId
      ? getFirestore().collection(COLLECTIONS.esignTemplateFields).where("template_id", "==", templateId).get()
      : Promise.resolve(null),
    loadStaffSignerStatuses([id]),
    loadAttachments(id),
  ]);

  const staff = staffMap.get(id) ?? [];
  const fieldValues = typeof data.field_values === "object" && data.field_values !== null ? (data.field_values as Dict) : {};
  const fields = (fieldsSnap?.docs ?? [])
    .map((doc) => dataOf(doc))
    .sort((a, b) => (numberOrNull(a.sort_order) ?? 0) - (numberOrNull(b.sort_order) ?? 0))
    .map((field) => ({
      key: textOrNull(field.field_key) ?? "",
      label_en: textOrNull(field.label_en),
      label_ar: textOrNull(field.label_ar),
      value: fieldValues[String(field.field_key ?? "")] ?? null,
    }));

  const signedKey = textOrNull(data.signed_document_storage_key);
  const documentKey = textOrNull(data.document_storage_key);
  const status = String(data.status ?? "");
  const catRestricted = category?.screenshot_restricted;
  const raw = serializeValue({ ...data, id }) as Dict;
  raw.id = id;
  raw.due_at = dayOf(data.due_at);
  raw.signed_at = isoTimestamp(data.signed_at);
  raw.viewed_at = isoTimestamp(data.viewed_at);
  raw.created_at = isoTimestamp(data.created_at);
  raw.declined_at = isoTimestamp(data.declined_at);
  raw.category_label = category ? textOrNull(category.label_en) : null;
  raw.screenshot_restricted = catRestricted === undefined ? data.screenshot_restricted === true : catRestricted === true;
  raw.download_storage_key = signedKey ?? documentKey;
  raw.signed_document_ready = signedKey !== null;
  raw.signed_document_pending = status === "signed" && signedKey === null && data.signed_document_error == null;
  raw.awaiting_counter_signature = awaitingCounterSignature(status, staff);
  raw.counter_signature_state = counterSignatureState(staff);
  raw.attachments = attachments;
  raw.attachment_count = attachments.length;
  raw.review_status = textOrNull(data.review_status);
  raw.review_note = textOrNull(data.review_note);
  raw.reviewed_at = isoTimestamp(data.reviewed_at);
  raw.template_name = template?.exists ? textOrNull(template.get("name_en")) : null;
  raw.template_name_ar = template?.exists ? textOrNull(template.get("name_ar")) : null;
  raw.field_values_labeled = fields;

  return { ok: true, request: raw };
});

/**
 * Registers a rider-uploaded supporting document. The bytes are PUT to R2 with
 * the presigned URL from `driverGetUploadUrl`; this call only records the key
 * after checking the request is pending or already signed and belongs to the caller.
 */
export const driverAddEsignAttachment = onCall(async (request) => {
  const ctx = await requireRider(request);
  const data = asData(request);
  const requestId = pickId(data, "id", "request_id", "p_request_id", "p_id");
  const storageKey = pickText(data, "storageKey", "storage_key", "p_storage_key");
  if (!requestId || !storageKey) return fail("invalid_request");
  if (!isOwnRiderAttachmentKey(ctx.uid, storageKey)) return fail("not_authorized");
  const name = pickText(data, "name", "p_name") ?? "Attachment";
  const contentType =
    pickText(data, "contentType", "content_type", "p_content_type") ?? "application/octet-stream";
  const size = Math.max(0, numberOrNull(data.size) ?? numberOrNull(data.p_size) ?? 0);

  const db = getFirestore();
  const snap = await db.collection(COLLECTIONS.esignRequests).doc(requestId).get();
  const row = dataOf(snap);
  if (!snap.exists || row.driver_id !== ctx.uid) return fail("not_found");
  const attachmentStatus = String(row.status ?? "");
  if (attachmentStatus !== "pending" && attachmentStatus !== "signed") return fail("not_pending");

  const existing = await db
    .collection(COLLECTIONS.esignRequestAttachments)
    .where("request_id", "==", requestId)
    .get();
  if (!canAddEsignAttachment(existing.size)) return fail("attachment_limit");

  const ref = db.collection(COLLECTIONS.esignRequestAttachments).doc();
  const created = Timestamp.now();
  await ref.set({
    request_id: requestId,
    name,
    storage_key: storageKey,
    content_type: contentType,
    size,
    uploaded_by: ctx.uid,
    source: "driver",
    created_at: created,
  });
  let url: string | null = null;
  try {
    url = await presignR2Get(esignAttachmentPath(storageKey), ATTACHMENT_URL_TTL_SECONDS);
  } catch {
    url = null;
  }
  return {
    ok: true,
    attachment: {
      id: ref.id,
      name,
      content_type: contentType,
      size,
      source: "driver",
      created_at: created.toDate().toISOString(),
      storage_key: storageKey,
      url,
    },
  };
});

export const driverSubmitEsignature = onCall(
  {
    memory: "1GiB",
    cpu: 1,
    timeoutSeconds: 120,
    concurrency: 1,
  },
  async (request) => {
  const ctx = await requireRider(request);
  const data = asData(request);
  const id = pickId(data, "id", "p_id");
  const signatureKey = pickText(data, "signatureStorageKey", "p_signature_storage_key");
  const displayName = pickText(data, "signerDisplayName", "p_signer_display_name");
  const meta = pickObject(data, "signerMeta", "p_signer_meta") ?? {};
  if (!id) return fail("not_found");
  if (!signatureKey) return fail("signature_required");
  if (!declarationAccepted(meta)) {
    await logDriverOperation({
      driverId: ctx.uid,
      module: "esign",
      action: "esign.sign",
      actor: "driver_submit_esignature",
      success: false,
      recordType: "esign_request",
      recordId: id,
    });
    return fail("declaration_required");
  }

  const ref = getFirestore().collection(COLLECTIONS.esignRequests).doc(id);
  const snap = await ref.get();
  const row = dataOf(snap);
  if (!snap.exists || row.driver_id !== ctx.uid) return fail("not_found");
  if (String(row.status ?? "") !== "pending") {
    await logDriverOperation({
      driverId: ctx.uid,
      module: "esign",
      action: "esign.sign",
      actor: "driver_submit_esignature",
      success: false,
      recordType: "esign_request",
      recordId: id,
      detail: { request_code: row.request_code, status: row.status },
    });
    return fail("not_pending");
  }

  const nowTs = Timestamp.now();
  const firstView = row.viewed_at == null;
  await ref.update({
    status: "signed",
    signed_at: nowTs,
    declaration_accepted_at: nowTs,
    viewed_at: row.viewed_at ?? nowTs,
    signature_storage_key: signatureKey,
    signer_display_name: displayName,
    signer_meta: { ...meta, declaration_accepted: true },
    updated_at: nowTs,
  });

  await logDriverOperation({
    driverId: ctx.uid,
    module: "esign",
    action: "esign.sign",
    actor: "driver_submit_esignature",
    recordType: "esign_request",
    recordId: id,
    detail: { request_code: row.request_code, first_view_was_capture: firstView },
  });

  try {
    await composeSignedEsignRequest(id, { force: true, actorId: null });
  } catch (error) {
    console.error("rider esign compose", error);
  }

  return { ok: true, status: "signed" };
});

export const driverMarkEsignViewed = onCall(async (request) => {
  const ctx = await requireRider(request);
  const id = pickId(asData(request), "id", "p_id");
  if (!id) return fail("not_found");

  const ref = getFirestore().collection(COLLECTIONS.esignRequests).doc(id);
  const snap = await ref.get();
  const row = dataOf(snap);
  if (!snap.exists || row.driver_id !== ctx.uid) return fail("not_found");

  const wasViewed = instantOf(row.viewed_at);
  const nowTs = Timestamp.now();
  if (wasViewed === null) {
    await ref.update({ viewed_at: nowTs, updated_at: nowTs });
    await logDriverOperation({
      driverId: ctx.uid,
      module: "esign",
      action: "esign.viewed",
      actor: "driver_mark_esign_viewed",
      recordType: "esign_request",
      recordId: id,
    });
    return { ok: true, viewed_at: nowTs.toDate().toISOString() };
  }

  return { ok: true, viewed_at: wasViewed.toISOString() };
});

export const driverDeclineEsignature = onCall(async (request) => {
  const ctx = await requireRider(request);
  const data = asData(request);
  const id = pickId(data, "id", "p_id");
  const reason = pickText(data, "reason", "p_reason");
  if (!id) return fail("not_found");

  const ref = getFirestore().collection(COLLECTIONS.esignRequests).doc(id);
  const snap = await ref.get();
  const row = dataOf(snap);
  if (!snap.exists || row.driver_id !== ctx.uid) return fail("not_found");
  if (String(row.status ?? "") !== "pending") {
    await logDriverOperation({
      driverId: ctx.uid,
      module: "esign",
      action: "esign.decline",
      actor: "driver_decline_esignature",
      success: false,
      recordType: "esign_request",
      recordId: id,
      detail: { request_code: row.request_code, status: row.status },
    });
    return fail("not_pending");
  }

  const nowTs = Timestamp.now();
  const meta = typeof row.signer_meta === "object" && row.signer_meta !== null ? { ...(row.signer_meta as Dict) } : {};
  meta.declined_reason = reason;
  await ref.update({
    status: "declined",
    declined_at: nowTs,
    viewed_at: row.viewed_at ?? nowTs,
    signer_meta: meta,
    updated_at: nowTs,
  });

  // The request is dead: release every staff signer still waiting on it, or the
  // counter-signature lock (`awaiting_counter_signature`) holds the signed copy
  // back forever.
  const voided = await voidPendingStaffSigners(getFirestore(), id, "request_declined");

  await logDriverOperation({
    driverId: ctx.uid,
    module: "esign",
    action: "esign.decline",
    actor: "driver_decline_esignature",
    recordType: "esign_request",
    recordId: id,
    detail: { request_code: row.request_code, declined_reason: reason, voided_signers: voided },
  });

  return { ok: true, status: "declined" };
});

export const driverListAppointments = onCall(async (request) => {
  const ctx = await requireRider(request);
  const data = asData(request);
  const limit = Math.max(pickCount(data, 50, "limit", "p_limit"), 1);
  const offset = Math.max(pickCount(data, 0, "offset", "p_offset"), 0);

  const snap = await getFirestore().collection(APPOINTMENTS).where("driver_id", "==", ctx.uid).get();
  const docs = snap.docs
    .map((doc) => ({ id: doc.id, data: dataOf(doc) }))
    .sort((a, b) => {
      return (instantOf(b.data.scheduled_for)?.getTime() ?? 0) - (instantOf(a.data.scheduled_for)?.getTime() ?? 0);
    })
    .slice(offset, offset + limit);

  const creatorIds = [
    ...new Set(docs.map((row) => textOrNull(row.data.created_by)).filter((id): id is string => id !== null)),
  ];
  const profiles = await loadDocMap(COLLECTIONS.profiles, creatorIds);
  const roleIds = [
    ...new Set(
      [...profiles.values()].map((profile) => textOrNull(profile.admin_role_id)).filter((id): id is string => id !== null),
    ),
  ];
  const roles = await loadDocMap(COLLECTIONS.adminRoles, roleIds);

  return {
    ok: true,
    rows: docs.map((row) => {
      const creatorId = textOrNull(row.data.created_by);
      const profile = creatorId ? profiles.get(creatorId) : undefined;
      const roleId = profile ? textOrNull(profile.admin_role_id) : null;
      const role = roleId ? roles.get(roleId) : undefined;
      return {
        id: row.id,
        appointment_code: textOrNull(row.data.appointment_code) ?? row.id,
        title: textOrNull(row.data.title) ?? "Appointment",
        scheduled_for: isoTimestamp(row.data.scheduled_for),
        status: row.data.status ?? null,
        reason: row.data.reason ?? null,
        location_label: row.data.location_label ?? null,
        admin_note: row.data.admin_note ?? null,
        proposed_for: isoTimestamp(row.data.proposed_for),
        driver_response_note: row.data.driver_response_note ?? null,
        responded_at: isoTimestamp(row.data.responded_at),
        requested_by_name: profile ? textOrNull(profile.full_name) : null,
        requested_by_role: role ? textOrNull(role.name) : null,
        created_at: isoTimestamp(row.data.created_at),
      };
    }),
  };
});

export const driverRespondAppointment = onCall(async (request) => {
  const ctx = await requireRider(request);
  const data = asData(request);
  const id = pickId(data, "id", "p_id");
  const action = parseAppointmentAction(pickText(data, "action", "p_action"));
  const proposedFor = pickInstant(data, "proposedFor", "p_proposed_for");
  const note = pickText(data, "note", "p_note");
  if (!id) return fail("not_found");

  const ref = getFirestore().collection(APPOINTMENTS).doc(id);
  const snap = await ref.get();
  const row = dataOf(snap);
  if (!snap.exists || row.driver_id !== ctx.uid) return fail("not_found");

  const status = String(row.status ?? "");
  if (status !== "pending" && status !== "scheduled") {
    await logDriverOperation({
      driverId: ctx.uid,
      module: "visit",
      action: "appointment.respond",
      actor: "driver_respond_appointment",
      success: false,
      recordType: "appointment",
      recordId: id,
      detail: { appointment_code: row.appointment_code, status, action },
    });
    return fail("not_pending");
  }

  if (action === null) return fail("unknown_action");

  const nowTs = Timestamp.now();
  const code = textOrNull(row.appointment_code) ?? "";
  const title = textOrNull(row.title) ?? "Appointment";
  const location = textOrNull(row.location_label) ?? "Central Tower";

  if (action === "accept") {
    await ref.update({ status: "accepted", responded_at: nowTs, updated_at: nowTs });
    await notifyDriverTransactional({
      driverId: ctx.uid,
      title: `Appointment confirmed — ${code}`,
      body: `${title} at ${location}`,
      deepLink: `musallam:///profile/support/appointments/${id}/confirmed`,
      category: "operations",
      priority: "normal",
      actionParams: { record_type: "appointment", record_id: id },
    });
    await logDriverOperation({
      driverId: ctx.uid,
      module: "visit",
      action: "appointment.accept",
      actor: "driver_respond_appointment",
      recordType: "appointment",
      recordId: id,
      detail: { appointment_code: row.appointment_code },
    });
    return { ok: true, status: "accepted" };
  }

  if (action === "reject") {
    await ref.update({
      status: "rejected",
      driver_response_note: note,
      responded_at: nowTs,
      updated_at: nowTs,
    });
    await logDriverOperation({
      driverId: ctx.uid,
      module: "visit",
      action: "appointment.reject",
      actor: "driver_respond_appointment",
      recordType: "appointment",
      recordId: id,
      detail: { appointment_code: row.appointment_code, note },
    });
    return { ok: true, status: "rejected" };
  }

  if (proposedFor === null) return fail("proposed_time_required");
  await ref.update({
    status: "reschedule_requested",
    proposed_for: Timestamp.fromDate(proposedFor),
    driver_response_note: note,
    responded_at: nowTs,
    updated_at: nowTs,
  });
  await logDriverOperation({
    driverId: ctx.uid,
    module: "visit",
    action: "appointment.reschedule_request",
    actor: "driver_respond_appointment",
    recordType: "appointment",
    recordId: id,
    detail: { appointment_code: row.appointment_code, proposed_for: proposedFor.toISOString() },
  });
  return { ok: true, status: "reschedule_requested" };
});
