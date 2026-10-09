import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { getFirebaseFirestore } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/db";

async function commitUpdates(
  db: Firestore,
  refs: DocumentReference[],
  patch: Record<string, unknown>,
): Promise<void> {
  for (let index = 0; index < refs.length; index += 400) {
    const batch = db.batch();
    for (const ref of refs.slice(index, index + 400)) {
      batch.update(ref, patch);
    }
    await batch.commit();
  }
}

/** Keep profiles.avatar_url, drivers.avatar_object_key, and linked intake in lockstep. */
export async function syncDriverAvatarKey(
  driverId: string,
  objectKey: string | null,
): Promise<void> {
  const now = new Date();
  const key = objectKey?.trim() || null;

  try {
    const db = await getFirebaseFirestore();
    if (!db) return;

    const driverRef = db.collection(COLLECTIONS.drivers).doc(driverId);
    const profileRef = db.collection(COLLECTIONS.profiles).doc(driverId);
    const [driverSnap, profileSnap, intakes] = await Promise.all([
      driverRef.get(),
      profileRef.get(),
      db.collection(COLLECTIONS.driverIntakes).where("linked_profile_id", "==", driverId).get(),
    ]);

    const driverPatch = {
      avatar_object_key: key,
      avatar_updated_at: now,
      updated_at: now,
    };
    const avatarPatch = { avatar_url: key, updated_at: now };
    const writes: Array<Promise<unknown>> = [];
    if (driverSnap.exists) writes.push(driverRef.update(driverPatch));
    if (profileSnap.exists) writes.push(profileRef.update(avatarPatch));
    if (!intakes.empty) {
      writes.push(commitUpdates(db, intakes.docs.map((doc) => doc.ref), avatarPatch));
    }
    await Promise.all(writes);
  } catch {
    // Missing Admin SDK config must not crash the Edit Driver server action.
  }
}
