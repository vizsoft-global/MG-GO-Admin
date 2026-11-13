"use client";

import { useRef } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ColumnHeaderFilter,
  matchingValues,
  type ColumnFilterDraft,
  type ColumnFilterOption,
} from "@/components/app/column-filter";
import {
  isRangeFilter,
  rangeFilterActive,
  type OpsColumnFilter,
  type OpsRangeFilter,
  type OpsSortDir,
} from "../performance-ops-table";

export function OpsSortButton({
  active,
  dir,
  onClick,
  label,
}: {
  active: boolean;
  dir: OpsSortDir | null;
  onClick: () => void;
  label: string;
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-md",
        active
          ? "text-emerald-800 hover:bg-emerald-50"
          : "text-muted-foreground hover:bg-muted/40",
      )}
    >
      <Icon className="size-3" />
    </button>
  );
}

/**
 * The Performance funnel, delegating to the shared `ColumnHeaderFilter`.
 *
 * The operator's funnel record travels whole, so every live/commit/revert path
 * below writes `{...filters}` rather than a single key.
 */
export function OpsHeaderFilter({
  columnId,
  values,
  filters,
  onApply,
  numeric,
  onSortDir,
  searchPlaceholder,
  allLabel,
  clearLabel,
  applyLabel,
  minLabel,
  maxLabel,
}: {
  columnId: string;
  values: string[];
  filters: OpsColumnFilter;
  onApply: (next: OpsColumnFilter) => void;
  numeric?: boolean;
  /** Sorts the column a specific way — the Range tab's "Smallest / Largest first". */
  onSortDir?: (dir: "asc" | "desc") => void;
  searchPlaceholder: string;
  allLabel: string;
  clearLabel: string;
  applyLabel: string;
  minLabel: string;
  maxLabel: string;
}) {
  const current = filters[columnId];
  const active = numeric
    ? rangeFilterActive(isRangeFilter(current) ? current : undefined)
    : Array.isArray(current) && current.length > 0;
  const snapshot = useRef<OpsColumnFilter>(filters);

  const options: ColumnFilterOption[] = values.map((value) => ({
    value,
    label: value || "—",
  }));

  function draftFromCommitted(): ColumnFilterDraft {
    if (numeric) {
      const range: OpsRangeFilter = isRangeFilter(current) ? current : {};
      return {
        mode: "range",
        text: "",
        query: "",
        picked: [],
        min: range.min == null ? "" : String(range.min),
        max: range.max == null ? "" : String(range.max),
      };
    }
    return {
      mode: "list",
      text: "",
      query: "",
      picked: Array.isArray(current) ? [...current] : [],
      min: "",
      max: "",
    };
  }

  function asLiveFilter(draft: ColumnFilterDraft): string[] | OpsRangeFilter | null {
    if (draft.mode === "list" && draft.query.trim()) {
      // A typed search is a value-list of its own: keep every option whose
      // label contains it so the table narrows without losing the ticks.
      const matched = matchingValues(values, draft.query);
      return matched.length ? matched : null;
    }
    return asCommittedFilter(draft);
  }

  function asCommittedFilter(draft: ColumnFilterDraft): string[] | OpsRangeFilter | null {
    if (draft.mode === "range") {
      const min = draft.min === "" ? null : Number(draft.min);
      const max = draft.max === "" ? null : Number(draft.max);
      const range: OpsRangeFilter = {
        min: min != null && Number.isFinite(min) ? min : null,
        max: max != null && Number.isFinite(max) ? max : null,
      };
      return rangeFilterActive(range) ? range : null;
    }
    return draft.picked.length ? draft.picked : null;
  }

  function withFilter(value: string[] | OpsRangeFilter | null): OpsColumnFilter {
    return mergeOpsFilter(filters, columnId, value);
  }

  return (
    <ColumnHeaderFilter<string[] | OpsRangeFilter>
      column={columnId}
      label={columnId}
      title={`Filter ${columnId}`}
      modes={numeric ? ["range"] : ["list"]}
      defaultMode={numeric ? "range" : "list"}
      draftFromCommitted={draftFromCommitted}
      options={options}
      active={active}
      liveFilter={asLiveFilter}
      committedFilter={asCommittedFilter}
      onLive={(next) => onApply(withFilter(next))}
      onCommit={(next) => onApply(withFilter(next))}
      onClear={() => onApply(mergeOpsFilter(filters, columnId, null))}
      onRevert={() => onApply(snapshot.current)}
      onOpenChange={(open) => {
        if (open) snapshot.current = filters;
      }}
      liveDebounceMs={0}
      onRangeShortcut={
        onSortDir
          ? (dir, draft) => {
              onApply(withFilter(asCommittedFilter({ ...draft, mode: "range" })));
              onSortDir(dir);
            }
          : undefined
      }
      labels={{
        title: (column) => `Filter ${column}`,
        mode: {},
        search: searchPlaceholder,
        contains: searchPlaceholder,
        all: allLabel,
        clear: clearLabel,
        apply: applyLabel,
        min: minLabel,
        max: maxLabel,
        noOptions: allLabel,
        blank: "—",
        filterBy: (column) => `Filter ${column}`,
      }}
      triggerIcon={<Filter className="size-3" />}
      triggerClassName="size-6 rounded-md text-emerald-800 hover:bg-emerald-50"
      contentClassName="w-56 space-y-2 p-2"
    />
  );
}

/** Writes one column into the record, deleting it when the value is empty. */
function mergeOpsFilter(
  filters: OpsColumnFilter,
  columnId: string,
  value: string[] | OpsRangeFilter | null,
): OpsColumnFilter {
  const next = { ...filters };
  if (value === null) delete next[columnId];
  else next[columnId] = value;
  return next;
}
