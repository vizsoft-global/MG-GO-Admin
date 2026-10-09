/**
 * E-sign staff counter-signature (F15): the signer editor and the To Sign inbox.
 *
 * Port of `20261117000200_esign_staff_signer_inbox`. `esign_requests.status`
 * stays the employee's signature; the counter-signature lives on the signer
 * row. Staff rows carry `staff_user_id` and never `driver_id`.
 *
 * The partial unique `(request_id, staff_user_id, role)` becomes the document
 * id of a staff signer row, so two concurrent adds of the same person collide
 * on `create()` instead of producing two inbox rows.
 */
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  getFirestore,
  Timestamp,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { requireStaff } from "../core/staff";
import {
  IN_FILTER_LIMIT,
  SCAN_CAP,
  chunk,
  dataOf,
  isoTimestamp,
  loadDocMap,
  logAdminActivity,
  numberOrNull,
  pickId,
  pickIdList,
  pickObject,
  pickText,
  pickTriBool,
  type Dict,
} from "./_shared";

const SIGNER_ROLES = new Set(["countersigner", "manager", "witness"]);
const FIRST_STAFF_SLOT = 10;
const LAST_STAFF_SLOT = 200;
const REORDER_SHIFT = 1000;

type CounterSignatureState = "none" | "pending" | "signed" | "declined";

function staffSignerDocId(requestId: string, staffUserId: string, role: string): string {
  return `staff_${requestId}_${staffUserId}_${role}`;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function sortOrderOf(row: Dict): number {
  return numberOrNull(row.sort_order) ?? 0;
}

function millisOf(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function isStaffRow(row: Dict): boolean {
  return textOf(row.staff_user_id) !== null;
}

/** `_esign_counter_signature_state`: declined beats pending beats signed. */
function counterSignatureState(rows: readonly Dict[]): CounterSignatureState {
  const staff = rows.filter(isStaffRow);
  if (staff.length === 0) return "none";
  if (staff.some((row) => row.status === "declined")) return "declined";
  if (staff.some((row) => row.status === "pending")) return "pending";
  return "signed";
}

/** `_esign_awaiting_counter_signature`. */
function awaitingCounterSignature(rows: readonly Dict[], requestStatus: unknown): boolean {
  return (
    requestStatus === "signed" &&
    rows.some((row) => isStaffRow(row) && row.status === "pending")
  );
}

/** `_esign_next_signer_order`: the lowest free slot in 10..200, else 10. */
function nextSignerOrder(rows: readonly Dict[]): number {
  const taken = new Set(rows.map(sortOrderOf));
  for (let slot = FIRST_STAFF_SLOT; slot <= LAST_STAFF_SLOT; slot += 1) {
    if (!taken.has(slot)) return slot;
  }
  return FIRST_STAFF_SLOT;
}

function signersForRequestQuery(requestId: string) {
  return getFirestore()
    .collection(COLLECTIONS.esignRequestSigners)
    .where("request_id", "==", requestId)
    .limit(SCAN_CAP + 1);
}

function assertWithinCap(size: number): void {
  if (size > SCAN_CAP) throw new HttpsError("out-of-range", "too_many_rows");
}

/** The caller's own pending staff row for a request, lowest `sort_order` first. */
function firstPendingOwnRow(
  docs: readonly QueryDocumentSnapshot[],
  uid: string,
): QueryDocumentSnapshot | null {
  const own = docs
    .filter((doc) => {
      const row = dataOf(doc);
      return row.staff_user_id === uid && row.status === "pending";
    })
    .sort((a, b) => sortOrderOf(dataOf(a)) - sortOrderOf(dataOf(b)));
  return own[0] ?? null;
}

function declinedReasonOf(row: Dict): string | null {
  const meta = row.signer_meta;
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return null;
  return textOf((meta as Dict).declined_reason);
}

async function loadCategoriesByKey(keys: readonly string[]): Promise<Map<string, Dict>> {
  const unique = [...new Set(keys.filter((key) => key !== ""))];
  const out = new Map<string, Dict>();
  const db = getFirestore();
  for (const group of chunk(unique, IN_FILTER_LIMIT)) {
    const snap = await db
      .collection(COLLECTIONS.esignCategories)
      .where("key", "in", group)
      .get();
    for (const doc of snap.docs) {
      const row = dataOf(doc);
      const key = textOf(row.key) ?? doc.id;
      out.set(key, row);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Manage the signer set
// ---------------------------------------------------------------------------

export const adminListEsignSigners = onCall(async (request) => {
  await requireStaff(request, "requests.view");
  const data = (request.data ?? {}) as Dict;
  const requestId = pickId(data, "requestId", "p_request_id");
  if (!requestId) {
    return { ok: true, awaiting_counter_signature: false, counter_signature_state: "none", rows: [] };
  }

  const db = getFirestore();
  const [requestSnap, signerSnap] = await Promise.all([
    db.collection(COLLECTIONS.esignRequests).doc(requestId).get(),
    signersForRequestQuery(requestId).get(),
  ]);
  assertWithinCap(signerSnap.size);

  const signers = signerSnap.docs.map((doc) => ({ id: doc.id, row: dataOf(doc) }));
  const rows = signers.map((signer) => signer.row);
  const requestStatus = requestSnap.exists ? dataOf(requestSnap).status : null;

  const staffIds = rows.map((row) => textOf(row.staff_user_id)).filter((id): id is string => !!id);
  const driverIds = rows.map((row) => textOf(row.driver_id)).filter((id): id is string => !!id);
  const [profiles, drivers] = await Promise.all([
    loadDocMap(COLLECTIONS.profiles, [...staffIds, ...driverIds]),
    loadDocMap(COLLECTIONS.drivers, driverIds),
  ]);

  const out = signers
    .map(({ id, row }) => {
      const staffUserId = textOf(row.staff_user_id);
      const driverId = textOf(row.driver_id);
      const staffProfile = staffUserId ? profiles.get(staffUserId) : undefined;
      const driverProfile = driverId ? profiles.get(driverId) : undefined;
      const driver = driverId ? drivers.get(driverId) : undefined;
      return {
        id,
        request_id: requestId,
        role: textOf(row.role),
        sort_order: sortOrderOf(row),
        status: textOf(row.status),
        driver_id: driverId,
        staff_user_id: staffUserId,
        display_name:
          textOf(row.signer_display_name) ??
          textOf(staffProfile?.full_name) ??
          textOf(driverProfile?.full_name),
        employee_id: driver ? textOf(driver[FIELDS.drivers.employeeId]) : null,
        driver_code: driver ? textOf(driver[FIELDS.drivers.driverCode]) : null,
        staff_contact: staffProfile
          ? (textOf(staffProfile.email) ?? textOf(staffProfile.phone))
          : null,
        is_staff_signer: staffUserId !== null,
        viewed_at: isoTimestamp(row.viewed_at),
        signed_at: isoTimestamp(row.signed_at),
        declined_at: isoTimestamp(row.declined_at),
        declined_reason: declinedReasonOf(row),
        created_at: isoTimestamp(row.created_at),
        _created_ms: millisOf(row.created_at) ?? 0,
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order || a._created_ms - b._created_ms)
    .map(({ _created_ms: _ignored, ...rest }) => rest);

  return {
    ok: true,
    awaiting_counter_signature: awaitingCounterSignature(rows, requestStatus),
    counter_signature_state: counterSignatureState(rows),
    rows: out,
  };
});

export const adminEsignSignerOptions = onCall(async (request) => {
  await requireStaff(request, "requests.manage");
  const snap = await getFirestore()
    .collection(COLLECTIONS.profiles)
    .where(FIELDS.profiles.role, "==", "staff")
    .where(FIELDS.profiles.approvalStatus, "==", "approved")
    .limit(SCAN_CAP + 1)
    .get();
  assertWithinCap(snap.size);

  const rows = snap.docs
    .map((doc) => ({ id: doc.id, row: dataOf(doc) }))
    .filter(({ row }) => !row[FIELDS.profiles.archivedAt])
    .map(({ id, row }) => ({
      id,
      full_name: textOf(row.full_name),
      email: textOf(row.email),
      phone: textOf(row.phone),
    }))
    .sort((a, b) => {
      if (a.full_name === b.full_name) return 0;
      if (a.full_name === null) return 1;
      if (b.full_name === null) return -1;
      return a.full_name.localeCompare(b.full_name);
    });

  return { ok: true, rows };
});

export const adminAddEsignSigner = onCall(async (request) => {
  await requireStaff(request, "requests.manage");
  const data = (request.data ?? {}) as Dict;
  const requestId = pickId(data, "requestId", "p_request_id");
  const staffUserId = pickId(data, "staffUserId", "p_staff_user_id");
  const role = (pickText(data, "role", "p_role") ?? "countersigner").toLowerCase();
  const displayName = pickText(data, "displayName", "p_display_name");

  if (!SIGNER_ROLES.has(role)) return { ok: false, error: "invalid_role" };
  if (!requestId) return { ok: false, error: "not_found" };
  if (!staffUserId) return { ok: false, error: "unknown_signer" };

  const db = getFirestore();
  const requestRef = db.collection(COLLECTIONS.esignRequests).doc(requestId);
  const profileRef = db.collection(COLLECTIONS.profiles).doc(staffUserId);
  const signerRef = db
    .collection(COLLECTIONS.esignRequestSigners)
    .doc(staffSignerDocId(requestId, staffUserId, role));

  return db.runTransaction(async (tx) => {
    const [requestSnap, profileSnap, existingSnap, signerSnap] = await Promise.all([
      tx.get(requestRef),
      tx.get(profileRef),
      tx.get(signerRef),
      tx.get(signersForRequestQuery(requestId)),
    ]);
    if (!requestSnap.exists) return { ok: false, error: "not_found" };
    const requestStatus = dataOf(requestSnap).status;
    if (requestStatus === "cancelled" || requestStatus === "declined") {
      return { ok: false, error: "closed" };
    }
    if (!profileSnap.exists) return { ok: false, error: "unknown_signer" };
    const profile = dataOf(profileSnap);
    if (profile[FIELDS.profiles.role] !== "staff") return { ok: false, error: "not_staff" };

    assertWithinCap(signerSnap.size);
    const rows = signerSnap.docs.map(dataOf);
    const duplicate =
      existingSnap.exists ||
      rows.some((row) => row.staff_user_id === staffUserId && row.role === role);
    if (duplicate) return { ok: false, error: "already_added" };

    const sortOrder = nextSignerOrder(rows);
    const now = Timestamp.now();
    tx.create(signerRef, {
      request_id: requestId,
      driver_id: null,
      staff_user_id: staffUserId,
      role,
      sort_order: sortOrder,
      status: "pending",
      signer_display_name: displayName ?? textOf(profile.full_name),
      signer_meta: {},
      viewed_at: null,
      signed_at: null,
      declined_at: null,
      signature_storage_key: null,
      created_at: now,
      updated_at: now,
    });
    return { ok: true, id: signerRef.id, sort_order: sortOrder };
  });
});

export const adminRemoveEsignSigner = onCall(async (request) => {
  await requireStaff(request, "requests.manage");
  const data = (request.data ?? {}) as Dict;
  const signerId = pickId(data, "signerId", "p_signer_id");
  if (!signerId) return { ok: false, error: "not_found" };

  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.esignRequestSigners).doc(signerId);
  return db.runTransaction(async (tx) => {
    const snap: DocumentSnapshot = await tx.get(ref);
    if (!snap.exists) return { ok: false, error: "not_found" };
    const row = dataOf(snap);
    if (!isStaffRow(row)) return { ok: false, error: "not_a_staff_signer" };
    if (row.status === "signed") return { ok: false, error: "already_signed" };
    tx.delete(ref);
    return { ok: true };
  });
});

export const adminReorderEsignSigners = onCall(async (request) => {
  await requireStaff(request, "requests.manage");
  const data = (request.data ?? {}) as Dict;
  const requestId = pickId(data, "requestId", "p_request_id");
  const signerIds = pickIdList(data, "signerIds", "p_signer_ids");
  if (!signerIds || signerIds.length === 0) return { ok: false, error: "no_ids" };
  if (!requestId) return { ok: true, count: signerIds.length };

  const db = getFirestore();
  return db.runTransaction(async (tx) => {
    const signerSnap = await tx.get(signersForRequestQuery(requestId));
    assertWithinCap(signerSnap.size);

    const staffDocs = signerSnap.docs.filter((doc) => isStaffRow(dataOf(doc)));
    const next = new Map<string, number>();
    for (const doc of staffDocs) {
      next.set(doc.id, -(sortOrderOf(dataOf(doc)) + REORDER_SHIFT));
    }
    signerIds.forEach((id, index) => {
      if (next.has(id)) next.set(id, FIRST_STAFF_SLOT + index);
    });

    const now = Timestamp.now();
    for (const doc of staffDocs) {
      tx.update(doc.ref, { sort_order: next.get(doc.id), updated_at: now });
    }
    return { ok: true, count: signerIds.length };
  });
});

// ---------------------------------------------------------------------------
// The staff member's own inbox, and signing
// ---------------------------------------------------------------------------

export const adminListMyEsignSignatures = onCall(async (request) => {
  const staff = await requireStaff(request);
  const data = (request.data ?? {}) as Dict;
  const readyOnly = pickTriBool(data, "readyOnly", "p_ready_only") ?? true;

  const signerSnap = await getFirestore()
    .collection(COLLECTIONS.esignRequestSigners)
    .where("staff_user_id", "==", staff.uid)
    .limit(SCAN_CAP + 1)
    .get();
  assertWithinCap(signerSnap.size);

  const signers = signerSnap.docs.map((doc) => ({ id: doc.id, row: dataOf(doc) }));
  const requestIds = signers
    .map(({ row }) => textOf(row.request_id))
    .filter((id): id is string => !!id);
  const requests = await loadDocMap(COLLECTIONS.esignRequests, requestIds);

  const driverIds: string[] = [];
  const categoryKeys: string[] = [];
  for (const row of requests.values()) {
    const driverId = textOf(row.driver_id);
    if (driverId) driverIds.push(driverId);
    const key = textOf(row.category_key);
    if (key) categoryKeys.push(key);
  }
  const [drivers, profiles, categories] = await Promise.all([
    loadDocMap(COLLECTIONS.drivers, driverIds),
    loadDocMap(COLLECTIONS.profiles, driverIds),
    loadCategoriesByKey(categoryKeys),
  ]);

  const rows = signers
    .flatMap(({ id, row }) => {
      const requestId = textOf(row.request_id);
      const esign = requestId ? requests.get(requestId) : undefined;
      if (!requestId || !esign) return [];
      const driverId = textOf(esign.driver_id);
      const categoryKey = textOf(esign.category_key);
      const category = categoryKey ? categories.get(categoryKey) : undefined;
      const driver = driverId ? drivers.get(driverId) : undefined;
      const driverProfile = driverId ? profiles.get(driverId) : undefined;
      const categoryRestricted = category?.screenshot_restricted;
      return [
        {
          signer_id: id,
          request_id: requestId,
          role: textOf(row.role),
          signer_status: textOf(row.status),
          assigned_at: isoTimestamp(row.created_at),
          request_code: textOf(esign.request_code),
          title: textOf(esign.title),
          request_status: textOf(esign.status),
          created_at: isoTimestamp(esign.created_at),
          signed_at: isoTimestamp(esign.signed_at),
          due_at: isoTimestamp(esign.due_at),
          category_key: categoryKey,
          category_label: category ? textOf(category.label_en) : null,
          driver_id: driverId,
          driver_name: driverProfile ? textOf(driverProfile.full_name) : null,
          driver_code: driver ? textOf(driver[FIELDS.drivers.driverCode]) : null,
          screenshot_restricted:
            typeof categoryRestricted === "boolean"
              ? categoryRestricted
              : typeof esign.screenshot_restricted === "boolean"
                ? esign.screenshot_restricted
                : null,
          ready: esign.status === "signed",
          declined_reason: declinedReasonOf(row),
          _signed_ms: millisOf(esign.signed_at),
          _created_ms: millisOf(esign.created_at) ?? 0,
        },
      ];
    })
    .filter((row) => !readyOnly || row.ready)
    .sort((a, b) => {
      if (a._signed_ms !== b._signed_ms) {
        if (a._signed_ms === null) return -1;
        if (b._signed_ms === null) return 1;
        return a._signed_ms - b._signed_ms;
      }
      return b._created_ms - a._created_ms;
    })
    .map(({ _signed_ms: _s, _created_ms: _c, ...rest }) => rest);

  return { ok: true, rows };
});

export const adminSubmitEsignSignature = onCall(async (request) => {
  const staff = await requireStaff(request);
  const data = (request.data ?? {}) as Dict;
  const requestId = pickId(data, "requestId", "p_request_id");
  const storageKey = pickText(data, "signatureStorageKey", "p_signature_storage_key");
  const signerMeta = pickObject(data, "signerMeta", "p_signer_meta");

  if (!storageKey) return { ok: false, error: "signature_required" };
  if (!requestId) return { ok: false, error: "not_assigned" };

  const db = getFirestore();
  const requestRef = db.collection(COLLECTIONS.esignRequests).doc(requestId);
  const result = await db.runTransaction(async (tx) => {
    const [signerSnap, requestSnap] = await Promise.all([
      tx.get(signersForRequestQuery(requestId)),
      tx.get(requestRef),
    ]);
    assertWithinCap(signerSnap.size);
    const target = firstPendingOwnRow(signerSnap.docs, staff.uid);
    if (!target) return { ok: false as const, error: "not_assigned" };
    if (!requestSnap.exists || dataOf(requestSnap).status !== "signed") {
      return { ok: false as const, error: "not_ready" };
    }

    const current = dataOf(target);
    const now = Timestamp.now();
    tx.update(target.ref, {
      status: "signed",
      signed_at: now,
      signature_storage_key: storageKey,
      signer_meta: signerMeta ?? current.signer_meta ?? {},
      updated_at: now,
    });

    const after = signerSnap.docs.map((doc) =>
      doc.id === target.id ? { ...dataOf(doc), status: "signed" } : dataOf(doc),
    );
    return {
      ok: true as const,
      signerId: target.id,
      role: textOf(current.role),
      state: counterSignatureState(after),
    };
  });

  if (!result.ok) return result;

  await logAdminActivity({
    actorId: staff.uid,
    action: "update",
    entity: "esign_request_signers",
    entityId: result.signerId,
    detail: {
      route_name: "esign.sign",
      request_id: requestId,
      signer_role: result.role,
      counter_signature_state: result.state,
    },
  });

  return { ok: true, counter_signature_state: result.state };
});

export const adminDeclineEsignSignature = onCall(async (request) => {
  const staff = await requireStaff(request);
  const data = (request.data ?? {}) as Dict;
  const requestId = pickId(data, "requestId", "p_request_id");
  const reason = pickText(data, "reason", "p_reason");
  if (!requestId) return { ok: false, error: "not_assigned" };

  const db = getFirestore();
  const result = await db.runTransaction(async (tx) => {
    const signerSnap = await tx.get(signersForRequestQuery(requestId));
    assertWithinCap(signerSnap.size);
    const target = firstPendingOwnRow(signerSnap.docs, staff.uid);
    if (!target) return { ok: false as const, error: "not_assigned" };

    const current = dataOf(target);
    const existingMeta =
      typeof current.signer_meta === "object" &&
      current.signer_meta !== null &&
      !Array.isArray(current.signer_meta)
        ? (current.signer_meta as Dict)
        : {};
    const now = Timestamp.now();
    tx.update(target.ref, {
      status: "declined",
      declined_at: now,
      signer_meta: { ...existingMeta, declined_reason: reason },
      updated_at: now,
    });

    const after = signerSnap.docs.map((doc) =>
      doc.id === target.id ? { ...dataOf(doc), status: "declined" } : dataOf(doc),
    );
    return {
      ok: true as const,
      signerId: target.id,
      role: textOf(current.role),
      state: counterSignatureState(after),
    };
  });

  if (!result.ok) return result;

  await logAdminActivity({
    actorId: staff.uid,
    action: "update",
    entity: "esign_request_signers",
    entityId: result.signerId,
    detail: {
      route_name: "esign.decline_sign",
      request_id: requestId,
      signer_role: result.role,
      counter_signature_state: result.state,
    },
  });

  return { ok: true, counter_signature_state: result.state };
});
