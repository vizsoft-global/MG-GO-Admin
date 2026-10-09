/**
 * Visit-booking helpers shared by the `admin_*visit*` callables.
 *
 * Firestore has no joins, so every label `admin_list_visits` used to read with a
 * `LEFT JOIN` is loaded here in one batched pass per collection — once per page,
 * never once per row.
 */
import {
  FieldValue,
  getFirestore,
  Timestamp,
  type DocumentSnapshot,
  type Query,
} from "firebase-admin/firestore";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";

const DAY_MS = 86_400_000;
const GET_ALL_CHUNK = 300;
const WRITE_CHUNK = 400;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A Firestore range scan cannot answer `LIMIT`/`OFFSET` the way a Postgres index
 * does, so the windows that have to be filtered in memory carry a ceiling. Hitting
 * it is reported, never silently truncated into a wrong total.
 */
export const VISIT_SCAN_CAP = 5000;

export const VISIT_BOOKING_STATUSES = [
  "confirmed",
  "checked_in",
  "completed",
  "no_show",
  "cancelled",
] as const;

export type VisitBookingStatus = (typeof VISIT_BOOKING_STATUSES)[number];

/** The statuses the SQL counts as a live hold on a slot or a driver-day. */
export const VISIT_HOLD_STATUSES: readonly VisitBookingStatus[] = ["confirmed", "checked_in"];

export function isVisitBookingStatus(value: unknown): value is VisitBookingStatus {
  return typeof value === "string" && (VISIT_BOOKING_STATUSES as readonly string[]).includes(value);
}

export const VISIT_BOOKING_FIELDS = {
  bookingCode: "booking_code",
  driverId: "driver_id",
  driverName: "driver_name",
  driverPhone: "driver_phone",
  driverCode: "driver_code",
  departmentKey: "department_key",
  departmentLabel: "department_label",
  branchId: "branch_id",
  branchName: "branch_name",
  slotId: "slot_id",
  slotStart: "slot_start",
  slotEnd: "slot_end",
  scheduledDate: "scheduled_date",
  status: "status",
  note: "note",
  noteToRider: "note_to_rider",
  createdAt: "created_at",
  updatedAt: "updated_at",
  checkedInAt: "checked_in_at",
  completedAt: "completed_at",
  cancelledAt: "cancelled_at",
  rescheduledFromId: "rescheduled_from_id",
} as const;

export const VISIT_SLOT_FIELDS = {
  branchId: "branch_id",
  departmentKey: "department_key",
  slotDate: "slot_date",
  dayOfWeek: "day_of_week",
  startTime: "start_time",
  endTime: "end_time",
  capacity: "capacity",
  isActive: "is_active",
} as const;

export const VISIT_BRANCH_FIELDS = {
  key: "key",
  name: "name",
  isActive: "is_active",
  isDefault: "is_default",
  sortOrder: "sort_order",
  workingDows: "working_dows",
  bookingWindowDays: "booking_window_days",
} as const;

export const VISIT_DEPARTMENT_FIELDS = {
  key: "key",
  labelEn: "label_en",
  branchId: "branch_id",
  isActive: "is_active",
} as const;

export const VISIT_NOTE_FIELDS = {
  bookingId: "booking_id",
  note: "note",
  authorId: "author_id",
} as const;

export const VISIT_BLOCKED_DATE_FIELDS = {
  branchId: "branch_id",
  blockedDate: "blocked_date",
  reason: "reason",
} as const;

export function textOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function numberOf(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function asDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const seconds = Number((value as { seconds: unknown }).seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000);
  }
  return null;
}

export function isoOf(value: unknown): string | null {
  const date = asDate(value);
  return date ? date.toISOString() : null;
}

/** A `date` column as `YYYY-MM-DD`, whether it is stored as text or a Timestamp. */
export function dayTextOf(value: unknown): string | null {
  const text = textOf(value);
  if (text && DAY_RE.test(text)) return text;
  const date = asDate(value);
  return date ? kuwaitDayString(date) : null;
}

function clockOf(date: Date): string {
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

/** `visit_slots.start_time` / `end_time` as a clock string, whether stored as text or time. */
export function timeValueOf(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  const date = asDate(value);
  return date ? clockOf(date) : null;
}

/** The `HH24:MI` form `to_char(time, 'HH24:MI')` prints. */
export function hourMinuteOf(value: unknown): string | null {
  const text = timeValueOf(value);
  return text ? text.slice(0, 5) : null;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function parseDay(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dayOfWeek(day: string): number {
  const date = parseDay(day);
  return date ? date.getUTCDay() : -1;
}

export function addDays(day: string, delta: number): string {
  const date = parseDay(day);
  if (!date) return day;
  return new Date(date.getTime() + delta * DAY_MS).toISOString().slice(0, 10);
}

/** `to_char(date, 'DD Mon YYYY')`. */
export function formatDayLabel(day: string): string {
  const date = parseDay(day);
  if (!date) return day;
  return `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export type VisitListRow = {
  id: string;
  booking_code: string;
  driver_id: string;
  driver_name: string | null;
  driver_phone: string | null;
  driver_code: string | null;
  department_key: string | null;
  department_label: string | null;
  branch_id: string | null;
  branch_name: string | null;
  slot_id: string | null;
  slot_start: string | null;
  slot_end: string | null;
  scheduled_date: string;
  status: string;
  note: string | null;
  note_to_rider: string | null;
  created_at: string | null;
  updated_at: string | null;
  checked_in_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  rescheduled_from_id: string | null;
};

async function loadDocuments(
  collection: string,
  ids: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (!ids.length) return out;
  const db = getFirestore();
  const unique = [...new Set(ids)];
  for (let index = 0; index < unique.length; index += GET_ALL_CHUNK) {
    const chunk = unique.slice(index, index + GET_ALL_CHUNK);
    const snaps = await db.getAll(...chunk.map((id) => db.collection(collection).doc(id)));
    for (const snap of snaps) {
      if (snap.exists) out.set(snap.id, snap.data() ?? {});
    }
  }
  return out;
}

async function loadDepartmentsByKey(
  keys: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const unique = [...new Set(keys)];
  if (!unique.length) return out;
  const db = getFirestore();
  for (let index = 0; index < unique.length; index += 30) {
    const chunk = unique.slice(index, index + 30);
    const snap = await db
      .collection(COLLECTIONS.visitDepartments)
      .where(VISIT_DEPARTMENT_FIELDS.key, "in", chunk)
      .get();
    for (const doc of snap.docs) {
      const raw = doc.data() ?? {};
      const key = textOf(raw[VISIT_DEPARTMENT_FIELDS.key]);
      if (key) out.set(key, raw);
    }
  }
  return out;
}

/**
 * Composes list rows the way `admin_list_visits`' `LEFT JOIN` set did. A label the
 * booking already carries denormalised is used as-is; only the missing ones are
 * read, and each collection once for the whole page.
 */
export async function composeVisitRows(docs: DocumentSnapshot[]): Promise<VisitListRow[]> {
  if (!docs.length) return [];

  const driverIds = new Set<string>();
  const departmentKeys = new Set<string>();
  const branchIds = new Set<string>();
  const slotIds = new Set<string>();

  const drafts = docs.map((doc) => {
    const raw = doc.data() ?? {};
    const driverId = textOf(raw[VISIT_BOOKING_FIELDS.driverId]) ?? "";
    const departmentKey = textOf(raw[VISIT_BOOKING_FIELDS.departmentKey]) ?? "";
    const branchId = textOf(raw[VISIT_BOOKING_FIELDS.branchId]);
    const slotId = textOf(raw[VISIT_BOOKING_FIELDS.slotId]);

    if (
      driverId &&
      (!textOf(raw[VISIT_BOOKING_FIELDS.driverName]) ||
        !textOf(raw[VISIT_BOOKING_FIELDS.driverCode]) ||
        !textOf(raw[VISIT_BOOKING_FIELDS.driverPhone]))
    ) {
      driverIds.add(driverId);
    }
    if (departmentKey && !textOf(raw[VISIT_BOOKING_FIELDS.departmentLabel])) {
      departmentKeys.add(departmentKey);
    }
    if (branchId && !textOf(raw[VISIT_BOOKING_FIELDS.branchName])) branchIds.add(branchId);
    if (
      slotId &&
      (!textOf(raw[VISIT_BOOKING_FIELDS.slotStart]) || !textOf(raw[VISIT_BOOKING_FIELDS.slotEnd]))
    ) {
      slotIds.add(slotId);
    }

    return { doc, raw, driverId, departmentKey, branchId, slotId };
  });

  const [drivers, profiles, departments, branches, slots] = await Promise.all([
    loadDocuments(COLLECTIONS.drivers, [...driverIds]),
    loadDocuments(COLLECTIONS.profiles, [...driverIds]),
    loadDepartmentsByKey([...departmentKeys]),
    loadDocuments(COLLECTIONS.visitBranches, [...branchIds]),
    loadDocuments(COLLECTIONS.visitSlots, [...slotIds]),
  ]);

  return drafts.map(({ doc, raw, driverId, departmentKey, branchId, slotId }) => {
    const driver = drivers.get(driverId);
    const profile = profiles.get(driverId);
    const department = departments.get(departmentKey);
    const branch = branchId ? branches.get(branchId) : undefined;
    const slot = slotId ? slots.get(slotId) : undefined;

    return {
      id: doc.id,
      booking_code: textOf(raw[VISIT_BOOKING_FIELDS.bookingCode]) ?? "",
      driver_id: driverId,
      driver_name:
        textOf(raw[VISIT_BOOKING_FIELDS.driverName]) ??
        textOf(profile?.["full_name"]) ??
        textOf(driver?.["name"]),
      driver_phone: textOf(profile?.["phone"]) ?? textOf(raw[VISIT_BOOKING_FIELDS.driverPhone]),
      driver_code: textOf(driver?.["driver_code"]) ?? textOf(raw[VISIT_BOOKING_FIELDS.driverCode]),
      department_key: departmentKey || null,
      department_label:
        textOf(department?.[VISIT_DEPARTMENT_FIELDS.labelEn]) ??
        textOf(raw[VISIT_BOOKING_FIELDS.departmentLabel]),
      branch_id: branchId,
      branch_name:
        textOf(branch?.[VISIT_BRANCH_FIELDS.name]) ?? textOf(raw[VISIT_BOOKING_FIELDS.branchName]),
      slot_id: slotId,
      slot_start:
        timeValueOf(slot?.[VISIT_SLOT_FIELDS.startTime]) ??
        timeValueOf(raw[VISIT_BOOKING_FIELDS.slotStart]),
      slot_end:
        timeValueOf(slot?.[VISIT_SLOT_FIELDS.endTime]) ??
        timeValueOf(raw[VISIT_BOOKING_FIELDS.slotEnd]),
      scheduled_date: dayTextOf(raw[VISIT_BOOKING_FIELDS.scheduledDate]) ?? "",
      status: textOf(raw[VISIT_BOOKING_FIELDS.status]) ?? "",
      note: textOf(raw[VISIT_BOOKING_FIELDS.note]),
      note_to_rider: textOf(raw[VISIT_BOOKING_FIELDS.noteToRider]),
      created_at: isoOf(raw[VISIT_BOOKING_FIELDS.createdAt]),
      updated_at: isoOf(raw[VISIT_BOOKING_FIELDS.updatedAt]),
      checked_in_at: isoOf(raw[VISIT_BOOKING_FIELDS.checkedInAt]),
      completed_at: isoOf(raw[VISIT_BOOKING_FIELDS.completedAt]),
      cancelled_at: isoOf(raw[VISIT_BOOKING_FIELDS.cancelledAt]),
      rescheduled_from_id: textOf(raw[VISIT_BOOKING_FIELDS.rescheduledFromId]),
    };
  });
}

/** `ORDER BY scheduled_date DESC, created_at DESC` over already-composed rows. */
export function sortVisitRows(rows: VisitListRow[]): VisitListRow[] {
  return [...rows].sort((a, b) => {
    if (a.scheduled_date !== b.scheduled_date) {
      return a.scheduled_date < b.scheduled_date ? 1 : -1;
    }
    const left = a.created_at ?? "";
    const right = b.created_at ?? "";
    if (left === right) return 0;
    return left < right ? 1 : -1;
  });
}

export async function loadVisitBooking(
  bookingId: string,
): Promise<Record<string, unknown> | null> {
  const snap = await getFirestore().collection(COLLECTIONS.visitBookings).doc(bookingId).get();
  return snap.exists ? (snap.data() ?? {}) : null;
}

export async function loadVisitSlot(slotId: string): Promise<Record<string, unknown> | null> {
  const snap = await getFirestore().collection(COLLECTIONS.visitSlots).doc(slotId).get();
  return snap.exists ? (snap.data() ?? {}) : null;
}

export async function loadVisitBranch(
  branchId: string,
): Promise<Record<string, unknown> | null> {
  const snap = await getFirestore().collection(COLLECTIONS.visitBranches).doc(branchId).get();
  return snap.exists ? (snap.data() ?? {}) : null;
}

/**
 * Every booking that names this slot, each row carrying its document id — the SQL
 * compares `id <> p_booking_id`, and a Firestore document does not hold its own id.
 * Scoped by the single field the query can index and narrowed by date in memory,
 * because Firestore needs a composite index for `slot_id` + `scheduled_date`
 * together and the port must not depend on one the project does not declare.
 */
export async function visitBookingsForSlot(slotId: string): Promise<Record<string, unknown>[]> {
  if (!slotId) return [];
  const snap = await getFirestore()
    .collection(COLLECTIONS.visitBookings)
    .where(VISIT_BOOKING_FIELDS.slotId, "==", slotId)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() ?? {}) }));
}

/** Same shape for one rider's bookings — the duplicate-department-date rule. */
export async function visitBookingsForDriver(
  driverId: string,
): Promise<Record<string, unknown>[]> {
  if (!driverId) return [];
  const snap = await getFirestore()
    .collection(COLLECTIONS.visitBookings)
    .where(VISIT_BOOKING_FIELDS.driverId, "==", driverId)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() ?? {}) }));
}

export function visitRowStatus(raw: Record<string, unknown>): string {
  return textOf(raw[VISIT_BOOKING_FIELDS.status]) ?? "";
}

export function isVisitHold(raw: Record<string, unknown>): boolean {
  return (VISIT_HOLD_STATUSES as readonly string[]).includes(visitRowStatus(raw));
}

/**
 * Whether a branch has that date closed. A blocked date is a branch-scoped fact,
 * so an empty answer is a normal working day and must not be read as "unknown".
 */
export async function visitSlotAvailabilityBlock(
  branchId: string,
  day: string,
): Promise<boolean> {
  if (!branchId || !day) return false;
  const snap = await getFirestore()
    .collection(COLLECTIONS.visitBlockedDates)
    .where(VISIT_BLOCKED_DATE_FIELDS.branchId, "==", branchId)
    .get();
  return snap.docs.some(
    (doc) => dayTextOf(doc.data()?.[VISIT_BLOCKED_DATE_FIELDS.blockedDate]) === day,
  );
}

/** A `scheduled_date` range, applied only when the caller actually narrowed it. */
export function scopedVisitBookings(range: { from?: string; to?: string } = {}): Query {
  let query: Query = getFirestore().collection(COLLECTIONS.visitBookings);
  if (range.from) query = query.where(VISIT_BOOKING_FIELDS.scheduledDate, ">=", range.from);
  if (range.to) query = query.where(VISIT_BOOKING_FIELDS.scheduledDate, "<=", range.to);
  return query;
}

function slotTemplateKey(
  day: number,
  departmentKey: string,
  start: string | null,
  end: string | null,
): string {
  return `${day}|${departmentKey}|${start ?? ""}|${end ?? ""}`;
}

/**
 * `_visit_generate_branch_weekday_slots` — mirrors the branch's busiest recurring
 * weekday template onto every working day. Add-only: a branch whose toggles are
 * unset, or whose week has no template at all, stays exactly as it was, and a
 * deactivated row still counts as present so a slot an operator switched off is
 * never re-added.
 */
export async function syncBranchSlotsToWorkingDays(branchId: string): Promise<number> {
  const branch = await loadVisitBranch(branchId);
  if (!branch) return 0;

  const rawDows = branch[VISIT_BRANCH_FIELDS.workingDows];
  const workingDows = (Array.isArray(rawDows) ? rawDows : []).map((value) => numberOf(value, -1));
  if (!workingDows.length) return 0;

  const snap = await getFirestore()
    .collection(COLLECTIONS.visitSlots)
    .where(VISIT_SLOT_FIELDS.branchId, "==", branchId)
    .get();
  const rows = snap.docs.map((doc) => doc.data() ?? {});

  const recurring = rows.filter((raw) => dayTextOf(raw[VISIT_SLOT_FIELDS.slotDate]) === null);
  const templates = recurring.filter((raw) => raw[VISIT_SLOT_FIELDS.isActive] === true);

  const perDay = new Map<number, number>();
  for (const raw of templates) {
    const day = numberOf(raw[VISIT_SLOT_FIELDS.dayOfWeek], -1);
    if (day < 0) continue;
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }

  let templateDay = -1;
  let templateCount = 0;
  for (const day of [...perDay.keys()].sort((a, b) => a - b)) {
    const count = perDay.get(day) ?? 0;
    if (count > templateCount) {
      templateDay = day;
      templateCount = count;
    }
  }
  if (templateDay < 0) return 0;

  const templateRows = templates.filter(
    (raw) => numberOf(raw[VISIT_SLOT_FIELDS.dayOfWeek], -1) === templateDay,
  );

  const present = new Set(
    recurring.map((raw) =>
      slotTemplateKey(
        numberOf(raw[VISIT_SLOT_FIELDS.dayOfWeek], -1),
        textOf(raw[VISIT_SLOT_FIELDS.departmentKey]) ?? "",
        timeValueOf(raw[VISIT_SLOT_FIELDS.startTime]),
        timeValueOf(raw[VISIT_SLOT_FIELDS.endTime]),
      ),
    ),
  );

  const inserts: Array<Record<string, unknown>> = [];
  for (const day of workingDows) {
    for (const source of templateRows) {
      const key = slotTemplateKey(
        day,
        textOf(source[VISIT_SLOT_FIELDS.departmentKey]) ?? "",
        timeValueOf(source[VISIT_SLOT_FIELDS.startTime]),
        timeValueOf(source[VISIT_SLOT_FIELDS.endTime]),
      );
      if (present.has(key)) continue;
      present.add(key);
      inserts.push({
        [VISIT_SLOT_FIELDS.branchId]: branchId,
        [VISIT_SLOT_FIELDS.departmentKey]: source[VISIT_SLOT_FIELDS.departmentKey] ?? null,
        [VISIT_SLOT_FIELDS.slotDate]: null,
        [VISIT_SLOT_FIELDS.dayOfWeek]: day,
        [VISIT_SLOT_FIELDS.startTime]: source[VISIT_SLOT_FIELDS.startTime] ?? null,
        [VISIT_SLOT_FIELDS.endTime]: source[VISIT_SLOT_FIELDS.endTime] ?? null,
        [VISIT_SLOT_FIELDS.capacity]: source[VISIT_SLOT_FIELDS.capacity] ?? null,
        [VISIT_SLOT_FIELDS.isActive]: true,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
    }
  }
  if (!inserts.length) return 0;

  const db = getFirestore();
  for (let index = 0; index < inserts.length; index += WRITE_CHUNK) {
    const batch = db.batch();
    for (const row of inserts.slice(index, index + WRITE_CHUNK)) {
      batch.set(db.collection(COLLECTIONS.visitSlots).doc(), row);
    }
    await batch.commit();
  }
  return inserts.length;
}

export type TransactionalNotifyParams = {
  driverId: string | null;
  title: string | null;
  body: string | null;
  deepLink?: string | null;
  category: string;
  priority: string;
  actionParams?: Record<string, unknown>;
  createdBy?: string | null;
};

export type TransactionalNotifyResult = {
  ok: boolean;
  campaign_id: string | null;
  dispatch_item_id: string | null;
};

/**
 * `notify_driver_transactional` — the campaign, its dispatch run and the single
 * item addressed to the rider, written in one commit so the rider's inbox row can
 * never exist without the campaign it belongs to. The caller sends FCM from the
 * ids this returns, exactly as the panel's server action already does.
 */
export async function notifyDriverTransactional(
  params: TransactionalNotifyParams,
): Promise<TransactionalNotifyResult> {
  const title = params.title?.trim() ?? "";
  if (!params.driverId || params.title === null || title === "") {
    return { ok: false, campaign_id: null, dispatch_item_id: null };
  }

  const actionParams: Record<string, unknown> = { ...(params.actionParams ?? {}) };
  const deepLink = params.deepLink?.trim() ?? "";
  if (deepLink !== "") actionParams.deep_link = deepLink;

  const body = params.body?.trim() ?? "";

  const db = getFirestore();
  const now = FieldValue.serverTimestamp();
  const campaignRef = db.collection(COLLECTIONS.notificationCampaigns).doc();
  const runRef = db.collection(COLLECTIONS.notificationDispatchRuns).doc();
  const itemRef = db.collection(COLLECTIONS.notificationDispatchItems).doc();

  const batch = db.batch();
  batch.set(campaignRef, {
    title,
    body: body === "" ? title : body,
    category: params.category,
    priority: params.priority,
    status: "sent",
    action_type: "open_record",
    action_params: actionParams,
    payload_version: 2,
    target_spec: { mode: "transactional", driver_ids: [params.driverId] },
    recipient_count: 1,
    delivered_count: 1,
    sent_at: now,
    estimated_audience_count: 1,
    created_at: now,
  });
  batch.set(runRef, {
    campaign_id: campaignRef.id,
    status: "sent",
    provider: "fcm",
    idempotency_key: `txn-${campaignRef.id}`,
    started_at: now,
    finished_at: now,
    total_count: 1,
    sent_count: 1,
    created_at: now,
  });
  batch.set(itemRef, {
    run_id: runRef.id,
    campaign_id: campaignRef.id,
    driver_id: params.driverId,
    status: "delivered",
    delivered_at: now,
    sent_at: now,
    created_at: now,
  });
  await batch.commit();

  return { ok: true, campaign_id: campaignRef.id, dispatch_item_id: itemRef.id };
}
