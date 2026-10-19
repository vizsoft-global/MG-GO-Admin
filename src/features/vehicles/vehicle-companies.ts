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
    .slice(0, 32);
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
