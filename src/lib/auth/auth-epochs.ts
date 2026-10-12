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
