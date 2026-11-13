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

/** The job-positions catalog the Profile's Job Position picker reads. */
export function useJobPositions() {
  return useEmployeeCatalog("job_positions");
}

/**
 * The four catalogs the client asked Employee Settings to own.
 *
 * Each one was a compiled enum or a fixed list in code before this existed, so
 * every reader keeps that compiled list as its fallback — an empty collection
 * renders exactly what the app showed yesterday.
 */
export function useHiringTypes() {
  return useEmployeeCatalog("hiring_types");
}

export function useJobEndDescriptions() {
  return useEmployeeCatalog("job_end_descriptions");
}

export function useNationalities() {
  return useEmployeeCatalog("nationalities");
}

export function usePaymentCurrencies() {
  return useEmployeeCatalog("payment_currencies");
}
