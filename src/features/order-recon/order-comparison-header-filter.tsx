"use client";

import { useRef } from "react";
import { Filter } from "lucide-react";
import {
  ColumnHeaderFilter,
  matchingValues,
  type ColumnFilterDraft,
  type ColumnFilterOption,
} from "@/components/app/column-filter";
import {
  filterActive,
  filterKind,
  isContainsFilter,
  isRangeFilter,
  sanitizeNumericFilter,
  type ComparisonColumnFilters,
  type ComparisonRangeFilter,
} from "./order-comparison-filters";

/**
 * Order reconciliation's funnel, delegating to the shared `ColumnHeaderFilter`.
 *
 * Typing narrows the comparison grid before Apply, and a close without Apply
 * restores the filter record the popover opened with.
 */
export function ComparisonHeaderFilter({
  columnId,
  values,
  filters,
  onApply,
  placeholder,
  allLabel,
  clearLabel,
  applyLabel,
  minLabel,
  maxLabel,
  containsLabel,
  onSortDir,
}: {
  columnId: string;
  values: string[];
  filters: ComparisonColumnFilters;
  onApply: (next: ComparisonColumnFilters) => void;
  placeholder: string;
  allLabel: string;
  clearLabel: string;
  applyLabel: string;
  minLabel: string;
  maxLabel: string;
  containsLabel: string;
  /** Sorts the column a specific way — the Range tab's "Smallest / Largest first". */
  onSortDir?: (dir: "asc" | "desc") => void;
}) {
  const kind = filterKind(columnId);
  const textLike = kind === "text" || kind === "number";
  const current = filters[columnId];
  const active = filterActive(current);
  const snapshot = useRef<ComparisonColumnFilters>(filters);

  const options: ColumnFilterOption[] = values.map((value) => ({
    value,
    label: value || "—",
  }));

  function draftFromCommitted(): ColumnFilterDraft {
    if (kind === "range") {
      const range: ComparisonRangeFilter = isRangeFilter(current) ? current : {};
      return {
        mode: "range",
        text: "",
        query: "",
        picked: [],
        min: range.min == null ? "" : String(range.min),
        max: range.max == null ? "" : String(range.max),
      };
    }
    if (textLike) {
      return {
        mode: "text",
        text: isContainsFilter(current) ? current.contains : "",
        query: "",
        picked: [],
        min: "",
        max: "",
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

  function valueOf(draft: ColumnFilterDraft): ComparisonColumnFilters[string] | null {
    if (draft.mode === "range") {
      const min = draft.min === "" ? null : Number(draft.min);
      const max = draft.max === "" ? null : Number(draft.max);
      const range: ComparisonRangeFilter = {
        min: min != null && Number.isFinite(min) ? min : null,
        max: max != null && Number.isFinite(max) ? max : null,
      };
      return range.min != null || range.max != null ? range : null;
    }
    if (draft.mode === "text") {
      const text = draft.text.trim();
      return text ? { contains: text } : null;
    }
    return draft.picked.length ? draft.picked : null;
  }

  function liveOf(draft: ColumnFilterDraft): ComparisonColumnFilters[string] | null {
    if (draft.mode === "list" && draft.query.trim()) {
      const matched = matchingValues(values, draft.query);
      return matched.length ? matched : null;
    }
    return valueOf(draft);
  }

  function withValue(value: ComparisonColumnFilters[string] | null): ComparisonColumnFilters {
    const next = { ...filters };
    if (value === null) delete next[columnId];
    else next[columnId] = value;
    return next;
  }

  return (
    <ColumnHeaderFilter<ComparisonColumnFilters[string]>
      column={columnId}
      label={columnId}
      title={`Filter ${columnId}`}
      modes={textLike ? ["text"] : kind === "range" ? ["range"] : ["list"]}
      defaultMode={textLike ? "text" : kind === "range" ? "range" : "list"}
      draftFromCommitted={draftFromCommitted}
      options={options}
      active={active}
      liveFilter={liveOf}
      committedFilter={valueOf}
      onLive={(next) => onApply(withValue(next))}
      onCommit={(next) => onApply(withValue(next))}
      onClear={() => onApply(withValue(null))}
      onRevert={() => onApply(snapshot.current)}
      onOpenChange={(open) => {
        if (open) snapshot.current = filters;
      }}
      liveDebounceMs={0}
      onRangeShortcut={
        onSortDir
          ? (dir, draft) => {
              onApply(withValue(valueOf({ ...draft, mode: "range" })));
              onSortDir(dir);
            }
          : undefined
      }
      sanitizeNumber={kind === "number" ? sanitizeNumericFilter : undefined}
      textLabel={containsLabel}
      labels={{
        title: (column) => `Filter ${column}`,
        mode: {},
        search: placeholder,
        contains: placeholder,
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
