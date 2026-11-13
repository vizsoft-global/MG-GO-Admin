"use client";

import { useMemo, useRef } from "react";
import { Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ColumnHeaderFilter,
  type ColumnFilterDraft,
  type ColumnFilterOption,
} from "@/components/app/column-filter";
import { OpsSortButton } from "@/features/performance/ops/ops-header-filter";
import { filterPlateSearch } from "./vehicle-form-validation";
import {
  isFilterActive,
  isListFilter,
  isRangeFilter,
  isTextFilter,
  type VehiclesColumnFilter,
  type VehiclesFilterKind,
  type VehiclesSort,
} from "./vehicles-list-query";

export type VehiclesHeaderLabels = {
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
 * The fleet funnel, delegating to the shared `ColumnHeaderFilter` so a vehicle
 * column searches, ticks and narrows exactly like every other table.
 */
export function VehiclesColumnHeader({
  column,
  label,
  kind,
  filter,
  onApply,
  sort,
  onSort,
  onSortDir,
  options,
  optionLabel,
  labels,
}: {
  column: string;
  label: string;
  kind: VehiclesFilterKind;
  filter: VehiclesColumnFilter | undefined;
  onApply: (next: VehiclesColumnFilter | null) => void;
  sort: VehiclesSort;
  onSort: () => void;
  /** Sorts the column a specific way — the Range tab's "Smallest / Largest first". */
  onSortDir?: (dir: "asc" | "desc") => void;
  options: string[];
  optionLabel: (value: string) => string;
  labels: VehiclesHeaderLabels;
}) {
  const active = isFilterActive(filter);
  const committedAtOpen = useRef<VehiclesColumnFilter | undefined>(filter);

  const items = useMemo<ColumnFilterOption[]>(
    () => options.map((value) => ({ value, label: optionLabel(value) })),
    [optionLabel, options],
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

  function committedFilter(draft: ColumnFilterDraft): VehiclesColumnFilter | null {
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
      <ColumnHeaderFilter<VehiclesColumnFilter>
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
          if (open) committedAtOpen.current = filter;
        }}
        liveDebounceMs={0}
        onRangeShortcut={
          onSortDir
            ? (dir, draft) => {
                onApply(committedFilter({ ...draft, mode: "range" }));
                onSortDir(dir);
              }
            : undefined
        }
        sanitizeText={column === "plate" ? filterPlateSearch : undefined}
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
      />
    </span>
  );
}
