"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  fetchDpdLiveSnapshot,
  fetchDriverPerformanceDetail,
  fetchDriverPerformanceList,
  fetchRecentDeliveriesFeed,
  getPerformanceScoreWeights,
  updatePerformanceScoreWeights,
} from "./performance-actions";
import type {
  PerformanceListFilters,
  PerformanceScoreWeights,
} from "./performance-types";

export function useDriverPerformanceList(
  filters: PerformanceListFilters,
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: queryKeys.performance.list(filters),
    queryFn: () => fetchDriverPerformanceList(filters),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

export function useDriverPerformanceDetail(
  driverId: string | null,
  fromDate: string,
  toDate: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.performance.detail(driverId ?? "", fromDate, toDate),
    queryFn: () => fetchDriverPerformanceDetail(driverId!, fromDate, toDate),
    enabled: Boolean(driverId) && enabled,
  });
}

export function useRecentDeliveriesFeed(
  limit = 30,
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: queryKeys.performance.recentDeliveries(limit),
    queryFn: () => fetchRecentDeliveriesFeed(limit),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? 30_000,
  });
}

export function useDpdLiveSnapshot(
  date: string,
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: queryKeys.performance.liveSnapshot(date),
    queryFn: () => fetchDpdLiveSnapshot(date),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? 30_000,
  });
}

export function usePerformanceScoreWeights(enabled = true) {
  return useQuery({
    queryKey: queryKeys.performance.weights(),
    queryFn: getPerformanceScoreWeights,
    enabled,
  });
}

export function useUpdatePerformanceScoreWeights() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (weights: PerformanceScoreWeights) =>
      updatePerformanceScoreWeights(weights),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.performance.all() });
    },
  });
}
