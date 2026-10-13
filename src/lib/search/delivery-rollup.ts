import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "../firebase/db";

const ROLLUP_STATUSES = [
  "verified",
  "pending",
  "in_transit",
  "under_review",
  "rejected",
  "cancelled",
] as const;

type RollupStatus = (typeof ROLLUP_STATUSES)[number];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRollupStatus(value: string): value is RollupStatus {
  return (ROLLUP_STATUSES as readonly string[]).includes(value);
}

export function deliveryStatusDelta(
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

function verifiedDriverDayDelta(previousVerified: number, nextVerified: number): number {
  if (previousVerified <= 0 && nextVerified > 0) return 1;
  if (previousVerified > 0 && nextVerified <= 0) return -1;
  return 0;
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

  const dayRef = db.collection(COLLECTIONS.rollupsDriverDay).doc(`${input.driverId}_${input.day}`);
  const markerRef = dayRef.collection("applied").doc(input.deliveryId);
  const month = input.day.slice(0, 7);
  const zoneRef = input.zoneId
    ? db.collection(COLLECTIONS.rollupsZoneMonth).doc(`${input.zoneId}_${month}`)
    : null;

  return db.runTransaction(async (tx) => {
    const [daySnap, markerSnap] = await Promise.all([tx.get(dayRef), tx.get(markerRef)]);
    const previous =
      markerSnap.exists && typeof markerSnap.get("status") === "string"
        ? (markerSnap.get("status") as string)
        : null;
    const delta = deliveryStatusDelta(previous, input.status);
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
