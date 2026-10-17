/**
 * Reconcile of the Bites mirrors.
 *
 * The inline pushes in `catalogs.ts` and `drivers-admin.ts` only cover writes made
 * through those RPCs, and the Firestore triggers that would have covered the rest
 * cannot deploy: the live database is in me-central2, where this project's agreement
 * blocks compute. So the net under both is here — a full pass over the delivery
 * side's own rows, run on demand by `adminBackfillBitesMirror` and on a schedule by
 * `bitesMirrorSweep` in `bites-reconcile.ts`.
 *
 * `syncRestaurantMirror` also refreshes the store→rider link and the rider's name
 * and number, so the restaurant pass rebuilds both mirrors and nothing else has to
 * be scanned. The orphan sweep is the one thing a push cannot do, because a caller
 * only ever names rows that still exist.
 */
import { onCall } from "firebase-functions/v2/https";
import { BITES_MIRROR_COLLECTIONS, getBitesFirestore } from "../core/bites";
import { getFirestore, type Firestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { requireStaff } from "../core/staff";
import { pushRestaurantMirror } from "./bites-mirror";

/** Bounded so one call cannot run past the light lane's 60s timeout. */
const MAX_ROWS = 2_000;
const CONCURRENCY = 10;

export type BitesReconcileCounts = {
  scanned: number;
  pushed: number;
  orphans: number;
  /**
   * The catalogue scan hit its cap, so the sweep did not see every restaurant and
   * must not delete anything: a live restaurant would look like an orphan.
   */
  truncated: boolean;
};

async function pushAll(
  db: Firestore,
  ids: readonly string[],
  push: (id: string) => Promise<boolean>,
): Promise<number> {
  let pushed = 0;
  for (let index = 0; index < ids.length; index += CONCURRENCY) {
    const results = await Promise.all(
      ids.slice(index, index + CONCURRENCY).map((id) => push(id)),
    );
    pushed += results.filter(Boolean).length;
  }
  return pushed;
}

/**
 * Drops mirror rows whose restaurant no longer exists.
 *
 * The caller passes a *complete* set of live ids: with the catalogue scan truncated,
 * a live restaurant would look like an orphan and its panel row and rider link would
 * be deleted.
 */
async function deleteOrphanMirrors(
  liveIds: readonly string[],
  bites: Firestore,
): Promise<number> {
  const snap = await bites
    .collection(BITES_MIRROR_COLLECTIONS.restaurants)
    .limit(MAX_ROWS)
    .get();
  const live = new Set(liveIds);
  const orphans = snap.docs.filter((doc) => !live.has(doc.id));
  if (orphans.length === 0) return 0;

  const batch = bites.batch();
  for (const doc of orphans) {
    batch.delete(doc.ref);
    batch.delete(bites.collection(BITES_MIRROR_COLLECTIONS.partnerLinks).doc(doc.id));
  }
  await batch.commit();
  return orphans.length;
}

/**
 * One full reconcile: push every restaurant, then clear the orphans.
 *
 * `bites` is injectable for tests. Nothing here requires a staff caller, so the
 * scheduled sweep shares it with the callable rather than the sweep calling back
 * into the callable and needing credentials it does not have.
 */
export async function reconcileBitesMirrorCore(
  db: Firestore,
  at: Date = new Date(),
  bites: Firestore = getBitesFirestore(),
): Promise<BitesReconcileCounts> {
  const snap = await db.collection(COLLECTIONS.restaurants).limit(MAX_ROWS).get();
  const ids = snap.docs.map((doc) => doc.id);
  const pushed = await pushAll(db, ids, (id) => pushRestaurantMirror(db, id, at, bites));

  // The next pass picks up the tail once the catalogue grows past the cap.
  const truncated = snap.size >= MAX_ROWS;
  const orphans = truncated ? 0 : await deleteOrphanMirrors(ids, bites);

  return { scanned: snap.size, pushed, orphans, truncated };
}

export const adminBackfillBitesMirror = onCall(async (request) => {
  await requireStaff(request, "restaurants.manage");
  const counts = await reconcileBitesMirrorCore(getFirestore());
  return {
    ok: true,
    restaurants: { scanned: counts.scanned, pushed: counts.pushed },
    orphans: counts.orphans,
    truncated: counts.truncated,
  };
});
