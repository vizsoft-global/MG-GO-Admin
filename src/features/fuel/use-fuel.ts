"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { listFuelFills } from "./fuel-actions";

export function useFuelFills(input: {
  from: string;
  to: string;
  search?: string;
  projectKey?: string | null;
}) {
  return useQuery({
    queryKey: queryKeys.fuel.list(input),
    queryFn: () => listFuelFills(input),
    staleTime: 30_000,
  });
}
