export const PENALTY_SUBCATEGORY_KEYS = [
  "late_attendance",
  "unauthorised_absence",
  "written_warning",
  "damage_to_property",
  "penalty_others",
] as const;

export function isPenaltyChild(row: { key: string; parent_key?: string | null }): boolean {
  return row.parent_key === "penalty" && PENALTY_SUBCATEGORY_KEYS.includes(
    row.key as (typeof PENALTY_SUBCATEGORY_KEYS)[number],
  );
}
