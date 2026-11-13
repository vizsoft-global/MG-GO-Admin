"use client";

import { useMemo, useRef, useState } from "react";
import { Filter, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ColumnHeaderFilter,
  type ColumnFilterDraft,
  type ColumnFilterOption,
} from "@/components/app/column-filter";
import { OpsSortButton } from "@/features/performance/ops/ops-header-filter";
import {
  isFilterActive,
  isListFilter,
  isRangeFilter,
  isTextFilter,
  type DriversColumnFilter,
  type DriversColumnFilters,
  type DriversSort,
  type DriversTab,
} from "./drivers-list-query";
import { useDriverFilterValues } from "./use-drivers-page";

export type DriversHeaderLabels = {
  search: string;
  contains: string;
  all: string;
  clear: string;
  apply: string;
  min: string;
  max: string;
  noOptions: string;
  sortBy: (label: string) => string;
  filterBy: (label: string) => string;
};

/**
 * The Employees funnel, delegating to the shared `ColumnHeaderFilter`.
 *
 * Typing in the checklist search narrows the roster on the keystroke as well as
 * the checklist itself; opening the list mode is what fetches the column's
 * distinct values, so the fetch is driven by the shared popover's open state.
 */
export function DriversColumnHeader({
  column,
  label,
  kind,
  filter,
  onApply,
  sort,
  onSort,
  onSortDir,
  context,
  optionLabel,
  labels,
}: {
  column: string;
  label: string;
  kind: "text" | "list" | "range";
  filter: DriversColumnFilter | undefined;
  onApply: (next: DriversColumnFilter | null) => void;
  sort: DriversSort;
  onSort: () => void;
  /** Sorts the column a specific way — the Range tab's "Smallest / Largest first". */
  onSortDir?: (dir: "asc" | "desc") => void;
  context: { tab: DriversTab; search: string; filters: DriversColumnFilters };
  optionLabel: (value: string, label: string | null) => string;
  labels: DriversHeaderLabels;
}) {
  const active = isFilterActive(filter);
  const [listOpen, setListOpen] = useState(false);
  const committedAtOpen = useRef<DriversColumnFilter | undefined>(filter);
  const options = useDriverFilterValues(column, context, listOpen && kind === "list");

  const items = useMemo<ColumnFilterOption[]>(
    () =>
      (options.data ?? []).map((option) => ({
        value: option.value,
        label: optionLabel(option.value, option.label),
      })),
    [options.data, optionLabel],
  );

  function draftFromCommitted(): ColumnFilterDraft {
    return {
      mode: kind,
      text: isTextFilter(filter) ? filter.contains : "",
      query: "",
      picked: isListFilter(filter) ? [...filter.in] : [],
      min: isRangeFilter(filter) && filter.min != null ? String(filter.min) : "",
      max: isRangeFilter(filter) && filter.max != null ? String(filter.max) : "",
    };
  }

  function committedFilter(draft: ColumnFilterDraft): DriversColumnFilter | null {
    if (draft.mode === "text") return { contains: draft.text };
    if (draft.mode === "list") return { in: draft.picked };
    const min = draft.min === "" ? null : Number(draft.min);
    const max = draft.max === "" ? null : Number(draft.max);
    return {
      min: min != null && Number.isFinite(min) ? min : null,
      max: max != null && Number.isFinite(max) ? max : null,
    };
  }

  return (
    <span className="inline-flex items-center gap-0.5">
      <span className={cn("truncate", active && "text-primary")}>{label}</span>
      <OpsSortButton
        active={sort.key === column}
        dir={sort.key === column ? sort.dir : null}
        onClick={onSort}
        label={labels.sortBy(label)}
      />
      <ColumnHeaderFilter<DriversColumnFilter>
        column={column}
        label={label}
        title={labels.filterBy(label)}
        modes={[kind]}
        defaultMode={kind}
        draftFromCommitted={draftFromCommitted}
        options={items}
        active={active}
        liveFilter={(draft) =>
          draft.mode === "list" && draft.query.trim() ? { contains: draft.query.trim() } : committedFilter(draft)
        }
        committedFilter={committedFilter}
        onLive={(next) => onApply(next)}
        onCommit={(next) => onApply(next)}
        onClear={() => onApply(null)}
        onRevert={() => onApply(committedAtOpen.current ?? null)}
        onOpenChange={(open) => {
          setListOpen(open);
          if (open) committedAtOpen.current = filter;
        }}
        onRangeShortcut={
          onSortDir
            ? (dir, draft) => {
                // "Smallest first / Largest first" both sort and apply the typed
                // bounds, so one click answers "who is at the bottom of this
                // range" without a second step.
                onApply(committedFilter({ ...draft, mode: "range" }));
                onSortDir(dir);
              }
            : undefined
        }
        labels={{
          title: () => labels.filterBy(label),
          mode: {},
          search: labels.search,
          contains: labels.contains,
          all: labels.all,
          clear: labels.clear,
          apply: labels.apply,
          min: labels.min,
          max: labels.max,
          noOptions: labels.noOptions,
          blank: "—",
          filterBy: labels.filterBy,
        }}
        triggerIcon={<Filter className="size-3" />}
        triggerClassName="size-6 rounded-md text-muted-foreground hover:bg-muted/40"
        contentClassName="w-60 space-y-2 p-2 normal-case tracking-normal"
        footerExtra={
          options.isLoading ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : null
        }
      />
    </span>
  );
}
