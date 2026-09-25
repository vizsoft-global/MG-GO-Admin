"use client";

import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  fetchDriverFilterValues,
  fetchDriversPage,
  type DriversPageQuery,
} from "./drivers-list-actions";
import type { DriversColumnFilters } from "./drivers-list-query";

export const DRIVERS_PAGE_LIMIT = 100;

export function useDriversPage(query: DriversPageQuery) {
  return useInfiniteQuery({
    queryKey: queryKeys.drivers.page(query),
    queryFn: ({ pageParam }) => fetchDriversPage(query, pageParam, DRIVERS_PAGE_LIMIT),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.rows.length, 0);
      return last.rows.length === DRIVERS_PAGE_LIMIT && loaded < last.filteredTotal
        ? loaded
        : undefined;
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
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
