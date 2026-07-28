"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchDriverHistoryActiveDates } from "@/features/locations/locations-actions";
import { queryKeys } from "@/lib/query/query-keys";

export function useDriverHistoryActiveDates(driverId: string | null, yearMonth: string) {
  return useQuery({
    queryKey: queryKeys.liveTracking.historyActiveDates(driverId ?? "", yearMonth),
    queryFn: () => fetchDriverHistoryActiveDates(driverId!, yearMonth),
    enabled: Boolean(driverId && yearMonth),
    staleTime: 60_000,
  });
}
