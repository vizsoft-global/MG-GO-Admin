"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
  evaluateDriverLevels,
  listDriverLevels,
  setDriverLevelOverride,
  type DriverLevelFilter,
  type DriverLevelRow,
} from "./driver-level-actions";

export type { DriverLevelFilter };

const PAGE = 500;
const CAP = 2000;

export const driverLevelKeys = {
  index: () => ["driver-levels", "index"] as const,
  one: (driverId: string) => ["driver-levels", "one", driverId] as const,
};

async function loadIndex(): Promise<Map<string, DriverLevelRow>> {
  const map = new Map<string, DriverLevelRow>();
  let offset = 0;
  let total = Infinity;
  while (offset < total && offset < CAP) {
    const { data, error } = await listDriverLevels({ limit: PAGE, offset });
    if (error || !data) throw new Error(error ?? "unknown");
    for (const row of data.rows) map.set(row.driver_id, row);
    total = data.total;
    if (data.rows.length === 0) break;
    offset += PAGE;
  }
  return map;
}

export function useDriverLevelIndex(enabled = true) {
  return useQuery({
    queryKey: driverLevelKeys.index(),
    queryFn: loadIndex,
    enabled,
    staleTime: 60_000,
    retry: 0,
  });
}

export function useDriverLevel(driverId: string | null) {
  return useQuery({
    queryKey: driverLevelKeys.one(driverId ?? ""),
    enabled: Boolean(driverId),
    staleTime: 30_000,
    retry: 0,
    queryFn: async () => {
      const { data, error } = await listDriverLevels({ driverId: driverId ?? "", limit: 1 });
      if (error || !data) throw new Error(error ?? "unknown");
      return data.rows[0] ?? null;
    },
  });
}

export function useDriverLevelOverride() {
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const save = useCallback(
    async (input: { driverId: string; level: "D" | "standard" | "clear"; reason?: string }) => {
      setPending(true);
      try {
        const result = await setDriverLevelOverride(input);
        if (result.ok) {
          await client.invalidateQueries({ queryKey: ["driver-levels"] });
        }
        return result;
      } finally {
        setPending(false);
      }
    },
    [client],
  );
  const sweep = useCallback(async () => {
    setPending(true);
    try {
      const result = await evaluateDriverLevels();
      if (result.ok) await client.invalidateQueries({ queryKey: ["driver-levels"] });
      return result;
    } finally {
      setPending(false);
    }
  }, [client]);
  return { save, sweep, pending };
}

export function matchesLevelFilter(
  row: DriverLevelRow | undefined,
  filter: DriverLevelFilter,
): boolean {
  if (filter === "all") return true;
  if (!row) return false;
  if (filter === "override") return row.override_level != null;
  return row.level === filter;
}
