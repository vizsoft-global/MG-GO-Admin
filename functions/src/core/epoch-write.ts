import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";

const EPOCH_COLLECTION = "auth_epochs";
const EPOCH_DOC_ID = "current";

export type EpochKind = "access" | "settings" | "menu" | "config";

export type EpochWrite = {
  tx: Transaction;
};

function incrementPatch(
  kinds: readonly EpochKind[],
): Record<string, ReturnType<typeof FieldValue.increment>> {
  const patch: Record<string, ReturnType<typeof FieldValue.increment>> = {};
  for (const kind of kinds) patch[kind] = FieldValue.increment(1);
  return patch;
}

/**
 * Standalone counter bump for a writer that is not a transaction.
 *
 * Delivery/incentive rule saves already run inside their own `WriteBatch`, and
 * folding them into one `runTransaction` would change what a partially failed
 * save leaves behind. The counter therefore moves in its own write right after
 * the data lands: the config cache then drops the old fleet-wide copy on the
 * next call instead of waiting for the TTL safety net.
 */
export async function bumpEpoch(
  db: Firestore,
  kinds: EpochKind | readonly EpochKind[],
): Promise<void> {
  const list = (Array.isArray(kinds) ? kinds : [kinds]) as readonly EpochKind[];
  if (list.length === 0) return;
  await db
    .collection(EPOCH_COLLECTION)
    .doc(EPOCH_DOC_ID)
    .set(incrementPatch(list), { merge: true });
  if (list.includes("config")) await bumpRiderConfigEpoch(db);
}

/**
 * Riders cannot read `auth_epochs`, but every phone already listens to
 * `app_settings/1`. Mirroring the config counter there is how a fleet-wide rule
 * change reaches the app without each phone polling for it.
 */
export async function bumpRiderConfigEpoch(db: Firestore): Promise<void> {
  await db
    .collection("app_settings")
    .doc("1")
    .set({ config_epoch: FieldValue.increment(1) }, { merge: true })
    .catch(() => undefined);
}

/**
 * One transaction: the caller's writes, then FieldValue.increment(1) on each
 * named counter of auth_epochs/current. Mirrors Next writeWithEpoch. Reads
 * inside `mutate` must happen before its writes. The epoch set runs after.
 */
export async function writeWithEpoch<T>(
  db: Firestore,
  kinds: EpochKind | readonly EpochKind[],
  mutate: (write: EpochWrite) => Promise<T> | T,
): Promise<T> {
  const list = (Array.isArray(kinds) ? kinds : [kinds]) as readonly EpochKind[];
  const epochRef = db.collection(EPOCH_COLLECTION).doc(EPOCH_DOC_ID);
  const result = await db.runTransaction(async (tx) => {
    const value = await mutate({ tx });
    if (list.length > 0) {
      tx.set(epochRef, incrementPatch(list), { merge: true });
    }
    return value;
  });
  if (list.includes("config")) await bumpRiderConfigEpoch(db);
  return result;
}
