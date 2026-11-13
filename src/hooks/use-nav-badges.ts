"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { panelGet } from "@/lib/browser/panel-get";
import { queryKeys } from "@/lib/query/query-keys";

type RequestTypeCounts = { counts: Record<string, { total: number; pending: number }>; error?: string };

/**
 * Sidebar counters shown next to nav items (Figma `4149:24182` sidebar).
 * Keyed by menu registry node id.
 */
export function useNavBadges(): Record<string, number> {
  const { can } = useAuth();
  const canViewRequests = can("requests.view");

  const { data } = useQuery({
    queryKey: queryKeys.requests.typeCounts(),
    // A GET, not a server action: see `panelGet`. Same answer, same cache key.
    queryFn: () => panelGet<RequestTypeCounts>("/api/nav/badges?kind=requests"),
    enabled: canViewRequests,
    staleTime: 60_000,
  });

  const pending = Object.values(data?.counts ?? {}).reduce(
    (sum, c) => sum + c.pending,
    0,
  );

  const canViewVerifications = can("verifications.view");

  const { data: pendingVerifications } = useQuery({
    queryKey: queryKeys.verifications.pendingCount(),
    queryFn: async () => (await panelGet<{ count: number }>("/api/nav/badges?kind=verifications")).count,
    enabled: canViewVerifications,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const badges: Record<string, number> = {};

  if (pending > 0) {
    badges.requests = pending;
    badges.employeedesk = pending;
  }

  if ((pendingVerifications ?? 0) > 0) {
    badges["dpd-verification"] = pendingVerifications ?? 0;
  }

  return badges;
}
