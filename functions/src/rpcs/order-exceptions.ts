/**
 * Rejected and cancelled orders, as a record the rider files and an admin
 * verifies.
 *
 * Two situations look identical in `deliveries` and are not the same fact:
 *
 *   A. the rider refused the assignment or the pickup (their own decision), and
 *   B. the store or the customer rejected or cancelled the order (not their
 *      decision, usually mid-trip).
 *
 * `deliveries` cannot tell them apart — both end in `rejected` / `cancelled` —
 * and the rider's side of the story (a screenshot of the partner app, the store
 * closing, the customer refusing) never reaches the panel at all. That is what
 * this collection exists for: one row per reported case, with the proof, the
 * rider's mandatory reason, and the admin's verdict.
 *
 * The verdict does not rewrite `deliveries`. An approved exception is a fact
 * about *why* the delivery ended, and the delivery still ended; a module that
 * wanted to price it differently can read `order_exceptions` and find the
 * approved ones. Rewriting history here would make the delivery counts
 * disagree with themselves on every screen that already reads them.
 */
import { onCall } from "firebase-functions/v2/https";
import { FieldValue, getFirestore, type Query } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import { requireRider, riderError } from "../core/rider";
import { requireStaff, requireStaffFresh } from "../core/staff";
import { notifyDriverTransactional } from "./visits-shared";
import {
  isoTimestamp,
  logAdminActivity,
  logDriverOperation,
  pick,
  pickCount,
  pickId,
  pickText,
  textOrNull,
  type Dict,
} from "./_shared";

export const ORDER_EXCEPTION_KINDS = ["rejected", "cancelled"] as const;
export type OrderExceptionKind = (typeof ORDER_EXCEPTION_KINDS)[number];

export const ORDER_EXCEPTION_SOURCES = ["driver_declined", "store_or_customer"] as const;
export type OrderExceptionSource = (typeof ORDER_EXCEPTION_SOURCES)[number];

export const ORDER_EXCEPTION_STATUSES = ["pending", "approved", "rejected"] as const;
export type OrderExceptionStatus = (typeof ORDER_EXCEPTION_STATUSES)[number];

const MAX_PROOFS = 5;
const MAX_PROOF_LEN = 512;
const MAX_ORDERS_PER_DAY = 20;
const REASON_MIN = 8;
const REASON_MAX = 500;
const LIST_DEFAULT = 50;
const LIST_MAX = 200;
/** An explicit export may read a wider window than one page of the queue. */
const EXPORT_MAX = 1000;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function parseExceptionKind(raw: string | null): OrderExceptionKind {
  const value = (raw ?? "").toLowerCase();
  if (value === "rejected" || value === "cancelled") return value;
  throw riderError("invalid-argument", "invalid_kind");
}

export function parseExceptionSource(raw: string | null): OrderExceptionSource {
  const value = (raw ?? "").toLowerCase();
  if (value === "driver_declined" || value === "store_or_customer") return value;
  throw riderError("invalid-argument", "invalid_source");
}

export function parseExceptionStatus(raw: string | null): OrderExceptionStatus | null {
  const value = (raw ?? "").toLowerCase();
  if (value === "pending" || value === "approved" || value === "rejected") return value;
  return null;
}

/**
 * Proof keys: the rider's screenshots, already uploaded through the admin
 * `/api/driver-uploads/presign` route.
 *
 * Accepts the JSON-array spelling the app sends for a multi-pick and the scalar
 * spelling a single pick uses, because both are produced by the same screen
 * depending on how many photos were attached. A `..` segment is refused: the
 * key becomes an R2 object path on read, and a traversing path would escape the
 * rider's own prefix.
 */
export function parseExceptionProofKeys(raw: unknown): string[] {
  let items: unknown[];
  if (raw === null || raw === undefined || raw === "") {
    items = [];
  } else if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") {
      items = [];
    } else if (trimmed.startsWith("[")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw riderError("invalid-argument", "invalid_proof_keys");
      }
      if (!Array.isArray(parsed)) throw riderError("invalid-argument", "invalid_proof_keys");
      items = parsed;
    } else {
      items = [trimmed];
    }
  } else {
    throw riderError("invalid-argument", "invalid_proof_keys");
  }

  const out: string[] = [];
  for (const item of items) {
    const key = typeof item === "string" ? item.trim() : "";
    if (key === "") continue;
    if (key.includes("..") || key.length > MAX_PROOF_LEN) {
      throw riderError("invalid-argument", "invalid_proof_keys");
    }
    if (!out.includes(key)) out.push(key);
  }
  if (out.length > MAX_PROOFS) throw riderError("invalid-argument", "too_many_proofs");
  return out;
}

/** The order id the rider typed. Digits only, the same contract as pickup. */
export function parseExceptionOrderId(raw: unknown): string | null {
  const value = asString(raw)?.replace(/^#+|#+$/g, "") ?? "";
  if (value === "") return null;
  if (!/^[0-9]{1,32}$/.test(value)) throw riderError("invalid-argument", "invalid_order_id");
  return value;
}

export function validateExceptionReason(raw: unknown): string {
  const reason = (asString(raw) ?? "").replace(/\s+/g, " ");
  if (reason.length < REASON_MIN) throw riderError("invalid-argument", "reason_required");
  if (reason.length > REASON_MAX) throw riderError("invalid-argument", "reason_too_long");
  return reason;
}

type ExceptionRow = {
  id: string;
  created_at: string | null;
  updated_at: string | null;
  day: string | null;
  driver_id: string;
  driver_code: string | null;
  driver_name: string | null;
  kind: OrderExceptionKind;
  source: OrderExceptionSource;
  status: OrderExceptionStatus;
  order_id: string | null;
  delivery_id: string | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
  reason: string;
  proof_keys: string[];
  reviewed_at: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  review_note: string | null;
  /** Admin can mark an accepted case as excluded from any penalty view. */
  counted_as_exception: boolean;
};

function serialiseException(id: string, raw: Dict): ExceptionRow {
  const reviewedAt = raw["reviewed_at"];
  return {
    id,
    created_at: isoTimestamp(raw["created_at"]),
    updated_at: isoTimestamp(raw["updated_at"]),
    day: asString(raw["day"]),
    driver_id: asString(raw["driver_id"]) ?? "",
    driver_code: asString(raw["driver_code"]),
    driver_name: asString(raw["driver_name"]),
    kind: (asString(raw["kind"]) ?? "rejected") as OrderExceptionKind,
    source: (asString(raw["source"]) ?? "store_or_customer") as OrderExceptionSource,
    status: (asString(raw["status"]) ?? "pending") as OrderExceptionStatus,
    order_id: asString(raw["order_id"]),
    delivery_id: asString(raw["delivery_id"]),
    restaurant_id: asString(raw["restaurant_id"]),
    restaurant_name: asString(raw["restaurant_name"]),
    reason: asString(raw["reason"]) ?? "",
    proof_keys: Array.isArray(raw["proof_keys"])
      ? (raw["proof_keys"] as unknown[]).filter((key): key is string => typeof key === "string")
      : [],
    reviewed_at: isoTimestamp(reviewedAt),
    reviewed_by: asString(raw["reviewed_by"]),
    reviewed_by_name: asString(raw["reviewed_by_name"]),
    review_note: asString(raw["review_note"]),
    counted_as_exception: raw["counted_as_exception"] !== false,
  };
}

function sortByCreatedDesc(rows: ExceptionRow[]): ExceptionRow[] {
  return rows.sort((left, right) => {
    const a = left.created_at ?? "";
    const b = right.created_at ?? "";
    if (a !== b) return b.localeCompare(a);
    return right.id.localeCompare(left.id);
  });
}

/**
 * `driver_submit_order_exception`.
 *
 * Runs under the rider's own uid, so `driver_id` is never taken from the body.
 * The day is the Kuwait day of the write, not a body value: a rider filing this
 * evening for an order they lost yesterday would otherwise be able to move the
 * record to any day they liked.
 */
export const driverSubmitOrderException = onCall(async (request) => {
  const rider = await requireRider(request);
  const data = (request.data ?? {}) as Dict;

  const kind = parseExceptionKind(pickText(data, "kind", "p_kind"));
  const source = parseExceptionSource(pickText(data, "source", "p_source"));
  const reason = validateExceptionReason(pick(data, "reason", "p_reason"));
  const proofKeys = parseExceptionProofKeys(pick(data, "proofKeys", "proof_keys", "p_proof_keys"));
  if (proofKeys.length === 0) throw riderError("invalid-argument", "proof_required");

  const orderId = parseExceptionOrderId(pick(data, "orderId", "order_id", "p_order_id"));
  const deliveryId = pickId(data, "deliveryId", "delivery_id", "p_delivery_id");
  const restaurantId = pickId(data, "restaurantId", "restaurant_id", "p_restaurant_id");

  const driver = rider.driver;
  const profile = rider.profile;
  const db = getFirestore();
  const today = kuwaitDayString(new Date());

  // One rider can lose a handful of orders in a shift; twenty in a day is not a
  // shift, it is an attempt to fill the queue. The ceiling is per rider per
  // Kuwait day and is deliberately generous — a genuine bad night can reach it.
  const todaySnap = await db
    .collection(COLLECTIONS.orderExceptions)
    .where("driver_id", "==", rider.uid)
    .where("day", "==", today)
    .get();
  if (todaySnap.size >= MAX_ORDERS_PER_DAY) {
    throw riderError("resource-exhausted", "daily_limit_reached");
  }

  // A duplicate report for the same order on the same day is the rider tapping
  // Send twice, not a second incident.
  if (orderId) {
    const duplicate = todaySnap.docs.find((doc) => {
      const row = doc.data() as Dict;
      return asString(row["order_id"]) === orderId && asString(row["kind"]) === kind;
    });
    if (duplicate) throw riderError("already-exists", "duplicate_exception");
  }

  let restaurantName: string | null = null;
  if (restaurantId) {
    const restaurantSnap = await db.collection(COLLECTIONS.restaurants).doc(restaurantId).get();
    restaurantName = restaurantSnap.exists ? asString(restaurantSnap.get("name")) : null;
  }

  const driverCode = asString(driver["driver_code"]);
  const driverName =
    asString(profile["full_name"]) ?? asString(driver["full_name"]) ?? asString(driver["name"]);

  const ref = db.collection(COLLECTIONS.orderExceptions).doc();
  await ref.set({
    driver_id: rider.uid,
    driver_code: driverCode,
    driver_name: driverName,
    employee_id: asString(driver["employee_id"]),
    kind,
    source,
    status: "pending",
    order_id: orderId,
    delivery_id: deliveryId,
    restaurant_id: restaurantId,
    restaurant_name: restaurantName,
    reason,
    proof_keys: proofKeys,
    day: today,
    counted_as_exception: true,
    reviewed_at: null,
    reviewed_by: null,
    reviewed_by_name: null,
    review_note: null,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });

  void logDriverOperation({
    driverId: rider.uid,
    module: "delivery",
    action: `exception_${kind}`,
    actor: rider.uid,
    recordType: "order_exception",
    recordId: ref.id,
    detail: { source, order_id: orderId, proofs: proofKeys.length },
  }).catch(() => undefined);

  return { ok: true, id: ref.id };
});

/** `driver_list_my_order_exceptions`. */
export const driverListMyOrderExceptions = onCall(async (request) => {
  const rider = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const limit = Math.min(Math.max(pickCount(data, LIST_DEFAULT, "limit", "p_limit"), 1), LIST_MAX);
  const status = parseExceptionStatus(pickText(data, "status", "p_status"));

  const db = getFirestore();
  const snap = await db
    .collection(COLLECTIONS.orderExceptions)
    .where("driver_id", "==", rider.uid)
    .orderBy("created_at", "desc")
    .limit(status ? LIST_MAX : limit)
    .get();

  let rows = snap.docs.map((doc) => serialiseException(doc.id, doc.data() as Dict));
  if (status) rows = rows.filter((row) => row.status === status).slice(0, limit);

  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const doc of snap.docs) {
    const raw = doc.data() as Dict;
    const key = (asString(raw["status"]) ?? "pending") as OrderExceptionStatus;
    counts[key] += 1;
  }

  return { rows: sortByCreatedDesc(rows), counts };
});

/**
 * `admin_list_order_exceptions`.
 *
 * Reads on `deliveries.view` — verifying an exception is looking at a delivery,
 * not changing a rider's money — while the decision itself needs
 * `deliveries.manage`, so a view-only seat can read the queue and not clear it.
 */
export const adminListOrderExceptions = onCall(async (request) => {
  await requireStaff(request, "deliveries.view");

  const data = (request.data ?? {}) as Dict;
  const status = parseExceptionStatus(pickText(data, "status", "p_status"));
  const kind = asString(pickText(data, "kind", "p_kind"));
  const source = asString(pickText(data, "source", "p_source"));
  const driverId = pickId(data, "driverId", "driver_id", "p_driver_id");
  const fromDay = pickText(data, "from", "p_from");
  const toDay = pickText(data, "to", "p_to");
  const search = (pickText(data, "search", "p_search") ?? "").toLowerCase();
  /**
   * An export asks for a wider window than a page can hold, and says so with
   * `export: true`. Without it the queue keeps its 200-row ceiling, so a stray
   * client cannot turn one list call into a full-collection scan.
   */
  const exportMode = data["export"] === true;
  const maxLimit = exportMode ? EXPORT_MAX : LIST_MAX;
  const limit = Math.min(Math.max(pickCount(data, LIST_DEFAULT, "limit", "p_limit"), 1), maxLimit);
  const offset = Math.max(pickCount(data, 0, "offset", "p_offset"), 0);

  const db = getFirestore();
  let query: Query = db.collection(COLLECTIONS.orderExceptions);
  if (driverId) query = query.where("driver_id", "==", driverId);
  if (status) query = query.where("status", "==", status);
  if (kind === "rejected" || kind === "cancelled") query = query.where("kind", "==", kind);
  if (source === "driver_declined" || source === "store_or_customer") {
    query = query.where("source", "==", source);
  }

  const snap = await query.orderBy("created_at", "desc").limit(maxLimit * 2).get();
  const all = snap.docs.map((doc) => serialiseException(doc.id, doc.data() as Dict));

  const windowed = all.filter((row) => {
    const day = row.day ?? (row.created_at ? row.created_at.slice(0, 10) : "");
    if (fromDay && day < fromDay) return false;
    if (toDay && day > toDay) return false;
    if (search === "") return true;
    return [row.driver_name, row.driver_code, row.order_id, row.restaurant_name, row.reason]
      .filter((part): part is string => part !== null)
      .some((part) => part.toLowerCase().includes(search));
  });

  const counts = { pending: 0, approved: 0, rejected: 0, total: windowed.length };
  for (const row of windowed) counts[row.status] += 1;

  return {
    rows: sortByCreatedDesc(windowed).slice(offset, offset + limit),
    total: windowed.length,
    counts,
    offset,
    limit,
  };
});

/**
 * `admin_review_order_exception`.
 *
 * Approve means the panel accepts the rider's account of what happened; reject
 * means it does not. Either way the row keeps the rider's own words and proof —
 * this is a record with a verdict on it, never an overwrite.
 */
export const adminReviewOrderException = onCall(async (request) => {
  const staff = await requireStaffFresh(request, "deliveries.manage");
  const data = (request.data ?? {}) as Dict;

  const id = pickId(data, "id", "exceptionId", "exception_id", "p_id");
  if (!id) throw riderError("invalid-argument", "invalid_exception");

  const decision = (pickText(data, "decision", "status", "p_decision") ?? "").toLowerCase();
  if (decision !== "approved" && decision !== "rejected") {
    throw riderError("invalid-argument", "invalid_decision");
  }
  const note = textOrNull(pick(data, "note", "reviewNote", "review_note", "p_note"));
  if (decision === "rejected" && note === null) {
    // A rejection with no sentence is the one outcome the rider cannot learn
    // from, and they will file the same case again tomorrow.
    throw riderError("invalid-argument", "review_note_required");
  }

  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.orderExceptions).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw riderError("not-found", "exception_not_found");
  const row = snap.data() as Dict;

  const staffSnap = await db.collection(COLLECTIONS.profiles).doc(staff.uid).get();
  const staffName = staffSnap.exists ? asString(staffSnap.get("full_name")) : null;

  await ref.set(
    {
      status: decision,
      reviewed_at: FieldValue.serverTimestamp(),
      reviewed_by: staff.uid,
      reviewed_by_name: staffName,
      review_note: note,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await logAdminActivity({
    actorId: staff.uid,
    action: `order_exception_${decision}`,
    entity: "order_exceptions",
    entityId: id,
    detail: { driver_id: asString(row["driver_id"]), order_id: asString(row["order_id"]), note },
  });

  const driverId = asString(row["driver_id"]);
  const kind = (asString(row["kind"]) ?? "rejected") as OrderExceptionKind;
  const orderLabel = asString(row["order_id"]);
  const amountLabel = orderLabel ? `#${orderLabel}` : "";
  if (driverId) {
    await notifyDriverTransactional({
      driverId,
      title:
        decision === "approved"
          ? `Order ${kind} case verified`
          : `Order ${kind} case declined`,
      body:
        decision === "approved"
          ? `${amountLabel} was accepted as reported.${note ? ` ${note}` : ""}`.trim()
          : `${amountLabel} was not accepted.${note ? ` ${note}` : ""}`.trim(),
      deepLink: "musallam:///profile/order-exceptions",
      category: "delivery",
      priority: "normal",
      actionParams: {
        record_type: "order_exception",
        record_id: id,
        status: decision,
      },
      createdBy: staff.uid,
    });
  }

  return { ok: true, id, status: decision };
});

/**
 * `admin_order_exception_summary` — the counts the list header shows without
 * reading every row. One scan over a small collection.
 */
export const adminOrderExceptionSummary = onCall(async (request) => {
  await requireStaff(request, "deliveries.view");

  const data = (request.data ?? {}) as Dict;
  const fromDay = pickText(data, "from", "p_from");
  const toDay = pickText(data, "to", "p_to");

  const snap = await getFirestore().collection(COLLECTIONS.orderExceptions).orderBy("created_at", "desc").limit(2000).get();
  const counts = {
    pending: 0,
    approved: 0,
    rejected: 0,
    rejected_orders: 0,
    cancelled_orders: 0,
    driver_declined: 0,
    store_or_customer: 0,
    total: 0,
  };
  for (const doc of snap.docs) {
    const row = doc.data() as Dict;
    const day = asString(row["day"]) ?? "";
    if (fromDay && day < fromDay) continue;
    if (toDay && day > toDay) continue;
    counts.total += 1;
    const status = (asString(row["status"]) ?? "pending") as OrderExceptionStatus;
    counts[status] += 1;
    if (status !== "rejected") {
      if (asString(row["kind"]) === "cancelled") counts.cancelled_orders += 1;
      else counts.rejected_orders += 1;
    }
    if (asString(row["source"]) === "driver_declined") counts.driver_declined += 1;
    else counts.store_or_customer += 1;
  }
  return counts;
});
