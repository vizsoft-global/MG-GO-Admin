/**
 * Rider visit callables — ports of `driver_list_visit_slots` /
 * `driver_book_visit` (20261111000000) and `driver_cancel_visit`
 * (20260908150000). Availability is the full SQL helper, not the blocked-date
 * boolean in `visits-shared`.
 */
import { onCall, type CallableRequest } from "firebase-functions/v2/https";
import { FieldValue, Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import { requireRider, riderError, type RiderContext } from "../core/rider";
import {
  logDriverOperation,
  numberOrNull,
  pickDay,
  pickId,
  pickText,
  type Dict,
} from "./_shared";
import {
  VISIT_BOOKING_FIELDS,
  VISIT_DEPARTMENT_FIELDS,
  VISIT_SLOT_FIELDS,
  addDays,
  dayOfWeek,
  dayTextOf,
  isVisitHold,
  loadVisitBranch,
  loadVisitSlot,
  numberOf,
  parseDay,
  textOf,
  timeValueOf,
  visitBookingsForDriver,
  visitBookingsForSlot,
} from "./visits-shared";

export { riderError };

const VISIT_CODE_COUNTER = "visit_booking_code_seq";

export type VisitAvailabilityCode =
  | "branch_inactive"
  | "branch_closed"
  | "date_blocked"
  | "outside_booking_window";

function asData(request: CallableRequest<unknown>): Dict {
  return (request.data ?? {}) as Dict;
}

function fail(error: string, message?: string): { ok: false; error: string; message?: string } {
  return message ? { ok: false, error, message } : { ok: false, error };
}

function archived(ctx: RiderContext): boolean {
  return ctx.driver.archived_at != null;
}

export function normalizeClock(value: string): string {
  const parts = value.split(":");
  const hours = (parts[0] ?? "00").padStart(2, "0");
  const minutes = (parts[1] ?? "00").padStart(2, "0");
  const seconds = (parts[2] ?? "00").padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return normalizeClock(aStart) < normalizeClock(bEnd) && normalizeClock(aEnd) > normalizeClock(bStart);
}

export function visitAvailabilityMessage(code: string): string {
  switch (code) {
    case "branch_closed":
      return "This branch is closed on the selected day.";
    case "date_blocked":
      return "This branch does not accept visits on the selected date.";
    case "outside_booking_window":
      return "This date is outside the branch booking window.";
    case "branch_inactive":
      return "This branch is not accepting visits right now.";
    default:
      return "This date is not available for booking.";
  }
}

export function visitAvailabilityBlock(args: {
  branch: Dict | null;
  branchId: string | null;
  day: string;
  today: string;
  blockedDates: ReadonlyArray<{ day: string; branchId: string | null }>;
}): VisitAvailabilityCode | null {
  if (!args.branch || !args.branchId) return null;
  if (args.branch.is_active !== true) return "branch_inactive";
  const dows = (Array.isArray(args.branch.working_dows) ? args.branch.working_dows : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const dow = dayOfWeek(args.day);
  if (dows.length > 0 && !dows.includes(dow)) return "branch_closed";
  if (
    args.blockedDates.some(
      (row) => row.day === args.day && (row.branchId === null || row.branchId === args.branchId),
    )
  ) {
    return "date_blocked";
  }
  const window = numberOrNull(args.branch.booking_window_days);
  if (window !== null && args.day > addDays(args.today, window)) return "outside_booking_window";
  return null;
}

export function slotMatchesDate(slot: Dict, day: string): boolean {
  const slotDate = dayTextOf(slot[VISIT_SLOT_FIELDS.slotDate]);
  if (slotDate === day) return true;
  return slotDate === null && numberOf(slot[VISIT_SLOT_FIELDS.dayOfWeek], -1) === dayOfWeek(day);
}

async function allocateVisitBookingCode(): Promise<string> {
  const db = getFirestore();
  const counterRef = db.collection(COLLECTIONS.counters).doc(VISIT_CODE_COUNTER);
  const seq = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const last = numberOrNull(snap.get("value"));
    const next = last === null ? 1 : Math.trunc(last) + 1;
    tx.set(counterRef, { value: next, updated_at: FieldValue.serverTimestamp() }, { merge: true });
    return next;
  });
  return `VIS-${String(seq).padStart(5, "0")}`;
}

async function loadDepartment(key: string): Promise<{ id: string; data: Dict } | null> {
  const db = getFirestore();
  const byId = await db.collection(COLLECTIONS.visitDepartments).doc(key).get();
  if (byId.exists) {
    const data = (byId.data() ?? {}) as Dict;
    if (data[VISIT_DEPARTMENT_FIELDS.key] === key || !data[VISIT_DEPARTMENT_FIELDS.key]) {
      return { id: byId.id, data: { ...data, key } };
    }
  }
  const snap = await db.collection(COLLECTIONS.visitDepartments).where("key", "==", key).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, data: (snap.docs[0].data() ?? {}) as Dict };
}

async function loadBlockedDates(): Promise<Array<{ day: string; branchId: string | null }>> {
  const snap = await getFirestore().collection(COLLECTIONS.visitBlockedDates).limit(2000).get();
  return snap.docs.map((doc) => {
    const data = doc.data() ?? {};
    return {
      day: dayTextOf(data.blocked_date) ?? "",
      branchId: textOf(data.branch_id),
    };
  });
}

async function defaultBranchId(): Promise<string | null> {
  const snap = await getFirestore().collection(COLLECTIONS.visitBranches).where("is_active", "==", true).get();
  const rows = snap.docs.map((doc) => ({ id: doc.id, data: (doc.data() ?? {}) as Dict }));
  rows.sort((a, b) => {
    const defaultDelta = Number(b.data.is_default === true) - Number(a.data.is_default === true);
    if (defaultDelta !== 0) return defaultDelta;
    return (numberOrNull(a.data.sort_order) ?? 0) - (numberOrNull(b.data.sort_order) ?? 0);
  });
  return rows[0]?.id ?? null;
}

export const driverListVisitSlots = onCall(async (request) => {
  await requireRider(request);
  const data = asData(request);
  const day = pickDay(data, "date", "p_date");
  const departmentKey = pickText(data, "departmentKey", "p_department_key");
  if (!day || !departmentKey || !parseDay(day)) return { ok: true, slots: [] };

  const [dept, slotsSnap, bookingsSnap, blockedDates] = await Promise.all([
    loadDepartment(departmentKey),
    getFirestore().collection(COLLECTIONS.visitSlots).where("department_key", "==", departmentKey).get(),
    getFirestore().collection(COLLECTIONS.visitBookings).where("scheduled_date", "==", day).get(),
    loadBlockedDates(),
  ]);

  if (!dept || dept.data[VISIT_DEPARTMENT_FIELDS.isActive] !== true) {
    return { ok: true, slots: [] };
  }

  const bookedBySlot = new Map<string, number>();
  for (const doc of bookingsSnap.docs) {
    const row = { id: doc.id, ...(doc.data() ?? {}) } as Dict;
    if (!isVisitHold(row)) continue;
    const slotId = textOf(row[VISIT_BOOKING_FIELDS.slotId]);
    if (!slotId) continue;
    bookedBySlot.set(slotId, (bookedBySlot.get(slotId) ?? 0) + 1);
  }

  const today = kuwaitDayString(new Date());
  const deptBranchId = textOf(dept.data[VISIT_DEPARTMENT_FIELDS.branchId]);
  const slots: Array<{
    id: string;
    start_time: string;
    end_time: string;
    capacity: number;
    booked: number;
    remaining: number;
    full: boolean;
    start: string;
  }> = [];

  for (const doc of slotsSnap.docs) {
    const slot = (doc.data() ?? {}) as Dict;
    if (slot[VISIT_SLOT_FIELDS.isActive] !== true) continue;
    if (!slotMatchesDate(slot, day)) continue;
    const slotBranch = textOf(slot[VISIT_SLOT_FIELDS.branchId]);
    if (deptBranchId !== null && slotBranch !== deptBranchId) continue;

    const branchId = slotBranch ?? deptBranchId;
    const branch = branchId ? await loadVisitBranch(branchId) : null;
    const block = visitAvailabilityBlock({
      branch,
      branchId,
      day,
      today,
      blockedDates,
    });
    if (block !== null) continue;

    const start = timeValueOf(slot[VISIT_SLOT_FIELDS.startTime]) ?? "";
    const end = timeValueOf(slot[VISIT_SLOT_FIELDS.endTime]) ?? "";
    const capacity = numberOf(slot[VISIT_SLOT_FIELDS.capacity], 0);
    const booked = bookedBySlot.get(doc.id) ?? 0;
    slots.push({
      id: doc.id,
      start_time: start,
      end_time: end,
      capacity,
      booked,
      remaining: Math.max(capacity - booked, 0),
      full: booked >= capacity,
      start,
    });
  }

  slots.sort((a, b) => a.start.localeCompare(b.start));
  return {
    ok: true,
    slots: slots.map((row) => ({
      id: row.id,
      start_time: row.start_time,
      end_time: row.end_time,
      capacity: row.capacity,
      booked: row.booked,
      remaining: row.remaining,
      full: row.full,
    })),
  };
});

export const driverBookVisit = onCall(async (request) => {
  const ctx = await requireRider(request);
  if (archived(ctx)) return fail("not_a_driver");

  const data = asData(request);
  const departmentKey = pickText(data, "departmentKey", "p_department_key");
  const day = pickDay(data, "date", "p_date");
  const slotId = pickId(data, "slotId", "p_slot_id");
  const note = pickText(data, "note", "p_note");

  if (!departmentKey || !day || !slotId) return fail("slot_not_found");

  const [dept, slot] = await Promise.all([
    loadDepartment(departmentKey),
    loadVisitSlot(slotId),
  ]);

  if (!dept || dept.data[VISIT_DEPARTMENT_FIELDS.isActive] !== true) {
    await logDriverOperation({
      driverId: ctx.uid,
      module: "visit",
      action: "visit.book",
      actor: "driver_book_visit",
      success: false,
      recordType: "visit_booking",
      detail: { department_key: departmentKey, date: day },
    });
    return fail("invalid_department");
  }

  if (!slot || slot[VISIT_SLOT_FIELDS.isActive] !== true) {
    await logDriverOperation({
      driverId: ctx.uid,
      module: "visit",
      action: "visit.book",
      actor: "driver_book_visit",
      success: false,
      recordType: "visit_booking",
      detail: { department_key: departmentKey, slot_id: slotId },
    });
    return fail("slot_not_found");
  }

  const deptBranchId = textOf(dept.data[VISIT_DEPARTMENT_FIELDS.branchId]);
  const slotBranchId = textOf(slot[VISIT_SLOT_FIELDS.branchId]);
  if (deptBranchId !== null && deptBranchId !== slotBranchId) {
    await logDriverOperation({
      driverId: ctx.uid,
      module: "visit",
      action: "visit.book",
      actor: "driver_book_visit",
      success: false,
      recordType: "visit_booking",
      detail: { department_key: departmentKey, slot_id: slotId },
    });
    return fail("department_not_at_branch");
  }

  const fallbackBranch = await defaultBranchId();
  const branchId = slotBranchId ?? deptBranchId ?? fallbackBranch;
  const [branch, blockedDates, slotBookings, driverBookings] = await Promise.all([
    branchId ? loadVisitBranch(branchId) : Promise.resolve(null),
    loadBlockedDates(),
    visitBookingsForSlot(slotId),
    visitBookingsForDriver(ctx.uid),
  ]);

  const today = kuwaitDayString(new Date());
  const block = visitAvailabilityBlock({
    branch,
    branchId,
    day,
    today,
    blockedDates,
  });
  if (block !== null) {
    await logDriverOperation({
      driverId: ctx.uid,
      module: "visit",
      action: "visit.book",
      actor: "driver_book_visit",
      success: false,
      recordType: "visit_booking",
      detail: { department_key: departmentKey, date: day },
    });
    return fail(block, visitAvailabilityMessage(block));
  }

  const dayHolds = slotBookings.filter(
    (row) => dayTextOf(row[VISIT_BOOKING_FIELDS.scheduledDate]) === day && isVisitHold(row),
  );
  const capacity = numberOf(slot[VISIT_SLOT_FIELDS.capacity], 0);
  if (dayHolds.length >= capacity) {
    await logDriverOperation({
      driverId: ctx.uid,
      module: "visit",
      action: "visit.book",
      actor: "driver_book_visit",
      success: false,
      recordType: "visit_booking",
      detail: { department_key: departmentKey, date: day, capacity },
    });
    return fail("slot_full");
  }

  const driverDay = driverBookings.filter(
    (row) => dayTextOf(row[VISIT_BOOKING_FIELDS.scheduledDate]) === day && isVisitHold(row),
  );
  if (driverDay.some((row) => textOf(row[VISIT_BOOKING_FIELDS.departmentKey]) === departmentKey)) {
    await logDriverOperation({
      driverId: ctx.uid,
      module: "visit",
      action: "visit.book",
      actor: "driver_book_visit",
      success: false,
      recordType: "visit_booking",
      detail: { department_key: departmentKey, date: day },
    });
    return fail("duplicate_department_date", "Already booked for this department on this date.");
  }

  const slotStart = timeValueOf(slot[VISIT_SLOT_FIELDS.startTime]) ?? "";
  const slotEnd = timeValueOf(slot[VISIT_SLOT_FIELDS.endTime]) ?? "";
  for (const row of driverDay) {
    const other = await loadVisitSlot(textOf(row[VISIT_BOOKING_FIELDS.slotId]) ?? "");
    if (!other) continue;
    const otherStart = timeValueOf(other[VISIT_SLOT_FIELDS.startTime]) ?? "";
    const otherEnd = timeValueOf(other[VISIT_SLOT_FIELDS.endTime]) ?? "";
    if (timesOverlap(slotStart, slotEnd, otherStart, otherEnd)) {
      await logDriverOperation({
        driverId: ctx.uid,
        module: "visit",
        action: "visit.book",
        actor: "driver_book_visit",
        success: false,
        recordType: "visit_booking",
        detail: { department_key: departmentKey, date: day, slot_id: slotId },
      });
      return fail("overlapping_visit", "You already have a visit at this time. Pick another slot.");
    }
  }

  const code = await allocateVisitBookingCode();
  const nowTs = Timestamp.now();
  const bookingRef = getFirestore().collection(COLLECTIONS.visitBookings).doc();
  await bookingRef.set({
    [VISIT_BOOKING_FIELDS.bookingCode]: code,
    [VISIT_BOOKING_FIELDS.driverId]: ctx.uid,
    [VISIT_BOOKING_FIELDS.departmentKey]: departmentKey,
    [VISIT_BOOKING_FIELDS.branchId]: branchId,
    [VISIT_BOOKING_FIELDS.slotId]: slotId,
    [VISIT_BOOKING_FIELDS.scheduledDate]: day,
    [VISIT_BOOKING_FIELDS.note]: note,
    [VISIT_BOOKING_FIELDS.status]: "confirmed",
    created_at: nowTs,
    updated_at: nowTs,
  });

  await logDriverOperation({
    driverId: ctx.uid,
    module: "visit",
    action: "visit.book",
    actor: "driver_book_visit",
    recordType: "visit_booking",
    recordId: bookingRef.id,
    detail: { booking_code: code, department_key: departmentKey, date: day },
  });

  return { ok: true, id: bookingRef.id, booking_code: code, status: "confirmed" };
});

export const driverCancelVisit = onCall(async (request) => {
  const ctx = await requireRider(request);
  const bookingId = pickId(asData(request), "bookingId", "p_booking_id");
  if (!bookingId) return fail("not_cancellable");

  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.visitBookings).doc(bookingId);
  const snap = await ref.get();
  const data = (snap.data() ?? {}) as Dict;
  if (
    !snap.exists ||
    data[VISIT_BOOKING_FIELDS.driverId] !== ctx.uid ||
    data[VISIT_BOOKING_FIELDS.status] !== "confirmed"
  ) {
    await logDriverOperation({
      driverId: ctx.uid,
      module: "visit",
      action: "visit.cancel",
      actor: "driver_cancel_visit",
      success: false,
      recordType: "visit_booking",
      recordId: bookingId,
    });
    return fail("not_cancellable");
  }

  const nowTs = Timestamp.now();
  await ref.update({
    status: "cancelled",
    cancelled_at: nowTs,
    updated_at: nowTs,
  });

  await logDriverOperation({
    driverId: ctx.uid,
    module: "visit",
    action: "visit.cancel",
    actor: "driver_cancel_visit",
    recordType: "visit_booking",
    recordId: bookingId,
    detail: { booking_code: data[VISIT_BOOKING_FIELDS.bookingCode] },
  });

  return { ok: true };
});
