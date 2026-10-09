import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  getFirestore,
  FieldValue,
  Timestamp,
  type DocumentReference,
  type Transaction,
} from "firebase-admin/firestore";
import { COLLECTIONS } from "../core/collections";
import { requireStaff, type StaffContext } from "../core/staff";
import {
  pick,
  pickText,
  pickId,
  pickObject,
  pickBoolean,
  pickDay,
  textOrNull,
  numberOrNull,
  dataOf,
  logAdminActivity,
  BATCH_LIMIT,
  SCAN_CAP,
  type Dict,
} from "./_shared";
import {
  asDate,
  notifyDriverTransactional,
  type TransactionalNotifyParams,
} from "./visits-shared";

const CLOSED_STATUSES = new Set(["approved", "rejected", "solved", "responded", "closed"]);
const AUTO_CLOSE_STATUSES = ["approved", "rejected", "solved", "responded"];
const FUEL_TYPES = new Set(["fuel", "fuel_refund"]);
const ADVANCING_ACTIONS = new Set([
  "approve",
  "request_documents",
  "escalate",
  "attach_send",
  "attach_breakdown",
]);
const ATTACH_ACTIONS = new Set(["attach_send", "attach_breakdown"]);
const REQUEST_LINK_PREFIX = "musallam:///profile/support/requests/";
const ACTION_REQUIRED_LINK = "musallam:///profile/support/action-required";
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

type StepRow = { ref: DocumentReference; data: Dict; order: number; status: string };

type TxOutcome = { result: Dict; notify: TransactionalNotifyParams | null };

function asDict(value: unknown): Dict {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Dict)
    : {};
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasPermission(staff: StaffContext, slug: string): boolean {
  if (staff.isSuperAdmin || staff.permissionSlugs.has(slug)) return true;
  if (slug === "requests.manage") {
    return ["requests.create", "requests.edit", "requests.delete"].some((s) =>
      staff.permissionSlugs.has(s),
    );
  }
  return false;
}

function hasAny(staff: StaffContext, ...slugs: string[]): boolean {
  return slugs.some((slug) => hasPermission(staff, slug));
}

function titled(prefix: string, code: string | null): string | null {
  return code === null ? null : `${prefix}${code}`;
}

function requestIdOf(data: Dict): string | null {
  return pickId(data, "requestId", "request_id", "p_request_id");
}

function dayOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value.trim() : String(value);
  if (text === "") return null;
  const match = DAY_PATTERN.exec(text);
  if (!match) throw new HttpsError("invalid-argument", "invalid_date");
  const day = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    throw new HttpsError("invalid-argument", "invalid_date");
  }
  return day;
}

async function loadProfileName(uid: string): Promise<string | null> {
  const snap = await getFirestore().collection(COLLECTIONS.profiles).doc(uid).get();
  if (!snap.exists) return null;
  const name = trimmed(dataOf(snap).full_name);
  return name === "" ? null : name;
}

async function loadTypeDefinition(tx: Transaction, key: string): Promise<Dict | null> {
  if (key === "") return null;
  const col = getFirestore().collection(COLLECTIONS.requestTypeDefinitions);
  const byId = await tx.get(col.doc(key));
  if (byId.exists) return dataOf(byId);
  const byKey = await tx.get(col.where("key", "==", key).limit(1));
  return byKey.empty ? null : dataOf(byKey.docs[0]);
}

async function loadSteps(tx: Transaction, requestId: string): Promise<StepRow[]> {
  const snap = await tx.get(
    getFirestore()
      .collection(COLLECTIONS.requestApprovalSteps)
      .where("request_id", "==", requestId),
  );
  return snap.docs
    .map((doc) => {
      const data = dataOf(doc);
      return {
        ref: doc.ref,
        data,
        order: numberOrNull(data.step_order) ?? 0,
        status: textOrNull(data.status) ?? "",
      };
    })
    .sort((a, b) => a.order - b.order);
}

async function loadTemplates(tx: Transaction, requestType: string): Promise<Dict[]> {
  const snap = await tx.get(
    getFirestore()
      .collection(COLLECTIONS.requestApprovalStepTemplates)
      .where("request_type", "==", requestType),
  );
  return snap.docs
    .map((doc) => dataOf(doc))
    .sort((a, b) => (numberOrNull(a.step_order) ?? 0) - (numberOrNull(b.step_order) ?? 0));
}

function positiveMinutes(value: unknown): number | null {
  const n = numberOrNull(value);
  return n !== null && n > 0 ? n : null;
}

function addMinutes(now: Timestamp, minutes: number): Timestamp {
  return Timestamp.fromMillis(now.toMillis() + minutes * 60_000);
}

function attachmentsOf(meta: Dict): Dict[] | null {
  const raw = meta.attachments;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const rows: Dict[] = [];
  for (const item of raw) {
    const row = asDict(item);
    if (trimmed(row.storage_key) === "") return null;
    rows.push(row);
  }
  return rows;
}

function attachmentDoc(requestId: string, row: Dict, uploadedBy: string, now: Timestamp): Dict {
  return {
    request_id: requestId,
    storage_key: trimmed(row.storage_key),
    file_name: textOrNull(row.file_name),
    content_type: textOrNull(row.content_type),
    byte_size: numberOrNull(row.byte_size),
    uploaded_by: uploadedBy,
    created_at: now,
  };
}

async function nextRequestCode(tx: Transaction, requestType: string): Promise<string> {
  const isRefund = requestType === "fuel_refund";
  const ref = getFirestore()
    .collection(COLLECTIONS.counters)
    .doc(isRefund ? "fuel_refund_code_seq" : "request_code_seq");
  const snap = await tx.get(ref);
  const last = snap.exists ? numberOrNull(dataOf(snap).value) : null;
  const next = last === null ? 1 : last + 1;
  tx.set(ref, { value: next, updated_at: FieldValue.serverTimestamp() }, { merge: true });
  return `${isRefund ? "RFR-" : "RCM-"}${String(next).padStart(4, "0")}`;
}

async function runOutcome(
  work: (tx: Transaction) => Promise<TxOutcome>,
): Promise<Dict> {
  const outcome = await getFirestore().runTransaction(work);
  if (outcome.notify) await notifyDriverTransactional(outcome.notify);
  return outcome.result;
}

function fail(error: string): TxOutcome {
  return { result: { ok: false, error }, notify: null };
}

export const adminDecideRequest = onCall(async (request) => {
  const staff = await requireStaff(request);
  if (!hasAny(staff, "requests.approve", "requests.manage")) {
    return { ok: false, error: "not_authorized" };
  }
  const data = asDict(request.data);
  const requestId = requestIdOf(data);
  if (!requestId) return { ok: false, error: "not_found" };
  const action = (pickText(data, "action", "p_action") ?? "").toLowerCase();
  const reason = trimmed(pick(data, "reason", "p_reason"));
  const meta = pickObject(data, "meta", "p_meta") ?? {};
  const actorName = await loadProfileName(staff.uid);
  const db = getFirestore();
  const reqRef = db.collection(COLLECTIONS.requests).doc(requestId);

  return runOutcome(async (tx) => {
    const snap = await tx.get(reqRef);
    if (!snap.exists) return fail("not_found");
    const req = dataOf(snap);
    const status = textOrNull(req.status) ?? "";
    const requestType = textOrNull(req.request_type) ?? "";
    const code = textOrNull(req.request_code);
    const driverId = textOrNull(req.driver_id);
    const def = await loadTypeDefinition(tx, requestType);
    const now = Timestamp.now();
    const nowIso = now.toDate().toISOString();
    const link = `${REQUEST_LINK_PREFIX}${requestId}`;

    if (action === "close") {
      if (!hasPermission(staff, "requests.manage")) return fail("not_authorized");
      if (status === "closed") return fail("already_closed");
      if (req.completed_at === null || req.completed_at === undefined) {
        return fail("not_decided_yet");
      }
      tx.update(reqRef, {
        status: "closed",
        closed_at: now,
        closed_by: staff.uid,
        needs_attention: false,
        updated_at: now,
      });
      return { result: { ok: true, status: "closed" }, notify: null };
    }

    if (CLOSED_STATUSES.has(status)) return fail("already_closed");
    if (status === "rescheduled" && action !== "clarify") {
      return fail("awaiting_driver_reschedule");
    }
    if (status === "needs_clarification" && action !== "clarify" && action !== "reject") {
      return fail("awaiting_driver_clarification");
    }
    if (
      action === "approve" &&
      FUEL_TYPES.has(requestType) &&
      textOrNull(req.fuel_transfer_type) === null
    ) {
      return fail("fuel_transfer_type_required");
    }

    const steps = await loadSteps(tx, requestId);
    const inProgress = steps.filter((s) => s.status === "in_progress");

    if (action === "clarify") {
      if (reason === "") return fail("reason_required");
      tx.set(db.collection(COLLECTIONS.requestClarifications).doc(), {
        request_id: requestId,
        step_order: numberOrNull(req.current_step_order),
        asked_by: staff.uid,
        question: reason,
        asked_at: now,
        created_at: now,
      });
      tx.update(reqRef, {
        status: "needs_clarification",
        decision_reason: reason,
        needs_attention: false,
        updated_at: now,
      });
      for (const step of inProgress) {
        tx.update(step.ref, {
          actor_display_name: actorName ?? textOrNull(step.data.actor_display_name),
          updated_at: now,
        });
      }
      return {
        result: { ok: true, status: "needs_clarification" },
        notify: {
          driverId,
          title: titled("Action required — ", code),
          body: "Please respond to a clarification on your request.",
          deepLink: ACTION_REQUIRED_LINK,
          category: "operations",
          priority: "high",
          actionParams: {
            record_type: "request",
            record_id: requestId,
            screen: "support_action_required",
          },
        },
      };
    }

    if (action === "reject") {
      if (reason === "") return fail("reason_required");
      for (const step of inProgress) {
        tx.update(step.ref, {
          status: "rejected",
          decided_by: staff.uid,
          decided_at: now,
          actor_display_name: actorName,
          decision_note: reason,
          updated_at: now,
        });
      }
      tx.update(reqRef, {
        status: "rejected",
        decision_reason: reason,
        decided_by: staff.uid,
        decided_at: now,
        completed_at: now,
        needs_attention: false,
        sla_due_at: null,
        updated_at: now,
      });
      return {
        result: { ok: true, status: "rejected" },
        notify: {
          driverId,
          title: titled("Request rejected — ", code),
          body: reason,
          deepLink: link,
          category: "operations",
          priority: "high",
          actionParams: { record_type: "request", record_id: requestId },
        },
      };
    }

    if (action === "solve") {
      tx.update(reqRef, {
        status: "solved",
        decided_by: staff.uid,
        decided_at: now,
        completed_at: now,
        decision_reason: reason === "" ? null : reason,
        needs_attention: false,
        sla_due_at: null,
        updated_at: now,
      });
      return {
        result: { ok: true, status: "solved" },
        notify: {
          driverId,
          title: titled("Request resolved — ", code),
          body: "Your request has been marked resolved.",
          deepLink: link,
          category: "operations",
          priority: "normal",
          actionParams: { record_type: "request", record_id: requestId },
        },
      };
    }

    if (action === "reschedule") {
      const newStart = dayOrNull(meta.new_start_date);
      const newEnd = dayOrNull(meta.new_end_date);
      if (newStart === null && newEnd === null) return fail("reschedule_dates_required");
      if (newStart !== null && newEnd !== null && newEnd < newStart) {
        return fail("invalid_date_range");
      }
      const step = inProgress[0];
      if (!step) return fail("wrong_step");
      const proposedBy = actorName ?? "Admin";
      tx.update(step.ref, {
        meta: {
          ...asDict(step.data.meta),
          reschedule_proposed_at: nowIso,
          reschedule_proposed_by: proposedBy,
          new_start_date: newStart,
          new_end_date: newEnd,
        },
        actor_display_name: actorName,
        updated_at: now,
      });
      tx.update(reqRef, {
        status: "rescheduled",
        decision_reason: reason === "" ? null : reason,
        payload: {
          ...asDict(req.payload),
          awaiting_driver_reschedule: true,
          reschedule: {
            proposed_start_date: newStart,
            proposed_end_date: newEnd,
            proposed_by: proposedBy,
            proposed_at: nowIso,
            note: reason === "" ? null : reason,
          },
        },
        needs_attention: false,
        updated_at: now,
      });
      return {
        result: { ok: true, status: "rescheduled" },
        notify: {
          driverId,
          title: titled("New dates proposed — ", code),
          body: "Please accept or decline the proposed dates.",
          deepLink: ACTION_REQUIRED_LINK,
          category: "operations",
          priority: "high",
          actionParams: {
            record_type: "request",
            record_id: requestId,
            screen: "support_action_required",
          },
        },
      };
    }

    if (action === "send_response") {
      if (reason === "") return fail("response_required");
      for (const step of inProgress) {
        tx.update(step.ref, {
          status: "completed",
          decided_by: staff.uid,
          decided_at: now,
          actor_display_name: actorName,
          decision_note: reason,
          meta: { ...asDict(step.data.meta), ...meta },
          updated_at: now,
        });
      }
      for (const step of steps.filter((s) => s.status === "pending")) {
        tx.update(step.ref, { status: "skipped", updated_at: now });
      }
      tx.update(reqRef, {
        status: "responded",
        decision_reason: reason,
        decided_by: staff.uid,
        decided_at: now,
        completed_at: now,
        needs_attention: false,
        sla_due_at: null,
        updated_at: now,
      });
      return {
        result: { ok: true, status: "responded" },
        notify: {
          driverId,
          title: titled("Response sent — ", code),
          body: reason,
          deepLink: link,
          category: "operations",
          priority: "high",
          actionParams: { record_type: "request", record_id: requestId },
        },
      };
    }

    if (!ADVANCING_ACTIONS.has(action)) return fail("unknown_action");

    let stepMeta: Dict = meta;
    let attachments: Dict[] = [];
    if (ATTACH_ACTIONS.has(action)) {
      const rows = attachmentsOf(meta);
      if (rows === null) return fail("attachment_required");
      attachments = rows;
      const { attachments: _dropped, ...rest } = meta;
      void _dropped;
      stepMeta = rest;
    }

    const step = inProgress[0];
    if (!step) return fail("wrong_step");
    const next = steps.find((s) => s.status === "pending" && s.order > step.order) ?? null;
    const templates = next ? await loadTemplates(tx, requestType) : [];

    for (const row of attachments) {
      tx.set(
        db.collection(COLLECTIONS.requestAttachments).doc(),
        attachmentDoc(requestId, row, staff.uid, now),
      );
    }
    tx.update(step.ref, {
      status: "completed",
      decided_by: staff.uid,
      decided_at: now,
      actor_display_name: actorName,
      decision_note: reason === "" ? null : reason,
      meta: stepMeta,
      updated_at: now,
    });

    if (next) {
      const template = templates.find((t) => numberOrNull(t.step_order) === next.order) ?? null;
      const slaMinutes = template ? positiveMinutes(template.sla_minutes) : null;
      const breach = template ? textOrNull(template.breach_action) : null;
      const slaDue = slaMinutes === null ? null : addMinutes(now, slaMinutes);
      const nextName = textOrNull(next.data.step_name);
      tx.update(next.ref, {
        status: "in_progress",
        started_at: now,
        sla_due_at: slaDue,
        breach_action: breach,
        updated_at: now,
      });
      tx.update(reqRef, {
        status: "in_review",
        current_step_order: next.order,
        current_step_label: nextName,
        sla_due_at: slaDue,
        sla_breach_action: breach,
        updated_at: now,
      });
      return {
        result: { ok: true, status: "in_review", step: next.order },
        notify: {
          driverId,
          title: titled("Request update — ", code),
          body: nextName === null ? null : `Now at step: ${nextName}`,
          deepLink: link,
          category: "operations",
          priority: "normal",
          actionParams: { record_type: "request", record_id: requestId },
        },
      };
    }

    const terminal = textOrNull(def?.terminal_status_on_approve) ?? "approved";
    const needsAck = terminal === "approved" && def?.requires_driver_ack_on_approve === true;
    const update: Dict = {
      status: terminal,
      current_step_label: textOrNull(step.data.step_name),
      current_step_order: step.order,
      decided_by: staff.uid,
      decided_at: now,
      completed_at: now,
      needs_attention: false,
      sla_due_at: null,
      updated_at: now,
    };
    if (needsAck) update.payload = { ...asDict(req.payload), awaiting_driver_ack: true };
    tx.update(reqRef, update);
    const solved = terminal === "solved";
    return {
      result: { ok: true, status: terminal },
      notify: {
        driverId,
        title: titled(solved ? "Request resolved — " : "Request approved — ", code),
        body: solved ? "Your request has been resolved." : "Your request has been approved.",
        deepLink: link,
        category: "operations",
        priority: "high",
        actionParams: { record_type: "request", record_id: requestId },
      },
    };
  });
});

export const adminForwardRequest = onCall(async (request) => {
  const staff = await requireStaff(request);
  if (!hasAny(staff, "requests.approve", "requests.manage")) {
    return { ok: false, error: "not_authorized" };
  }
  const data = asDict(request.data);
  const requestId = requestIdOf(data);
  const toUser = pickId(data, "toUser", "to_user", "p_to_user");
  if (!requestId || !toUser) return { ok: false, error: "missing_fields" };
  const note = trimmed(pick(data, "note", "p_note"));
  if (note === "") return { ok: false, error: "note_required" };
  if (toUser === staff.uid) return { ok: false, error: "forward_to_self" };

  const db = getFirestore();
  const reqRef = db.collection(COLLECTIONS.requests).doc(requestId);
  const outcome = await db.runTransaction(async (tx): Promise<Dict> => {
    const snap = await tx.get(reqRef);
    if (!snap.exists) return { ok: false, error: "not_found" };
    const req = dataOf(snap);
    if (CLOSED_STATUSES.has(textOrNull(req.status) ?? "")) {
      return { ok: false, error: "already_closed" };
    }
    const target = await tx.get(db.collection(COLLECTIONS.profiles).doc(toUser));
    const profile = target.exists ? dataOf(target) : null;
    if (
      !profile ||
      profile.role !== "staff" ||
      profile.approval_status !== "approved" ||
      textOrNull(profile.admin_role_id) === null
    ) {
      return { ok: false, error: "not_staff" };
    }
    const toName = trimmed(profile.full_name) || null;
    const currentOrder = numberOrNull(req.current_step_order);
    const steps = await loadSteps(tx, requestId);
    const step = steps.find((s) => currentOrder !== null && s.order === currentOrder) ?? null;
    const now = Timestamp.now();

    tx.set(db.collection(COLLECTIONS.requestForwards).doc(), {
      request_id: requestId,
      step_id: step?.ref.id ?? null,
      from_user: staff.uid,
      to_user: toUser,
      note,
      created_at: now,
    });
    tx.update(reqRef, {
      assigned_to: toUser,
      needs_attention: true,
      attention_at: now,
      attention_reason: "forwarded",
      updated_at: now,
    });
    if (step) tx.update(step.ref, { assigned_user_id: toUser, updated_at: now });
    return { ok: true, to_user: toUser, to_name: toName };
  });

  if (outcome.ok === true) {
    await logAdminActivity({
      actorId: staff.uid,
      action: "update",
      entity: "requests",
      entityId: requestId,
      detail: {
        route_name: "requests.forward",
        to_user: toUser,
        to_name: outcome.to_name ?? null,
        note,
      },
    });
  }
  return outcome;
});

export const adminEscalateRequest = onCall(async (request) => {
  const staff = await requireStaff(request);
  if (!hasAny(staff, "requests.approve", "requests.manage")) {
    return { ok: false, error: "not_authorized" };
  }
  const data = asDict(request.data);
  const requestId = requestIdOf(data);
  if (!requestId) return { ok: false, error: "missing_fields" };
  const note = trimmed(pick(data, "note", "p_note"));
  if (note === "") return { ok: false, error: "note_required" };

  const db = getFirestore();
  const reqRef = db.collection(COLLECTIONS.requests).doc(requestId);
  const outcome = await db.runTransaction(async (tx): Promise<Dict> => {
    const snap = await tx.get(reqRef);
    if (!snap.exists) return { ok: false, error: "not_found" };
    const req = dataOf(snap);
    if (CLOSED_STATUSES.has(textOrNull(req.status) ?? "")) {
      return { ok: false, error: "already_closed" };
    }
    const now = Timestamp.now();
    tx.update(reqRef, {
      needs_attention: true,
      attention_at: now,
      attention_reason: "escalated",
      payload: {
        ...asDict(req.payload),
        escalated_at: now.toDate().toISOString(),
        escalated_by: staff.uid,
        escalated_note: note,
      },
      updated_at: now,
    });
    return { ok: true };
  });

  if (outcome.ok === true) {
    await logAdminActivity({
      actorId: staff.uid,
      action: "update",
      entity: "requests",
      entityId: requestId,
      detail: { route_name: "requests.escalate", note },
    });
  }
  return outcome;
});

export const adminAddRequestComment = onCall(async (request) => {
  const staff = await requireStaff(request);
  if (!hasAny(staff, "requests.view", "requests.manage", "requests.approve")) {
    return { ok: false, error: "not_authorized" };
  }
  const data = asDict(request.data);
  const requestId = requestIdOf(data);
  const body = trimmed(pick(data, "body", "p_body"));
  if (!requestId || body === "") return { ok: false, error: "missing_fields" };

  const db = getFirestore();
  const reqSnap = await db.collection(COLLECTIONS.requests).doc(requestId).get();
  if (!reqSnap.exists) return { ok: false, error: "not_found" };
  const ref = db.collection(COLLECTIONS.requestComments).doc();
  await ref.set({
    request_id: requestId,
    author_id: staff.uid,
    body,
    created_at: FieldValue.serverTimestamp(),
  });
  return { ok: true, id: ref.id };
});

export const adminSetRequestDecisionMeta = onCall(async (request) => {
  const staff = await requireStaff(request);
  if (!hasAny(staff, "requests.approve", "requests.manage")) {
    return { ok: false, error: "not_authorized" };
  }
  const data = asDict(request.data);
  const requestId = requestIdOf(data);
  const meta = pickObject(data, "meta", "p_meta");
  if (meta === null) return { ok: false, error: "invalid_meta" };
  if (!requestId) return { ok: false, error: "no_completed_step" };

  const db = getFirestore();
  const reqRef = db.collection(COLLECTIONS.requests).doc(requestId);
  return db.runTransaction(async (tx): Promise<Dict> => {
    const steps = await loadSteps(tx, requestId);
    const reqSnap = await tx.get(reqRef);
    const completed = steps
      .filter((s) => s.status === "completed")
      .sort((a, b) => {
        const at = asDate(a.data.decided_at)?.getTime() ?? null;
        const bt = asDate(b.data.decided_at)?.getTime() ?? null;
        if (at !== bt) {
          if (at === null) return 1;
          if (bt === null) return -1;
          return bt - at;
        }
        return b.order - a.order;
      });
    const step = completed[0];
    if (!step) return { ok: false, error: "no_completed_step" };
    const now = Timestamp.now();
    tx.update(step.ref, { meta: { ...asDict(step.data.meta), ...meta }, updated_at: now });
    if (reqSnap.exists) {
      tx.update(reqRef, {
        needs_attention: true,
        attention_at: now,
        attention_reason: "decision_terms_updated",
        updated_at: now,
      });
    }
    return { ok: true, step_id: step.ref.id };
  });
});

function templateSla(raw: unknown): number | null {
  const text =
    typeof raw === "number" && Number.isFinite(raw)
      ? String(raw)
      : typeof raw === "string"
        ? raw
        : null;
  if (text === null || !/^[0-9]+$/.test(text)) return null;
  const n = Number(text);
  return n > 0 ? n : null;
}

function templateBoolean(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === "boolean") return raw;
  const text = String(raw).trim().toLowerCase();
  if (["true", "t", "yes", "y", "on", "1"].includes(text)) return true;
  if (["false", "f", "no", "n", "off", "0"].includes(text)) return false;
  throw new HttpsError("invalid-argument", "invalid_steps");
}

function templateActions(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) throw new HttpsError("invalid-argument", "invalid_steps");
  return raw
    .filter((item) => item !== null && item !== undefined)
    .map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
}

export const adminUpsertStepTemplate = onCall(async (request) => {
  const staff = await requireStaff(request);
  if (!hasPermission(staff, "requests.manage")) return { ok: false, error: "not_authorized" };
  const data = asDict(request.data);
  const requestType = pickText(data, "requestType", "request_type", "p_request_type") ?? "";
  const rawSteps = pick(data, "steps", "p_steps");
  if (!Array.isArray(rawSteps)) return { ok: false, error: "invalid_steps" };

  const rows: Dict[] = [];
  const seen = new Set<number>();
  for (const item of rawSteps) {
    const step = asDict(item);
    const order = numberOrNull(step.step_order);
    if (order === null || !Number.isInteger(order)) {
      throw new HttpsError("invalid-argument", "invalid_steps");
    }
    if (seen.has(order)) throw new HttpsError("invalid-argument", "duplicate_step_order");
    seen.add(order);
    const sla = templateSla(step.sla_minutes);
    const breachText = trimmed(step.breach_action).toLowerCase();
    let breach: string | null =
      breachText === "notify" || breachText === "escalate" ? breachText : null;
    if (sla === null) breach = null;
    else if (breach === null) breach = "notify";
    rows.push({
      request_type: requestType,
      step_order: order,
      step_name: textOrNull(step.step_name),
      role_key: textOrNull(step.role_key),
      is_system_auto: templateBoolean(step.is_system_auto),
      allowed_actions: templateActions(step.allowed_actions),
      sla_minutes: sla,
      breach_action: breach,
    });
  }

  const db = getFirestore();
  const col = db.collection(COLLECTIONS.requestApprovalStepTemplates);
  return db.runTransaction(async (tx): Promise<Dict> => {
    const def = await loadTypeDefinition(tx, requestType);
    if (!def) return { ok: false, error: "unknown_request_type" };
    const existing = await tx.get(col.where("request_type", "==", requestType));
    if (existing.size + rows.length > BATCH_LIMIT) {
      throw new HttpsError("out-of-range", "too_many_rows");
    }
    const now = Timestamp.now();
    for (const doc of existing.docs) tx.delete(doc.ref);
    for (const row of rows) tx.set(col.doc(), { ...row, created_at: now, updated_at: now });
    return { ok: true };
  });
});

async function commitUpdates(updates: Array<{ ref: DocumentReference; data: Dict }>) {
  const db = getFirestore();
  for (let i = 0; i < updates.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const { ref, data } of updates.slice(i, i + BATCH_LIMIT)) batch.update(ref, data);
    await batch.commit();
  }
}

export const adminAutoCloseRequests = onCall(async (request) => {
  await requireStaff(request);
  const db = getFirestore();
  const settings = await db.collection(COLLECTIONS.appSettings).doc("1").get();
  if (!settings.exists) return 0;
  const days = numberOrNull(dataOf(settings).request_auto_close_days) ?? 30;
  if (days <= 0) return 0;

  const snap = await db
    .collection(COLLECTIONS.requests)
    .where("status", "in", AUTO_CLOSE_STATUSES)
    .limit(SCAN_CAP + 1)
    .get();
  if (snap.size > SCAN_CAP) throw new HttpsError("out-of-range", "too_many_rows");

  const now = Timestamp.now();
  const cutoff = now.toMillis() - days * 86_400_000;
  const updates = snap.docs
    .filter((doc) => {
      const completed = asDate(dataOf(doc).completed_at);
      return completed !== null && completed.getTime() < cutoff;
    })
    .map((doc) => ({
      ref: doc.ref,
      data: { status: "closed", closed_at: now, needs_attention: false, updated_at: now } as Dict,
    }));
  await commitUpdates(updates);
  return updates.length;
});

export const adminRunRequestSlaSweep = onCall(async (request) => {
  await requireStaff(request);
  const db = getFirestore();
  const snap = await db
    .collection(COLLECTIONS.requestApprovalSteps)
    .where("status", "==", "in_progress")
    .limit(SCAN_CAP + 1)
    .get();
  if (snap.size > SCAN_CAP) throw new HttpsError("out-of-range", "too_many_rows");

  const now = Timestamp.now();
  const nowMs = now.toMillis();
  const breached = snap.docs.filter((doc) => {
    const row = dataOf(doc);
    const due = asDate(row.sla_due_at);
    return (
      due !== null &&
      due.getTime() < nowMs &&
      (row.sla_breached_at === null || row.sla_breached_at === undefined)
    );
  });

  const reasonByRequest = new Map<string, string>();
  const stepUpdates = breached.map((doc) => {
    const row = dataOf(doc);
    const requestId = textOrNull(row.request_id);
    if (requestId !== null && !reasonByRequest.has(requestId)) {
      reasonByRequest.set(
        requestId,
        textOrNull(row.breach_action) === "escalate" ? "sla_escalated" : "sla_breach",
      );
    }
    return { ref: doc.ref, data: { sla_breached_at: now, updated_at: now } as Dict };
  });
  await commitUpdates(stepUpdates);

  const requestCol = db.collection(COLLECTIONS.requests);
  const ids = [...reasonByRequest.keys()];
  const requestUpdates: Array<{ ref: DocumentReference; data: Dict }> = [];
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const refs = ids.slice(i, i + BATCH_LIMIT).map((id) => requestCol.doc(id));
    const docs = refs.length > 0 ? await db.getAll(...refs) : [];
    for (const doc of docs) {
      if (!doc.exists) continue;
      requestUpdates.push({
        ref: doc.ref,
        data: {
          needs_attention: true,
          attention_at: now,
          attention_reason: reasonByRequest.get(doc.id) ?? "sla_breach",
          updated_at: now,
        },
      });
    }
  }
  await commitUpdates(requestUpdates);
  return requestUpdates.length;
});

export const adminUploadIncomingDocument = onCall(async (request) => {
  const staff = await requireStaff(request);
  if (!hasPermission(staff, "requests.manage")) return { ok: false, error: "not_authorized" };
  const data = asDict(request.data);
  const driverId = pickId(data, "driverId", "driver_id", "p_driver_id");
  if (!driverId) return { ok: false, error: "driver_required" };
  const subject = trimmed(pick(data, "subject", "p_subject"));
  if (subject === "") return { ok: false, error: "subject_required" };
  const category = trimmed(pick(data, "category", "p_category"));
  if (category === "") return { ok: false, error: "category_required" };
  const rawAttachments = pick(data, "attachments", "p_attachments");
  if (!Array.isArray(rawAttachments) || rawAttachments.length === 0) {
    return { ok: false, error: "attachment_required" };
  }
  const receivedOn = pickDay(data, "receivedOn", "received_on", "p_received_on");
  const startRoute = pickBoolean(data, "startRoute", "start_route", "p_start_route");
  const actorName = await loadProfileName(staff.uid);

  const db = getFirestore();
  const outcome = await db.runTransaction(async (tx): Promise<Dict> => {
    const driverSnap = await tx.get(db.collection(COLLECTIONS.drivers).doc(driverId));
    const driver = driverSnap.exists ? dataOf(driverSnap) : null;
    if (!driver || (driver.archived_at !== null && driver.archived_at !== undefined)) {
      return { ok: false, error: "not_a_driver" };
    }
    const profileSnap = await tx.get(db.collection(COLLECTIONS.profiles).doc(driverId));
    const driverName =
      (profileSnap.exists ? trimmed(dataOf(profileSnap).full_name) : "") ||
      trimmed(driver.name) ||
      null;
    const templates = startRoute ? await loadTemplates(tx, "document") : [];
    const code = await nextRequestCode(tx, "document");

    const now = Timestamp.now();
    const nowIso = now.toDate().toISOString();
    const reqRef = db.collection(COLLECTIONS.requests).doc();
    const requestDoc: Dict = {
      request_code: code,
      driver_id: driverId,
      driver_name: driverName,
      driver_code: textOrNull(driver.driver_code),
      employee_id: textOrNull(driver.employee_id),
      request_type: "document",
      status: "submitted",
      payload: {
        source: "admin_incoming",
        category,
        subject,
        received_on: receivedOn,
        created_on_behalf: true,
        created_on_behalf_by: staff.uid,
        created_on_behalf_by_name: actorName ?? "Admin",
        created_on_behalf_at: nowIso,
      },
      details: subject,
      current_step_order: null,
      current_step_label: null,
      needs_attention: true,
      attention_at: now,
      attention_reason: "incoming_document",
      created_at: now,
      updated_at: now,
    };

    if (startRoute && templates.length > 0) {
      let current: { order: number; name: string | null } | null = null;
      let slaDue: Timestamp | null = null;
      let breach: string | null = null;
      const seen = new Set<number>();
      for (const template of templates) {
        const order = numberOrNull(template.step_order);
        if (order === null || seen.has(order)) continue;
        seen.add(order);
        const name = textOrNull(template.step_name);
        const status = order === 1 ? "completed" : order === 2 ? "in_progress" : "pending";
        const sla = order === 2 ? positiveMinutes(template.sla_minutes) : null;
        const due = sla === null ? null : addMinutes(now, sla);
        const stepBreach = order === 2 ? textOrNull(template.breach_action) : null;
        tx.set(db.collection(COLLECTIONS.requestApprovalSteps).doc(`${reqRef.id}_${order}`), {
          request_id: reqRef.id,
          step_order: order,
          step_name: name,
          role_key: textOrNull(template.role_key),
          status,
          started_at: order <= 2 ? now : null,
          decided_at: order === 1 ? now : null,
          actor_display_name: order === 1 ? driverName : null,
          sla_due_at: due,
          breach_action: stepBreach,
          meta: {},
          created_at: now,
          updated_at: now,
        });
        if (status === "in_progress" && current === null) {
          current = { order, name };
          slaDue = due;
          breach = stepBreach;
        }
      }
      requestDoc.current_step_order = current?.order ?? 1;
      requestDoc.current_step_label = current?.name ?? "Submitted";
      requestDoc.sla_due_at = slaDue;
      requestDoc.sla_breach_action = breach;
    }
    tx.set(reqRef, requestDoc);

    for (const item of rawAttachments) {
      const row = asDict(item);
      const capturedAt = asDate(row.captured_at);
      tx.set(db.collection(COLLECTIONS.requestAttachments).doc(), {
        request_id: reqRef.id,
        storage_key: textOrNull(row.storage_key),
        file_name: textOrNull(row.file_name),
        content_type: textOrNull(row.content_type),
        byte_size: numberOrNull(row.byte_size),
        uploaded_by: staff.uid,
        title: textOrNull(row.title),
        kind: textOrNull(row.kind),
        captured_at: capturedAt === null ? null : Timestamp.fromDate(capturedAt),
        source: textOrNull(row.source) ?? "admin_upload",
        created_at: now,
      });
    }
    return { ok: true, id: reqRef.id, request_code: code };
  });

  if (outcome.ok === true) {
    await logAdminActivity({
      actorId: staff.uid,
      action: "create",
      entity: "requests",
      entityId: String(outcome.id),
      detail: { route_name: "requests.incoming_upload", category, start_route: startRoute },
    });
  }
  return outcome;
});
