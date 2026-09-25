import type { DeliveryRuleRow } from "./types";

export type DeliveryRuleFilterable = Pick<
  DeliveryRuleRow,
  "name" | "scope_label" | "scope_search"
>;

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function filterDeliveryRules<T extends DeliveryRuleFilterable>(
  rows: readonly T[],
  query: string,
): T[] {
  const needle = normalizeSearch(query);
  if (!needle) return [...rows];
  return rows.filter((row) => {
    return (
      normalizeSearch(row.name).includes(needle) ||
      normalizeSearch(row.scope_label).includes(needle) ||
      normalizeSearch(row.scope_search).includes(needle)
    );
  });
}
