import { getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { COLLECTIONS } from "./collections";
import { BACKFILL_BATCH, type ApplyWrite, type AttendanceFact, type DeliveryFact, type StoredDoc } from "./backfill-plan";

const PAGE = 500;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const SEARCH_COLLECTIONS = [
  COLLECTIONS.drivers,
  COLLECTIONS.driverIntakes,
  COLLECTIONS.requests,
  COLLECTIONS.restaurants,
  COLLECTIONS.deliveryRules,
  COLLECTIONS.incentiveRules,
  COLLECTIONS.deliveries,
] as const;

/**
 * Emulator traffic uses the emulator's `(default)` database.
 * Production traffic uses the named `default` database in me-central2.
 */
export function openApplyFirestore(): Firestore {
  const app = getApps()[0] ?? initializeApp({
    projectId: process.env.GCLOUD_PROJECT || "musallam-delivery-prod",
  });
  if (process.env.FIRESTORE_EMULATOR_HOST) return getFirestore(app);
  return getFirestore(app, "default");
}

export async function commitApplyBatch(db: Firestore, rows: readonly ApplyWrite[]): Promise<void> {
  if (rows.length === 0) return;
  if (rows.length > BACKFILL_BATCH) throw new Error("batch_too_large");
  const batch = db.batch();
  for (const row of rows) {
    const ref = db.doc(row.path);
    if (row.merge) batch.set(ref, row.data, { merge: true });
    else batch.set(ref, row.data);
  }
  await batch.commit();
}

function asRecord(data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null) return {};
  return data as Record<string, unknown>;
}

/** Non-archived drivers only. A missing id means the delivery is left out of the rollup. */
export function driverZoneMap(
  drivers: readonly { id: string; data: Record<string, unknown> }[],
): Map<string, string | null> {
  const zones = new Map<string, string | null>();
  for (const driver of drivers) {
    if (driver.data.archived_at != null) continue;
    const zone = driver.data.zone_id;
    zones.set(driver.id, typeof zone === "string" && zone.length > 0 ? zone : null);
  }
  return zones;
}

/**
 * Rollup zone is the driver's zone. The performance snapshot counts the same way.
 * A delivery `zone_id` is ignored so the backfill does not move a rider's orders.
 */
export function deliveryFactFromData(
  id: string,
  data: Record<string, unknown>,
  driverZoneById: ReadonlyMap<string, string | null>,
): DeliveryFact | null {
  const driverId = typeof data.driver_id === "string" ? data.driver_id : "";
  if (!driverId || !driverZoneById.has(driverId)) return null;
  const day = typeof data.shift_date === "string" ? data.shift_date : "";
  if (!DAY_RE.test(day)) return null;
  const status = typeof data.status === "string" ? data.status : "";
  return { id, driverId, zoneId: driverZoneById.get(driverId) ?? null, day, status };
}

export function attendanceFactFromData(
  id: string,
  data: Record<string, unknown>,
  driverZoneById: ReadonlyMap<string, string | null>,
): AttendanceFact | null {
  if (data.status !== "present") return null;
  const driverId = typeof data.driver_id === "string" ? data.driver_id : "";
  if (!driverId || !driverZoneById.has(driverId)) return null;
  const day = typeof data.log_date === "string" ? data.log_date : "";
  if (!DAY_RE.test(day)) return null;
  return { id, driverId, zoneId: driverZoneById.get(driverId) ?? null, day, present: true };
}

async function pageDocs(
  db: Firestore,
  collection: string,
  onPage: (docs: QueryDocumentSnapshot[]) => void,
): Promise<void> {
  let last: QueryDocumentSnapshot | null = null;
  for (;;) {
    let query = db.collection(collection).orderBy(FieldPath.documentId()).limit(PAGE);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    if (snap.empty) break;
    onPage(snap.docs);
    last = snap.docs[snap.docs.length - 1] ?? null;
    if (snap.size < PAGE) break;
  }
}

export async function loadProductionApplyInput(db: Firestore): Promise<{
  deliveries: DeliveryFact[];
  attendance: AttendanceFact[];
  searchDocs: StoredDoc[];
}> {
  const driverRows: { id: string; data: Record<string, unknown> }[] = [];
  await pageDocs(db, COLLECTIONS.drivers, (docs) => {
    for (const doc of docs) driverRows.push({ id: doc.id, data: asRecord(doc.data()) });
  });
  const driverZoneById = driverZoneMap(driverRows);

  const deliveries: DeliveryFact[] = [];
  const searchDocs: StoredDoc[] = driverRows
    .filter((row) => row.data.archived_at == null)
    .map((row) => ({ collection: COLLECTIONS.drivers, id: row.id, data: row.data }));

  await pageDocs(db, COLLECTIONS.deliveries, (docs) => {
    for (const doc of docs) {
      const data = asRecord(doc.data());
      searchDocs.push({ collection: COLLECTIONS.deliveries, id: doc.id, data });
      const fact = deliveryFactFromData(doc.id, data, driverZoneById);
      if (fact) deliveries.push(fact);
    }
  });

  const attendance: AttendanceFact[] = [];
  await pageDocs(db, COLLECTIONS.attendanceLogs, (docs) => {
    for (const doc of docs) {
      const fact = attendanceFactFromData(doc.id, asRecord(doc.data()), driverZoneById);
      if (fact) attendance.push(fact);
    }
  });

  for (const collection of SEARCH_COLLECTIONS) {
    if (collection === COLLECTIONS.drivers || collection === COLLECTIONS.deliveries) continue;
    await pageDocs(db, collection, (docs) => {
      for (const doc of docs) {
        searchDocs.push({ collection, id: doc.id, data: asRecord(doc.data()) });
      }
    });
  }

  return { deliveries, attendance, searchDocs };
}
