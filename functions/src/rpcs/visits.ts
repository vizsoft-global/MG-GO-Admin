import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import { requireStaff } from "../core/staff";
import {
  VISIT_BOOKING_FIELDS,
  VISIT_SCAN_CAP,
  VISIT_SLOT_FIELDS,
  addDays,
  composeVisitRows,
  dayOfWeek,
  dayTextOf,
  formatDayLabel,
  hourMinuteOf,
  isVisitBookingStatus,
  isVisitHold,
  loadVisitBooking,
  loadVisitBranch,
  loadVisitSlot,
  notifyDriverTransactional,
  numberOf,
  scopedVisitBookings,
  sortVisitRows,
  syncBranchSlotsToWorkingDays,
  textOf,
  visitBookingsForDriver,
  visitBookingsForSlot,
  visitRowStatus,
  type VisitBookingStatus,
} from "./visits-shared";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_PAGE_LIMIT = 50;
const UPCOMING_DAYS = 7;
const NO_SHOW_LOOKBACK_DAYS = 7;

/** The callables take the `p_*` names the SQL declared, plus the camelCase form. */
function pick(data: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    const value = data[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function pickId(data: Record<string, unknown>, ...names: string[]): string | null {
  const value = pick(data, ...names);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function pickDay(data: Record<string, unknown>, ...names: string[]): string | null {
  const value = pick(data, ...names);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return DAY_RE.test(trimmed) ? trimmed : null;
}

function pickCount(data: Record<string, unknown>, fallback: number, ...names: string[]): number {
  const value = pick(data, ...names);
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
}

function countWithStatus(rows: Array<Record<string, unknown>>, statuses: string[]): number {
  let total = 0;
  for (const raw of rows) {
    if (statuses.includes(visitRowStatus(raw))) total += 1;
  }
  return total;
}

/**
 * Firestore has no unique index over `(driver, date, department)`, so the SQL's
 * `unique_violation` has no twin — an aborted transaction (two operators moving the
 * same rider at once) is the only conflict the pre-check can lose, and only that is
 * reported as a duplicate. Anything else is rethrown, because a false
 * `duplicate_department_date` is worse than a failed request.
 */
function isWriteConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 6 || code === "6" || code === 10 || code === "10" || code === "aborted";
}

/**
 * `admin_list_visits` — rows plus the five KPI counters.
 *
 * The KPI block is deliberately *not* date-filtered in the SQL and is not filtered
 * here either: it describes the day and the week ahead, while the rows describe
 * whatever window the operator asked for.
 */
export const adminListVisits = onCall(async (request) => {
  await requireStaff(request, "visits.view");
  const data = (request.data ?? {}) as Record<string, unknown>;

  const rawFrom = pick(data, "dateFrom", "p_date_from");
  const rawTo = pick(data, "dateTo", "p_date_to");
  const dateFrom = typeof rawFrom === "string" && DAY_RE.test(rawFrom.trim()) ? rawFrom.trim() : null;
  const dateTo = typeof rawTo === "string" && DAY_RE.test(rawTo.trim()) ? rawTo.trim() : null;

  const rawStatus = pick(data, "status", "p_status");
  const status = typeof rawStatus === "string" ? rawStatus.trim() : "";
  if (status !== "" && !isVisitBookingStatus(status)) {
    throw new HttpsError("invalid-argument", "invalid_status");
  }

  const limit = Math.max(pickCount(data, DEFAULT_PAGE_LIMIT, "limit", "p_limit"), 1);
  const offset = Math.max(pickCount(data, 0, "offset", "p_offset"), 0);

  const today = kuwaitDayString(new Date());
  const window = { from: dateFrom ?? undefined, to: dateTo ?? undefined };

  const [todaySnap, upcomingSnap, noShowSnap, rowsSnap] = await Promise.all([
    scopedVisitBookings({ from: today, to: today }).get(),
    scopedVisitBookings({ from: addDays(today, 1), to: addDays(today, UPCOMING_DAYS) }).get(),
    scopedVisitBookings({ from: addDays(today, -NO_SHOW_LOOKBACK_DAYS) })
      .limit(VISIT_SCAN_CAP + 1)
      .get(),
    status === ""
      ? scopedVisitBookings(window)
          .orderBy(VISIT_BOOKING_FIELDS.scheduledDate, "desc")
          .limit(limit + offset)
          .get()
      : scopedVisitBookings(window)
          .orderBy(VISIT_BOOKING_FIELDS.scheduledDate, "desc")
          .limit(VISIT_SCAN_CAP + 1)
          .get(),
  ]);

  if (status !== "" && rowsSnap.size > VISIT_SCAN_CAP) {
    throw new HttpsError("out-of-range", "visit_window_too_large");
  }
  if (noShowSnap.size > VISIT_SCAN_CAP) {
    throw new HttpsError("out-of-range", "visit_window_too_large");
  }

  const todayRows = todaySnap.docs.map((doc) => doc.data() ?? {});
  const upcomingRows = upcomingSnap.docs.map((doc) => doc.data() ?? {});
  const noShowRows = noShowSnap.docs.map((doc) => doc.data() ?? {});

  const kpi = {
    today: todayRows.length,
    today_checked_in: countWithStatus(todayRows, ["checked_in", "completed"]),
    upcoming: countWithStatus(upcomingRows, ["confirmed"]),
    awaiting_checkin: countWithStatus(todayRows, ["confirmed"]),
    no_shows: countWithStatus(noShowRows, ["no_show"]),
  };

  const matching =
    status === ""
      ? rowsSnap.docs
      : rowsSnap.docs.filter((doc) => visitRowStatus(doc.data() ?? {}) === status);
  const ordered = sortVisitRows(await composeVisitRows(matching));

  return { ok: true, kpi, rows: ordered.slice(offset, offset + limit) };
});

/**
 * `admin_update_visit_status` — the Operator check-in / complete / no-show / cancel
 * path, and the confirm-into-a-slot path. A timestamp is stamped only the first time
 * its status is reached, so re-deciding a booking never rewrites when it happened.
 */
export const adminUpdateVisitStatus = onCall(async (request) => {
  await requireStaff(request, "visits.operate");
  const data = (request.data ?? {}) as Record<string, unknown>;

  const bookingId = pickId(data, "bookingId", "p_booking_id");
  if (!bookingId) throw new HttpsError("invalid-argument", "invalid_booking_id");

  const rawStatus = pick(data, "status", "p_status");
  const status = typeof rawStatus === "string" ? rawStatus.trim() : "";
  if (!isVisitBookingStatus(status)) {
    throw new HttpsError("invalid-argument", "invalid_status");
  }

  const newSlotId = pickId(data, "newSlotId", "p_new_slot_id");
  const newDate = pickDay(data, "newDate", "p_new_date");

  const db = getFirestore();
  const bookingRef = db.collection(COLLECTIONS.visitBookings).doc(bookingId);

  const booking = await db.runTransaction(async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists) return null;
    const raw = snap.data() ?? {};
    const now = FieldValue.serverTimestamp();

    const update: Record<string, unknown> = {
      [VISIT_BOOKING_FIELDS.status]: status,
      [VISIT_BOOKING_FIELDS.updatedAt]: now,
    };
    if (newSlotId) update[VISIT_BOOKING_FIELDS.slotId] = newSlotId;
    if (newDate) update[VISIT_BOOKING_FIELDS.scheduledDate] = newDate;

    if (status === "checked_in" && !raw[VISIT_BOOKING_FIELDS.checkedInAt]) {
      update[VISIT_BOOKING_FIELDS.checkedInAt] = now;
    }
    if (status === "completed" && !raw[VISIT_BOOKING_FIELDS.completedAt]) {
      update[VISIT_BOOKING_FIELDS.completedAt] = now;
    }
    if (status === "cancelled" && !raw[VISIT_BOOKING_FIELDS.cancelledAt]) {
      update[VISIT_BOOKING_FIELDS.cancelledAt] = now;
    }

    tx.update(bookingRef, update);
    return raw;
  });

  if (!booking) return { ok: false, error: "not_found" };

  const bookingCode = textOf(booking[VISIT_BOOKING_FIELDS.bookingCode]) ?? "";
  const body = visitStatusBody(status);

  await notifyDriverTransactional({
    driverId: textOf(booking[VISIT_BOOKING_FIELDS.driverId]),
    title: `Visit ${status.replace(/_/g, " ")} — ${bookingCode}`,
    body,
    deepLink: "musallam:///profile/support/visits",
    category: "operations",
    priority: "normal",
    actionParams: {
      record_type: "visit",
      record_id: bookingId,
      route: "/profile/support/visits",
    },
  });

  return { ok: true, status };
});

function visitStatusBody(status: VisitBookingStatus): string {
  switch (status) {
    case "checked_in":
      return "You have been checked in at reception.";
    case "completed":
      return "Your visit is marked completed.";
    case "cancelled":
      return "Your visit booking was cancelled.";
    case "no_show":
      return "Your visit was marked as no-show.";
    case "confirmed":
      return "Your visit status was updated.";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/**
 * `admin_reschedule_visit` — moves the booking in place, so `booking_code` survives
 * and the rider keeps the code they were already shown.
 */
export const adminRescheduleVisit = onCall(async (request) => {
  await requireStaff(request, "visits.operate");
  const data = (request.data ?? {}) as Record<string, unknown>;

  const bookingId = pickId(data, "bookingId", "p_booking_id");
  const newDate = pickDay(data, "scheduledDate", "newDate", "p_new_date");
  const newSlotId = pickId(data, "slotId", "newSlotId", "p_new_slot_id");

  if (!bookingId) throw new HttpsError("invalid-argument", "invalid_booking_id");
  if (!newDate || !newSlotId) return { ok: false, error: "invalid_input" };

  const booking = await loadVisitBooking(bookingId);
  if (!booking) return { ok: false, error: "not_found" };

  const bookingStatus = visitRowStatus(booking);
  if (bookingStatus !== "confirmed") return { ok: false, error: "not_reschedulable" };

  const slot = await loadVisitSlot(newSlotId);
  if (!slot || slot[VISIT_SLOT_FIELDS.isActive] !== true) {
    return { ok: false, error: "slot_not_found" };
  }

  const bookingDepartment = textOf(booking[VISIT_BOOKING_FIELDS.departmentKey]);
  const slotDepartment = textOf(slot[VISIT_SLOT_FIELDS.departmentKey]);
  if (slotDepartment !== bookingDepartment) {
    return { ok: false, error: "slot_department_mismatch" };
  }

  const slotDate = dayTextOf(slot[VISIT_SLOT_FIELDS.slotDate]);
  if (slotDate) {
    if (slotDate !== newDate) return { ok: false, error: "slot_date_mismatch" };
  } else if (numberOf(slot[VISIT_SLOT_FIELDS.dayOfWeek], -1) !== dayOfWeek(newDate)) {
    return { ok: false, error: "slot_date_mismatch" };
  }

  const currentDate = dayTextOf(booking[VISIT_BOOKING_FIELDS.scheduledDate]);
  const currentSlotId = textOf(booking[VISIT_BOOKING_FIELDS.slotId]);
  if (currentDate === newDate && currentSlotId === newSlotId) {
    return { ok: false, error: "unchanged" };
  }

  const [slotBookings, driverBookings] = await Promise.all([
    visitBookingsForSlot(newSlotId),
    visitBookingsForDriver(textOf(booking[VISIT_BOOKING_FIELDS.driverId]) ?? ""),
  ]);

  const capacity = numberOf(slot[VISIT_SLOT_FIELDS.capacity], 0);
  let slotBooked = 0;
  for (const other of slotBookings) {
    if (!isVisitHold(other)) continue;
    if (dayTextOf(other[VISIT_BOOKING_FIELDS.scheduledDate]) !== newDate) continue;
    if (textOf(other["id"]) === bookingId) continue;
    slotBooked += 1;
  }
  if (slotBooked >= capacity) return { ok: false, error: "slot_full" };

  const driverId = textOf(booking[VISIT_BOOKING_FIELDS.driverId]);
  for (const other of driverBookings) {
    if (!isVisitHold(other)) continue;
    if (dayTextOf(other[VISIT_BOOKING_FIELDS.scheduledDate]) !== newDate) continue;
    if (textOf(other[VISIT_BOOKING_FIELDS.departmentKey]) !== bookingDepartment) continue;
    if (textOf(other["id"]) === bookingId) continue;
    return {
      ok: false,
      error: "duplicate_department_date",
      message: "Rider already has an active booking for this department on that date.",
    };
  }

  const db = getFirestore();
  const bookingRef = db.collection(COLLECTIONS.visitBookings).doc(bookingId);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(bookingRef);
      if (!snap.exists) throw new HttpsError("not-found", "not_found");
      const latest = snap.data() ?? {};
      if (visitRowStatus(latest) !== "confirmed") {
        throw new HttpsError("failed-precondition", "not_reschedulable");
      }
      tx.update(bookingRef, {
        [VISIT_BOOKING_FIELDS.slotId]: newSlotId,
        [VISIT_BOOKING_FIELDS.scheduledDate]: newDate,
        [VISIT_BOOKING_FIELDS.updatedAt]: FieldValue.serverTimestamp(),
      });
    });
  } catch (error) {
    if (error instanceof HttpsError) {
      if (error.message === "not_found") return { ok: false, error: "not_found" };
      if (error.message === "not_reschedulable") return { ok: false, error: "not_reschedulable" };
      throw error;
    }
    if (isWriteConflict(error)) {
      return {
        ok: false,
        error: "duplicate_department_date",
        message: "Rider already has an active booking for this department on that date.",
      };
    }
    throw error;
  }

  const bookingCode = textOf(booking[VISIT_BOOKING_FIELDS.bookingCode]) ?? "";
  const startTime = hourMinuteOf(slot[VISIT_SLOT_FIELDS.startTime]);

  await notifyDriverTransactional({
    driverId,
    title: `Visit rescheduled — ${bookingCode}`,
    body: `Your visit is now on ${formatDayLabel(newDate)} at ${startTime ?? ""}.`,
    deepLink: "musallam:///profile/support/visits",
    category: "operations",
    priority: "normal",
    actionParams: {
      record_type: "visit",
      record_id: bookingId,
      route: "/profile/support/visits",
    },
  });

  return { ok: true, scheduled_date: newDate, slot_id: newSlotId };
});

/**
 * `admin_set_visit_note_to_rider` — the note is Admin-authored and driver-readable,
 * and each *new* note writes its own inbox row so the rider sees the instruction
 * rather than having to reopen the booking. Clearing it notifies nobody.
 */
export const adminSetVisitNoteToRider = onCall(async (request) => {
  await requireStaff(request, "visits.operate");
  const data = (request.data ?? {}) as Record<string, unknown>;

  const bookingId = pickId(data, "bookingId", "p_booking_id");
  if (!bookingId) throw new HttpsError("invalid-argument", "invalid_booking_id");

  const rawNote = pick(data, "note", "p_note");
  const trimmed = typeof rawNote === "string" ? rawNote.trim() : "";
  const note = trimmed.length ? trimmed : null;

  const booking = await loadVisitBooking(bookingId);
  if (!booking) return { ok: false, error: "not_found" };

  const existing = textOf(booking[VISIT_BOOKING_FIELDS.noteToRider]) ?? "";
  const bookingCode = textOf(booking[VISIT_BOOKING_FIELDS.bookingCode]) ?? "";
  const driverId = textOf(booking[VISIT_BOOKING_FIELDS.driverId]);

  await getFirestore()
    .collection(COLLECTIONS.visitBookings)
    .doc(bookingId)
    .update({
      [VISIT_BOOKING_FIELDS.noteToRider]: note,
      [VISIT_BOOKING_FIELDS.updatedAt]: FieldValue.serverTimestamp(),
    });

  if (note === null || note === existing) {
    return { ok: true, notified: false, driver_id: driverId, booking_code: bookingCode };
  }

  const notified = await notifyDriverTransactional({
    driverId,
    title: `Visit note — ${bookingCode}`,
    body: note,
    deepLink: "musallam:///profile/support/visits",
    category: "operations",
    priority: "normal",
    actionParams: {
      record_type: "visit",
      record_id: bookingId,
      route: "/profile/support/visits",
      booking_code: bookingCode,
      note_to_rider: note,
    },
  });

  return {
    ok: true,
    notified: true,
    driver_id: driverId,
    booking_code: bookingCode,
    campaign_id: notified.campaign_id,
    dispatch_item_id: notified.dispatch_item_id,
  };
});

/**
 * `admin_sync_branch_slots_to_working_days` — copies the branch's busiest recurring
 * weekday onto every day the operator has toggled open. Add-only, and inert until a
 * branch both declares its working days and already has one weekday built by hand.
 */
export const adminSyncBranchSlotsToWorkingDays = onCall(async (request) => {
  await requireStaff(request, "visits.manage_catalog");
  const data = (request.data ?? {}) as Record<string, unknown>;

  const branchId = pickId(data, "branchId", "p_branch_id");
  if (!branchId) throw new HttpsError("invalid-argument", "invalid_branch_id");

  const branch = await loadVisitBranch(branchId);
  if (!branch) return { ok: false, error: "branch_not_found" };

  const added = await syncBranchSlotsToWorkingDays(branchId);
  return { ok: true, added };
});
