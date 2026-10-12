/**
 * Per-isolate cache for the two `app_settings` flags the proxy reads.
 *
 * The proxy no longer consults this cache. Maintenance mode is a live read.
 * The helpers stay so the deadline tests can still pin the unclaimed-super-admin
 * rule: a claimed row may be stored, an unclaimed one must not.
 */
export type ProxyOpsSettings = {
  super_admin_claimed: boolean | null;
  maintenance_mode: boolean | null;
};

const TTL_MS = 60_000;

let cached: { value: ProxyOpsSettings; expiresAt: number } | null = null;

/**
 * Maintenance mode is safe to serve up to `TTL_MS` stale here because the
 * dashboard layout re-reads it uncached on every render, so turning it on still
 * takes effect on the next page load — the proxy redirect is an optimisation,
 * not the enforcement point.
 *
 * An unclaimed super admin is deliberately never cached: that is the one-time
 * setup window where the flag does flip, and staleness there would bounce the
 * new super admin back to a claim page they had just completed.
 */
export function readCachedOpsSettings(now = Date.now()): ProxyOpsSettings | null {
  if (!cached || cached.expiresAt <= now) return null;
  return cached.value;
}

export function cacheOpsSettings(
  value: ProxyOpsSettings | null,
  now = Date.now(),
): void {
  if (!value || value.super_admin_claimed !== true) return;
  cached = { value, expiresAt: now + TTL_MS };
}

/** Test seam. */
export function clearOpsSettingsCache(): void {
  cached = null;
}
