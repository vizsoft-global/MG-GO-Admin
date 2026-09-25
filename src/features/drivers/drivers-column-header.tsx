"use client";

import { useMemo, useState } from "react";
import { Check, Filter, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OpsSortButton } from "@/features/performance/ops/ops-header-filter";
import { cn } from "@/lib/utils";
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

export function DriversColumnHeader({
  column,
  label,
  kind,
  filter,
  onApply,
  sort,
  onSort,
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
  context: { tab: DriversTab; search: string; filters: DriversColumnFilters };
  optionLabel: (value: string, label: string | null) => string;
  labels: DriversHeaderLabels;
}) {
  const active = isFilterActive(filter);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [draftText, setDraftText] = useState("");
  const [draftValues, setDraftValues] = useState<string[]>([]);
  const [draftMin, setDraftMin] = useState("");
  const [draftMax, setDraftMax] = useState("");
  const options = useDriverFilterValues(column, context, open && kind === "list");

  const visible = useMemo(() => {
    const all = (options.data ?? []).map((o) => ({
      value: o.value,
      text: optionLabel(o.value, o.label),
    }));
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((o) => o.text.toLowerCase().includes(needle)) : all;
  }, [options.data, optionLabel, q]);

  function openDraft() {
    setQ("");
    setDraftText(isTextFilter(filter) ? filter.contains : "");
    setDraftValues(isListFilter(filter) ? filter.in : []);
    setDraftMin(isRangeFilter(filter) && filter.min != null ? String(filter.min) : "");
    setDraftMax(isRangeFilter(filter) && filter.max != null ? String(filter.max) : "");
  }

  function apply() {
    if (kind === "text") onApply({ contains: draftText });
    else if (kind === "list") onApply({ in: draftValues });
    else {
      const min = draftMin === "" ? null : Number(draftMin);
      const max = draftMax === "" ? null : Number(draftMax);
      onApply({
        min: min != null && Number.isFinite(min) ? min : null,
        max: max != null && Number.isFinite(max) ? max : null,
      });
    }
    setOpen(false);
  }

  return (
    <span className="inline-flex items-center gap-0.5">
      <span className={cn("truncate", active && "text-emerald-800")}>{label}</span>
      <OpsSortButton
        active={sort.key === column}
        dir={sort.key === column ? sort.dir : null}
        onClick={onSort}
        label={labels.sortBy(label)}
      />
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) openDraft();
        }}
      >
        <PopoverTrigger
          aria-label={labels.filterBy(label)}
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-md transition-colors",
            active
              ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-400/50 hover:bg-emerald-100"
              : "text-muted-foreground hover:bg-muted/40",
          )}
        >
          <Filter className="size-3" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-60 origin-(--transform-origin) space-y-2 p-2 normal-case tracking-normal"
        >
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              apply();
            }}
          >
            {kind === "text" ? (
              <Input
                autoFocus
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                placeholder={labels.contains}
                className="h-9"
              />
            ) : kind === "range" ? (
              <div className="grid grid-cols-2 gap-1.5">
                <label className="text-[10px] text-muted-foreground">
                  {labels.min}
                  <Input
                    type="number"
                    min={0}
                    value={draftMin}
                    onChange={(e) => setDraftMin(e.target.value)}
                    className="mt-0.5 h-9"
                  />
                </label>
                <label className="text-[10px] text-muted-foreground">
                  {labels.max}
                  <Input
                    type="number"
                    min={0}
                    value={draftMax}
                    onChange={(e) => setDraftMax(e.target.value)}
                    className="mt-0.5 h-9"
                  />
                </label>
              </div>
            ) : (
              <>
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={labels.search}
                  className="h-9"
                />
                <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1.5 text-xs hover:bg-muted/40">
                  <Checkbox
                    checked={draftValues.length === 0}
                    onCheckedChange={() => setDraftValues([])}
                  />
                  <span className="min-w-0 flex-1 font-medium">{labels.all}</span>
                  {draftValues.length === 0 ? (
                    <Check className="size-3 shrink-0 text-emerald-700" />
                  ) : null}
                </label>
                <div className="max-h-56 overflow-y-auto">
                  {options.isLoading ? (
                    <div className="flex h-10 items-center justify-center">
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : visible.length === 0 ? (
                    <p className="px-1.5 py-2 text-xs text-muted-foreground">{labels.noOptions}</p>
                  ) : (
                    visible.map((o) => {
                      const on = draftValues.includes(o.value);
                      return (
                        <label
                          key={o.value || "(blank)"}
                          className={cn(
                            "flex h-8 cursor-pointer items-center gap-2 rounded-md px-1.5 text-xs hover:bg-muted/40",
                            on && "font-semibold text-emerald-900",
                          )}
                        >
                          <Checkbox
                            checked={on}
                            onCheckedChange={() =>
                              setDraftValues((cur) =>
                                cur.includes(o.value)
                                  ? cur.filter((v) => v !== o.value)
                                  : [...cur, o.value],
                              )
                            }
                          />
                          <span className="min-w-0 flex-1 truncate">{o.text}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </>
            )}
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                className="h-8 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted/40"
                onClick={() => {
                  onApply(null);
                  setOpen(false);
                }}
              >
                {labels.clear}
              </button>
              <button
                type="submit"
                className="h-8 rounded-md bg-primary px-2 text-xs text-primary-foreground"
              >
                {labels.apply}
              </button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
    </span>
  );
}
