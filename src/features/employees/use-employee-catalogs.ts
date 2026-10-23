"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { listEmployeeCatalog } from "./employee-catalogs-actions";
import type { EmployeeCatalogKind } from "./employee-catalogs";

export function useEmployeeCatalog(kind: EmployeeCatalogKind) {
  return useQuery({
    queryKey: queryKeys.employees.catalog(kind),
    queryFn: () => listEmployeeCatalog(kind),
    staleTime: 60_000,
  });
}

export function useEmployeeStatuses() {
  return useEmployeeCatalog("employee_statuses");
}

export function useEmployeeSections() {
  return useEmployeeCatalog("employee_sections");
}

export function useNationalityCategories() {
  return useEmployeeCatalog("nationality_categories");
}

export function useBankCodes() {
  return useEmployeeCatalog("bank_codes");
}

/** The sponsorship catalog the Profile's Sponsorship picker reads. */
export function useSponsorships() {
  return useEmployeeCatalog("sponsorships");
}
