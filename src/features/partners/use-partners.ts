"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query/query-keys";
import { fetchPartnersForAdmin } from "./partners-actions";
import type { PartnerRow } from "./types";

export async function fetchPartners(): Promise<PartnerRow[]> {
  return fetchPartnersForAdmin();
}

/** Id+name for filters. Any panel user (RLS); does not require partners.view. */
export async function fetchPartnerSelectOptions(): Promise<Array<{ id: string; name: string }>> {
  const supabase = createClient();
  const { data, error } = await supabase.from("partners").select("id, name").order("name");
  if (error) throw error;
  return data ?? [];
}

export function usePartnersList() {
  return useQuery({
    queryKey: queryKeys.partners.list(),
    queryFn: fetchPartners,
  });
}
