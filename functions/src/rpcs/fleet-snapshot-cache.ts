export const FLEET_BASE_CACHE_MS = 5_000;

/** Fields a caller without contact permission must not receive. */
export const FLEET_CONTACT_FIELDS = ["phone", "contact", "email", "driver_phone"] as const;

export type FleetCallerScope = {
  uid: string;
  permissionSetHash: string;
  filtersHash: string;
};

/**
 * Unscoped base data uses one key. A cached value that was built for a caller
 * must include that caller, or two staff sessions would share a filtered roster.
 */
export function fleetBaseCacheKey(baseIsUnscoped: boolean, caller?: FleetCallerScope): string {
  if (baseIsUnscoped) return "unscoped";
  const uid = caller?.uid ?? "";
  const permissions = caller?.permissionSetHash ?? "";
  const filters = caller?.filtersHash ?? "";
  return `${uid}:${permissions}:${filters}`;
}

export type FleetCacheRow = {
  driver_id: string;
  zone_id: string | null;
  partner_id: string | null;
  is_on_duty: boolean;
  is_blocked: boolean;
  active_delivery_id: string | null;
  last_seen_at: string | null;
  phone?: string | null;
  contact?: string | null;
  email?: string | null;
  driver_phone?: string | null;
};

export type FleetSnapshotScope = {
  zoneIds: readonly string[] | null;
  partnerIds: readonly string[] | null;
  seenWithinMinutes: number;
  nowMs: number;
  canSeeContact: boolean;
};

export function projectFleetSnapshot<T extends FleetCacheRow>(
  base: { drivers: readonly T[] },
  scope: FleetSnapshotScope,
): { drivers: T[] } {
  const cutoff = scope.nowMs - Math.max(scope.seenWithinMinutes, 0) * 60_000;
  const zones = scope.zoneIds ? new Set(scope.zoneIds) : null;
  const partners = scope.partnerIds ? new Set(scope.partnerIds) : null;
  const drivers: T[] = [];
  for (const row of base.drivers) {
    if (zones && !zones.has(row.zone_id ?? "")) continue;
    if (partners && !partners.has(row.partner_id ?? "")) continue;
    const seen = row.last_seen_at ? Date.parse(row.last_seen_at) : Number.NaN;
    const recentlySeen = Number.isFinite(seen) && seen >= cutoff;
    if (!row.is_on_duty && !row.is_blocked && !recentlySeen && !row.active_delivery_id) continue;
    const copy = { ...row };
    if (!scope.canSeeContact) {
      for (const field of FLEET_CONTACT_FIELDS) delete copy[field];
    }
    drivers.push(copy);
  }
  return { drivers };
}

export function createFleetBaseCache<T>(options: { ttlMs?: number; now: () => number }) {
  const ttlMs = options.ttlMs ?? FLEET_BASE_CACHE_MS;
  let entry: { at: number; value: T } | null = null;
  return {
    async get(load: () => Promise<T>): Promise<T> {
      const now = options.now();
      if (entry && now - entry.at < ttlMs) return entry.value;
      const value = await load();
      entry = { at: options.now(), value };
      return value;
    },
  };
}
