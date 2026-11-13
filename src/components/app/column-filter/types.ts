/**
 * The one set of words and shapes every column-header filter speaks.
 *
 * Five modules grew their own funnel over time (Payroll, HR Payroll, Employees,
 * Vehicles, Performance, Order reconciliation) and they disagreed about what a
 * search box inside the popover does. They now all render
 * `ColumnHeaderFilter`, which is why the draft — the operator's uncommitted
 * choices — is a shape of its own instead of being the page's filter type.
 */
export type ColumnFilterMode = "text" | "list" | "range";

/** What the operator has typed or ticked inside an open popover. */
export type ColumnFilterDraft = {
  mode: ColumnFilterMode;
  /** Text mode input. */
  text: string;
  /** List mode search box. */
  query: string;
  /** List mode ticks. */
  picked: string[];
  min: string;
  max: string;
};

export type ColumnFilterOption = {
  value: string;
  label: string;
  /** Rows carrying this value; omitted by the wrappers that have no tally. */
  count?: number;
};

export type ColumnFilterLabels = {
  /** "Filter Employee Name" — the popover title. */
  title: (column: string) => string;
  mode: Partial<Record<ColumnFilterMode, string>>;
  search: string;
  contains: string;
  all: string;
  clear: string;
  apply: string;
  min: string;
  max: string;
  noOptions: string;
  blank: string;
  filterBy: (label: string) => string;
  /** Range mode shortcuts; rendered only when both are supplied. */
  sortSmallest?: string;
  sortLargest?: string;
};

export const EMPTY_COLUMN_FILTER_DRAFT: ColumnFilterDraft = {
  mode: "list",
  text: "",
  query: "",
  picked: [],
  min: "",
  max: "",
};
