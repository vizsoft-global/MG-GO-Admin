"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  executeCleanupPurge,
  fetchCleanupCandidates,
  previewCleanupPurge,
  previewPurgeAllModules,
  runPurgeAllModule,
  type CleanupPurgeSelection,
  type CleanupTab,
} from "./data-cleanup-actions";
import type { PurgeAllEntity } from "./purge-entities";

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

export function usePurgeAllPreview(
  entities: readonly PurgeAllEntity[],
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.dataCleanup.purgeAll(entities),
    enabled: enabled && entities.length > 0,
    queryFn: async () => {
      const result = await previewPurgeAllModules([...entities]);
      if ("error" in result) throw new Error(result.errorDetail ?? result.error);
      return result.items;
    },
  });
}

/** One module's live count, fetched only when its dialog opens. */
export function usePurgeAllModuleCount(entity: PurgeAllEntity, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.dataCleanup.purgeAll([entity]),
    enabled,
    staleTime: 0,
    queryFn: async () => {
      const result = await previewPurgeAllModules([entity]);
      if ("error" in result) throw new Error(result.errorDetail ?? result.error);
      return result.items[0] ?? { entity, count: 0, blockers: [] };
    },
  });
}

export function usePurgeAllRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entity: PurgeAllEntity) => {
      const result = await runPurgeAllModule(entity);
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
    },
  });
}
