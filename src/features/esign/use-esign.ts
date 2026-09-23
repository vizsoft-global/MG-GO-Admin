"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  createEsignRequest,
  fetchEsignCategories,
  fetchEsignDocumentLinks,
  fetchEsignDriverOptions,
  fetchEsignRequestDetail,
  fetchEsignRequestsList,
  fetchEsignScreenshotDefault,
  fetchEsignStatusCounts,
  updateEsignScreenshotDefault,
} from "./esign-actions";
import {
  createEsignFromTemplate,
  fetchEsignBatch,
  fetchEsignBatches,
  fetchEsignTemplate,
  fetchEsignTemplates,
} from "./esign-sender-actions";
import type { EsignListFilters } from "./types";

export function useEsignStatusCounts() {
  return useQuery({
    queryKey: [...queryKeys.esign.all(), "status-counts"],
    queryFn: () => fetchEsignStatusCounts(),
  });
}

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

export function useEsignDocumentLinks(id: string) {
  return useQuery({
    queryKey: [...queryKeys.esign.detail(id), "document-links"],
    queryFn: () => fetchEsignDocumentLinks(id),
    enabled: Boolean(id),
    staleTime: 60_000,
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

export function useEsignTemplates() {
  return useQuery({
    queryKey: queryKeys.esign.templates(),
    queryFn: () => fetchEsignTemplates(),
  });
}

export function useEsignTemplate(id: string) {
  return useQuery({
    queryKey: queryKeys.esign.template(id),
    queryFn: () => fetchEsignTemplate(id),
    enabled: Boolean(id),
  });
}

export function useEsignBatches() {
  return useQuery({
    queryKey: queryKeys.esign.batches(),
    queryFn: () => fetchEsignBatches(),
  });
}

export function useEsignBatch(id: string) {
  return useQuery({
    queryKey: queryKeys.esign.batch(id),
    queryFn: () => fetchEsignBatch(id),
    enabled: Boolean(id),
  });
}

export function useCreateEsignFromTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createEsignFromTemplate,
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
