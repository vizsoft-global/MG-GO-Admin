export type VehicleCompany = {
  key: string;
  label_en: string;
  label_ar: string;
  is_active: boolean;
  sort_order: number;
};

export type VehicleCompanyWithUsage = VehicleCompany & { vehicle_count: number };

export const COMPANY_KEY_RE = /^[a-z0-9_]{1,32}$/;

export function companyKeyFromLabel(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    // Truncate **before** the trailing trim, or a name whose 32nd character is
    // the separator leaves a dangling `_` and fails `COMPANY_KEY_RE`.
    .slice(0, 32)
    .replace(/_+$/g, "");
}

export function companyLabel(
  key: string | null | undefined,
  companies: readonly VehicleCompany[],
  locale: string,
): string {
  if (!key) return "—";
  const hit = companies.find((item) => item.key === key);
  if (!hit) return key;
  return locale.startsWith("ar") ? hit.label_ar || hit.label_en : hit.label_en;
}
