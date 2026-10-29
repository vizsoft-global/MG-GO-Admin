"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { fetchZones } from "@/features/zones/use-zones";
import { queryKeys } from "@/lib/query/query-keys";
import type { PayrollClientConfig } from "./payroll-rules-engine";

export type PayrollAssignOption = {
  value: string;
  label: string;
  keywords: string[];
};

type Catalog = {
  clients: PayrollAssignOption[];
  zones: PayrollAssignOption[];
  restaurants: PayrollAssignOption[];
  zonesLoading: boolean;
};

const EMPTY: Catalog = { clients: [], zones: [], restaurants: [], zonesLoading: false };
const PayrollAssignCatalogContext = createContext<Catalog>(EMPTY);

export function PayrollAssignCatalogProvider({
  clients,
  restaurants = [],
  enabled,
  children,
}: {
  clients: readonly PayrollClientConfig[];
  /**
   * The restaurant catalogue the payroll snapshot already carries for the Store
   * slicer. Reusing it keeps the Combined row's dropdown off a second scan.
   */
  restaurants?: ReadonlyArray<{ id: string; name: string }>;
  enabled: boolean;
  children: ReactNode;
}) {
  const zonesQuery = useQuery({
    queryKey: queryKeys.zones.list(),
    queryFn: fetchZones,
    enabled,
    staleTime: 60_000,
  });
  const value = useMemo<Catalog>(() => {
    const clientItems = clients
      .filter((client) => client.key.trim())
      .map((client) => ({
        value: client.key,
        label: client.name.trim() || client.key,
        keywords: [client.key, client.name].filter((part) => part.trim().length > 0),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const zoneItems = (zonesQuery.data ?? [])
      .filter((zone) => zone.id && zone.name.trim())
      .map((zone) => ({
        value: zone.id,
        label: zone.name.trim(),
        keywords: [zone.name, zone.code].filter((part) => part.trim().length > 0),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const restaurantItems = restaurants
      .filter((restaurant) => restaurant.id && restaurant.name.trim())
      .map((restaurant) => ({
        value: restaurant.id,
        label: restaurant.name.trim(),
        keywords: [restaurant.name.trim()],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return {
      clients: clientItems,
      zones: zoneItems,
      restaurants: restaurantItems,
      zonesLoading: zonesQuery.isLoading,
    };
  }, [clients, zonesQuery.data, zonesQuery.isLoading, restaurants]);
  return (
    <PayrollAssignCatalogContext.Provider value={value}>
      {children}
    </PayrollAssignCatalogContext.Provider>
  );
}

export function usePayrollAssignCatalog(): Catalog {
  return useContext(PayrollAssignCatalogContext);
}
