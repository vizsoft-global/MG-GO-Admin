"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownAZ, ArrowUpAZ, Check, ListFilter, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/lib/search/list-search";
import { cn } from "@/lib/utils";
import {
  allVisiblePicked,
  draftNarrows,
  filterColumnOptions,
  toggleVisible,
  visibleOptionCount,
} from "./draft";
import {
  EMPTY_COLUMN_FILTER_DRAFT,
  type ColumnFilterDraft,
  type ColumnFilterLabels,
  type ColumnFilterMode,
  type ColumnFilterOption,
} from "./types";

export type ColumnHeaderFilterProps<F> = {
  /** Column id, used only for React keys and aria wiring. */
  column: string;
  /** Human column name, for the popover title and the trigger's aria-label. */
  label: string;
  /** Modes this column offers, in tab order. One mode renders no tabs. */
  modes: readonly ColumnFilterMode[];
  defaultMode: ColumnFilterMode;
  /** Builds the draft from the filter that is currently committed. */
  draftFromCommitted: () => ColumnFilterDraft;
  options: readonly ColumnFilterOption[];
  labels: ColumnFilterLabels;
  active: boolean;
  /** What a keystroke narrows the table to, before Apply. */
  liveFilter: (draft: ColumnFilterDraft) => F | null;
  /** What Apply commits. Kept separate so Apply means what it always meant. */
  committedFilter: (draft: ColumnFilterDraft) => F | null;
  onLive: (filter: F | null) => void;
  onCommit: (filter: F | null) => void;
  onClear: () => void;
  /** Restores the filter that was committed when the popover opened. */
  onRevert: () => void;
  /** Fires when the popover opens or closes, so a wrapper can fetch options. */
  onOpenChange?: (open: boolean) => void;
  /** Text-mode input normaliser (plate search, digits-only number filters…). */
  sanitizeText?: (value: string) => string;
  sanitizeNumber?: (value: string) => string;
  /** Shown above the Text input when the column wants a caption there. */
  textLabel?: string;
  /** Popover title override; the funnel is otherwise titled from `labels`. */
  title?: string;
  /** Extra control drawn next to the Apply button (Payroll's sort toggle). */
  footerExtra?: ReactNode;
  triggerIcon?: ReactNode;
  triggerClassName?: string;
  contentClassName?: string;
  /** Renders the range badge inside the footer when both bounds are set. */
  onRangeShortcut?: (dir: "asc" | "desc", draft: ColumnFilterDraft) => void;
  /**
   * Delay before a keystroke narrows the table. Client-side grids filter in
   * memory and want 0; a server-backed list passes the shared list-search
   * delay so a fast typist costs one request, not one per letter.
   */
  liveDebounceMs?: number;
};

/**
 * The shared column-header funnel: text, ticked list or numeric range, with a
 * search box that narrows the checklist **and** the table on every keystroke.
 *
 * The two halves are deliberately separate. `liveFilter` answers "what does the
 * table show while I type" and is debounced by the one list-search delay the
 * rest of the panel uses; `committedFilter` answers "what does Apply mean" and
 * stays exactly what each module has always committed. Closing the popover
 * without pressing Apply puts the original filter back, so a half-typed query
 * can never leave a column silently narrowed.
 */
export function ColumnHeaderFilter<F>({
  column,
  label,
  modes,
  defaultMode,
  draftFromCommitted,
  options,
  labels,
  active,
  liveFilter,
  committedFilter,
  onLive,
  onCommit,
  onClear,
  onRevert,
  onOpenChange,
  sanitizeText,
  sanitizeNumber,
  textLabel,
  title,
  footerExtra,
  triggerIcon,
  triggerClassName,
  contentClassName,
  onRangeShortcut,
  liveDebounceMs = LIST_SEARCH_DEBOUNCE_MS,
}: ColumnHeaderFilterProps<F>) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ColumnFilterMode>(defaultMode);
  const [draft, setDraft] = useState<ColumnFilterDraft>(EMPTY_COLUMN_FILTER_DRAFT);
  /** Set when Apply/Clear closes the popover, so the close does not undo them. */
  const closingAfterCommit = useRef(false);

  // The parent rebuilds these inline on every render; syncing them in an effect
  // (rather than during render) is what stops the live timer from restarting on
  // an unrelated parent render without writing a ref mid-render.
  const liveFilterRef = useRef(liveFilter);
  const onLiveRef = useRef(onLive);
  const onRevertRef = useRef(onRevert);
  useEffect(() => {
    liveFilterRef.current = liveFilter;
    onLiveRef.current = onLive;
    onRevertRef.current = onRevert;
  });

  const visible = useMemo(() => filterColumnOptions(options, draft.query), [options, draft.query]);
  const allTicked = allVisiblePicked(draft, visible);
  const visibleCount = visibleOptionCount(visible);
  const hasCounts = options.some((option) => typeof option.count === "number");

  /**
   * The live channel. A keystroke narrows the table after the shared 150ms
   * delay; clearing the box applies on the same tick because that is an undo,
   * not a query.
   */
  useEffect(() => {
    if (!open) return;
    const current: ColumnFilterDraft = { ...draft, mode };
    const delay = draftNarrows(current) ? liveDebounceMs : 0;
    const timer = window.setTimeout(
      () => onLiveRef.current(liveFilterRef.current(current)),
      delay,
    );
    return () => window.clearTimeout(timer);
  }, [open, mode, draft, liveDebounceMs]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
    if (next) {
      closingAfterCommit.current = false;
      setMode(defaultMode);
      setDraft(draftFromCommitted());
      return;
    }
    // Apply and Clear called `setOpen(false)` themselves and closed the gate;
    // a click-away did not, so the committed filter comes back.
    if (closingAfterCommit.current) {
      closingAfterCommit.current = false;
      return;
    }
    onRevertRef.current();
  }

  function finish() {
    closingAfterCommit.current = true;
    setOpen(false);
    onOpenChange?.(false);
  }

  function apply() {
    onCommit(committedFilter({ ...draft, mode }));
    finish();
  }

  function clear() {
    onClear();
    finish();
  }

  function patch(next: Partial<ColumnFilterDraft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function toggle(value: string) {
    setDraft((current) => ({
      ...current,
      picked: current.picked.includes(value)
        ? current.picked.filter((item) => item !== value)
        : [...current.picked, value],
    }));
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        aria-label={labels.filterBy(label)}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-sm transition-colors",
          active
            ? "bg-primary/10 text-primary ring-1 ring-primary/40"
            : "text-muted-foreground/60 hover:bg-muted hover:text-foreground",
          triggerClassName,
        )}
      >
        {triggerIcon ?? <ListFilter className="size-3" />}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        data-column={column}
        className={cn("w-[min(260px,92vw)] origin-(--transform-origin) p-3", contentClassName)}
      >
        <p className="mb-2 text-xs font-semibold">{title ?? labels.title(label)}</p>

        {modes.length > 1 ? (
          <div className="mb-2 flex flex-wrap gap-1">
            {modes.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={cn(
                  "inline-flex h-7 items-center rounded-md border px-2 text-xs font-semibold transition-colors",
                  mode === id
                    ? "border-primary bg-primary text-primary-foreground ring-1 ring-primary/40"
                    : "border-border bg-muted/30 text-muted-foreground hover:text-foreground",
                )}
              >
                {labels.mode[id] ?? id}
              </button>
            ))}
          </div>
        ) : null}

        {mode === "text" ? (
          <label className="block space-y-1">
            {textLabel ? <span className="text-xs text-muted-foreground">{textLabel}</span> : null}
            <Input
              className="h-9"
              value={draft.text}
              onChange={(event) =>
                patch({
                  text: sanitizeText ? sanitizeText(event.target.value) : event.target.value,
                })
              }
              placeholder={labels.contains}
            />
          </label>
        ) : mode === "list" ? (
          <div className="space-y-2">
            <div className="relative">
              <Input
                className="h-9 pe-8"
                value={draft.query}
                onChange={(event) => patch({ query: event.target.value })}
                placeholder={labels.search}
              />
              {draft.query ? (
                <button
                  type="button"
                  onClick={() => patch({ query: "" })}
                  className="absolute end-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={labels.clear}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
            <div className="max-h-44 overflow-auto rounded-md border border-border">
              <button
                type="button"
                onClick={() => patch({ picked: toggleVisible(draft, visible) })}
                className="flex w-full items-center gap-2 border-b border-border px-2 py-1.5 text-xs font-semibold hover:bg-muted/50"
              >
                <span
                  className={cn(
                    "flex size-3.5 items-center justify-center rounded-sm border",
                    allTicked ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {allTicked ? <Check className="size-2.5" /> : null}
                </span>
                <span className="min-w-0 flex-1 text-start">{labels.all}</span>
                {hasCounts ? (
                  <span className="tabular-nums text-muted-foreground">
                    {draft.query.trim() ? visibleCount : visibleOptionCount(options)}
                  </span>
                ) : null}
              </button>
              {visible.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">{labels.noOptions}</p>
              ) : (
                visible.map((option) => {
                  const ticked = draft.picked.includes(option.value);
                  return (
                    <button
                      key={option.value || "(blank)"}
                      type="button"
                      onClick={() => toggle(option.value)}
                      className="flex w-full items-center gap-2 px-2 py-1.5 text-start text-xs hover:bg-muted/50"
                    >
                      <span
                        className={cn(
                          "flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
                          ticked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border",
                        )}
                      >
                        {ticked ? <Check className="size-2.5" /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {option.label || labels.blank}
                      </span>
                      {typeof option.count === "number" ? (
                        <span className="tabular-nums text-muted-foreground">{option.count}</span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {onRangeShortcut ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onRangeShortcut("asc", { ...draft, mode })}
                  className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-border text-xs font-semibold hover:bg-muted/50"
                >
                  <ArrowUpAZ className="size-3" />
                  {labels.sortSmallest ?? labels.min}
                </button>
                <button
                  type="button"
                  onClick={() => onRangeShortcut("desc", { ...draft, mode })}
                  className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-border text-xs font-semibold hover:bg-muted/50"
                >
                  <ArrowDownAZ className="size-3" />
                  {labels.sortLargest ?? labels.max}
                </button>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <Input
                className="h-9"
                inputMode="decimal"
                value={draft.min}
                onChange={(event) =>
                  patch({
                    min: sanitizeNumber ? sanitizeNumber(event.target.value) : event.target.value,
                  })
                }
                placeholder={labels.min}
              />
              <span className="text-xs text-muted-foreground">–</span>
              <Input
                className="h-9"
                inputMode="decimal"
                value={draft.max}
                onChange={(event) =>
                  patch({
                    max: sanitizeNumber ? sanitizeNumber(event.target.value) : event.target.value,
                  })
                }
                placeholder={labels.max}
              />
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={clear}
            className="inline-flex h-8 items-center rounded-md px-2 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10"
          >
            {labels.clear}
          </button>
          <div className="flex items-center gap-1">
            {footerExtra}
            <button
              type="button"
              onClick={apply}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground"
            >
              {labels.apply}
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The tick-all helper, exported so a wrapper can mirror the same rule. */
export { allVisiblePicked, filterColumnOptions, toggleVisible, visibleOptionCount };
export type { ColumnFilterDraft, ColumnFilterLabels, ColumnFilterOption, ColumnFilterMode };
