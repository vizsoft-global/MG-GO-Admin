"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { fetchPartnersForAdmin, loadPartnerSelectOptions } from "./partners-actions";
import type { PartnerRow } from "./types";

export async function fetchPartners(): Promise<PartnerRow[]> {
  return fetchPartnersForAdmin();
}

/** Id+name for filters. Any panel user; does not require partners.view. */
export async function fetchPartnerSelectOptions(): Promise<Array<{ id: string; name: string }>> {
  return loadPartnerSelectOptions();
}

export function usePartnersList() {
  return useQuery({
    queryKey: queryKeys.partners.list(),
    queryFn: fetchPartners,
  });
}
