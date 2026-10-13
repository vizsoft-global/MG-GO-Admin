import type { EpochCounters } from "@/lib/auth/epoch-cache";

function counter(current: number, next: number | undefined): number {
  if (typeof next !== "number" || !Number.isFinite(next)) return current;
  return Math.max(current, next);
}

/**
 * Merge epoch counters a save action just returned into the sidebar context.
 * A missing or lower number does not rewind a counter the client already holds.
 */
export function applyReturnedEpochs(
  current: EpochCounters,
  returned: Partial<EpochCounters> | null | undefined,
): EpochCounters {
  if (!returned) return current;
  return {
    access: counter(current.access, returned.access),
    settings: counter(current.settings, returned.settings),
    menu: counter(current.menu, returned.menu),
  };
}
