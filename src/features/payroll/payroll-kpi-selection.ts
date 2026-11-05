/**
 * The one rule a clickable summary card follows: choosing a card filters the
 * table, choosing the same card again clears the filter. Keeping it here (rather
 * than inline in six tabs) is what stops one tab from being a one-way filter.
 */
export function nextKpiSelection<T extends string>(current: T | null, key: T): T | null {
  return current === key ? null : key;
}

/** True when the card is the one currently driving the table. */
export function kpiSelected<T extends string>(current: T | null, key: T): boolean {
  return current === key;
}

/** The Payroll summary cards that describe a row an operator can filter to. */
export type PayrollKpiKey = "active" | "atOrAbove100" | "unjustified" | "reduced3Days" | "manualAdjustments";

/**
 * The one fact set a card's number and its filter are both derived from.
 *
 * Every figure is a boolean or a count of riders, never a KWD/hour total: a card
 * that prints a sum cannot be filtered to the rows that produced it, so the sum
 * and the table would always disagree. `efficiency` is a **percent** (100 = 100%),
 * not a fraction — the old filter compared it with 1 and filled the table with
 * riders at 1%-99% under a card reading 0.
 */
export type PayrollKpiFacts = {
  status: "Active" | "Inactive";
  /** Attendance efficiency as a percent. */
  efficiency: number;
  unjustified: number;
  reduced3: boolean;
  adjusted: boolean;
};

/** Only the row fields a KPI card's predicate reads. */
export type PayrollKpiRow = {
  status: "Active" | "Inactive";
  efficiency: number;
  unjustified: number;
  days: readonly string[];
  adjusted: boolean;
};

/** The aggregate row `computePayrollKpis` counts, before it knows about `days`. */
export type PayrollKpiCountRow = {
  status: "Active" | "Inactive";
  efficiency: number;
  unjustified: number;
  reducedDays?: number;
  adjustedCells?: number;
};

/**
 * The single predicate per card. `riderMatchesKpi` and `computePayrollKpis` both
 * go through this, so the number above the table and the table itself cannot
 * drift apart again.
 */
export function kpiPredicate(key: PayrollKpiKey | null): (facts: PayrollKpiFacts) => boolean {
  switch (key) {
    case null:
      return () => true;
    case "active":
      return (facts) => facts.status === "Active";
    case "atOrAbove100":
      // Percent, not fraction: the card counts `efficiency >= 100`.
      return (facts) => facts.efficiency >= 100;
    case "unjustified":
      return (facts) => facts.unjustified > 0;
    case "reduced3Days":
      return (facts) => facts.reduced3;
    case "manualAdjustments":
      return (facts) => facts.adjusted;
    default: {
      const never: never = key;
      return never;
    }
  }
}

/** Facts from a rendered sheet row (day tokens + adjustment flag). */
export function kpiFactsOfRow(row: PayrollKpiRow): PayrollKpiFacts {
  return {
    status: row.status,
    efficiency: row.efficiency,
    unjustified: row.unjustified,
    reduced3: row.days.includes("reduced3"),
    adjusted: row.adjusted,
  };
}

/** Facts from the aggregate row the summary cards count. */
export function kpiFactsOfCountRow(row: PayrollKpiCountRow): PayrollKpiFacts {
  return {
    status: row.status,
    efficiency: row.efficiency,
    unjustified: row.unjustified,
    reduced3: (row.reducedDays ?? 0) > 0,
    adjusted: (row.adjustedCells ?? 0) > 0,
  };
}

/** The Combined sheet's cards that describe a row an operator can filter to. */
export type CombinedKpiKey = "riders" | "active" | "activeAmericana" | "activeKeeta";

/**
 * Does this rider belong under that Combined card?
 *
 * `keeta` is the same test the card counts with (`companyDayHours(...) === 10`),
 * passed in so this module stays free of the payroll formulas.
 */
export function combinedRiderMatchesKpi(
  row: { status: "Active" | "Inactive"; keeta: boolean },
  key: CombinedKpiKey | null,
): boolean {
  switch (key) {
    case null:
    case "riders":
      return true;
    case "active":
      return row.status === "Active";
    case "activeKeeta":
      return row.status === "Active" && row.keeta;
    case "activeAmericana":
      return row.status === "Active" && !row.keeta;
    default: {
      const never: never = key;
      return never;
    }
  }
}

/**
 * Does this rider belong under that Payroll card?
 *
 * Every predicate here is the same figure the card prints, so the number above
 * the table and the table itself cannot disagree. A card with no honest
 * row-level predicate (average efficiency is a mean) is not mapped at all and the
 * UI renders it disabled.
 */
export function riderMatchesKpi(row: PayrollKpiRow, key: PayrollKpiKey | null): boolean {
  return kpiPredicate(key)(kpiFactsOfRow(row));
}

