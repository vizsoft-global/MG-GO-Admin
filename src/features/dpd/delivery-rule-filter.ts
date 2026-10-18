import { textContainsMatch } from "@/lib/search/prefix";
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
      textContainsMatch(row.name, needle) ||
      textContainsMatch(row.scope_label, needle) ||
      textContainsMatch(row.scope_search, needle)
    );
  });
}
