"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { fetchWorktimeList } from "@/features/driver-tracking/tracking-read-actions";

export function useWorktimeList(filters: {
  fromDate: string;
  toDate: string;
  zoneId?: string;
  partnerId?: string;
}) {
  return useQuery({
    queryKey: queryKeys.worktime.list(filters),
    queryFn: () => fetchWorktimeList(filters),
  });
}
