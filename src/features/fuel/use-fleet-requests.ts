"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { listFleetRequests } from "./fleet-request-actions";
import type { FleetQueueRequestType } from "./fleet-request-utils";

export function useFleetRequests(type: FleetQueueRequestType) {
  return useQuery({
    queryKey: queryKeys.fuel.requests(type),
    queryFn: () => listFleetRequests({ type }),
    staleTime: 30_000,
  });
}
