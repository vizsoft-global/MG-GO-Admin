"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowDownAZ, ArrowUpAZ, Check, ListFilter, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { countValueOccurrences, sortParticularValues } from "./payroll-particulars";

/**
 * The one Excel-style header filter the three payroll grids share.
 *
 * A column is filtered in exactly one of three modes at a time — text contains,
 * a ticked value list, or a numeric range — because Excel behaves that way and
 * mixing them silently would make a column look unrestricted while it is not.
 */
export type ColumnFilterValue =
  | { kind: "text"; text: string }
  | { kind: "list"; values: string[] }
  | { kind: "range"; min: number | null; max: number | null };

export type ColumnFilters = Record<string, ColumnFilterValue>;

export type ColumnSort = { columnId: string; dir: "asc" | "desc" } | null;

export function columnFilterActive(filter: ColumnFilterValue | undefined): boolean {
  if (!filter) return false;
  if (filter.kind === "text") return filter.text.trim().length > 0;
  if (filter.kind === "list") return filter.values.length > 0;
  return filter.min !== null || filter.max !== null;
}

export function textMatches(value: string, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (!needle) return true;
  return value.toLowerCase().includes(needle);
}

export function listMatches(value: string, values: readonly string[]): boolean {
  if (!values.length) return true;
  return values.includes(value);
}

export function rangeMatches(
  value: number,
  min: number | null,
  max: number | null,
): boolean {
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

export function matchesColumnFilter(
  value: string | number | null,
  filter: ColumnFilterValue | undefined,
  numeric = false,
): boolean {
  if (!columnFilterActive(filter) || !filter) return true;
  if (filter.kind === "text") return textMatches(String(value ?? ""), filter.text);
  if (filter.kind === "list") return listMatches(String(value ?? ""), filter.values);
  const parsed = typeof value === "number" ? value : Number(value ?? Number.NaN);
  if (!Number.isFinite(parsed)) return false;
  void numeric;
  return rangeMatches(parsed, filter.min, filter.max);
}

/** True when a row passes every active column filter. */
export function rowMatchesColumnFilters(
  row: Record<string, string | number | null>,
  filters: ColumnFilters,
  numericColumns: ReadonlySet<string> = new Set(),
): boolean {
  for (const [columnId, filter] of Object.entries(filters)) {
    if (!columnFilterActive(filter)) continue;
    if (!matchesColumnFilter(row[columnId] ?? null, filter, numericColumns.has(columnId))) {
      return false;
    }
  }
  return true;
}

export function activeFilterChips(
  filters: ColumnFilters,
  labelFor: (columnId: string) => string,
  listSeparator = ", ",
): Array<{ columnId: string; text: string }> {
  const chips: Array<{ columnId: string; text: string }> = [];
  for (const [columnId, filter] of Object.entries(filters)) {
    if (!columnFilterActive(filter)) continue;
    if (filter.kind === "text") {
      chips.push({ columnId, text: `${labelFor(columnId)}: ${filter.text.trim()}` });
    } else if (filter.kind === "list") {
      chips.push({ columnId, text: `${labelFor(columnId)}: ${filter.values.join(listSeparator)}` });
    } else {
      const min = filter.min === null ? "" : String(filter.min);
      const max = filter.max === null ? "" : String(filter.max);
      chips.push({ columnId, text: `${labelFor(columnId)}: ${min}–${max}` });
    }
  }
  return chips;
}

/** Sorts rows by a column accessor, leaving the input untouched. */
export function sortByColumn<T>(
  rows: readonly T[],
  sort: ColumnSort,
  accessor: (row: T, columnId: string) => string | number | null,
): T[] {
  if (!sort) return [...rows];
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = accessor(a, sort.columnId);
    const right = accessor(b, sort.columnId);
    if (typeof left === "number" && typeof right === "number") {
      return (left - right) * factor;
    }
    const ls = String(left ?? "");
    const rs = String(right ?? "");
    return ls.localeCompare(rs, undefined, { numeric: true, sensitivity: "base" }) * factor;
  });
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
        <span className="text-[11px] font-semibold text-muted-foreground">{prefix}</span>
      ) : null}
      {chips.map((chip) => (
        <span
          key={chip.columnId}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-muted/40 px-2 text-[11px] font-medium text-foreground"
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
        <span className="inline-flex h-7 items-center rounded-md border border-emerald-300 bg-emerald-50 px-2 text-[11px] font-semibold text-emerald-900">
          {sortLabel}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onClear}
        className="inline-flex h-7 items-center rounded-md px-2 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10"
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
): ColumnFilterValue["kind"] {
  if (filter?.kind) return filter.kind;
  if (values && values.length > 0) return "list";
  if (numeric) return "range";
  return "text";
}

export function PayrollColumnHeader({
  label,
  columnId,
  values,
  filter,
  onChange,
  sort,
  onSort,
  numeric = false,
  className,
  style,
  heading,
}: {
  label: string;
  columnId: string;
  values?: readonly string[];
  filter: ColumnFilterValue | undefined;
  onChange: (next: ColumnFilterValue | null) => void;
  sort: ColumnSort;
  onSort: (next: ColumnSort) => void;
  numeric?: boolean;
  className?: string;
  style?: CSSProperties;
  heading?: ReactNode;
}) {
  const t = useTranslations("pages.payroll.columnFilter");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ColumnFilterValue["kind"]>(defaultFilterMode(filter, values, numeric));
  const [text, setText] = useState(filter?.kind === "text" ? filter.text : "");
  const [picked, setPicked] = useState<string[]>(
    filter?.kind === "list" ? [...filter.values] : [],
  );
  const [min, setMin] = useState(filter?.kind === "range" && filter.min !== null ? String(filter.min) : "");
  const [max, setMax] = useState(filter?.kind === "range" && filter.max !== null ? String(filter.max) : "");
  const [search, setSearch] = useState("");

  const counts = useMemo(() => countValueOccurrences(values ?? []), [values]);
  const uniqueValues = useMemo(() => sortParticularValues([...new Set(values ?? [])]), [values]);
  const visibleValues = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return uniqueValues;
    return uniqueValues.filter((value) => value.toLowerCase().includes(needle));
  }, [uniqueValues, search]);

  const active = columnFilterActive(filter);
  const sorted = sort?.columnId === columnId ? sort.dir : null;

  function openChanged(next: boolean) {
    setOpen(next);
    if (next) {
      setMode(defaultFilterMode(filter, values, numeric));
      setText(filter?.kind === "text" ? filter.text : "");
      setPicked(filter?.kind === "list" ? [...filter.values] : []);
      setMin(filter?.kind === "range" && filter.min !== null ? String(filter.min) : "");
      setMax(filter?.kind === "range" && filter.max !== null ? String(filter.max) : "");
      setSearch("");
    }
  }

  function apply() {
    if (mode === "text") {
      const next = text.trim();
      onChange(next ? { kind: "text", text: next } : null);
    } else if (mode === "list") {
      onChange(picked.length ? { kind: "list", values: picked } : null);
    } else {
      const parsedMin = min.trim() === "" ? null : Number(min);
      const parsedMax = max.trim() === "" ? null : Number(max);
      const safeMin = parsedMin !== null && Number.isFinite(parsedMin) ? parsedMin : null;
      const safeMax = parsedMax !== null && Number.isFinite(parsedMax) ? parsedMax : null;
      onChange(safeMin === null && safeMax === null ? null : { kind: "range", min: safeMin, max: safeMax });
    }
    setOpen(false);
  }

  function clear() {
    onChange(null);
    setOpen(false);
  }

  function toggleValue(value: string) {
    setPicked((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  function toggleAll() {
    const pool = search.trim() ? visibleValues : uniqueValues;
    setPicked((prev) => (pool.length > 0 && pool.every((value) => prev.includes(value)) ? [] : [...pool]));
  }

  const allTicked =
    (search.trim() ? visibleValues : uniqueValues).length > 0 &&
    (search.trim() ? visibleValues : uniqueValues).every((value) => picked.includes(value));

  return (
    <th className={cn("whitespace-nowrap px-2 py-2 text-start align-bottom", className)} style={style}>
      <span className="inline-flex items-center gap-1">
        {heading ?? <span>{label}</span>}
        <Popover open={open} onOpenChange={openChanged}>
          <PopoverTrigger
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center rounded-sm transition-colors",
              active
                ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-400/60"
                : "text-muted-foreground/60 hover:bg-muted hover:text-foreground",
            )}
            aria-label={t("title", { column: label })}
          >
            <ListFilter className="size-3" />
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[min(260px,92vw)] origin-(--transform-origin) p-3"
          >
            <p className="mb-2 text-xs font-semibold">{t("title", { column: label })}</p>
            <div className="mb-2 flex flex-wrap gap-1">
              {(["text", "list", ...(numeric ? (["range"] as const) : [])] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className={cn(
                    "inline-flex h-7 items-center rounded-md border px-2 text-[11px] font-semibold transition-colors",
                    mode === id
                      ? "border-emerald-500 bg-emerald-100 text-emerald-900 ring-1 ring-emerald-400/50"
                      : "border-border bg-muted/30 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`mode.${id}`)}
                </button>
              ))}
            </div>

            {mode === "text" ? (
              <Input
                className="h-9"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t("textPlaceholder")}
              />
            ) : mode === "list" ? (
              <div className="space-y-2">
                <Input
                  className="h-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                />
                <div className="max-h-44 overflow-auto rounded-md border border-border">
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="flex w-full items-center gap-2 border-b border-border px-2 py-1.5 text-[11px] font-semibold hover:bg-muted/50"
                  >
                    <span
                      className={cn(
                        "flex size-3.5 items-center justify-center rounded-sm border",
                        allTicked ? "border-emerald-500 bg-emerald-500 text-white" : "border-border",
                      )}
                    >
                      {allTicked ? <Check className="size-2.5" /> : null}
                    </span>
                    {t("all")}
                  </button>
                  {visibleValues.map((value) => {
                    const ticked = picked.includes(value);
                    const count = counts.get(value) ?? 0;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => toggleValue(value)}
                        className="flex w-full items-center gap-2 px-2 py-1.5 text-start text-[11px] hover:bg-muted/50"
                      >
                        <span
                          className={cn(
                            "flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
                            ticked ? "border-emerald-500 bg-emerald-500 text-white" : "border-border",
                          )}
                        >
                          {ticked ? <Check className="size-2.5" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{value || t("blank")}</span>
                        <span className="tabular-nums text-muted-foreground">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMin(min);
                      setMax(max);
                      onChange({
                        kind: "range",
                        min: min.trim() === "" ? null : Number(min),
                        max: max.trim() === "" ? null : Number(max),
                      });
                      onSort({ columnId, dir: "asc" });
                    }}
                    className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-border text-[11px] font-semibold hover:bg-muted/50"
                  >
                    <ArrowUpAZ className="size-3" />
                    {t("sortSmallest")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSort({ columnId, dir: "desc" });
                    }}
                    className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-border text-[11px] font-semibold hover:bg-muted/50"
                  >
                    <ArrowDownAZ className="size-3" />
                    {t("sortLargest")}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    className="h-9"
                    inputMode="decimal"
                    value={min}
                    onChange={(e) => setMin(e.target.value)}
                    placeholder={t("min")}
                  />
                  <span className="text-xs text-muted-foreground">–</span>
                  <Input
                    className="h-9"
                    inputMode="decimal"
                    value={max}
                    onChange={(e) => setMax(e.target.value)}
                    placeholder={t("max")}
                  />
                </div>
              </div>
            )}

            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={clear}
                className="inline-flex h-8 items-center rounded-md px-2 text-[11px] font-semibold text-destructive transition-colors hover:bg-destructive/10"
              >
                {t("clear")}
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSort({ columnId, dir: sorted === "asc" ? "desc" : "asc" })}
                  className="inline-flex h-8 items-center rounded-md border border-border px-2 text-[11px] font-semibold hover:bg-muted/50"
                >
                  {sorted === "desc" ? <ArrowDownAZ className="size-3" /> : <ArrowUpAZ className="size-3" />}
                </button>
                <button
                  type="button"
                  onClick={apply}
                  className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[11px] font-semibold text-primary-foreground"
                >
                  {t("apply")}
                </button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </span>
    </th>
  );
}
