/**
 * Driver intake lifecycle and payroll OFF structure, ported from the SQL RPCs:
 * `admin_approve_driver`, `allocate_driver_code`, `archive_driver_intake`,
 * `restore_driver_intake`, `regenerate_driver_app_passcode`,
 * `intake_has_ops_assignment`, `admin_set_driver_off_structure` and
 * `admin_bulk_set_driver_off_structure`.
 *
 * The partial unique indexes on `employee_id` / `civil_id` / `phone` (scoped to
 * live rows) and on `app_passcode` become `uniq_*` lock docs. A lock belongs to
 * an intake and its linked driver, so archiving releases it and restoring takes
 * it back — the same window the `WHERE archived_at IS NULL` index covered.
 */
import { randomInt } from "crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  getFirestore,
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QuerySnapshot,
  type Transaction,
  type WriteBatch,
} from "../core/fs";
import { getAuth } from "firebase-admin/auth";
import { COLLECTIONS, UNIQUE_LOCKS } from "../core/collections";
import { daysInMonth, parseMonthKey, payrollMonths } from "../core/kuwait";
import { requireStaff, type StaffContext } from "../core/staff";
import {
  BATCH_LIMIT,
  SCAN_CAP,
  chunk,
  dataOf,
  loadDocMap,
  numberOrNull,
  pick,
  pickId,
  pickText,
  textOrNull,
  type Dict,
} from "./_shared";

const DRIVER_CODE_COUNTER = "driver_code_seq";
const DRIVER_CODE_FLOOR = 10000;
const DRIVER_CODE_MAX = 99999;
const PASSCODE_ATTEMPTS = 50;
const DEFAULT_OFF_DAYS = 2;
const BULK_ROW_LIMIT = 2000;
const DRIVER_SCAN_CAP = SCAN_CAP * 5;
const OFF_DAYS_RE = /^\s*[0-9]+\s*$/;
const MONTH_RE = /^(\d{4})-(\d{2})/;

const PAYROLL_WRITE_SLUGS = ["payroll.manage", "payroll.create", "payroll.edit", "payroll.delete"];
const DRIVER_WRITE_SLUGS = ["drivers.manage", "drivers.create", "drivers.edit"];

type LockField = "employeeId" | "civilId" | "phone";

const LOCK_ERRORS: Record<LockField, string> = {
  employeeId: "employee_id_exists",
  civilId: "civil_id_exists",
  phone: "phone_exists",
};

const LOCK_SOURCE: Record<LockField, string> = {
  employeeId: "employee_id",
  civilId: "civil_id",
  phone: "phone",
};

/** One read surface over a transaction or plain reads, so a pre-check and the transaction share the rules. */
type Reader = {
  get(ref: DocumentReference): Promise<DocumentSnapshot>;
  getAll(refs: DocumentReference[]): Promise<DocumentSnapshot[]>;
  query(query: Query): Promise<QuerySnapshot>;
};

function directReader(db: Firestore): Reader {
  return {
    get: (ref) => ref.get(),
    getAll: (refs) => (refs.length === 0 ? Promise.resolve([]) : db.getAll(...refs)),
    query: (query) => query.get(),
  };
}

function txReader(tx: Transaction): Reader {
  return {
    get: (ref) => tx.get(ref),
    getAll: (refs) => (refs.length === 0 ? Promise.resolve([]) : tx.getAll(...refs)),
    query: (query) => tx.get(query),
  };
}

function lockRef(db: Firestore, field: LockField, value: string): DocumentReference {
  return db.collection(UNIQUE_LOCKS[field]).doc(encodeURIComponent(value.trim()));
}

function passcodeLockRef(db: Firestore, code: string): DocumentReference {
  return db.collection(UNIQUE_LOCKS.passcode).doc(code);
}

/** A lock is ours when no one holds it, or the holder is this intake or its driver. */
function lockIsOurs(snap: DocumentSnapshot, owners: ReadonlySet<string>): boolean {
  if (!snap.exists) return true;
  const data = dataOf(snap);
  return ["owner_id", "intake_id", "driver_id"].some((key) => {
    const value = textOrNull(data[key]);
    return value !== null && owners.has(value);
  });
}

function lockValues(intake: Dict): Array<{ field: LockField; value: string }> {
  const out: Array<{ field: LockField; value: string }> = [];
  for (const field of Object.keys(LOCK_SOURCE) as LockField[]) {
    const value = textOrNull(intake[LOCK_SOURCE[field]]);
    if (value) out.push({ field, value });
  }
  return out;
}

function randomPasscode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** `generate_driver_app_passcode` — a free 6-digit code, checked against the passcode lock. */
async function pickFreePasscode(db: Firestore, reader: Reader): Promise<string> {
  for (let attempt = 0; attempt < PASSCODE_ATTEMPTS; attempt += 1) {
    const code = randomPasscode();
    const snap = await reader.get(passcodeLockRef(db, code));
    if (!snap.exists) return code;
  }
  throw new HttpsError("resource-exhausted", "driver_passcode_collision_retry_exceeded");
}

/** `intake_has_ops_assignment` — a zone, or at least one active restaurant mapping. */
async function intakeOpsAssignment(
  db: Firestore,
  reader: Reader,
  intakeId: string,
  intake: Dict,
): Promise<{ assigned: boolean; restaurantIds: string[] }> {
  const edges = await reader.query(
    db.collection(COLLECTIONS.driverRestaurants).where("intake_id", "==", intakeId),
  );
  const restaurantIds = [
    ...new Set(
      edges.docs
        .map((doc) => textOrNull(dataOf(doc)["restaurant_id"]))
        .filter((id): id is string => id !== null),
    ),
  ];
  if (textOrNull(intake["zone_id"]) !== null) return { assigned: true, restaurantIds };
  const restaurants = await reader.getAll(
    restaurantIds.map((id) => db.collection(COLLECTIONS.restaurants).doc(id)),
  );
  const assigned = restaurants.some((snap) => snap.exists && dataOf(snap)["is_active"] === true);
  return { assigned, restaurantIds };
}

type IntakeCheck =
  | { ok: false; error: string }
  | { ok: true; intake: Dict; restaurantIds: string[] };

/** The intake-only half of `admin_approve_driver`'s validation. */
async function checkIntakeForApproval(
  db: Firestore,
  reader: Reader,
  intakeId: string,
): Promise<IntakeCheck> {
  const snap = await reader.get(db.collection(COLLECTIONS.driverIntakes).doc(intakeId));
  if (!snap.exists) return { ok: false, error: "intake_not_found" };
  const intake = dataOf(snap);
  if (intake["archived_at"] != null) return { ok: false, error: "intake_archived" };
  if (intake["linked"] === true || textOrNull(intake["linked_profile_id"]) !== null) {
    return { ok: false, error: "intake_already_linked" };
  }
  if (!textOrNull(intake["full_name"]) || !textOrNull(intake["employee_id"])) {
    return { ok: false, error: "missing_fields" };
  }
  const assignment = await intakeOpsAssignment(db, reader, intakeId, intake);
  if (!assignment.assigned) return { ok: false, error: "driver_missing_assignment" };
  return { ok: true, intake, restaurantIds: assignment.restaurantIds };
}

/** The auth user for an approval: the one the caller named, the one holding the email, or a new one. */
async function resolveAuthUser(
  userId: string | null,
  email: string,
  displayName: string | null,
): Promise<{ uid: string; created: boolean }> {
  if (userId) return { uid: userId, created: false };
  const auth = getAuth();
  try {
    const user = await auth.createUser({
      email,
      ...(displayName ? { displayName } : {}),
    });
    return { uid: user.uid, created: true };
  } catch (error) {
    if ((error as { code?: string }).code === "auth/email-already-exists") {
      const existing = await auth.getUserByEmail(email);
      return { uid: existing.uid, created: false };
    }
    throw error;
  }
}

/**
 * `admin_approve_driver` — the Firebase Auth user stands in for `auth.users`.
 *
 * Intake-level failures are checked before any auth user is created, and a
 * user this call created is deleted again if the transaction refuses, so a
 * failed approval never leaves an orphan login behind.
 */
export const adminApproveDriver = onCall(async (request) => {
  await requireStaff(request);

  const data = (request.data ?? {}) as Dict;
  const intakeId = pickId(data, "intakeId", "p_intake_id");
  const requestedUserId = pickId(data, "userId", "p_user_id");
  const emailRaw = pickText(data, "email", "p_email");
  if (!intakeId || !emailRaw) return { ok: false, error: "missing_fields" };
  const email = emailRaw.toLowerCase();

  const db = getFirestore();
  const precheck = await checkIntakeForApproval(db, directReader(db), intakeId);
  if (!precheck.ok) return { ok: false, error: precheck.error };

  const { uid, created } = await resolveAuthUser(
    requestedUserId,
    email,
    textOrNull(precheck.intake["full_name"]),
  );

  let result: Dict;
  try {
    result = await db.runTransaction(async (tx) => approveInTransaction(db, tx, intakeId, uid, email));
  } catch (error) {
    if (created) await getAuth().deleteUser(uid).catch(() => undefined);
    throw error;
  }
  if (result.ok !== true && created) {
    await getAuth().deleteUser(uid).catch(() => undefined);
  }
  return result;
});

async function approveInTransaction(
  db: Firestore,
  tx: Transaction,
  intakeId: string,
  uid: string,
  email: string,
): Promise<Dict> {
  const reader = txReader(tx);
  const check = await checkIntakeForApproval(db, reader, intakeId);
  if (!check.ok) return { ok: false, error: check.error };
  const { intake, restaurantIds } = check;

  const phone = textOrNull(intake["phone"]);
  const civilId = textOrNull(intake["civil_id"]);
  const employeeId = textOrNull(intake["employee_id"]) as string;

  if (phone) {
    const clash = await reader.query(
      db.collection(COLLECTIONS.profiles).where("phone", "==", phone).limit(5),
    );
    if (clash.docs.some((doc) => doc.id !== uid)) return { ok: false, error: "phone_exists" };
  }
  if (civilId) {
    const clash = await reader.query(
      db.collection(COLLECTIONS.drivers).where("civil_id", "==", civilId).limit(5),
    );
    if (clash.docs.some((doc) => doc.id !== uid)) return { ok: false, error: "civil_id_exists" };
  }

  const driverRef = db.collection(COLLECTIONS.drivers).doc(uid);
  const driverSnap = await reader.get(driverRef);
  if (driverSnap.exists) return { ok: false, error: "intake_already_linked" };

  const employeeClash = await reader.query(
    db.collection(COLLECTIONS.drivers).where("employee_id", "==", employeeId).limit(10),
  );
  if (employeeClash.docs.some((doc) => doc.id !== uid && dataOf(doc)["archived_at"] == null)) {
    return { ok: false, error: "employee_id_exists" };
  }

  const owners = new Set([intakeId, uid]);
  const locks = lockValues(intake);
  const lockSnaps = await reader.getAll(locks.map((lock) => lockRef(db, lock.field, lock.value)));
  for (let index = 0; index < locks.length; index += 1) {
    if (!lockIsOurs(lockSnaps[index], owners)) {
      return { ok: false, error: LOCK_ERRORS[locks[index].field] };
    }
  }

  const profileRef = db.collection(COLLECTIONS.profiles).doc(uid);
  const profileSnap = await reader.get(profileRef);

  const [assetSnap, trackingSnap, documentSnap] = await Promise.all([
    reader.query(db.collection(COLLECTIONS.assetAssignments).where("intake_id", "==", intakeId)),
    reader.query(db.collection(COLLECTIONS.documentTracking).where("intake_id", "==", intakeId)),
    reader.query(db.collection(COLLECTIONS.driverDocuments).where("driver_id", "==", uid)),
  ]);

  const passcode = await pickFreePasscode(db, reader);

  const now = Timestamp.now();
  const avatar = textOrNull(intake["avatar_url"]);
  const fullName = textOrNull(intake["full_name"]) as string;
  const driverCode = textOrNull(intake["driver_code"]);

  const profile = profileSnap.exists ? dataOf(profileSnap) : {};
  tx.set(
    profileRef,
    {
      id: uid,
      email,
      full_name: fullName,
      phone,
      role: "rider",
      approval_status: "approved",
      avatar_url: avatar ?? textOrNull(profile["avatar_url"]),
      updated_at: now,
      ...(profileSnap.exists ? {} : { locale: "en", created_at: now }),
    },
    { merge: true },
  );

  tx.create(driverRef, {
    id: uid,
    name: fullName,
    full_name: fullName,
    driver_code: driverCode,
    partner_id: intake["partner_id"] ?? null,
    zone_id: intake["zone_id"] ?? null,
    zone_name: intake["zone_name"] ?? null,
    vehicle_id: intake["vehicle_id"] ?? null,
    civil_id: civilId,
    employee_id: employeeId,
    nationality: intake["nationality"] ?? null,
    rider_category: intake["rider_category"] ?? null,
    client_id: intake["client_id"] ?? null,
    client_name: intake["client_name"] ?? null,
    project_key: intake["project_key"] ?? null,
    accommodation: intake["accommodation"] ?? null,
    source_company: intake["source_company"] ?? null,
    custom_fields: intake["custom_fields"] ?? {},
    restaurant_ids: restaurantIds,
    intake_id: intakeId,
    status: "active",
    is_on_duty: false,
    app_passcode: passcode,
    avatar_object_key: avatar,
    avatar_updated_at: avatar ? now : null,
    archived_at: null,
    created_at: now,
    updated_at: now,
  });

  tx.set(passcodeLockRef(db, passcode), { owner_id: uid, driver_id: uid, created_at: now });

  for (const lock of locks) {
    tx.set(
      lockRef(db, lock.field, lock.value),
      { owner_id: intakeId, intake_id: intakeId, driver_id: uid, value: lock.value, updated_at: now },
      { merge: true },
    );
  }

  for (const restaurantId of restaurantIds) {
    tx.set(
      db.collection(COLLECTIONS.driverRestaurants).doc(`${uid}_${restaurantId}`),
      { driver_id: uid, restaurant_id: restaurantId, created_at: now },
      { merge: true },
    );
  }

  for (const doc of assetSnap.docs) {
    if (dataOf(doc)["status"] !== "assigned") continue;
    tx.update(doc.ref, { driver_id: uid, updated_at: now });
  }

  const expiryByDocType = new Map<string, unknown>();
  for (const doc of trackingSnap.docs) {
    tx.update(doc.ref, { driver_id: uid, updated_at: now });
    const row = dataOf(doc);
    const docType = textOrNull(row["doc_type"]);
    if (docType && row["track_expiry"] === true && row["expires_at"] != null) {
      expiryByDocType.set(docType, row["expires_at"]);
    }
  }
  for (const doc of documentSnap.docs) {
    const docType = textOrNull(dataOf(doc)["doc_type"]);
    if (!docType || !expiryByDocType.has(docType)) continue;
    tx.update(doc.ref, { expires_at: expiryByDocType.get(docType), updated_at: now });
  }

  tx.update(db.collection(COLLECTIONS.driverIntakes).doc(intakeId), {
    linked: true,
    linked_profile_id: uid,
    workflow_status: "approved",
    status: "linked",
    updated_at: now,
  });

  return { ok: true, driver_id: uid, driver_code: driverCode, app_passcode: passcode };
}

/** `allocate_driver_code` — the next 5-digit code from the `driver_code_seq` counter. */
export const allocateDriverCode = onCall(async (request) => {
  await requireStaff(request);

  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.counters).doc(DRIVER_CODE_COUNTER);
  const next = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current =
      numberOrNull(snap.get("value")) ?? numberOrNull(snap.get("last_value")) ?? DRIVER_CODE_FLOOR;
    const value = Math.trunc(current) + 1;
    if (value > DRIVER_CODE_MAX) {
      throw new HttpsError("out-of-range", "driver_code_capacity_exceeded");
    }
    tx.set(ref, { value, updated_at: Timestamp.now() }, { merge: true });
    return value;
  });

  return String(next).padStart(5, "0");
});

/** `_end_driver_duty_keep_gps(driver, 'admin')` plus the device revoke of `_end_driver_app_session`. */
async function endDriverAppSession(db: Firestore, driverId: string): Promise<void> {
  const now = Timestamp.now();
  const [sessions, openLogs, devices] = await Promise.all([
    db
      .collection(COLLECTIONS.driverSessions)
      .where("driver_id", "==", driverId)
      .where("is_online", "==", true)
      .get(),
    db
      .collection(COLLECTIONS.attendanceLogs)
      .where("driver_id", "==", driverId)
      .where("check_out_at", "==", null)
      .get(),
    db
      .collection(COLLECTIONS.driverDeviceSessions)
      .where("driver_id", "==", driverId)
      .where("revoked_at", "==", null)
      .get(),
  ]);

  const writes: Array<(batch: WriteBatch) => void> = [];
  writes.push((batch) =>
    batch.set(
      db.collection(COLLECTIONS.drivers).doc(driverId),
      { is_on_duty: false, active_device_id: null, active_device_session_id: null, updated_at: now },
      { merge: true },
    ),
  );
  for (const doc of sessions.docs) {
    writes.push((batch) =>
      batch.set(
        doc.ref,
        { is_online: false, went_offline_at: doc.get("went_offline_at") ?? now, updated_at: now },
        { merge: true },
      ),
    );
  }
  for (const doc of openLogs.docs) {
    writes.push((batch) =>
      batch.set(doc.ref, { check_out_at: now, check_out_reason: "admin", updated_at: now }, { merge: true }),
    );
  }
  for (const doc of devices.docs) {
    writes.push((batch) =>
      batch.set(
        doc.ref,
        {
          revoked_at: doc.get("revoked_at") ?? now,
          revoked_reason: doc.get("revoked_reason") ?? "archived",
          updated_at: now,
        },
        { merge: true },
      ),
    );
  }

  for (const group of chunk(writes, BATCH_LIMIT)) {
    const batch = db.batch();
    for (const write of group) write(batch);
    await batch.commit();
  }
}

/**
 * `archive_driver_intake` — stamps the intake and the linked driver, then ends
 * the live app session the way the `drivers_end_session_on_archive` trigger did.
 */
export const archiveDriverIntake = onCall(async (request) => {
  await requireStaff(request);

  const data = (request.data ?? {}) as Dict;
  const intakeId = pickId(data, "intakeId", "p_intake_id");
  if (!intakeId) return { ok: false, error: "intake_not_found" };

  const db = getFirestore();
  const outcome = await db.runTransaction(async (tx) => {
    const intakeRef = db.collection(COLLECTIONS.driverIntakes).doc(intakeId);
    const intakeSnap = await tx.get(intakeRef);
    if (!intakeSnap.exists) return { found: false as const };
    const intake = dataOf(intakeSnap);
    const linked = textOrNull(intake["linked_profile_id"]);

    const driverRef = linked ? db.collection(COLLECTIONS.drivers).doc(linked) : null;
    const driverSnap = driverRef ? await tx.get(driverRef) : null;

    const owners = new Set([intakeId, ...(linked ? [linked] : [])]);
    const locks = lockValues(intake);
    const lockSnaps = locks.length
      ? await tx.getAll(...locks.map((lock) => lockRef(db, lock.field, lock.value)))
      : [];

    const now = Timestamp.now();
    tx.update(intakeRef, { archived_at: now, status: "cancelled", updated_at: now });

    let driverArchived = false;
    if (driverRef && driverSnap?.exists && dataOf(driverSnap)["archived_at"] == null) {
      tx.update(driverRef, { archived_at: now, updated_at: now });
      driverArchived = true;
    }

    lockSnaps.forEach((snap) => {
      if (snap.exists && lockIsOurs(snap, owners)) tx.delete(snap.ref);
    });

    return { found: true as const, linked: driverArchived ? linked : null };
  });

  if (!outcome.found) return { ok: false, error: "intake_not_found" };
  if (outcome.linked) await endDriverAppSession(db, outcome.linked);
  return { ok: true };
});

/** `restore_driver_intake` — clears `archived_at` and takes the identity locks back. */
export const restoreDriverIntake = onCall(async (request) => {
  await requireStaff(request);

  const data = (request.data ?? {}) as Dict;
  const intakeId = pickId(data, "intakeId", "p_intake_id");
  if (!intakeId) return { ok: false, error: "intake_not_found" };

  const db = getFirestore();
  return db.runTransaction(async (tx) => {
    const intakeRef = db.collection(COLLECTIONS.driverIntakes).doc(intakeId);
    const intakeSnap = await tx.get(intakeRef);
    if (!intakeSnap.exists) return { ok: false, error: "intake_not_found" };
    const intake = dataOf(intakeSnap);
    if (intake["archived_at"] == null) return { ok: false, error: "intake_not_archived" };

    const linked = textOrNull(intake["linked_profile_id"]);
    const isLinked = intake["linked"] === true || linked !== null;
    const owners = new Set([intakeId, ...(linked ? [linked] : [])]);
    const locks = lockValues(intake);
    const lockSnaps = locks.length
      ? await tx.getAll(...locks.map((lock) => lockRef(db, lock.field, lock.value)))
      : [];
    for (let index = 0; index < locks.length; index += 1) {
      if (!lockIsOurs(lockSnaps[index], owners)) {
        throw new HttpsError("already-exists", LOCK_ERRORS[locks[index].field]);
      }
    }

    const now = Timestamp.now();
    tx.update(intakeRef, {
      archived_at: null,
      status: isLinked ? "linked" : "awaiting_app_link",
      updated_at: now,
    });
    if (linked) {
      tx.set(
        db.collection(COLLECTIONS.drivers).doc(linked),
        { archived_at: null, updated_at: now },
        { merge: true },
      );
    }
    for (const lock of locks) {
      tx.set(
        lockRef(db, lock.field, lock.value),
        {
          owner_id: intakeId,
          intake_id: intakeId,
          driver_id: linked,
          value: lock.value,
          updated_at: now,
        },
        { merge: true },
      );
    }
    return { ok: true };
  });
});

/** `regenerate_driver_app_passcode` — mints a fresh code and releases the old lock. */
export const regenerateDriverAppPasscode = onCall(async (request) => {
  await requireStaff(request);

  const data = (request.data ?? {}) as Dict;
  const driverId = pickId(data, "driverId", "p_driver_id");
  if (!driverId) return { ok: false, error: "driver_not_found" };

  const db = getFirestore();
  return db.runTransaction(async (tx) => {
    const reader = txReader(tx);
    const driverRef = db.collection(COLLECTIONS.drivers).doc(driverId);
    const driverSnap = await tx.get(driverRef);
    if (!driverSnap.exists) return { ok: false, error: "driver_not_found" };

    const previous = textOrNull(dataOf(driverSnap)["app_passcode"]);
    const previousLock = previous ? await tx.get(passcodeLockRef(db, previous)) : null;
    const code = await pickFreePasscode(db, reader);

    const now = Timestamp.now();
    if (previousLock?.exists && lockIsOurs(previousLock, new Set([driverId]))) {
      tx.delete(previousLock.ref);
    }
    tx.set(passcodeLockRef(db, code), { owner_id: driverId, driver_id: driverId, created_at: now });
    tx.update(driverRef, { app_passcode: code, updated_at: now });
    return { ok: true, passcode: code };
  });
});

/** `intake_has_ops_assignment` as a callable. */
export const intakeHasOpsAssignment = onCall(async (request) => {
  await requireStaff(request);

  const data = (request.data ?? {}) as Dict;
  const intakeId = pickId(data, "intakeId", "p_intake_id");
  if (!intakeId) return false;

  const db = getFirestore();
  const reader = directReader(db);
  const snap = await reader.get(db.collection(COLLECTIONS.driverIntakes).doc(intakeId));
  if (!snap.exists) return false;
  const { assigned } = await intakeOpsAssignment(db, reader, intakeId, dataOf(snap));
  return assigned;
});

function holdsAny(ctx: StaffContext, slugs: readonly string[]): boolean {
  return ctx.isManager || slugs.some((slug) => ctx.permissionSlugs.has(slug));
}

type OffMonth = { key: string; periodMonth: string; days: number };

/** `date_trunc('month', p_month)` bounded to the current Kuwait month and the two before it. */
function resolveOffMonth(data: Dict): OffMonth {
  const raw = pickText(data, "month", "p_month");
  const match = raw ? MONTH_RE.exec(raw) : null;
  if (!match) throw new HttpsError("invalid-argument", "invalid_month");
  const key = `${match[1]}-${match[2]}`;
  const { year, month } = parseMonthKey(key);
  if (!Number.isInteger(year) || month < 1 || month > 12) {
    throw new HttpsError("invalid-argument", "invalid_month");
  }
  const allowed = new Set(payrollMonths(new Date(), 3).map((entry) => entry.key));
  if (!allowed.has(key)) throw new HttpsError("out-of-range", "month_out_of_range");
  return { key, periodMonth: `${key}-01`, days: daysInMonth(year, month) };
}

function offStructureDocId(driverId: string, periodMonth: string): string {
  return `${driverId}_${periodMonth}`;
}

function driverDisplayName(driver: Dict, profile: Dict | undefined): string | null {
  return textOrNull(profile?.["full_name"]) ?? textOrNull(driver["driver_code"]);
}

/**
 * `admin_set_driver_off_structure`.
 *
 * A null `off_days` clears the override and returns the rider to the 2-day
 * fallback. Payroll CRUD or a drivers write tick may call it, because the
 * Drivers import writes Number of OFFs through the same door.
 */
export const adminSetDriverOffStructure = onCall(async (request) => {
  const ctx = await requireStaff(request);
  if (!holdsAny(ctx, PAYROLL_WRITE_SLUGS) && !holdsAny(ctx, DRIVER_WRITE_SLUGS)) {
    throw new HttpsError("permission-denied", "not_authorized");
  }

  const data = (request.data ?? {}) as Dict;
  const month = resolveOffMonth(data);
  const driverId = pickId(data, "driverId", "p_driver_id");
  const rawOff = pick(data, "offDays", "p_off_days");

  const db = getFirestore();
  const [driverSnap, profileSnap] = driverId
    ? await Promise.all([
        db.collection(COLLECTIONS.drivers).doc(driverId).get(),
        db.collection(COLLECTIONS.profiles).doc(driverId).get(),
      ])
    : [null, null];
  const driver = driverSnap?.exists ? dataOf(driverSnap) : null;
  const name =
    driver && driver["archived_at"] == null
      ? driverDisplayName(driver, profileSnap?.exists ? dataOf(profileSnap) : undefined)
      : null;
  if (!driverId || !name) throw new HttpsError("not-found", "driver_not_found");

  const existing = await db
    .collection(COLLECTIONS.driverOffStructure)
    .where("driver_id", "==", driverId)
    .where("period_month", "==", month.periodMonth)
    .get();
  const previous = existing.empty ? null : numberOrNull(dataOf(existing.docs[0])["off_days"]);

  if (rawOff === undefined) {
    const batch = db.batch();
    for (const doc of existing.docs) batch.delete(doc.ref);
    if (!existing.empty) await batch.commit();
    return {
      ok: true,
      cleared: true,
      driver_id: driverId,
      driver_name: name,
      month: month.key,
      previous_off_days: previous,
    };
  }

  const offDays = numberOrNull(rawOff);
  if (offDays === null || offDays < 0) throw new HttpsError("invalid-argument", "invalid_off_days");
  const off = Math.trunc(offDays);
  if (off > month.days) throw new HttpsError("invalid-argument", "off_days_exceeds_month");

  const ref = existing.empty
    ? db.collection(COLLECTIONS.driverOffStructure).doc(offStructureDocId(driverId, month.periodMonth))
    : existing.docs[0].ref;
  const now = Timestamp.now();
  await ref.set(
    {
      driver_id: driverId,
      driver_name: name,
      period_month: month.periodMonth,
      month: month.key,
      off_days: off,
      source: "manual",
      updated_by: ctx.uid,
      updated_at: now,
    },
    { merge: true },
  );

  return {
    ok: true,
    cleared: false,
    driver_id: driverId,
    driver_name: name,
    month: month.key,
    off_days: off,
    previous_off_days: previous,
  };
});

type BulkVerdict =
  | "missing_id"
  | "duplicate"
  | "invalid_off_days"
  | "off_days_exceeds_month"
  | "unknown_id"
  | "ambiguous_id"
  | "no_change"
  | "applied";

function jsonText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function millisOf(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
  }
  return Number.MAX_SAFE_INTEGER;
}

/**
 * `admin_bulk_set_driver_off_structure`.
 *
 * Each row resolves against live drivers by employee ID or driver code. A
 * value equal to the current effective OFF count is `no_change`; an applied
 * value equal to the 2-day default deletes the override instead of storing it.
 */
export const adminBulkSetDriverOffStructure = onCall(async (request) => {
  const ctx = await requireStaff(request);
  if (!holdsAny(ctx, PAYROLL_WRITE_SLUGS)) {
    throw new HttpsError("permission-denied", "not_authorized");
  }

  const data = (request.data ?? {}) as Dict;
  const month = resolveOffMonth(data);
  const rows = pick(data, "rows", "p_rows");
  if (!Array.isArray(rows)) throw new HttpsError("invalid-argument", "invalid_rows");
  if (rows.length === 0) throw new HttpsError("invalid-argument", "no_rows");
  if (rows.length > BULK_ROW_LIMIT) throw new HttpsError("invalid-argument", "too_many_rows");

  const db = getFirestore();
  const driverSnap = await db
    .collection(COLLECTIONS.drivers)
    .select("employee_id", "driver_code", "archived_at", "created_at")
    .limit(DRIVER_SCAN_CAP + 1)
    .get();
  if (driverSnap.size > DRIVER_SCAN_CAP) throw new HttpsError("out-of-range", "too_many_drivers");

  const byKey = new Map<string, Map<string, number>>();
  const index = (key: string | null, id: string, createdAt: number) => {
    if (!key) return;
    const upper = key.trim().toUpperCase();
    const bucket = byKey.get(upper) ?? new Map<string, number>();
    bucket.set(id, createdAt);
    byKey.set(upper, bucket);
  };
  for (const doc of driverSnap.docs) {
    const row = dataOf(doc);
    if (row["archived_at"] != null) continue;
    const createdAt = millisOf(row["created_at"]);
    index(jsonText(row["employee_id"]), doc.id, createdAt);
    index(jsonText(row["driver_code"]), doc.id, createdAt);
  }

  const parsed = rows.map((entry, idx) => {
    const value = (typeof entry === "object" && entry !== null ? entry : {}) as Dict;
    const keySource = value["driver_key"] ?? value["employee_id"];
    const driverKey = (jsonText(keySource) ?? "").trim();
    const offRaw = jsonText(value["off_days"]);
    const offDays = offRaw !== null && OFF_DAYS_RE.test(offRaw) ? Number.parseInt(offRaw.trim(), 10) : null;
    const matches = driverKey ? byKey.get(driverKey.toUpperCase()) : undefined;
    const matchCount = matches?.size ?? 0;
    let driverId: string | null = null;
    if (matches && matches.size > 0) {
      driverId = [...matches.entries()].sort((a, b) => a[1] - b[1])[0][0];
    }
    return { idx, driverKey, offDays, matchCount, driverId };
  });

  const keyCounts = new Map<string, number>();
  for (const row of parsed) {
    if (row.driverKey === "") continue;
    const upper = row.driverKey.toUpperCase();
    keyCounts.set(upper, (keyCounts.get(upper) ?? 0) + 1);
  }

  const existingSnap = await db
    .collection(COLLECTIONS.driverOffStructure)
    .where("period_month", "==", month.periodMonth)
    .get();
  const existingByDriver = new Map<string, { ref: DocumentReference; offDays: number | null }>();
  for (const doc of existingSnap.docs) {
    const row = dataOf(doc);
    const driverId = textOrNull(row["driver_id"]);
    if (driverId) existingByDriver.set(driverId, { ref: doc.ref, offDays: numberOrNull(row["off_days"]) });
  }

  const verdictOf = (row: (typeof parsed)[number], previous: number | null): BulkVerdict => {
    if (row.driverKey === "") return "missing_id";
    if ((keyCounts.get(row.driverKey.toUpperCase()) ?? 0) > 1) return "duplicate";
    if (row.offDays === null || row.offDays < 0) return "invalid_off_days";
    if (row.offDays > month.days) return "off_days_exceeds_month";
    if (row.matchCount === 0) return "unknown_id";
    if (row.matchCount > 1) return "ambiguous_id";
    if (row.offDays === (previous ?? DEFAULT_OFF_DAYS)) return "no_change";
    return "applied";
  };

  const judged = parsed.map((row) => {
    const previous = row.driverId ? (existingByDriver.get(row.driverId)?.offDays ?? null) : null;
    return { ...row, previous, verdict: verdictOf(row, previous) };
  });

  const resolvedIds = judged
    .filter((row) => row.verdict === "applied" || row.verdict === "no_change")
    .map((row) => row.driverId as string);
  const [driverDocs, profileDocs] = await Promise.all([
    loadDocMap(COLLECTIONS.drivers, resolvedIds),
    loadDocMap(COLLECTIONS.profiles, resolvedIds),
  ]);

  const verdicts = judged.map((row) => {
    const resolved = row.verdict === "applied" || row.verdict === "no_change";
    const driverName =
      resolved && row.driverId
        ? driverDisplayName(driverDocs.get(row.driverId) ?? {}, profileDocs.get(row.driverId))
        : null;
    return {
      index: row.idx,
      driverKey: row.driverKey,
      offDays: row.offDays,
      previousOffDays: row.previous,
      verdict: row.verdict,
      driverId: resolved ? row.driverId : null,
      driverName,
    };
  });

  const now = Timestamp.now();
  let upserted = 0;
  let cleared = 0;
  const writes: Array<(batch: WriteBatch) => void> = [];
  for (const row of verdicts) {
    if (row.verdict !== "applied" || !row.driverId || row.offDays === null) continue;
    const driverId = row.driverId;
    const existing = existingByDriver.get(driverId);
    if (row.offDays === DEFAULT_OFF_DAYS) {
      if (existing) {
        writes.push((batch) => batch.delete(existing.ref));
        cleared += 1;
      }
      continue;
    }
    const ref =
      existing?.ref ??
      db.collection(COLLECTIONS.driverOffStructure).doc(offStructureDocId(driverId, month.periodMonth));
    const offDays = row.offDays;
    const driverName = row.driverName;
    writes.push((batch) =>
      batch.set(
        ref,
        {
          driver_id: driverId,
          driver_name: driverName,
          period_month: month.periodMonth,
          month: month.key,
          off_days: offDays,
          source: "bulk_upload",
          updated_by: ctx.uid,
          updated_at: now,
        },
        { merge: true },
      ),
    );
    upserted += 1;
  }

  for (const group of chunk(writes, BATCH_LIMIT)) {
    const batch = db.batch();
    for (const write of group) write(batch);
    await batch.commit();
  }

  const applied = upserted + cleared;
  return {
    ok: true,
    month: month.key,
    monthDays: month.days,
    applied,
    skipped: rows.length - applied,
    rows: verdicts,
  };
});
