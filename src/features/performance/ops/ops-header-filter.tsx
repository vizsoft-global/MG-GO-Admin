"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Filter } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toggleOpsMultiSelect } from "../performance-ops-formulas";
import {
  isRangeFilter,
  rangeFilterActive,
  type OpsColumnFilter,
  type OpsRangeFilter,
  type OpsSortDir,
} from "../performance-ops-table";
import { cn } from "@/lib/utils";

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

export function OpsHeaderFilter({
  columnId,
  values,
  filters,
  onApply,
  numeric,
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
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [draftValues, setDraftValues] = useState<string[]>([]);
  const [draftMin, setDraftMin] = useState("");
  const [draftMax, setDraftMax] = useState("");

  function openDraft() {
    if (numeric) {
      const range: OpsRangeFilter = isRangeFilter(current) ? current : {};
      setDraftMin(range.min == null ? "" : String(range.min));
      setDraftMax(range.max == null ? "" : String(range.max));
      return;
    }
    setDraftValues(Array.isArray(current) ? current : []);
    setQ("");
  }

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return values;
    return values.filter((v) => v.toLowerCase().includes(needle));
  }, [q, values]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) openDraft();
      }}
    >
      <PopoverTrigger
        aria-label={`Filter ${columnId}`}
        className={cn(
          "inline-flex size-6 items-center justify-center rounded-md",
          active
            ? "text-emerald-800 hover:bg-emerald-50"
            : "text-muted-foreground hover:bg-muted/40",
        )}
      >
        <Filter className="size-3" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 origin-(--transform-origin) space-y-2 p-2">
        {numeric ? (
          <div className="grid grid-cols-2 gap-1.5">
            <label className="text-[10px] text-muted-foreground">
              {minLabel}
              <Input
                type="number"
                value={draftMin}
                onChange={(e) => setDraftMin(e.target.value)}
                className="mt-0.5 h-9"
              />
            </label>
            <label className="text-[10px] text-muted-foreground">
              {maxLabel}
              <Input
                type="number"
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
              placeholder={searchPlaceholder}
              className="h-9"
            />
            <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1.5 text-xs hover:bg-muted/40">
              <Checkbox
                checked={draftValues.length === 0}
                onCheckedChange={() => setDraftValues([])}
              />
              <span className="min-w-0 flex-1 font-medium">{allLabel}</span>
              {draftValues.length === 0 ? (
                <Check className="size-3 shrink-0 text-emerald-700" />
              ) : null}
            </label>
            <div className="max-h-48 overflow-y-auto">
              {visible.map((v) => {
                const on = draftValues.includes(v);
                return (
                  <label
                    key={v || "(empty)"}
                    className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1.5 text-xs hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={on}
                      onCheckedChange={() =>
                        setDraftValues(toggleOpsMultiSelect(values, draftValues, v))
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{v || "—"}</span>
                  </label>
                );
              })}
            </div>
          </>
        )}
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            className="h-8 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted/40"
            onClick={() => {
              const next = { ...filters };
              delete next[columnId];
              onApply(next);
              setOpen(false);
            }}
          >
            {clearLabel}
          </button>
          <button
            type="button"
            className="h-8 rounded-md bg-primary px-2 text-xs text-primary-foreground"
            onClick={() => {
              const next = { ...filters };
              if (numeric) {
                const min = draftMin === "" ? null : Number(draftMin);
                const max = draftMax === "" ? null : Number(draftMax);
                const range: OpsRangeFilter = {
                  min: min != null && Number.isFinite(min) ? min : null,
                  max: max != null && Number.isFinite(max) ? max : null,
                };
                if (rangeFilterActive(range)) next[columnId] = range;
                else delete next[columnId];
              } else if (draftValues.length === 0) {
                delete next[columnId];
              } else {
                next[columnId] = draftValues;
              }
              onApply(next);
              setOpen(false);
            }}
          >
            {applyLabel}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
