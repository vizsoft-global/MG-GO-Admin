import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import {
  AUTH_EPOCHS_DOC_ID,
  epochCounters,
  type EpochCounters,
  type EpochKind,
} from "@/lib/auth/epoch-cache";
import { COLLECTIONS } from "@/lib/firebase/db";

export type EpochWrite = {
  tx: Transaction;
  /** Claim that is already taken must not bump a counter. */
  skipEpoch: () => void;
};

/**
 * One transaction: the caller's writes, then FieldValue.increment(1) on each
 * named counter of auth_epochs/current. Reads inside `mutate` must happen
 * before its writes (Firestore rule). The epoch set runs after `mutate`.
 */
export type EpochWriteResult<T> = {
  result: T;
  epochs: EpochCounters;
};

/**
 * Same transaction as `writeWithEpoch`, plus the counters after this commit.
 * The epoch document is read before `mutate` writes (Firestore rule). The
 * returned numbers are that snapshot plus one for each kind this call bumps.
 */
export async function writeWithEpochCounters<T>(
  db: Firestore,
  kinds: EpochKind | readonly EpochKind[],
  mutate: (write: EpochWrite) => Promise<T> | T,
): Promise<EpochWriteResult<T>> {
  const list = (Array.isArray(kinds) ? kinds : [kinds]) as readonly EpochKind[];
  const epochRef = db.collection(COLLECTIONS.authEpochs).doc(AUTH_EPOCHS_DOC_ID);
  return db.runTransaction(async (tx) => {
    const epochSnap = await tx.get(epochRef);
    const epochs = epochCounters(
      epochSnap.exists ? (epochSnap.data() as Record<string, unknown> | undefined) : undefined,
    );
    let skip = false;
    const result = await mutate({
      tx,
      skipEpoch: () => {
        skip = true;
      },
    });
    if (!skip && list.length > 0) {
      const patch: Record<string, ReturnType<typeof FieldValue.increment>> = {};
      for (const kind of list) {
        patch[kind] = FieldValue.increment(1);
        epochs[kind] += 1;
      }
      tx.set(epochRef, patch, { merge: true });
    }
    return { result, epochs };
  });
}

export async function writeWithEpoch<T>(
  db: Firestore,
  kinds: EpochKind | readonly EpochKind[],
  mutate: (write: EpochWrite) => Promise<T> | T,
): Promise<T> {
  const written = await writeWithEpochCounters(db, kinds, mutate);
  return written.result;
}

/**
 * Counters a panel writer may bump outside a transaction.
 *
 * `config` has no reader on this side: it is the key the rider Cloud Functions
 * use for the delivery rules, incentive rules, tiers and banners they hold in
 * their isolate cache (`functions/src/core/config-cache.ts`). A panel writer
 * that edits any of those collections bumps this counter so the next rider Home
 * call rebuilds that cache instead of waiting for the 5 minute TTL.
 */
export type EpochCounterKey = EpochKind | "config";

/**
 * Standalone counter bump for a writer that is not already inside a transaction.
 * The data write and the counter are two commits on purpose: a failed bump must
 * not roll back a save the operator just made, and the TTL is the fallback.
 */
export async function bumpEpochs(
  db: Firestore,
  kinds: EpochCounterKey | readonly EpochCounterKey[],
): Promise<void> {
  const list = (Array.isArray(kinds) ? kinds : [kinds]) as readonly EpochCounterKey[];
  if (list.length === 0) return;
  const patch: Record<string, ReturnType<typeof FieldValue.increment>> = {};
  for (const kind of list) patch[kind] = FieldValue.increment(1);
  await db.collection(COLLECTIONS.authEpochs).doc(AUTH_EPOCHS_DOC_ID).set(patch, { merge: true });
  if (list.includes("config")) {
    await db
      .collection(COLLECTIONS.appSettings)
      .doc("1")
      .set({ config_epoch: FieldValue.increment(1) }, { merge: true })
      .catch(() => undefined);
  }
}
