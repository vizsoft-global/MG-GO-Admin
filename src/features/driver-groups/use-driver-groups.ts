"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  getDriverGroup,
  listDriverGroups,
  listGroupsForDriver,
  searchDriversForGroup,
} from "./driver-groups-actions";

export function useDriverGroups() {
  return useQuery({
    queryKey: queryKeys.driverGroups.list(),
    queryFn: listDriverGroups,
  });
}

export function useDriverGroup(id: string | null) {
  return useQuery({
    queryKey: queryKeys.driverGroups.detail(id ?? ""),
    queryFn: () => getDriverGroup(id!),
    enabled: Boolean(id),
  });
}

export function useDriverGroupsForDriver(driverId: string | null) {
  return useQuery({
    queryKey: queryKeys.driverGroups.forDriver(driverId ?? ""),
    queryFn: () => listGroupsForDriver(driverId!),
    enabled: Boolean(driverId),
  });
}

export function useSearchDriversForGroup(query: string) {
  return useQuery({
    queryKey: queryKeys.driverGroups.searchDrivers(query),
    queryFn: () => searchDriversForGroup(query),
    enabled: query.trim().length >= 1,
  });
}
