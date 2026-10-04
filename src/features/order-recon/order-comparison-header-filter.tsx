"use client";

import { useMemo, useState } from "react";
import { Check, Filter } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  filterActive,
  filterKind,
  isContainsFilter,
  isRangeFilter,
  sanitizeNumericFilter,
  type ComparisonColumnFilters,
  type ComparisonRangeFilter,
} from "./order-comparison-filters";

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
}) {
  const kind = filterKind(columnId);
  const textLike = kind === "text" || kind === "number";
  const current = filters[columnId];
  const active = filterActive(current);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [draftText, setDraftText] = useState("");
  const [draftValues, setDraftValues] = useState<string[]>([]);
  const [draftMin, setDraftMin] = useState("");
  const [draftMax, setDraftMax] = useState("");

  function openDraft() {
    if (kind === "range") {
      const range: ComparisonRangeFilter = isRangeFilter(current) ? current : {};
      setDraftMin(range.min == null ? "" : String(range.min));
      setDraftMax(range.max == null ? "" : String(range.max));
      return;
    }
    if (textLike) {
      setDraftText(isContainsFilter(current) ? current.contains : "");
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
          active ? "text-emerald-800 hover:bg-emerald-50" : "text-muted-foreground hover:bg-muted/40",
        )}
      >
        <Filter className="size-3" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 origin-(--transform-origin) space-y-2 p-2">
        {kind === "range" ? (
          <div className="grid grid-cols-2 gap-1.5">
            <label className="text-[10px] text-muted-foreground">
              {minLabel}
              <Input type="number" value={draftMin} onChange={(e) => setDraftMin(e.target.value)} className="mt-0.5 h-9" />
            </label>
            <label className="text-[10px] text-muted-foreground">
              {maxLabel}
              <Input type="number" value={draftMax} onChange={(e) => setDraftMax(e.target.value)} className="mt-0.5 h-9" />
            </label>
          </div>
        ) : textLike ? (
          <label className="text-[10px] text-muted-foreground">
            {containsLabel}
            <Input
              value={draftText}
              inputMode={kind === "number" ? "numeric" : undefined}
              onChange={(e) =>
                setDraftText(kind === "number" ? sanitizeNumericFilter(e.target.value) : e.target.value)
              }
              placeholder={placeholder}
              className="mt-0.5 h-9"
            />
          </label>
        ) : (
          <>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-9" />
            <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1.5 text-xs hover:bg-muted/40">
              <Checkbox checked={draftValues.length === 0} onCheckedChange={() => setDraftValues([])} />
              <span className="min-w-0 flex-1 font-medium">{allLabel}</span>
              {draftValues.length === 0 ? <Check className="size-3 shrink-0 text-emerald-700" /> : null}
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
                        setDraftValues((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))
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
              if (kind === "range") {
                const min = draftMin === "" ? null : Number(draftMin);
                const max = draftMax === "" ? null : Number(draftMax);
                const range: ComparisonRangeFilter = {
                  min: min != null && Number.isFinite(min) ? min : null,
                  max: max != null && Number.isFinite(max) ? max : null,
                };
                if (range.min != null || range.max != null) next[columnId] = range;
                else delete next[columnId];
              } else if (textLike) {
                if (draftText.trim()) next[columnId] = { contains: draftText.trim() };
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
