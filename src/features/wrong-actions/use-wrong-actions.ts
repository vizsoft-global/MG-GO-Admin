"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  deleteWrongAction,
  listWrongActionDriverOptions,
  listWrongActions,
  listWrongActionsForDriver,
  saveWrongAction,
} from "./wrong-actions-actions";

export function useWrongActionsList() {
  return useQuery({
    queryKey: queryKeys.wrongActions.list(),
    queryFn: listWrongActions,
  });
}

export function useDriverWrongActions(driverId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.wrongActions.forDriver(driverId),
    queryFn: () => listWrongActionsForDriver(driverId),
    enabled: enabled && Boolean(driverId),
  });
}

export function useWrongActionDriverOptions(enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.wrongActions.all(), "driver-options"] as const,
    queryFn: listWrongActionDriverOptions,
    enabled,
  });
}

export function useSaveWrongAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveWrongAction,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.wrongActions.all() });
      // The conduct component reads these rows, so a filed incident changes a
      // score the operator may be looking at on the next tab.
      void queryClient.invalidateQueries({ queryKey: queryKeys.performance.all() });
    },
  });
}

export function useDeleteWrongAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteWrongAction,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.wrongActions.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.performance.all() });
    },
  });
}
