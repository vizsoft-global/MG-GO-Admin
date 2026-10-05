import type { useTranslations } from "next-intl";

type DataCleanupT = ReturnType<typeof useTranslations<"pages.settings.dataCleanup">>;

/**
 * The refusal codes `admin_purge_preview_all` can return.
 *
 * The database answers in machine codes because it has no locale, and an
 * operator reading `blocked_by_restaurants` in a mono font is being shown the
 * protocol instead of the problem. Anything the catalog has not learned yet
 * still falls through as-is, so a new blocker is visible the day it is added
 * rather than rendering as an empty row.
 */
const PURGE_BLOCKER_KEYS = [
  "blocked_by_deliveries",
  "blocked_by_restaurants",
  "blocked_by_fuel",
  /**
   * Raised only on the filtered path, and only because the per-id purger
   * refuses them: a restaurant a rider is assigned to, a zone an intake still
   * points at. Clear all reports the coarser `has_*` family from the candidate
   * preview, so both spellings have to be readable.
   */
  "blocked_by_drivers",
  "blocked_by_intakes",
] as const;

export function isPurgeBlocker(code: string): boolean {
  return (PURGE_BLOCKER_KEYS as readonly string[]).includes(code);
}

export function purgeBlockerLabel(t: DataCleanupT, code: string): string {
  if (!isPurgeBlocker(code)) return code;
  const key = `clearAll.blockers.${code}` as "clearAll.blockers.blocked_by_deliveries";
  return t(key);
}
