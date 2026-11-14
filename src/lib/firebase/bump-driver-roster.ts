/**
 * Drop the stored Employees roster after a direct panel write.
 *
 * The Employees list is cut from a roster the scan lane keeps in
 * `page_read_snapshots` (`functions/src/router/roster-snapshot.ts`), valid for
 * one generation of `page_read_generations/current`. Cloud Functions that
 * change a roster row call `bumpDriverRoster()` in
 * `functions/src/router/read-snapshot.ts`; a server action that writes Firestore
 * itself has to move the same counters, or its edit waits for the time limit.
 *
 * The three names are the stored roster and the two per-arguments results cut
 * from it. They must stay equal to `DRIVER_ROSTER_SNAPSHOTS` on the functions
 * side; `bump-driver-roster.test.ts` fails if they drift.
 *
 * One document write, whatever was changed: call it once per action, after the
 * loop. A failure never fails the action — the time limit still applies.
 */
import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { getFirebaseFirestore } from "@/lib/firebase/admin";

const PAGE_READ_GENERATIONS = "page_read_generations";

export const DRIVER_ROSTER_SNAPSHOTS = [
  "driverRosterBase",
  "adminListDriversPage",
  "adminDriversFilterValues",
] as const;

/**
 * Run a server action, then bump. The bump follows a returned `{ error }` too:
 * an action can fail after some of its writes have landed. It does not follow a
 * throw.
 */
export async function withDriverRosterBump<T>(run: () => Promise<T>): Promise<T> {
  const result = await run();
  try {
    const db = await getFirebaseFirestore();
    if (db) await bumpDriverRoster(db);
  } catch {
    // Missing Admin SDK config must not turn a finished action into a failure.
  }
  return result;
}

export async function bumpDriverRoster(db: Firestore): Promise<void> {
  try {
    const patch: Record<string, unknown> = { updated_at: FieldValue.serverTimestamp() };
    for (const name of DRIVER_ROSTER_SNAPSHOTS) patch[name] = FieldValue.increment(1);
    await db.collection(PAGE_READ_GENERATIONS).doc("current").set(patch, { merge: true });
  } catch {
    // The stored roster's own time limit still expires the stale copy.
  }
}
