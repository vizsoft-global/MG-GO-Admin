"use client";

import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { panelPost } from "@/lib/browser/panel-get";
import { queryKeys } from "@/lib/query/query-keys";
import {
  fetchDriverFilterValues,
  type DriversPageQuery,
  type DriversPageResult,
} from "./drivers-list-actions";
import type { DriversColumnFilters } from "./drivers-list-query";

/**
 * Rows per call.
 *
 * 100 again, since 2026-11-14. It went to 500 when every call re-read the whole
 * roster on the server, so fewer, larger calls were cheaper. The server now cuts
 * each page from a stored roster and the list draws 80 rows at a time as it is
 * scrolled, so a first answer of 500 only made the opening slower: five times
 * the rows to fill in and to send. The page fetches ahead of the scroll.
 */
export const DRIVERS_PAGE_LIMIT = 100;

/**
 * How long a loaded page is considered fresh.
 *
 * The Query client default is five minutes; this page used 30 s, so returning to
 * it after a minute always paid for the whole roster again. A stale-while-
 * revalidate read is the right shape here: paint the rows that are already
 * loaded, and let the 60 s invalidator refresh them underneath.
 */
const DRIVERS_PAGE_STALE_MS = 5 * 60_000;

export function useDriversPage(query: DriversPageQuery) {
  return useInfiniteQuery({
    queryKey: queryKeys.drivers.page(query),
    // A fetch, not a server action. The page fires eight small actions on mount
    // and Next sends them one at a time; as an action this request was ninth in
    // line and the riders did not start loading for about five seconds.
    queryFn: ({ pageParam }) =>
      panelPost<DriversPageResult>("/api/drivers/page", {
        query,
        offset: pageParam,
        limit: DRIVERS_PAGE_LIMIT,
      }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.rows.length, 0);
      return last.rows.length === DRIVERS_PAGE_LIMIT && loaded < last.filteredTotal
        ? loaded
        : undefined;
    },
    placeholderData: keepPreviousData,
    staleTime: DRIVERS_PAGE_STALE_MS,
  });
}

/** Options for one column, computed with every other active filter applied. */
export function useDriverFilterValues(
  column: string,
  context: { tab: DriversPageQuery["tab"]; search: string; filters: DriversColumnFilters },
  enabled: boolean,
) {
  const others = { ...context.filters };
  delete others[column];
  const scoped = { tab: context.tab, search: context.search, filters: others };
  return useQuery({
    queryKey: queryKeys.drivers.filterValues(column, scoped),
    queryFn: () => fetchDriverFilterValues(column, scoped),
    enabled,
    staleTime: 30_000,
  });
}
