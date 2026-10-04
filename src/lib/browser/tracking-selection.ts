/**
 * Which rider is open on a tracking page, kept in the URL (QA #49).
 *
 * Leaving for the driver detail page used to cost the operator the whole map: the pin they had
 * opened, and with it the popup, the day route, the playback strip and the recent orders. They
 * had to find the same rider again in a list of 500. The selection is a small piece of state
 * whose natural representation is a query parameter, so it is written when it changes and read
 * back when the page mounts again.
 *
 * Four deliberate choices:
 *
 * - **`window.history.replaceState`, not the router.** The selection changes several times a
 *   minute, and a router transition would refetch the route and re-render a WebGL canvas for
 *   something the server knows nothing about.
 * - **`replace`, not `push`,** so the browser's Back button still leaves the page instead of
 *   walking backwards through the operator's own clicks.
 * - **The locale is never rebuilt from a route hook.** next-intl's `usePathname` strips the
 *   locale prefix, so a URL assembled from it would turn `/en/live-tracking` into
 *   `/live-tracking`. The pathname comes from `window.location`, which has it — and the pure
 *   half below takes it as an argument, so that rule is pinned by a test.
 * - **Read once, at mount, rather than from `useSearchParams`.** The caller clears the parameter
 *   when nothing is selected, and a session that read through the router would be racing its own
 *   cleanup for the value it was about to restore. A snapshot taken before any write cannot be
 *   erased by one.
 *
 * Imported by V1 (`features/live-tracking`) and V2 (`features/live-tracking-v2`), which share
 * nothing else — no store, no channel, no component — because the parameter must mean the same
 * thing on both maps. The same helpers serve `/drivers`' back arrow.
 */

/** The parameter this module writes. */
export const DRIVER_QUERY_PARAM = "driver";

/**
 * A second accepted spelling, read-only.
 *
 * `/attendance`, `/driver-shifts` and `/worktime` already link to `/live-tracking?driverId=…`
 * and that parameter was never read by anything, so those links silently opened an empty map.
 * Accepting it here is what makes existing links work rather than adding a third way to spell
 * the same fact; nothing writes it.
 */
export const LEGACY_DRIVER_QUERY_PARAM = "driverId";

/** Read a search string (`"?a=1"` or `"a=1"`) into the selected rider id, or `null`. */
export function selectedDriverIdFromSearch(search: string): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const value =
    params.get(DRIVER_QUERY_PARAM) ?? params.get(LEGACY_DRIVER_QUERY_PARAM) ?? "";
  return value.length > 0 ? value : null;
}

/**
 * `pathname` + `search` with the selection replaced, or the parameter removed.
 *
 * Pure so the locale rule is testable: the pathname is passed through untouched, and only the
 * query string is rebuilt. The legacy spelling is dropped whenever anything is written, so a
 * page that arrived via `?driverId=` does not keep a second copy of the same fact in its URL.
 */
export function withSelectedDriverId(
  pathname: string,
  search: string,
  driverId: string | null,
): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.delete(LEGACY_DRIVER_QUERY_PARAM);
  if (driverId) {
    params.set(DRIVER_QUERY_PARAM, driverId);
  } else {
    params.delete(DRIVER_QUERY_PARAM);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** The rider id in the current URL, or `null`. Safe to call during SSR. */
export function readSelectedDriverId(): string | null {
  if (typeof window === "undefined") return null;
  return selectedDriverIdFromSearch(window.location.search);
}

/**
 * Point the address bar at `driverId`, or remove the parameter when nothing is selected.
 *
 * `replaceState` is given the same `history.state` it already holds, because replacing the entry
 * with a fresh state object would discard the markers the router keeps in it.
 */
export function writeSelectedDriverId(driverId: string | null): void {
  if (typeof window === "undefined") return;
  window.history.replaceState(
    window.history.state,
    "",
    withSelectedDriverId(window.location.pathname, window.location.search, driverId),
  );
}
