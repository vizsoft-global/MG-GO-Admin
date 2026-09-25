import {
  INCENTIVE_PERIODS,
  RULE_STATUSES,
  type IncentivePeriod,
  type IncentiveRuleRow,
  type RuleStatus,
} from "./types";

export type IncentiveRuleStatusFilter = "all" | RuleStatus;
export type IncentiveRulePeriodFilter = "all" | IncentivePeriod;

export type IncentiveRuleListFilter = {
  query: string;
  status: IncentiveRuleStatusFilter;
  period: IncentiveRulePeriodFilter;
};

export type IncentiveRuleFilterable = Pick<
  IncentiveRuleRow,
  "name" | "scope_label" | "status" | "period"
>;

export function isIncentiveRuleStatusFilter(
  value: string,
): value is IncentiveRuleStatusFilter {
  return value === "all" || (RULE_STATUSES as readonly string[]).includes(value);
}

export function isIncentiveRulePeriodFilter(
  value: string,
): value is IncentiveRulePeriodFilter {
  return value === "all" || (INCENTIVE_PERIODS as readonly string[]).includes(value);
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Display only. Does not change the stored name or search haystack. */
export function displayIncentiveRuleName(name: string): string {
  return name.replace(/\s+\d{4}-\d{2}-\d{2}$/, "");
}

export function filterIncentiveRules<T extends IncentiveRuleFilterable>(
  rows: readonly T[],
  filter: IncentiveRuleListFilter,
): T[] {
  const query = normalizeSearch(filter.query);
  return rows.filter((row) => {
    if (filter.status !== "all" && row.status !== filter.status) return false;
    if (filter.period !== "all" && row.period !== filter.period) return false;
    if (!query) return true;
    return (
      normalizeSearch(row.name).includes(query) ||
      normalizeSearch(row.scope_label).includes(query)
    );
  });
}
