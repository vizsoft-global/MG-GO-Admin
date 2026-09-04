"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { fetchDeliveryOrdersReport } from "./orders-report-actions";

export function useDeliveryOrdersReport(
  from: string | null,
  to: string | null,
  enabled: boolean,
  fromTime?: string,
  toTime?: string,
) {
  return useQuery({
    queryKey: queryKeys.deliveries.ordersReport(from ?? "", to ?? "", fromTime ?? "", toTime ?? ""),
    queryFn: () =>
      fetchDeliveryOrdersReport({
        from: from!,
        to: to!,
        fromTime,
        toTime,
      }),
    enabled: enabled && Boolean(from && to && from <= to),
    staleTime: 0,
    gcTime: 0,
  });
}
