"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { listDriverDevices } from "./driver-devices-actions";

export function useDriverDevices() {
  return useQuery({
    queryKey: queryKeys.driverDevices.list(),
    queryFn: listDriverDevices,
    // Device sessions move on login, not continuously. A minute is fresh enough
    // for a compliance view and keeps the Sentry side channel off the hot path.
    staleTime: 60_000,
  });
}
