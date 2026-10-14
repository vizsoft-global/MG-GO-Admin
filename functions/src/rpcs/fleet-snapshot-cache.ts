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
  last_report_at?: string | null;
  is_online?: boolean;
  phone?: string | null;
  contact?: string | null;
  email?: string | null;
  driver_phone?: string | null;
};

type FixInstant = string | number | Date | null | undefined;

/** The ingest coalesce path stamps `last_report_at` and leaves `last_seen_at` frozen. */
export function fleetLatestFixMs(lastSeenAt: FixInstant, lastReportAt: FixInstant): number | null {
  let max = Number.NaN;
  for (const value of [lastSeenAt, lastReportAt]) {
    const ms =
      value instanceof Date
        ? value.getTime()
        : typeof value === "number"
          ? value
          : typeof value === "string"
            ? Date.parse(value)
            : Number.NaN;
    if (Number.isFinite(ms) && (!Number.isFinite(max) || ms > max)) max = ms;
  }
  return Number.isFinite(max) ? max : null;
}

export function fleetRowIsEligible(input: {
  isOnDuty: boolean;
  isOnline?: boolean;
  isBlocked: boolean;
  activeDeliveryId?: string | null;
  lastSeenAt?: FixInstant;
  lastReportAt?: FixInstant;
  cutoffMs: number;
}): boolean {
  if (input.isOnDuty || input.isOnline || input.isBlocked || input.activeDeliveryId) {
    return true;
  }
  const seen = fleetLatestFixMs(input.lastSeenAt, input.lastReportAt);
  return seen != null && seen >= input.cutoffMs;
}

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
    if (
      !fleetRowIsEligible({
        isOnDuty: row.is_on_duty,
        isOnline: row.is_online,
        isBlocked: row.is_blocked,
        activeDeliveryId: row.active_delivery_id,
        lastSeenAt: row.last_seen_at,
        lastReportAt: row.last_report_at,
        cutoffMs: cutoff,
      })
    ) {
      continue;
    }
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
