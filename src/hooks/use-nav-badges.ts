"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { fetchRequestTypeCounts } from "@/features/requests/requests-actions";
import { queryKeys } from "@/lib/query/query-keys";

/**
 * Sidebar counters shown next to nav items (Figma `4149:24182` sidebar).
 * Keyed by menu registry node id.
 */
export function useNavBadges(): Record<string, number> {
  const { can } = useAuth();
  const canViewRequests = can("requests.view");

  const { data } = useQuery({
    queryKey: queryKeys.requests.typeCounts(),
    queryFn: () => fetchRequestTypeCounts(),
    enabled: canViewRequests,
    staleTime: 60_000,
  });

  const pending = Object.values(data?.counts ?? {}).reduce(
    (sum, c) => sum + c.pending,
    0,
  );

  return pending > 0 ? { requests: pending } : {};
}
