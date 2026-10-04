"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  bulkUpdateDeliveries,
  deleteDelivery,
  fetchDeliveriesKpis,
  fetchDeliveriesPage,
  fetchDeliveryFilterOptions,
  updateDeliveryStatus,
  type DeliveriesPage,
  type DeliveriesQueryFilter,
} from "./deliveries-actions";
import type { ReviewableDeliveryStatus } from "./types";
import type { DeliveryStatusFilterValue } from "./delivery-status-filter";
import {
  patchDeliveryStatusInPages,
  patchDeliveryStatusesInPages,
} from "./patch-delivery-status-pages";

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
    retry: false,
  });
}

/** Global KPI counts (independent of filters). */
export function useDeliveriesKpis() {
  return useQuery({
    queryKey: queryKeys.deliveries.kpis(),
    queryFn: fetchDeliveriesKpis,
    retry: false,
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

type DeliveryListCache = { pages: DeliveriesPage[]; pageParams: unknown[] };

/** Every cached deliveries list page, so an optimistic patch can be rolled back. */
function deliveryListSnapshots(client: ReturnType<typeof useQueryClient>) {
  return client.getQueriesData<DeliveryListCache>({
    queryKey: ["deliveries", "list"],
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
    // Paint the new status the moment the operator confirms, so the row and the
    // KPI-relevant list are already correct while the write is in flight. The
    // `onSuccess` patch below is kept as the reconciliation after the server
    // answers, and `onError` restores the snapshot if the write is refused.
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ["deliveries", "list"] });
      const previous = deliveryListSnapshots(queryClient);
      queryClient.setQueriesData<DeliveryListCache>(
        { queryKey: ["deliveries", "list"] },
        (old) => {
          if (!old?.pages) return old;
          return {
            ...old,
            pages: patchDeliveryStatusInPages(old.pages, vars.deliveryId, vars.status),
          };
        },
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSuccess: async (result, vars) => {
      if (result && "ok" in result) {
        queryClient.setQueriesData<DeliveryListCache>(
          { queryKey: ["deliveries", "list"] },
          (old) => {
            if (!old?.pages) return old;
            return {
              ...old,
              pages: patchDeliveryStatusInPages(old.pages, vars.deliveryId, vars.status),
            };
          },
        );
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.deliveries.all() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.verifications.all() });
    },
  });
}

export function useBulkUpdateDeliveries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      deliveryIds,
      status,
      rejectionReason,
    }: {
      deliveryIds: string[];
      status: Extract<ReviewableDeliveryStatus, "verified" | "rejected">;
      rejectionReason?: string;
    }) => bulkUpdateDeliveries(deliveryIds, status, rejectionReason),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ["deliveries", "list"] });
      const previous = deliveryListSnapshots(queryClient);
      queryClient.setQueriesData<DeliveryListCache>(
        { queryKey: ["deliveries", "list"] },
        (old) => {
          if (!old?.pages) return old;
          return {
            ...old,
            pages: patchDeliveryStatusesInPages(
              old.pages,
              vars.deliveryIds,
              vars.status,
            ),
          };
        },
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSuccess: async (result, vars) => {
      if (result && "ok" in result && result.updated > 0) {
        queryClient.setQueriesData<DeliveryListCache>(
          { queryKey: ["deliveries", "list"] },
          (old) => {
            if (!old?.pages) return old;
            return {
              ...old,
              pages: patchDeliveryStatusesInPages(
                old.pages,
                vars.deliveryIds,
                vars.status,
              ),
            };
          },
        );
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.deliveries.all() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.verifications.all() });
    },
  });
}

export function useDeleteDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deliveryId: string) => deleteDelivery(deliveryId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.deliveries.all() });
    },
  });
}
