/**
 * A short memory for what a location report checks a rider against.
 *
 * Restaurant assignments, zone shapes and the range settings change a few times
 * a day. A rider reports every few seconds, and each report used to read all of
 * them again: the settings document, the zone polygon (large, and this database
 * bills a read by its size), every assigned restaurant and its geofences. One
 * instance now reads each of them once a minute.
 *
 * The price is that an edit takes up to a minute to reach the zone status on a
 * rider's pin. The gates that decide a pickup or a clock-in do not use this.
 */
export const GEO_MEMO_MS = 60_000;
export const GEO_MEMO_MAX = 2000;

export type GeoMemo = <T>(key: string, load: () => Promise<T>) => Promise<T>;

export function createGeoMemo(options: { ttlMs?: number; maxKeys?: number; now?: () => number } = {}): GeoMemo {
  const ttlMs = options.ttlMs ?? GEO_MEMO_MS;
  const maxKeys = options.maxKeys ?? GEO_MEMO_MAX;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { at: number; value: Promise<unknown> }>();
  return function memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    const nowMs = now();
    const hit = entries.get(key);
    if (hit && nowMs - hit.at < ttlMs) return hit.value as Promise<T>;
    if (entries.size >= maxKeys) entries.clear();
    const value = load();
    entries.set(key, { at: nowMs, value });
    // A failed read is not remembered: the next report tries again.
    value.catch(() => {
      if (entries.get(key)?.value === value) entries.delete(key);
    });
    return value;
  };
}

/** One memory per instance, shared by every caller in it. */
export const memoGeo: GeoMemo = createGeoMemo();
