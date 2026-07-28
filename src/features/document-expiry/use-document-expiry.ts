"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { fetchDocumentExpiryDashboard } from "./document-expiry-actions";

export function useDocumentExpiryDashboard() {
  return useQuery({
    queryKey: queryKeys.documentExpiry.dashboard(),
    queryFn: async () => {
      const result = await fetchDocumentExpiryDashboard();
      if (result.error) throw new Error(result.error);
      return result;
    },
    staleTime: 30_000,
  });
}
