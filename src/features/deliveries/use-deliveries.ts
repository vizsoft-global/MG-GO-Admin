"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  deleteDelivery,
  fetchDeliveriesKpis,
  fetchDeliveriesPage,
  fetchDeliveryFilterOptions,
  updateDeliveryStatus,
  type DeliveriesQueryFilter,
} from "./deliveries-actions";
import type { ReviewableDeliveryStatus } from "./types";
import type { DeliveryStatusFilterValue } from "./delivery-status-filter";

/** @deprecated Use DeliveryStatusFilterValue */
export type DeliveriesTabFilter = DeliveryStatusFilterValue;

/** Infinite-scroll list of deliveries with server-side filtering + pagination. */
export function useDeliveriesInfinite(filter: DeliveriesQueryFilter) {
  return useInfiniteQuery({
    queryKey: queryKeys.deliveries.list(filter as Record<string, unknown>),
    queryFn: ({ pageParam }) =>
      fetchDeliveriesPage({ ...filter, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  });
}

/** Global KPI counts (independent of filters). */
export function useDeliveriesKpis() {
  return useQuery({
    queryKey: queryKeys.deliveries.kpis(),
    queryFn: fetchDeliveriesKpis,
  });
}

/** Zone + partner options for list filters. */
export function useDeliveryFilterOptions() {
  return useQuery({
    queryKey: queryKeys.deliveries.filterOptions(),
    queryFn: fetchDeliveryFilterOptions,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateDeliveryStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      deliveryId,
      status,
      rejectionReason,
    }: {
      deliveryId: string;
      status: ReviewableDeliveryStatus;
      rejectionReason?: string;
    }) => updateDeliveryStatus(deliveryId, status, rejectionReason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.deliveries.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.verifications.all() });
    },
  });
}

export function useDeleteDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deliveryId: string) => deleteDelivery(deliveryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.deliveries.all() });
    },
  });
}
