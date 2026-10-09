"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { fetchPartners } from "@/features/partners/use-partners";
import { fetchRestaurantPickerOptions } from "@/features/restaurants/restaurants-actions";
import { fetchZones } from "@/features/zones/use-zones";
import { listAvailableVehicles } from "./drivers-actions";
import type { PartnerOption, RestaurantOption, VehicleOption, ZoneOption } from "./types";

export async function fetchAvailableVehicles(): Promise<VehicleOption[]> {
  return listAvailableVehicles();
}

export type DriverFormOptions = {
  partners: PartnerOption[];
  zones: ZoneOption[];
  vehicles: VehicleOption[];
  restaurants: RestaurantOption[];
};

export async function fetchDriverFormOptions(): Promise<DriverFormOptions> {
  const [partners, zones, vehicles, restaurants] = await Promise.all([
    fetchPartners(),
    fetchZones(),
    fetchAvailableVehicles(),
    fetchRestaurantPickerOptions(),
  ]);

  return {
    partners: partners.map((p) => ({
      id: p.id,
      name: p.name,
      logo_url: p.logo_url,
    })),
    zones: zones.map((z) => ({
      id: z.id,
      name: z.name,
      code: z.code,
    })),
    vehicles,
    restaurants: restaurants.map((r) => ({
      id: r.id,
      name: r.name,
      partner_id: r.partner_id,
      partner_name: r.partner_name,
      status: r.status,
    })),
  };
}

export function useDriverFormOptions() {
  return useQuery({
    queryKey: [...queryKeys.drivers.all(), "form-options"] as const,
    queryFn: fetchDriverFormOptions,
    staleTime: 0,
    refetchOnMount: "always",
  });
}
