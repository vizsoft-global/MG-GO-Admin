"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  decideAdminRequest,
  decideAdminRequestsBulk,
  fetchAdminRequestDetail,
  fetchAdminRequestsList,
  fetchRequestTypeCounts,
  saveRequestDecisionTerms,
} from "./requests-actions";
import type { RequestDecisionTerms, RequestListFilters } from "./types";

export function useAdminRequestsList(filters: RequestListFilters) {
  return useQuery({
    queryKey: queryKeys.requests.list(filters),
    queryFn: () => fetchAdminRequestsList(filters),
  });
}

export function useRequestTypeCounts() {
  return useQuery({
    queryKey: queryKeys.requests.typeCounts(),
    queryFn: () => fetchRequestTypeCounts(),
    staleTime: 60_000,
  });
}

export function useAdminRequestDetail(requestId: string) {
  return useQuery({
    queryKey: queryKeys.requests.detail(requestId),
    queryFn: () => fetchAdminRequestDetail(requestId),
    enabled: Boolean(requestId),
  });
}

export function useDecideRequest(requestId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { action: string; reason?: string; terms?: RequestDecisionTerms }) =>
      decideAdminRequest({ requestId, ...input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.requests.all() });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.requests.detail(requestId),
      });
    },
  });
}

export function useBulkDecideRequests() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      requestIds: string[];
      action: "approve" | "reject";
      reason?: string;
    }) => decideAdminRequestsBulk(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.requests.all() });
    },
  });
}

export function useSaveDecisionTerms(requestId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (terms: RequestDecisionTerms) =>
      saveRequestDecisionTerms({ requestId, terms }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.requests.detail(requestId),
      });
    },
  });
}
