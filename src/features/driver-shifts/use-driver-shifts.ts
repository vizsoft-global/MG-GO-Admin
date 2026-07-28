"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { fetchDriverShiftsList } from "@/features/driver-tracking/tracking-read-actions";

export function useDriverShiftsList(filters: {
  fromDate: string;
  toDate: string;
  zoneId?: string;
  partnerId?: string;
}) {
  return useQuery({
    queryKey: queryKeys.driverShifts.list(filters),
    queryFn: () => fetchDriverShiftsList(filters),
  });
}
