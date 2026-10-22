"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  exportOrderExceptions,
  getOrderExceptionSummary,
  listOrderExceptions,
  resolveProofUrls,
  reviewOrderException,
} from "./order-exceptions-actions";
import type {
  OrderExceptionActionResult,
  OrderExceptionDateRange,
  OrderExceptionErrorCode,
  OrderExceptionExportResult,
  OrderExceptionListFilters,
  OrderExceptionListResult,
  OrderExceptionProof,
  OrderExceptionSummary,
  ReviewOrderExceptionInput,
  ReviewOrderExceptionResult,
} from "./types";

/** Local to this module — the shared query-key factory is not edited for one feature. */
export const orderExceptionKeys = {
  all: () => ["order-exceptions"] as const,
  list: (filters: OrderExceptionListFilters) =>
    [...orderExceptionKeys.all(), "list", filters] as const,
  summary: (range: OrderExceptionDateRange) =>
    [...orderExceptionKeys.all(), "summary", range] as const,
  /** Keyed by row, not by proof key — the object keys stay out of the client cache. */
  proofs: (rowId: string) => [...orderExceptionKeys.all(), "proofs", rowId] as const,
};

export class OrderExceptionRequestError extends Error {
  readonly code: OrderExceptionErrorCode;

  constructor(code: OrderExceptionErrorCode) {
    super(code);
    this.name = "OrderExceptionRequestError";
    this.code = code;
  }
}

function unwrap<T>(result: OrderExceptionActionResult<T>): T {
  if (result.error) throw new OrderExceptionRequestError(result.error);
  if (result.data === null) throw new OrderExceptionRequestError("unknown");
  return result.data;
}

export function orderExceptionErrorMessage(error: unknown): OrderExceptionErrorCode {
  if (error instanceof OrderExceptionRequestError) return error.code;
  return "unknown";
}

export function useOrderExceptionsList(filters: OrderExceptionListFilters) {
  return useQuery<OrderExceptionListResult>({
    queryKey: orderExceptionKeys.list(filters),
    queryFn: async () => unwrap(await listOrderExceptions(filters)),
    placeholderData: keepPreviousData,
    staleTime: 20_000,
    retry: 0,
  });
}

export function useOrderExceptionSummary(range: OrderExceptionDateRange) {
  return useQuery<OrderExceptionSummary>({
    queryKey: orderExceptionKeys.summary(range),
    queryFn: async () => unwrap(await getOrderExceptionSummary(range)),
    placeholderData: keepPreviousData,
    staleTime: 20_000,
    retry: 0,
  });
}

/**
 * Re-signs one row's proof screenshots when the URLs already on the row have expired.
 * The object keys never reach the client — the action re-reads them from the record.
 */
export function useOrderExceptionProofs(rowId: string, enabled = true) {
  return useQuery<OrderExceptionProof[]>({
    queryKey: orderExceptionKeys.proofs(rowId),
    queryFn: async () => unwrap(await resolveProofUrls(rowId)),
    enabled: enabled && Boolean(rowId),
    staleTime: 4 * 60_000,
    gcTime: 5 * 60_000,
    retry: 0,
  });
}

export function useReviewOrderException() {
  const queryClient = useQueryClient();
  return useMutation<ReviewOrderExceptionResult, Error, ReviewOrderExceptionInput>({
    mutationFn: async (input) => unwrap(await reviewOrderException(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orderExceptionKeys.all() });
    },
  });
}

/**
 * Export is an imperative one-shot, not a query — it is only run when the operator clicks
 * Export, and caching a 1000-row payload nobody revisits would be pure memory.
 */
export function useExportOrderExceptions() {
  return useMutation<OrderExceptionExportResult, Error, OrderExceptionListFilters>({
    mutationFn: async (filters) => unwrap(await exportOrderExceptions(filters)),
  });
}
