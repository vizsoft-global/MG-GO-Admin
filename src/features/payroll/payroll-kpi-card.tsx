"use client";

import type { LucideIcon } from "lucide-react";
import { NEUTRAL_TILE, TONE_STYLES, accentToTone } from "@/lib/ui/tone-styles";
import { cn } from "@/lib/utils";
import type { KpiAccent } from "@/components/dashboard/kpi-card";

/**
 * A summary card that is also the table's filter.
 *
 * The cards above a payroll sheet print a number the table can show, so pressing
 * one narrows the sheet to exactly those rows; pressing it again clears the
 * filter (see `nextKpiSelection`). A card whose figure has no honest row-level
 * predicate stays `disabled` with a tooltip instead of filtering a client-side
 * subset that would disagree with the number above it.
 */
export function PayrollKpiCard({
  label,
  value,
  icon: Icon,
  accent = "default",
  caption,
  selected = false,
  disabled = false,
  disabledHint,
  empty = false,
  emptyHint,
  onSelect,
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  accent?: KpiAccent;
  caption?: string;
  /** True when this card is the active filter. */
  selected?: boolean;
  disabled?: boolean;
  /** Why the card cannot filter; also the native tooltip. */
  disabledHint?: string;
  /** No riders behind this view: print `—` and refuse the click. */
  empty?: boolean;
  emptyHint?: string;
  onSelect?: () => void;
}) {
  const tone = TONE_STYLES[accentToTone(accent)];
  const interactive = !disabled && !empty && Boolean(onSelect);
  const hint = empty ? (emptyHint ?? disabledHint) : disabledHint;

  return (
    <button
      type="button"
      aria-pressed={interactive ? selected : undefined}
      aria-label={hint ? `${label} — ${hint}` : label}
      title={disabled || empty ? hint : label}
      disabled={!interactive}
      onClick={interactive ? onSelect : undefined}
      className={cn(
        "group relative flex items-start gap-2 overflow-hidden rounded-xl px-3 py-1.5 text-start",
        NEUTRAL_TILE,
        tone.accentBar,
        interactive ? "cursor-pointer transition-shadow hover:ring-1 hover:ring-primary/40" : "opacity-70",
        (disabled || empty) && "cursor-not-allowed",
        selected && "ring-2 ring-primary",
      )}
    >
      {Icon ? (
        <span
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-lg",
            tone.iconChip,
          )}
        >
          <Icon className="size-3.5" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block whitespace-normal break-words text-xs font-semibold text-muted-foreground">
          {label}
        </span>
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-xl font-semibold tabular-nums tracking-tight text-foreground">
            {empty ? "—" : value}
          </span>
          {empty ? (
            <span className="truncate text-xs text-muted-foreground">{emptyHint}</span>
          ) : caption ? (
            <span className="truncate text-xs text-muted-foreground">{caption}</span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
