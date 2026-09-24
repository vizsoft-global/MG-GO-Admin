"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { listFleetRequests } from "./fleet-request-actions";
import type { FleetQueueRequestType } from "./fleet-request-utils";

export function useFleetRequests(type: FleetQueueRequestType, driverId?: string) {
  return useQuery({
    queryKey: driverId ? queryKeys.fuel.driverRequests(driverId, type) : queryKeys.fuel.requests(type),
    queryFn: () => listFleetRequests({ type, driverId }),
    staleTime: 30_000,
  });
}
