"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  createEsignRequest,
  fetchEsignCategories,
  fetchEsignDriverOptions,
  fetchEsignRequestDetail,
  fetchEsignRequestsList,
  fetchEsignScreenshotDefault,
  updateEsignScreenshotDefault,
} from "./esign-actions";
import type { EsignListFilters } from "./types";

export function useEsignRequestsList(filters: EsignListFilters = {}) {
  return useQuery({
    queryKey: queryKeys.esign.list(filters),
    queryFn: () => fetchEsignRequestsList(filters),
  });
}

export function useEsignRequestDetail(id: string) {
  return useQuery({
    queryKey: queryKeys.esign.detail(id),
    queryFn: () => fetchEsignRequestDetail(id),
    enabled: Boolean(id),
  });
}

export function useEsignCategories() {
  return useQuery({
    queryKey: queryKeys.esign.categories(),
    queryFn: () => fetchEsignCategories(),
  });
}

export function useEsignDriverOptions() {
  return useQuery({
    queryKey: queryKeys.esign.driverOptions(),
    queryFn: () => fetchEsignDriverOptions(),
    staleTime: 60_000,
  });
}

export function useEsignScreenshotDefault() {
  return useQuery({
    queryKey: queryKeys.esign.screenshotDefault(),
    queryFn: () => fetchEsignScreenshotDefault(),
  });
}

export function useCreateEsignRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createEsignRequest,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.esign.all() });
    },
  });
}

export function useUpdateEsignScreenshotDefault() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateEsignScreenshotDefault,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.esign.screenshotDefault(),
      });
    },
  });
}
