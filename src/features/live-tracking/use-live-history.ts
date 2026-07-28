"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchDriverLocationHistory } from "@/features/locations/locations-actions";
import { queryKeys } from "@/lib/query/query-keys";

function dayBounds(date: string, endDate?: string | null): { from: string; to: string } {
  return {
    from: `${date}T00:00:00+03:00`,
    to: `${(endDate ?? date)}T23:59:59.999+03:00`,
  };
}

export function useLiveHistory(
  driverId: string | null,
  date: string,
  endDate?: string | null,
) {
  const rangeEnd = endDate && endDate !== date ? endDate : null;

  return useQuery({
    queryKey: rangeEnd
      ? queryKeys.liveTracking.historyRange(driverId ?? "", date, rangeEnd)
      : queryKeys.liveTracking.history(driverId ?? "", date),
    queryFn: async () => {
      if (!driverId) return [];
      const { from, to } = dayBounds(date, rangeEnd);
      return fetchDriverLocationHistory(driverId, from, to);
    },
    enabled: Boolean(driverId && date),
  });
}
