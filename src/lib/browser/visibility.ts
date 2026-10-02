/**
 * Whether background work should run right now.
 *
 * The admin panel's live surfaces lean on `setInterval` for anything the Query client
 * does not own — the fleet transport's snapshot poll, its status clock, the rail's
 * relative-time ticker, the V1 locations store's resync. `setInterval` does not care
 * whether the tab is visible, so all of them kept working for an operator who was, by
 * definition, looking at something else. The largest of them,
 * `admin_live_fleet_snapshot`, was measured at 784,984 calls.
 *
 * TanStack Query's `refetchInterval` already suspends in the background by default
 * (`refetchIntervalInBackground: false`), so the request/response reads were never the
 * problem; the raw timers were. That is why this rule is one shared predicate instead of
 * being re-derived at each call site.
 *
 * Nothing here changes what a page shows. A hidden tab is stale for exactly as long as it
 * is hidden, and every caller runs one catch-up pass when it becomes visible again — so
 * the operator never observes the pause, only its absence from the request log.
 */
export function shouldRunBackgroundWork(doc?: { hidden?: boolean } | null): boolean {
  if (!doc) return true;
  return doc.hidden !== true;
}
