"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { listVehiclePartners, listVehicleTypes, listVehicles } from "./vehicles-actions";

export function useVehiclesList() {
  return useQuery({
    queryKey: queryKeys.vehicles.list(),
    queryFn: listVehicles,
  });
}

export function useVehicleTypes() {
  return useQuery({
    queryKey: [...queryKeys.vehicles.all(), "types"] as const,
    queryFn: listVehicleTypes,
  });
}

export function useVehiclePartners() {
  return useQuery({
    queryKey: [...queryKeys.vehicles.all(), "partners"] as const,
    queryFn: listVehiclePartners,
  });
}
