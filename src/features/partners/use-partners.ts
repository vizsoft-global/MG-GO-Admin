"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { fetchPartnersForAdmin } from "./partners-actions";
import type { PartnerRow } from "./types";

export async function fetchPartners(): Promise<PartnerRow[]> {
  return fetchPartnersForAdmin();
}

export function usePartnersList() {
  return useQuery({
    queryKey: queryKeys.partners.list(),
    queryFn: fetchPartners,
  });
}
