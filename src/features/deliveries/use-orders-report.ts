"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { fetchDeliveryOrdersReport } from "./orders-report-actions";

export function useDeliveryOrdersReport(from: string | null, to: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.deliveries.ordersReport(from ?? "", to ?? ""),
    queryFn: () => fetchDeliveryOrdersReport({ from: from!, to: to! }),
    enabled: enabled && Boolean(from && to && from <= to),
    staleTime: 0,
    gcTime: 0,
  });
}
