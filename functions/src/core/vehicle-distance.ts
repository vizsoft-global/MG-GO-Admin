/**
 * The bike distance ledger.
 *
 * A bike has no dependable odometer feed yet, so the fallback is our own GPS:
 * `driver_locations.distance_today_meters` is the rider's cumulative distance for
 * the Kuwait day. It is a **ledger**, not an odometer — GPS under-reads indoors
 * and in tunnels, over-reads on scatter, and drifts from the bike's own meter
 * every month — which is why it is stored beside the rider-entered figure and
 * never added to it.
 *
 * One document per vehicle per day: `vehicle_day_distance/{vehicleId}_{day}`.
 * Each clock-out appends the delta for that **session**, keyed by the session id,
 * so a retried checkout cannot double count. `by_driver` and `total_meters` are
 * the sum over every assignment that day, which is the client's "reflect all
 * relevant assignments" rule.
 */
import type { Firestore } from "./fs";

export const VEHICLE_DAY_DISTANCE = "vehicle_day_distance";

export function vehicleDayDistanceId(vehicleId: string, day: string): string {
  return `${vehicleId}_${day}`;
}

type SessionMap = Record<string, number>;
type DriverMap = Record<string, number>;

function metres(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export type DistanceLedgerPlan = {
  id: string;
  vehicleId: string;
  day: string;
  sessionId: string;
  /** Metres added by this call; 0 when the session was already recorded. */
  deltaMeters: number;
  /** The day's total after this call. */
  totalMeters: number;
  byDriver: DriverMap;
  sessions: SessionMap;
  /** True when nothing changed and no write is needed. */
  noop: boolean;
};

/**
 * Append one session's metres to a day's ledger.
 *
 * Pure, so the two rules that matter can be tested without a database: a session
 * already in the ledger contributes **nothing** (a retried checkout cannot double
 * count), and the delta is `cumulative − everything already recorded`, clamped at
 * zero so a lost GPS fix that shrinks the figure cannot subtract kilometres.
 */
export function appendDistanceSession(
  existing: { totalMeters?: number | null; byDriver?: Record<string, unknown> | null; sessions?: Record<string, unknown> | null },
  input: { driverId: string; sessionId: string; distanceTodayMeters: number },
): {
  sessionId: string;
  deltaMeters: number;
  totalMeters: number;
  byDriver: DriverMap;
  sessions: SessionMap;
  alreadyRecorded: boolean;
} {
  const sessions: SessionMap = {};
  for (const [key, value] of Object.entries(existing.sessions ?? {})) {
    sessions[key] = metres(value);
  }
  const byDriver: DriverMap = {};
  for (const [key, value] of Object.entries(existing.byDriver ?? {})) {
    byDriver[key] = metres(value);
  }

  const alreadyRecorded = sessions[input.sessionId] != null;
  // The delta is measured per **driver**, because `distance_today_meters` is one
  // rider's cumulative figure for the day. Measuring it against the whole vehicle
  // total would make a second rider on the same bike contribute nothing.
  const recordedForDriver = byDriver[input.driverId] ?? 0;
  const cumulative = metres(input.distanceTodayMeters);
  const deltaMeters = alreadyRecorded ? 0 : Math.max(0, cumulative - recordedForDriver);

  if (!alreadyRecorded) sessions[input.sessionId] = deltaMeters;
  if (deltaMeters > 0) byDriver[input.driverId] = recordedForDriver + deltaMeters;

  return {
    sessionId: input.sessionId,
    deltaMeters,
    totalMeters: Object.values(sessions).reduce((sum, value) => sum + value, 0),
    byDriver,
    sessions,
    alreadyRecorded,
  };
}

/**
 * Work out the write for one clock-out, reading today's row first.
 *
 * `distanceTodayMeters` is the rider's cumulative figure for the day, so the
 * delta this session owns is `cumulative − everything already recorded for this
 * vehicle today`.
 */
export async function planVehicleDayDistance(
  db: Firestore,
  input: {
    vehicleId: string;
    driverId: string;
    day: string;
    sessionId: string;
    distanceTodayMeters: number;
  },
): Promise<DistanceLedgerPlan> {
  const id = vehicleDayDistanceId(input.vehicleId, input.day);
  const snap = await db.collection(VEHICLE_DAY_DISTANCE).doc(id).get();
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const appended = appendDistanceSession(
    {
      totalMeters: data["total_meters"] as number | null | undefined,
      byDriver: (data["by_driver"] ?? null) as Record<string, unknown> | null,
      sessions: (data["sessions"] ?? null) as Record<string, unknown> | null,
    },
    input,
  );

  return {
    id,
    vehicleId: input.vehicleId,
    day: input.day,
    sessionId: appended.sessionId,
    deltaMeters: appended.deltaMeters,
    totalMeters: appended.totalMeters,
    byDriver: appended.byDriver,
    sessions: appended.sessions,
    // Nothing to write when the session was already counted and the total did
    // not move.
    noop:
      appended.alreadyRecorded && appended.totalMeters === metres(data["total_meters"]),
  };
}
