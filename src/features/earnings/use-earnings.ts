"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  runGetEarningsOverview,
  runListDriverEarningsDaily,
  runListEarningsGrouped,
} from "./earnings-actions";

export function useEarningsDaily(startDate: string, endDate: string, driverId?: string | null) {
  return useQuery({
    queryKey: queryKeys.earnings.daily(startDate, endDate, driverId ?? null),
    queryFn: async () => {
      const result = await runListDriverEarningsDaily(startDate, endDate, driverId ?? null);
      if ("error" in result) throw new Error(result.error);
      return result.rows;
    },
  });
}

export function useEarningsOverview(
  startDate: string,
  endDate: string,
  filters?: {
    driver_ids?: string[];
    zone_ids?: string[];
    partner_ids?: string[];
    restaurant_ids?: string[];
  },
) {
  return useQuery({
    queryKey: queryKeys.earnings.overview(startDate, endDate, filters ?? {}),
    queryFn: async () => {
      const result = await runGetEarningsOverview(startDate, endDate, filters);
      if ("error" in result) throw new Error(result.error);
      return result.data;
    },
  });
}

export function useEarningsGrouped(
  startDate: string,
  endDate: string,
  groupBy: "day" | "driver" | "zone" | "partner" | "restaurant",
  filters?: {
    driver_ids?: string[];
    zone_ids?: string[];
    partner_ids?: string[];
    restaurant_ids?: string[];
  },
) {
  return useQuery({
    queryKey: queryKeys.earnings.grouped(startDate, endDate, groupBy, filters ?? {}),
    queryFn: async () => {
      const result = await runListEarningsGrouped(startDate, endDate, groupBy, filters);
      if ("error" in result) throw new Error(result.error);
      return result.rows;
    },
  });
}
