"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  decideAdminRequest,
  fetchAdminRequestDetail,
  fetchAdminRequestsList,
  fetchRequestTypeCounts,
} from "./requests-actions";
import type { RequestListFilters } from "./types";

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
    mutationFn: (input: { action: string; reason?: string }) =>
      decideAdminRequest({ requestId, ...input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.requests.all() });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.requests.detail(requestId),
      });
    },
  });
}
