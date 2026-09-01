"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  createRequestOnBehalf,
  decideAdminRequest,
  decideAdminRequestsBulk,
  uploadStaffRequestAttachments,
  fetchAdminRequestDetail,
  fetchAdminRequestsList,
  fetchRequestCreateOptions,
  fetchRequestTypeCounts,
  saveRequestDecisionTerms,
  setFuelTransferType,
} from "./requests-actions";
import type {
  FuelTransferType,
  RequestCreateInput,
  RequestDecisionAttachment,
  RequestDecisionTerms,
  RequestListFilters,
  RequestRescheduleInput,
} from "./types";

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

export function useRequestCreateOptions(enabled: boolean) {
  return useQuery({
    queryKey: [...queryKeys.requests.all(), "create-options"],
    queryFn: () => fetchRequestCreateOptions(),
    enabled,
    staleTime: 60_000,
  });
}

export function useCreateRequestOnBehalf() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RequestCreateInput) => createRequestOnBehalf(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.requests.all() });
    },
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
    mutationFn: (input: {
      action: string;
      reason?: string;
      terms?: RequestDecisionTerms;
      reschedule?: RequestRescheduleInput;
      attachments?: RequestDecisionAttachment[];
    }) => decideAdminRequest({ requestId, ...input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.requests.all() });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.requests.detail(requestId),
      });
    },
  });
}

export function useUploadStaffRequestAttachments(requestId: string) {
  return useMutation({
    mutationFn: (files: Array<{ name: string; type: string; base64: string }>) =>
      uploadStaffRequestAttachments({ requestId, files }),
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

export function useSetFuelTransferType(requestId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (transferType: FuelTransferType | null) =>
      setFuelTransferType({ requestId, transferType }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.requests.detail(requestId),
      });
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
