"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  approvePayoutRun,
  generatePayoutRun,
  getPayoutRunDetail,
  listPayoutRuns,
  markPayoutRunPaid,
  voidPayoutRun,
} from "./payouts-actions";

export function usePayoutRuns(startDate: string, endDate: string) {
  return useQuery({
    queryKey: queryKeys.payouts.list(startDate, endDate),
    queryFn: async () => {
      const result = await listPayoutRuns(startDate, endDate);
      if ("error" in result) throw new Error(result.error);
      return result.rows;
    },
  });
}

export function usePayoutRunDetail(id: string) {
  return useQuery({
    queryKey: queryKeys.payouts.detail(id),
    enabled: Boolean(id),
    queryFn: async () => {
      const result = await getPayoutRunDetail(id);
      if ("error" in result) throw new Error(result.error);
      return result;
    },
  });
}

export function useGeneratePayoutRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: generatePayoutRun,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.payouts.all() });
    },
  });
}

export function useApprovePayoutRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: approvePayoutRun,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.payouts.all() });
    },
  });
}

export function useMarkPayoutRunPaid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reference }: { id: string; reference?: string }) =>
      markPayoutRunPaid(id, reference),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.payouts.all() });
    },
  });
}

export function useVoidPayoutRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => voidPayoutRun(id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.payouts.all() });
    },
  });
}
