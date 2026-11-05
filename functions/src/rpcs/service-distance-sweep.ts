/**
 * The nightly bike-distance catch-up.
 *
 * A rider who never clocks out leaves no ledger row, so the day's GPS distance
 * would vanish from `/fleet/service/bikes`. This sweep runs late in the Kuwait
 * evening, one pass, and records the same row a checkout would have written —
 * under its own session key, so a rider who *does* clock out at 23:50 is not
 * counted twice.
 *
 * It only ever adds to `vehicle_day_distance`; it never touches the odometer,
 * because GPS distance is not an odometer reading.
 */
import "firebase-functions";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { FUNCTIONS_REGION } from "../router/lanes";
import { planVehicleDayDistance, VEHICLE_DAY_DISTANCE } from "../core/vehicle-distance";

/** 23:45 Kuwait — after the evening shift, before the day rolls over. */
export const SERVICE_DISTANCE_SCHEDULE = "45 23 * * *";

const KUWAIT_TZ = "Asia/Kuwait";

function kuwaitDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KUWAIT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function metres(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export const serviceVehicleDistanceSweep = onSchedule(
  {
    schedule: SERVICE_DISTANCE_SCHEDULE,
    timeZone: KUWAIT_TZ,
    region: FUNCTIONS_REGION,
    timeoutSeconds: 540,
    memory: "1GiB",
    cpu: 1,
    concurrency: 1,
    maxInstances: 1,
    retryCount: 0,
  },
  async () => {
    const db = getFirestore();
    const now = new Date();
    const day = kuwaitDay(now);
    let scanned = 0;
    let written = 0;
    let skipped = 0;

    try {
      // Only riders holding a vehicle can contribute a distance row.
      const drivers = await db.collection(COLLECTIONS.drivers).get();
      const assigned: { driverId: string; vehicleId: string }[] = [];
      for (const doc of drivers.docs) {
        const row = doc.data();
        if (row.archived_at) continue;
        const vehicleId = typeof row.vehicle_id === "string" ? row.vehicle_id.trim() : "";
        if (!vehicleId) continue;
        assigned.push({ driverId: doc.id, vehicleId });
      }

      const locations = new Map<string, Record<string, unknown>>();
      for (let i = 0; i < assigned.length; i += 100) {
        const slice = assigned.slice(i, i + 100);
        const refs = slice.map((entry) =>
          db.collection(COLLECTIONS.driverLocations).doc(entry.driverId),
        );
        const snaps = await db.getAll(...refs);
        for (const snap of snaps) {
          if (snap.exists) locations.set(snap.id, snap.data() ?? {});
        }
      }

      for (const entry of assigned) {
        scanned += 1;
        const location = locations.get(entry.driverId);
        const distance = metres(location?.["distance_today_meters"]);
        if (distance <= 0) {
          skipped += 1;
          continue;
        }
        const plan = await planVehicleDayDistance(db, {
          vehicleId: entry.vehicleId,
          driverId: entry.driverId,
          day,
          // Its own key: a real checkout under the session id still counts
          // separately, so neither can consume the other's metres.
          sessionId: `sweep:${day}:${entry.driverId}`,
          distanceTodayMeters: distance,
        });
        if (plan.noop) {
          skipped += 1;
          continue;
        }
        await db
          .collection(VEHICLE_DAY_DISTANCE)
          .doc(plan.id)
          .set(
            {
              id: plan.id,
              vehicle_id: plan.vehicleId,
              day: plan.day,
              total_meters: plan.totalMeters,
              by_driver: plan.byDriver,
              sessions: plan.sessions,
              gps_ledger_km: Math.round(plan.totalMeters / 1000),
              updated_at: now,
            },
            { merge: true },
          );
        written += 1;
      }

      logger.info("service vehicle distance sweep", { day, scanned, written, skipped });
    } catch (error) {
      logger.error("service vehicle distance sweep failed", { day, error });
    }
  },
);
