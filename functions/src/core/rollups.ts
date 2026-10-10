import { COLLECTIONS } from "./collections";
import { FieldValue, type Firestore } from "./fs";

export const ROLLUP_STATUSES = [
  "verified",
  "pending",
  "in_transit",
  "under_review",
  "rejected",
  "cancelled",
] as const;

export type RollupStatus = (typeof ROLLUP_STATUSES)[number];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function driverDayId(driverId: string, day: string): string {
  return `${driverId}_${day}`;
}

export function zoneMonthId(zoneId: string, month: string): string {
  return `${zoneId}_${month}`;
}

export function monthOfDay(day: string): string {
  return day.slice(0, 7);
}

export function isRollupStatus(value: string): value is RollupStatus {
  return (ROLLUP_STATUSES as readonly string[]).includes(value);
}

/**
 * Counter change for one delivery moving from `previous` to `next`.
 * The same status twice is a no-op, so a retried verify does not double-count.
 * `orders` tracks verified deliveries.
 */
export function statusDelta(
  previous: string | null,
  next: string | null,
): Record<string, number> {
  const delta: Record<string, number> = {};
  const bump = (status: string | null, amount: number) => {
    if (!status || !isRollupStatus(status) || amount === 0) return;
    delta[status] = (delta[status] ?? 0) + amount;
    if (status === "verified") delta.orders = (delta.orders ?? 0) + amount;
  };
  if (previous === next) return delta;
  bump(previous, -1);
  bump(next, 1);
  return delta;
}

export function verifiedDriverDayDelta(previousVerified: number, nextVerified: number): number {
  if (previousVerified <= 0 && nextVerified > 0) return 1;
  if (previousVerified > 0 && nextVerified <= 0) return -1;
  return 0;
}

export function attendanceCounterDelta(wasPresent: boolean, present: boolean): number {
  if (wasPresent === present) return 0;
  return present ? 1 : -1;
}

export function singleCalendarMonth(from: string, to: string): string | null {
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) return null;
  if (from.slice(0, 7) !== to.slice(0, 7)) return null;
  const year = Number(from.slice(0, 4));
  const month = Number(from.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const key = from.slice(0, 7);
  if (from !== `${key}-01`) return null;
  if (to !== `${key}-${String(last).padStart(2, "0")}`) return null;
  return key;
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export type DeliveryRollupInput = {
  deliveryId: string;
  driverId: string;
  zoneId: string | null;
  day: string;
  status: string;
};

export async function applyDeliveryRollup(
  db: Firestore,
  input: DeliveryRollupInput,
): Promise<Record<string, number>> {
  if (!input.deliveryId || !input.driverId || !DAY_RE.test(input.day)) return {};
  if (!isRollupStatus(input.status)) return {};

  const dayRef = db.collection(COLLECTIONS.rollupsDriverDay).doc(driverDayId(input.driverId, input.day));
  const markerRef = dayRef.collection("applied").doc(input.deliveryId);
  const month = monthOfDay(input.day);
  const zoneRef = input.zoneId
    ? db.collection(COLLECTIONS.rollupsZoneMonth).doc(zoneMonthId(input.zoneId, month))
    : null;

  return db.runTransaction(async (tx) => {
    const [daySnap, markerSnap] = await Promise.all([tx.get(dayRef), tx.get(markerRef)]);
    const previous =
      markerSnap.exists && typeof markerSnap.get("status") === "string"
        ? (markerSnap.get("status") as string)
        : null;
    const delta = statusDelta(previous, input.status);
    if (Object.keys(delta).length === 0) return {};

    const prevVerified = numberField(daySnap.get("verified"));
    const nextVerified = prevVerified + (delta.verified ?? 0);
    const dayDelta = verifiedDriverDayDelta(prevVerified, nextVerified);
    const now = FieldValue.serverTimestamp();
    const patch: Record<string, unknown> = {
      driver_id: input.driverId,
      day: input.day,
      month,
      zone_id: input.zoneId,
      partial: true,
      updated_at: now,
    };
    for (const [key, amount] of Object.entries(delta)) {
      patch[key] = FieldValue.increment(amount);
    }
    tx.set(dayRef, patch, { merge: true });
    tx.set(markerRef, { status: input.status, updated_at: now }, { merge: true });

    if (zoneRef) {
      const zonePatch: Record<string, unknown> = {
        zone_id: input.zoneId,
        month,
        partial: true,
        updated_at: now,
      };
      for (const [key, amount] of Object.entries(delta)) {
        zonePatch[key] = FieldValue.increment(amount);
      }
      if (dayDelta !== 0) zonePatch.verified_driver_days = FieldValue.increment(dayDelta);
      tx.set(zoneRef, zonePatch, { merge: true });
    }
    return delta;
  });
}

export type AttendanceRollupInput = {
  driverId: string;
  zoneId: string | null;
  day: string;
  logId: string;
  present: boolean;
};

export async function applyAttendanceRollup(db: Firestore, input: AttendanceRollupInput): Promise<number> {
  if (!input.driverId || !input.logId || !DAY_RE.test(input.day)) return 0;

  const dayRef = db.collection(COLLECTIONS.rollupsDriverDay).doc(driverDayId(input.driverId, input.day));
  const markerRef = dayRef.collection("attendance").doc(input.logId);
  const month = monthOfDay(input.day);
  const zoneRef = input.zoneId
    ? db.collection(COLLECTIONS.rollupsZoneMonth).doc(zoneMonthId(input.zoneId, month))
    : null;

  return db.runTransaction(async (tx) => {
    const [daySnap, markerSnap] = await Promise.all([tx.get(dayRef), tx.get(markerRef)]);
    const wasPresent = markerSnap.exists && markerSnap.get("present") === true;
    const delta = attendanceCounterDelta(wasPresent, input.present);
    if (delta === 0) return 0;

    const prev = numberField(daySnap.get("attendance_present"));
    const next = prev + delta;
    const dayDelta = verifiedDriverDayDelta(prev, next);
    const now = FieldValue.serverTimestamp();
    tx.set(
      dayRef,
      {
        driver_id: input.driverId,
        day: input.day,
        month,
        zone_id: input.zoneId,
        partial: true,
        attendance_present: FieldValue.increment(delta),
        updated_at: now,
      },
      { merge: true },
    );
    tx.set(markerRef, { present: input.present, updated_at: now }, { merge: true });
    if (zoneRef && dayDelta !== 0) {
      tx.set(
        zoneRef,
        {
          zone_id: input.zoneId,
          month,
          partial: true,
          attendance_days: FieldValue.increment(dayDelta),
          updated_at: now,
        },
        { merge: true },
      );
    }
    return delta;
  });
}

export type RollupCountShape = {
  total: number;
  active: number;
  verified: number;
  pending: number;
  rejected: number;
  cancelled: number;
  under_review: number;
  in_progress: number;
  in_transit: number;
};

export function countsFromRollup(data: Record<string, unknown> | undefined): RollupCountShape | null {
  if (!data) return null;
  const verified = numberField(data.verified);
  const pending = numberField(data.pending);
  const inTransit = numberField(data.in_transit);
  const underReview = numberField(data.under_review);
  const rejected = numberField(data.rejected);
  const cancelled = numberField(data.cancelled);
  const inProgress = inTransit + pending + underReview;
  return {
    total: verified + pending + inTransit + underReview + rejected + cancelled,
    active: inTransit,
    verified,
    pending,
    rejected,
    cancelled,
    under_review: underReview,
    in_progress: inProgress,
    in_transit: inTransit,
  };
}

export async function readRollupCounts(
  db: Firestore,
  ref: { collection: string; id: string },
): Promise<RollupCountShape | null> {
  const snap = await db.collection(ref.collection).doc(ref.id).get();
  if (!snap.exists) return null;
  return countsFromRollup(snap.data() ?? {});
}

export async function overlayZoneMonthDocs(
  db: Firestore,
  from: string,
  to: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const month = singleCalendarMonth(from, to);
  if (!month || rows.length === 0) return;
  const probe = await db.collection(COLLECTIONS.rollupsZoneMonth).limit(1).get();
  if (probe.empty) return;

  const ids = [
    ...new Set(
      rows
        .map((row) => (typeof row.key === "string" ? row.key : null))
        .filter((id): id is string => Boolean(id) && id !== "—"),
    ),
  ];
  if (ids.length === 0) return;

  const snaps = await db.getAll(
    ...ids.map((id) => db.collection(COLLECTIONS.rollupsZoneMonth).doc(zoneMonthId(id, month))),
  );
  const byZone = new Map<string, Record<string, unknown>>();
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const zoneId = typeof snap.get("zone_id") === "string" ? (snap.get("zone_id") as string) : "";
    if (zoneId) byZone.set(zoneId, snap.data() ?? {});
  }

  for (const row of rows) {
    if (typeof row.key !== "string") continue;
    const data = byZone.get(row.key);
    if (!data) continue;
    const orders = numberField(data.orders);
    const days = numberField(data.verified_driver_days);
    row.orders = orders;
    row.working_days = days;
    row.dpd = days > 0 ? orders / days : null;
  }
}
