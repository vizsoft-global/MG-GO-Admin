export type VehicleUseType = {
  key: string;
  label_en: string;
  label_ar: string;
  is_active: boolean;
  is_system: boolean;
  sort_order: number;
};

export type VehicleUseTypeWithUsage = VehicleUseType & { vehicle_count: number };

export const USE_TYPE_KEY_RE = /^[a-z0-9_]{1,24}$/;

export function useTypeKeyFromLabel(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

export function useTypeLabel(
  key: string | null | undefined,
  types: readonly VehicleUseType[],
  locale: string,
): string {
  if (!key) return "—";
  const hit = types.find((item) => item.key === key);
  if (!hit) return key;
  return locale.startsWith("ar") ? hit.label_ar : hit.label_en;
}
