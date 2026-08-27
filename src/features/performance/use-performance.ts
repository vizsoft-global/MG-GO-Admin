"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  clearDriverPerformanceRating,
  fetchDpdLiveSnapshot,
  fetchDriverPerformanceDetail,
  fetchDriverPerformanceList,
  fetchDriverPerformanceRatings,
  fetchPerformanceRatingTeams,
  fetchRatingEligibleStaff,
  fetchRecentDeliveriesFeed,
  getPerformanceScoreWeights,
  saveDriverPerformanceRating,
  setPerformanceTeamMember,
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

export function useDriverPerformanceRatings(
  driverId: string | null,
  periodMonth: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.performance.ratings(driverId ?? "", periodMonth),
    queryFn: () => fetchDriverPerformanceRatings(driverId!, periodMonth),
    enabled: Boolean(driverId) && enabled,
  });
}

export function useSaveDriverPerformanceRating() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveDriverPerformanceRating,
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.performance.ratings(input.driverId, input.periodMonth),
      });
      // The rating moves overall_score whenever the manual weight is above 0, so
      // the list and every KPI derived from it are stale too.
      void queryClient.invalidateQueries({ queryKey: queryKeys.performance.all() });
    },
  });
}

export function useClearDriverPerformanceRating() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clearDriverPerformanceRating,
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.performance.ratings(input.driverId, input.periodMonth),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.performance.all() });
    },
  });
}

export function usePerformanceRatingTeams(enabled = true) {
  return useQuery({
    queryKey: queryKeys.performance.ratingTeams(),
    queryFn: fetchPerformanceRatingTeams,
    enabled,
  });
}

export function useRatingEligibleStaff(enabled = true) {
  return useQuery({
    queryKey: queryKeys.performance.ratingStaff(),
    queryFn: fetchRatingEligibleStaff,
    enabled,
  });
}

export function useSetPerformanceTeamMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setPerformanceTeamMember,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.performance.ratingTeams(),
      });
      // Membership decides can_edit on every open rating panel.
      void queryClient.invalidateQueries({ queryKey: queryKeys.performance.all() });
    },
  });
}
