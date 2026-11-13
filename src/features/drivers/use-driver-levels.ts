"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { panelGet } from "@/lib/browser/panel-get";
import {
  evaluateDriverLevels,
  listDriverLevels,
  setDriverLevelOverride,
  type DriverLevelFilter,
  type DriverLevelRow,
} from "./driver-level-actions";

export type { DriverLevelFilter };

type LevelsAnswer = Awaited<ReturnType<typeof listDriverLevels>>;

/**
 * One request for the whole fleet. The backend builds every rider's level on each
 * call and only then slices, so asking 500 at a time repeated that work for each
 * slice. The loop stays for a fleet larger than one answer, and for a backend
 * that still caps the answer lower: it advances by what actually came back.
 */
const PAGE = 2000;
const CAP = 6000;

export const driverLevelKeys = {
  index: () => ["driver-levels", "index"] as const,
  one: (driverId: string) => ["driver-levels", "one", driverId] as const,
};

async function loadIndex(): Promise<Map<string, DriverLevelRow>> {
  const map = new Map<string, DriverLevelRow>();
  let offset = 0;
  let total = Infinity;
  while (offset < total && offset < CAP) {
    // A GET, not a server action: this is the slowest read on the page and it must
    // not hold the page's own requests behind it. See `panelGet`.
    const { data, error } = await panelGet<LevelsAnswer>(
      `/api/drivers/levels?limit=${PAGE}&offset=${offset}`,
    );
    if (error || !data) throw new Error(error ?? "unknown");
    for (const row of data.rows) map.set(row.driver_id, row);
    total = data.total;
    if (data.rows.length === 0) break;
    offset += data.rows.length;
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
