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
  deleteEsignDraft,
  fetchEsignBatch,
  fetchEsignBatches,
  fetchEsignDraft,
  fetchEsignDrafts,
  fetchEsignReminderState,
  fetchEsignTemplate,
  fetchEsignTemplates,
  fetchEsignTrackerRecipients,
  removeEsignBatchRow,
  remindEsignRequests,
  saveEsignDraft,
  updateEsignBatchRow,
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

// ---------------------------------------------------------------------------
// Tracker (Sent for signature)
// ---------------------------------------------------------------------------

/**
 * The narrow recipient read the batch tracker rolls its progress cells up from.
 *
 * A separate query from `useEsignBatches` rather than data folded into it,
 * because `fetchEsignTrackerRecipients` is the expensive half and the two have
 * different lifetimes: opening a batch detail must not re-fetch the whole
 * fleet's recipients, and a reminder must invalidate the recipients without
 * re-reading the batch headers.
 */
export function useEsignTrackerRecipients() {
  return useQuery({
    queryKey: queryKeys.esign.trackerRecipients(),
    queryFn: () => fetchEsignTrackerRecipients(),
    staleTime: 30_000,
  });
}

/**
 * The reminder cooldown for the recipients currently on screen.
 *
 * `enabled` is driven by the caller so a list of zero ids does not issue a
 * request that can only return an empty array — and so the drawer can mount
 * before its rows are known.
 */
export function useEsignReminderState(ids: string[]) {
  return useQuery({
    queryKey: queryKeys.esign.reminderState(ids),
    queryFn: () => fetchEsignReminderState(ids),
    enabled: ids.length > 0,
    staleTime: 0,
  });
}

export function useRemindEsignRequests() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: remindEsignRequests,
    onSuccess: async () => {
      // The reminder moved `last_reminded_at`, which is what the cooldown and
      // the Waiting badge both read, so every esign key is stale — not just the
      // ones this screen happens to be showing.
      await queryClient.invalidateQueries({ queryKey: queryKeys.esign.all() });
    },
  });
}

export function useUpdateEsignBatchRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateEsignBatchRow,
    onSuccess: async () => {
      // The repair moved the row's status, which is what the batch's counters
      // and the tracker's progress both read, so every esign key is stale.
      await queryClient.invalidateQueries({ queryKey: queryKeys.esign.all() });
    },
  });
}

export function useRemoveEsignBatchRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeEsignBatchRow,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.esign.all() });
    },
  });
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export function useEsignDrafts() {
  return useQuery({
    queryKey: queryKeys.esign.drafts(),
    queryFn: () => fetchEsignDrafts(),
  });
}

export function useEsignDraft(id: string) {
  return useQuery({
    queryKey: queryKeys.esign.draft(id),
    queryFn: () => fetchEsignDraft(id),
    enabled: Boolean(id),
  });
}

export function useSaveEsignDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveEsignDraft,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.esign.drafts() });
    },
  });
}

export function useDeleteEsignDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteEsignDraft,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.esign.drafts() });
    },
  });
}
