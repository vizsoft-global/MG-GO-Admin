/**
 * Isolate cache for fleet-wide, rarely-changing configuration.
 *
 * The problem this solves: a single `driverGetHomeDashboard` call re-read a
 * fleet-wide collection (delivery rules, their scopes, incentive rules, their
 * scopes and tiers, home banners) on every request — thousands of document
 * reads for data that changes a few times a week. Every rider paid that price
 * on every Home refresh.
 *
 * The epoch document is the primary invalidation signal and the entry TTL is
 * only a safety net, because console edits, scripts and imports never bump a
 * counter. A miss stores the value under the counter it actually observed in
 * the same round trip, so a write landing mid-fill can never pair a newer
 * counter with older data.
 *
 * Mirrors `src/lib/auth/epoch-cache.ts` on the panel side: same document, same
 * "epoch first, then the value" ordering. The difference is that a caller here
 * reads the epoch once and shares the number with every cache it owns, so a
 * Home call costs one extra read for the epoch instead of one per collection.
 */
import { COLLECTIONS } from "./collections";
import { getFirestore, type Firestore } from "./fs";

export const AUTH_EPOCHS_DOC_ID = "current";

/** Hard cap. An unchanged epoch number must not keep a value forever. */
export const CONFIG_CACHE_MAX_TTL_MS = 5 * 60 * 1000;

/** Guard against unbounded per-isolate growth in `driver_attendance`-style keys. */
export const CONFIG_CACHE_MAX_KEYS = 500;

export const CONFIG_EPOCH_KINDS = ["access", "settings", "menu", "config"] as const;

export type ConfigEpochKind = (typeof CONFIG_EPOCH_KINDS)[number];

export type ConfigEpochs = {
  access: number;
  settings: number;
  menu: number;
  config: number;
};

export function emptyConfigEpochs(): ConfigEpochs {
  return { access: 0, settings: 0, menu: 0, config: 0 };
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function configEpochs(data: Record<string, unknown> | undefined): ConfigEpochs {
  return {
    access: numberOf(data?.access),
    settings: numberOf(data?.settings),
    menu: numberOf(data?.menu),
    config: numberOf(data?.config),
  };
}

/** One document read. Callers that own several caches read this once and share it. */
export async function readConfigEpochs(db: Firestore = getFirestore()): Promise<ConfigEpochs> {
  const snap = await db.collection(COLLECTIONS.authEpochs).doc(AUTH_EPOCHS_DOC_ID).get();
  return configEpochs(snap.exists ? snap.data() : undefined);
}

export type ConfigCacheEntry<T> = { epoch: number; at: number; value: T };

export type KeyedEpochCache<T> = {
  /** Cached value for this key when the observed epoch matches and the TTL holds. */
  peek(key: string, epoch: number): T | undefined;
  get(key: string, epoch: number, load: () => Promise<T>): Promise<T>;
  clear(key?: string): void;
  size(): number;
};

export type KeyedEpochCacheOptions = {
  ttlMs?: number;
  maxKeys?: number;
  now?: () => number;
};

export function createKeyedEpochCache<T>(
  options: KeyedEpochCacheOptions = {},
): KeyedEpochCache<T> {
  const ttlMs = options.ttlMs ?? CONFIG_CACHE_MAX_TTL_MS;
  const maxKeys = options.maxKeys ?? CONFIG_CACHE_MAX_KEYS;
  const now = options.now ?? Date.now;
  const entries = new Map<string, ConfigCacheEntry<T>>();
  /** Two requests in one instance asking for the same key share one fill. */
  const inflight = new Map<string, { epoch: number; promise: Promise<T> }>();

  function fresh(key: string, epoch: number): ConfigCacheEntry<T> | undefined {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.epoch !== epoch) return undefined;
    if (now() - entry.at >= ttlMs) return undefined;
    return entry;
  }

  function store(key: string, epoch: number, value: T): T {
    // Re-insert so the eviction guard drops the coldest key, not this one.
    entries.delete(key);
    entries.set(key, { epoch, at: now(), value });
    while (entries.size > maxKeys) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
    return value;
  }

  return {
    peek(key, epoch) {
      return fresh(key, epoch)?.value;
    },
    get(key, epoch, load) {
      const hit = fresh(key, epoch);
      if (hit) {
        // Refresh the insertion order so the eviction guard drops the coldest
        // key rather than a key that is still being requested.
        entries.delete(key);
        entries.set(key, hit);
        return Promise.resolve(hit.value);
      }

      const pending = inflight.get(key);
      // Only share a fill that is filling the epoch this caller asked for.
      if (pending && pending.epoch === epoch) return pending.promise;

      const promise = load()
        .then((value) => store(key, epoch, value))
        .finally(() => {
          if (inflight.get(key)?.promise === promise) inflight.delete(key);
        });
      inflight.set(key, { epoch, promise });
      return promise;
    },
    clear(key) {
      if (key === undefined) {
        entries.clear();
        inflight.clear();
        return;
      }
      entries.delete(key);
      inflight.delete(key);
    },
    size() {
      return entries.size;
    },
  };
}

const SINGLE_KEY = "value";

export type ConfigCache<T> = {
  peek(epoch: number): T | undefined;
  get(epoch: number, load: () => Promise<T>): Promise<T>;
  clear(): void;
};

/** One value per cache instance. Use `createKeyedEpochCache` for per-id values. */
export function createConfigCache<T>(options: KeyedEpochCacheOptions = {}): ConfigCache<T> {
  const cache = createKeyedEpochCache<T>(options);
  return {
    peek: (epoch) => cache.peek(SINGLE_KEY, epoch),
    get: (epoch, load) => cache.get(SINGLE_KEY, epoch, load),
    clear: () => cache.clear(SINGLE_KEY),
  };
}
