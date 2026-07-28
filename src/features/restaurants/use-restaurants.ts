"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  fetchRestaurantActivityLog,
  fetchRestaurantAssignedDrivers,
  fetchRestaurantDeliveries,
  fetchRestaurantDetail,
  fetchRestaurantPartnerOptions,
  fetchRestaurantZoneOptions,
  fetchRestaurantsForAdmin,
  type RestaurantDeliveriesFilter,
} from "./restaurants-actions";

export function useRestaurantsList() {
  return useQuery({
    queryKey: queryKeys.restaurants.list(),
    queryFn: fetchRestaurantsForAdmin,
  });
}

export function useRestaurantDetail(id: string) {
  return useQuery({
    queryKey: queryKeys.restaurants.detail(id),
    queryFn: () => fetchRestaurantDetail(id),
    enabled: Boolean(id),
  });
}

export function useRestaurantAssignedDrivers(id: string) {
  return useQuery({
    queryKey: queryKeys.restaurants.assignedDrivers(id),
    queryFn: () => fetchRestaurantAssignedDrivers(id),
    enabled: Boolean(id),
  });
}

export function useRestaurantDeliveries(
  id: string,
  filters: RestaurantDeliveriesFilter = {},
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.restaurants.deliveries(id, filters),
    queryFn: () => fetchRestaurantDeliveries(id, filters),
    enabled: Boolean(id) && enabled,
  });
}

export function useRestaurantActivityLog(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.restaurants.activity(id),
    queryFn: () => fetchRestaurantActivityLog(id),
    enabled: Boolean(id) && enabled,
  });
}

export function useRestaurantPartnerOptions() {
  return useQuery({
    queryKey: queryKeys.restaurants.partnerOptions(),
    queryFn: fetchRestaurantPartnerOptions,
  });
}

export function useRestaurantZoneOptions() {
  return useQuery({
    queryKey: queryKeys.restaurants.zoneOptions(),
    queryFn: fetchRestaurantZoneOptions,
  });
}
