"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  fetchPurgeFilterColumns,
  fetchPurgeFilterValues,
  pageFilteredPurge,
  previewFilteredPurge,
  runFilteredPurge,
  type PurgeFilteredPage,
  type PurgeFilteredPreview,
} from "./data-cleanup-actions";
import type { PurgeFilters } from "./purge-filter-catalog";

/**
 * The entity's filterable columns, from the server.
 *
 * `staleTime: Infinity` because the catalogue is a schema fact, not data — it
 * changes when the database does, which a page load already covers. Every other
 * read here is `staleTime: 0`, because a count taken a minute ago is not the
 * count the delete will act on.
 */
export function usePurgeFilterColumns(entity: string | null) {
  return useQuery({
    queryKey: queryKeys.dataCleanup.purgeFilterColumns(entity ?? ""),
    enabled: Boolean(entity),
    staleTime: Infinity,
    queryFn: async () => {
      const result = await fetchPurgeFilterColumns(entity as string);
      if ("error" in result) throw new Error(result.errorDetail ?? result.error);
      return result;
    },
  });
}

/**
 * Distinct values for one column. Fetched for `list` and `text` — text still
 * matches as `contains`, but the picker needs the live names so Partners /
 * restaurants / driver fields are not a blind input. `range` has no list.
 */
export function usePurgeFilterValues(
  entity: string | null,
  column: string | null,
  filters: PurgeFilters,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.dataCleanup.purgeFilterValues(
      entity ?? "",
      column ?? "",
      filters,
    ),
    enabled: Boolean(entity && column) && enabled,
    staleTime: 0,
    queryFn: async () => {
      const result = await fetchPurgeFilterValues(
        entity as string,
        column as string,
        filters,
      );
      if ("error" in result) throw new Error(result.errorDetail ?? result.error);
      return result;
    },
  });
}

/**
 * `{count, breakdown, blockers, sample}` for the current filter set.
 *
 * `placeholderData` keeps the last answer on screen while the next one is in
 * flight, so a chip being added does not blank the footer count and read as
 * "nothing matches" for a moment. It carries the previous filter set's answer
 * forward honestly, because it is only ever a placeholder — the confirm button
 * stays disabled while the query is fetching, so a stale count can never be
 * what gets deleted.
 */
export function usePurgeFilteredPreview(
  entity: string | null,
  filters: PurgeFilters,
  enabled: boolean,
) {
  return useQuery<PurgeFilteredPreview>({
    queryKey: queryKeys.dataCleanup.purgeFilteredPreview(entity ?? "", filters),
    enabled: Boolean(entity) && enabled,
    staleTime: 0,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const result = await previewFilteredPurge(entity as string, filters);
      if ("error" in result) throw new Error(result.errorDetail ?? result.error);
      return result;
    },
  });
}

/** The read-only review list for one page of the matched rows. */
export function usePurgeFilteredPage(
  entity: string | null,
  filters: PurgeFilters,
  page: number,
  enabled: boolean,
) {
  return useQuery<PurgeFilteredPage>({
    queryKey: queryKeys.dataCleanup.purgeFilteredPage(entity ?? "", filters, page),
    enabled: Boolean(entity) && enabled,
    staleTime: 0,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const result = await pageFilteredPurge(entity as string, filters, page);
      if ("error" in result) throw new Error(result.errorDetail ?? result.error);
      return result;
    },
  });
}

/**
 * Runs the filtered delete and invalidates the same set Clear all does, plus
 * the filter reads — the count, the facets and the review list are all stale
 * the instant a row is gone, and the dialog must re-read them rather than
 * offer a second delete against a filter set that no longer matches anything.
 */
export function usePurgeFilteredRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      entity,
      filters,
    }: {
      entity: string;
      filters: PurgeFilters;
    }) => {
      const result = await runFilteredPurge(entity, filters);
      if ("error" in result) throw new Error(result.errorDetail ?? result.error);
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dataCleanup.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.drivers.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.zones.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.restaurants.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.deliveries.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assets.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.attendance.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.requests.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.fuel.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.visits.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.esign.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.partners.all() });
    },
  });
}
