"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  executeCleanupPurge,
  fetchCleanupCandidates,
  previewCleanupPurge,
  type CleanupPurgeSelection,
  type CleanupTab,
} from "./data-cleanup-actions";

export function useCleanupCandidates(
  tab: CleanupTab,
  search: string,
  page: number,
  archivedOnly?: boolean,
) {
  return useQuery({
    queryKey: queryKeys.dataCleanup.candidates(tab, search, page, archivedOnly ?? false),
    queryFn: async () => {
      const result = await fetchCleanupCandidates(tab, search, page, { archivedOnly });
      if ("error" in result) throw new Error(result.error);
      return result;
    },
  });
}

export function useCleanupPreview() {
  return useMutation({
    mutationFn: async (selections: CleanupPurgeSelection[]) => {
      const result = await previewCleanupPurge(selections);
      if ("error" in result) throw new Error(result.error);
      return result;
    },
  });
}

export function useCleanupPurge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (selections: CleanupPurgeSelection[]) => {
      const result = await executeCleanupPurge(selections);
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
    },
  });
}
