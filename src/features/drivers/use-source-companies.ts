"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import type { SourceCompany } from "./source-companies";
import { listSourceCompanies } from "./source-companies-actions";

const NO_COMPANIES: SourceCompany[] = [];

export function useSourceCompanies(): SourceCompany[] {
  const { data } = useQuery({
    queryKey: queryKeys.sourceCompanies.list(),
    queryFn: () => listSourceCompanies(),
    staleTime: 5 * 60_000,
  });
  return data ?? NO_COMPANIES;
}
