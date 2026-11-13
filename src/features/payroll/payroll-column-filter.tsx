"use client";

import { useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowDownAZ, ArrowUpAZ, ListFilter, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ColumnHeaderFilter,
  type ColumnFilterDraft,
  type ColumnFilterLabels,
  type ColumnFilterMode,
  type ColumnFilterOption,
} from "@/components/app/column-filter";
import { countValueOccurrences, sortParticularValues } from "./payroll-particulars";
import { draftToColumnFilter, draftToLiveFilter } from "./payroll-column-filter-map";
import {
  columnFilterActive,
  type ColumnFilterValue,
  type ColumnSort,
} from "./payroll-column-filter-match";

/**
 * The value shapes and row-matching rules live in a plain module so they can be
 * asserted without a renderer; this file re-exports them so every existing
 * import keeps its path.
 */
export {
  activeFilterChips,
  columnFilterActive,
  listMatches,
  matchesColumnFilter,
  rangeMatches,
  rowMatchesColumnFilters,
  sortByColumn,
  textMatches,
  type ColumnFilters,
  type ColumnFilterValue,
  type ColumnSort,
} from "./payroll-column-filter-match";

/** The bounds a Range filter is actually applying, for the header hint. */
export function rangeBoundsLabel(filter: ColumnFilterValue | undefined): string | null {
  if (!filter || filter.kind !== "range") return null;
  if (filter.min === null && filter.max === null) return null;
  const min = filter.min === null ? "" : String(filter.min);
  const max = filter.max === null ? "" : String(filter.max);
  return `${min || "…"} – ${max || "…"}`;
}

export function PayrollFilterChips({
  chips,
  onClear,
  onRemove,
  clearLabel,
  sortLabel,
  prefix,
}: {
  chips: Array<{ columnId: string; text: string }>;
  onClear: () => void;
  onRemove: (columnId: string) => void;
  clearLabel: string;
  sortLabel?: string | null;
  prefix?: string;
}) {
  if (!chips.length && !sortLabel) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {prefix ? (
        <span className="text-xs font-semibold text-muted-foreground">{prefix}</span>
      ) : null}
      {chips.map((chip) => (
        <span
          key={chip.columnId}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-muted/40 px-2 text-xs font-medium text-foreground"
        >
          <ListFilter className="size-3 text-muted-foreground" />
          {chip.text}
          <button
            type="button"
            onClick={() => onRemove(chip.columnId)}
            className="rounded-sm text-muted-foreground transition-colors hover:text-destructive"
            aria-label={chip.text}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {sortLabel ? (
        <span className="inline-flex h-7 items-center rounded-md border border-primary/30 bg-primary/10 px-2 text-xs font-semibold text-primary">
          {sortLabel}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onClear}
        className="inline-flex h-7 items-center rounded-md px-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
      >
        {clearLabel}
      </button>
    </div>
  );
}

/**
 * A header cell with the filter popover. `values` feeds the List mode; `numeric`
 * turns on Range mode. Sort is a pair of buttons rather than a third mode, since
 * sorting and filtering compose.
 */
function defaultFilterMode(
  filter: ColumnFilterValue | undefined,
  values: readonly string[] | undefined,
  numeric: boolean,
  fixedList?: readonly string[],
): ColumnFilterMode {
  if (fixedList && fixedList.length > 0) return "list";
  if (filter?.kind) return filter.kind;
  // A numeric column opens on Range, not List: money, counts, hours, days and
  // percentages are answered with "between two figures" far more often than with
  // ticking a hundred distinct values.
  if (numeric) return "range";
  if (values && values.length > 0) return "list";
  return "text";
}

/**
 * The payroll funnel, delegating to the shared `ColumnHeaderFilter`.
 *
 * Two behaviours are worth naming because they are the point of sharing it:
 * typing in the List search narrows **this table** on the keystroke (not just
 * the checklist), and closing the popover without Apply puts the committed
 * filter back, so a half-typed query cannot leave a column silently narrowed.
 */
export function PayrollColumnHeader({
  label,
  columnId,
  values,
  filter,
  onChange,
  sort,
  onSort,
  numeric = false,
  fixedList,
  className,
  style,
  heading,
  sortPair = false,
  listLabel,
}: {
  label: string;
  columnId: string;
  values?: readonly string[];
  filter: ColumnFilterValue | undefined;
  onChange: (next: ColumnFilterValue | null) => void;
  sort: ColumnSort;
  onSort: (next: ColumnSort) => void;
  numeric?: boolean;
  /** When set, List mode shows these labels in this order instead of the column's own words. */
  fixedList?: readonly string[];
  className?: string;
  style?: CSSProperties;
  heading?: ReactNode;
  /**
   * Draw the ▲▼ pair in the header and cycle asc → desc → none. Combined Payroll
   * asks for the sort to be a target of its own, next to the funnel.
   */
  sortPair?: boolean;
  /**
   * How List mode prints a stored value. The tick still stores the raw value, so
   * a `74.0%` label keeps filtering on the number.
   */
  listLabel?: (value: string) => string;
}) {
  const t = useTranslations("pages.payroll.columnFilter");
  /** The filter that was committed when the popover opened, restored on close. */
  const committedAtOpen = useRef<ColumnFilterValue | undefined>(filter);

  const counts = useMemo(() => countValueOccurrences(values ?? []), [values]);
  const uniqueValues = useMemo(
    () => (fixedList ? [...fixedList] : sortParticularValues([...new Set(values ?? [])])),
    [fixedList, values],
  );
  const options = useMemo<ColumnFilterOption[]>(
    () =>
      uniqueValues.map((value) => ({
        value,
        label: listLabel ? listLabel(value) || t("blank") : value || t("blank"),
        count: counts.get(value) ?? 0,
      })),
    [uniqueValues, counts, listLabel, t],
  );

  const modes: readonly ColumnFilterMode[] = fixedList
    ? ["list"]
    : numeric
      ? ["range", "text", "list"]
      : ["text", "list"];
  const defaultMode = defaultFilterMode(filter, values, numeric, fixedList);

  const active = columnFilterActive(filter);
  const sorted = sort?.columnId === columnId ? sort.dir : null;
  const bounds = rangeBoundsLabel(filter);

  const labels: ColumnFilterLabels = {
    title: (column) => t("title", { column }),
    mode: { text: t("mode.text"), list: t("mode.list"), range: t("mode.range") },
    search: t("searchPlaceholder"),
    contains: t("textPlaceholder"),
    all: t("all"),
    clear: t("clear"),
    apply: t("apply"),
    min: t("min"),
    max: t("max"),
    noOptions: t("noOptions"),
    blank: t("blank"),
    filterBy: (column) => t("title", { column }),
    sortSmallest: t("sortSmallest"),
    sortLargest: t("sortLargest"),
  };

  function draftFromCommitted(): ColumnFilterDraft {
    return {
      mode: defaultMode,
      text: filter?.kind === "text" ? filter.text : "",
      query: "",
      picked: filter?.kind === "list" ? [...filter.values] : [],
      min: filter?.kind === "range" && filter.min !== null ? String(filter.min) : "",
      max: filter?.kind === "range" && filter.max !== null ? String(filter.max) : "",
    };
  }

  /** asc → desc → none, so a third click clears the sort. */
  function cycleSort() {
    if (sorted === "asc") onSort({ columnId, dir: "desc" });
    else if (sorted === "desc") onSort(null);
    else onSort({ columnId, dir: "asc" });
  }

  return (
    <th className={cn("whitespace-nowrap px-2 py-2 text-start align-bottom", className)} style={style}>
      <span className="inline-flex items-center gap-1">
        {heading ?? <span>{label}</span>}
        {sortPair ? (
          <button
            type="button"
            onClick={cycleSort}
            aria-label={t("sortPair", { column: label })}
            aria-pressed={Boolean(sorted)}
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center rounded-sm transition-colors",
              sorted
                ? "bg-primary/10 text-primary ring-1 ring-primary/40"
                : "text-muted-foreground/60 hover:bg-muted hover:text-foreground",
            )}
          >
            {sorted === "desc" ? <ArrowDownAZ className="size-3" /> : <ArrowUpAZ className="size-3" />}
          </button>
        ) : null}
        <ColumnHeaderFilter<ColumnFilterValue>
          column={columnId}
          label={label}
          modes={modes}
          defaultMode={defaultMode}
          draftFromCommitted={draftFromCommitted}
          options={options}
          labels={labels}
          active={active}
          liveFilter={draftToLiveFilter}
          committedFilter={draftToColumnFilter}
          liveDebounceMs={0}
          onLive={(next) => onChange(next)}
          onCommit={(next) => onChange(next)}
          onClear={() => onChange(null)}
          onRevert={() => onChange(committedAtOpen.current ?? null)}
          onOpenChange={(next) => {
            if (next) committedAtOpen.current = filter;
          }}
          onRangeShortcut={(dir, draft) => {
            onChange(draftToColumnFilter({ ...draft, mode: "range" }));
            onSort({ columnId, dir });
          }}
          footerExtra={
            <button
              type="button"
              onClick={() => onSort({ columnId, dir: sorted === "asc" ? "desc" : "asc" })}
              className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs font-semibold hover:bg-muted/50"
            >
              {sorted === "desc" ? <ArrowDownAZ className="size-3" /> : <ArrowUpAZ className="size-3" />}
            </button>
          }
        />
        {bounds ? (
          <span
            className="rounded-sm bg-primary/10 px-1 text-[10px] font-semibold tabular-nums text-primary"
            title={t("activeRange", { bounds })}
          >
            {bounds}
          </span>
        ) : null}
      </span>
    </th>
  );
}
