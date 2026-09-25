import type { DriverRiderCategory } from "./types";

/** Row of `public.source_companies`. `client_code` is the company's Client ID. */
export type SourceCompany = {
  key: string;
  name: string;
  client_code: string | null;
  is_active: boolean;
  is_system: boolean;
  sort_order: number;
};

export type SourceCompanyWithUsage = SourceCompany & { driver_count: number };

export const COMPANY_KEY_RE = /^[a-z0-9_]{1,24}$/;
export const CLIENT_CODE_RE = /^[A-Z0-9-]{1,32}$/;

export function normalizeClientCode(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim().toUpperCase();
  return v || null;
}

/** Derives a key from a new company's name: "Al Sadeeq Co." → "al_sadeeq_co". */
export function companyKeyFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

/**
 * Sheet / form input → company key. Matches key, name or Client ID
 * (case-insensitive). Inactive companies do not match. Blank is null.
 */
export function resolveCompanyInput(
  raw: string | null | undefined,
  companies: readonly SourceCompany[],
): string | null | "invalid" {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  const hit = companies.find(
    (c) =>
      c.is_active &&
      (c.key === value ||
        c.name.trim().toLowerCase() === value ||
        (c.client_code ?? "").toLowerCase() === value),
  );
  return hit ? hit.key : "invalid";
}

/**
 * In-house riders belong to the system company (MG); outsourced riders to a
 * non-system one or none (Unassigned).
 */
export function companyMatchesCategory(
  riderCategory: DriverRiderCategory,
  companyKey: string | null,
  companies: readonly SourceCompany[],
): boolean {
  if (!companyKey) return true;
  const company = companies.find((c) => c.key === companyKey);
  if (!company) return false;
  return riderCategory === "in_house" ? company.is_system : !company.is_system;
}

/** Companies an operator may pick for this category (current value kept even if inactive). */
export function selectableCompanies(
  riderCategory: DriverRiderCategory,
  companies: readonly SourceCompany[],
  currentKey: string | null,
): SourceCompany[] {
  return companies.filter(
    (c) =>
      (c.is_active || c.key === currentKey) &&
      (riderCategory === "in_house" ? c.is_system : !c.is_system),
  );
}
