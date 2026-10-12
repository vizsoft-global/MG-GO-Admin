import { APP_SETTINGS_DOC_ID, COLLECTIONS } from "@/lib/firebase/db";

/**
 * Isolate cache for role slugs, ticks, settings and menu.
 *
 * The epoch document is read before any cached value is used. A fill re-reads
 * the epoch in the same getAll as the data and stores the entry under THAT
 * epoch. A write that lands between those two reads is stored under the epoch
 * the fill actually observed, so a newer counter is never paired with older data.
 * The profile document is not stored here. Maintenance mode is not stored here.
 *
 * Every entry also expires after EPOCH_CACHE_MAX_TTL_MS even when the epoch
 * number is unchanged. Console edits, scripts, and imports never bump the
 * counter, and a grep of app code cannot see them.
 */

export const AUTH_EPOCHS_DOC_ID = "current";
export const SESSION_REVOKE_SKEW_MS = 5_000;
export const SETTINGS_CACHE_ID = "app_settings";
/** Hard cap. An unchanged epoch number must not keep a value forever. */
export const EPOCH_CACHE_MAX_TTL_MS = 5 * 60 * 1000;

export const EPOCH_KINDS = ["access", "settings", "menu"] as const;
export type EpochKind = (typeof EPOCH_KINDS)[number];

export type EpochCounters = { access: number; settings: number; menu: number };

export function emptyEpochs(): EpochCounters {
  return { access: 0, settings: 0, menu: 0 };
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function epochCounters(data: Record<string, unknown> | undefined): EpochCounters {
  return {
    access: numberOf(data?.access),
    settings: numberOf(data?.settings),
    menu: numberOf(data?.menu),
  };
}

export function millisOf(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "object") {
    const record = value as {
      toMillis?: () => number;
      seconds?: number;
      _seconds?: number;
    };
    if (typeof record.toMillis === "function") {
      const ms = record.toMillis();
      return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
    }
    const seconds = record.seconds ?? record._seconds;
    if (typeof seconds === "number" && Number.isFinite(seconds)) return seconds * 1000;
  }
  return null;
}

/** Reads tolerate 5s of clock skew. Missing timestamps do not reject. */
export function sessionRevokedForRead(
  authTimeMs: number | null,
  revokedAt: unknown,
): boolean {
  if (authTimeMs == null) return false;
  const revokedMs = millisOf(revokedAt);
  if (revokedMs == null) return false;
  return authTimeMs < revokedMs - SESSION_REVOKE_SKEW_MS;
}

/** Mutations reject any session whose auth_time is strictly before revocation. */
export function sessionRevokedForMutation(
  authTimeMs: number | null,
  revokedAt: unknown,
): boolean {
  if (authTimeMs == null) return false;
  const revokedMs = millisOf(revokedAt);
  if (revokedMs == null) return false;
  return authTimeMs < revokedMs;
}

export type DocSnap = {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
};

export type DocRef = {
  id: string;
  path: string;
  get(): Promise<DocSnap>;
};

export type EpochReader = {
  collection(name: string): { doc(id: string): DocRef };
  getAll(...refs: DocRef[]): Promise<DocSnap[]>;
};

/**
 * Firestore.getAll also accepts a ReadOptions rest argument, so the Admin SDK
 * handle is not structurally a DocRef-only getAll. Callers still pass refs only.
 */
export function asEpochReader(db: {
  collection(name: string): {
    doc(id: string): { id: string; path: string; get(): Promise<DocSnap> };
  };
  getAll(...refs: never[]): Promise<DocSnap[]>;
}): EpochReader {
  return db as EpochReader;
}

export type CachedDoc = {
  exists: boolean;
  data: Record<string, unknown> | undefined;
};

type CacheBox = { epoch: number; storedAt: number; doc: CachedDoc };

export type EpochCache = {
  get(kind: EpochKind, id: string, epoch: number): CachedDoc | undefined;
  set(kind: EpochKind, id: string, epoch: number, doc: CachedDoc): void;
  snapshot(): Array<{ kind: EpochKind; id: string; epoch: number; doc: CachedDoc }>;
};

export function createEpochCache(now: () => number = Date.now): EpochCache {
  const maps: Record<EpochKind, Map<string, CacheBox>> = {
    access: new Map(),
    settings: new Map(),
    menu: new Map(),
  };
  return {
    get(kind, id, epoch) {
      const box = maps[kind].get(id);
      if (!box || box.epoch !== epoch) return undefined;
      if (now() - box.storedAt >= EPOCH_CACHE_MAX_TTL_MS) {
        maps[kind].delete(id);
        return undefined;
      }
      return box.doc;
    },
    set(kind, id, epoch, doc) {
      maps[kind].set(id, { epoch, storedAt: now(), doc });
    },
    snapshot() {
      const out: Array<{ kind: EpochKind; id: string; epoch: number; doc: CachedDoc }> = [];
      for (const kind of EPOCH_KINDS) {
        for (const [id, box] of maps[kind]) {
          out.push({ kind, id, epoch: box.epoch, doc: box.doc });
        }
      }
      return out;
    },
  };
}

let singleton: EpochCache | null = null;

export function getEpochCache(): EpochCache {
  singleton ??= createEpochCache();
  return singleton;
}

export function clearEpochCache(): void {
  singleton = createEpochCache();
}

function snapToDoc(snap: DocSnap | undefined): CachedDoc {
  if (!snap?.exists) return { exists: false, data: undefined };
  return { exists: true, data: snap.data() };
}

/**
 * Epoch document is the first getAll argument. The stored key is the epoch
 * from that snapshot, not `seenEpoch` from an earlier read.
 */
export async function readEpochAndDocs(
  db: EpochReader,
  cache: EpochCache,
  kind: EpochKind,
  seenEpoch: number,
  docs: ReadonlyArray<{ id: string; ref: DocRef }>,
): Promise<{ epoch: EpochCounters; hit: boolean; values: CachedDoc[] }> {
  if (docs.length > 0 && docs.every((doc) => cache.get(kind, doc.id, seenEpoch))) {
    return {
      epoch: { ...emptyEpochs(), [kind]: seenEpoch },
      hit: true,
      values: docs.map((doc) => cache.get(kind, doc.id, seenEpoch)!),
    };
  }

  const epochRef = db.collection(COLLECTIONS.authEpochs).doc(AUTH_EPOCHS_DOC_ID);
  const snaps = await db.getAll(epochRef, ...docs.map((doc) => doc.ref));
  const epoch = epochCounters(snaps[0]?.exists ? snaps[0].data() : undefined);
  const fillEpoch = epoch[kind];
  const values = docs.map((_, index) => snapToDoc(snaps[index + 1]));
  docs.forEach((doc, index) => {
    cache.set(kind, doc.id, fillEpoch, values[index]!);
  });
  return { epoch, hit: false, values };
}

/**
 * Settings cache never stores `maintenance_mode`. An unclaimed super admin
 * (`super_admin_claimed !== true`) is not stored at all.
 * `seenEpoch` null skips the hit path so a caller that has not read the epoch
 * yet cannot reuse an entry from a previous counter.
 */
export async function readEpochSettings(
  db: EpochReader,
  cache: EpochCache,
  seenEpoch: number | null,
): Promise<Record<string, unknown> | null> {
  if (seenEpoch != null) {
    const cached = cache.get("settings", SETTINGS_CACHE_ID, seenEpoch);
    if (cached?.exists && cached.data?.super_admin_claimed === true) {
      return cached.data;
    }
  }

  const epochRef = db.collection(COLLECTIONS.authEpochs).doc(AUTH_EPOCHS_DOC_ID);
  const settingsRef = db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID);
  const snaps = await db.getAll(epochRef, settingsRef);
  const epoch = epochCounters(snaps[0]?.exists ? snaps[0].data() : undefined);
  const data = snaps[1]?.exists ? snaps[1].data() : undefined;
  if (!data) return null;
  if (data.super_admin_claimed === true) {
    const stored = { ...data };
    delete stored.maintenance_mode;
    cache.set("settings", SETTINGS_CACHE_ID, epoch.settings, { exists: true, data: stored });
  }
  return data;
}

/** Epoch read, then the query. The cache key is the epoch from that read. */
export async function readEpochQuery<T>(
  db: EpochReader,
  cache: EpochCache,
  kind: EpochKind,
  cacheId: string,
  seenEpoch: number | null,
  load: () => Promise<T>,
): Promise<T> {
  if (seenEpoch != null) {
    const cached = cache.get(kind, cacheId, seenEpoch);
    const value = cached?.data?.value;
    if (cached?.exists && value !== undefined) {
      return value as T;
    }
  }

  const epochRef = db.collection(COLLECTIONS.authEpochs).doc(AUTH_EPOCHS_DOC_ID);
  const [epochSnap] = await db.getAll(epochRef);
  const epoch = epochCounters(epochSnap?.exists ? epochSnap.data() : undefined);
  const value = await load();
  cache.set(kind, cacheId, epoch[kind], {
    exists: true,
    data: { value: value as unknown },
  });
  return value;
}
