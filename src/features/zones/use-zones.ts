"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { loadZoneDriversForPanel, loadZonesForPanel } from "./zones-read-actions";
import type { ZoneDriverRow, ZoneRow } from "./types";

export async function fetchZones(): Promise<ZoneRow[]> {
  return loadZonesForPanel();
}

export async function fetchZoneDrivers(zoneId: string): Promise<ZoneDriverRow[]> {
  return loadZoneDriversForPanel(zoneId);
}

export function useZonesList() {
  return useQuery({
    queryKey: queryKeys.zones.list(),
    queryFn: fetchZones,
  });
}

export function useZoneDrivers(zoneId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.zones.drivers(zoneId ?? ""),
    queryFn: () => fetchZoneDrivers(zoneId!),
    enabled: Boolean(zoneId) && enabled,
  });
}
