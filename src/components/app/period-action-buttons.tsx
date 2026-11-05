"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarRange } from "lucide-react";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type PeriodActionPreset = "thisMonth" | "lastMonth" | "custom";

export type PeriodActionLabels = {
  thisMonth: string;
  lastMonth: string;
  custom: string;
  customTitle: string;
  from: string;
  to: string;
  cancel: string;
  apply: string;
};

function defaultDayLabel(ymd: string, locale: string) {
  if (!ymd) return "";
  return new Intl.DateTimeFormat(locale.startsWith("ar") ? "ar" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
    numberingSystem: "latn",
  }).format(new Date(`${ymd}T00:00:00Z`));
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** First and last day of the Kuwait month `today` belongs to, or the one before it. */
export function periodRangeFor(
  preset: Exclude<PeriodActionPreset, "custom">,
  today: string,
): { from: string; to: string } {
  const base = new Date(`${today}T00:00:00Z`);
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + (preset === "lastMonth" ? -1 : 0);
  const from = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  return {
    from: toYmd(from),
    to: preset === "lastMonth" ? toYmd(lastDay) : today,
  };
}

/** The preset a stored range matches, so a shared URL or a default reads back correctly. */
export function detectPeriodPreset(
  from: string,
  to: string,
  today: string,
): PeriodActionPreset {
  for (const preset of ["thisMonth", "lastMonth"] as const) {
    const range = periodRangeFor(preset, today);
    if (range.from === from && range.to === to) return preset;
  }
  return "custom";
}

/** The `common.period` copy every page passes to `PeriodActionButtons`. */
export function usePeriodActionLabels(): PeriodActionLabels {
  const t = useTranslations("common.period");
  return {
    thisMonth: t("thisMonth"),
    lastMonth: t("lastMonth"),
    custom: t("custom"),
    customTitle: t("title"),
    from: t("from"),
    to: t("to"),
    cancel: t("cancel"),
    apply: t("apply"),
  };
}

/**
 * One top action bar for every main page: This month / Last month / Custom.
 * Mirrors the Payroll range pills (see `PayrollRangePills`).
 */
export function PeriodActionButtons({
  preset,
  from,
  to,
  labels,
  onPreset,
  onApplyCustom,
  onClearCustom,
  clearLabel,
  formatDay,
  locale = "en",
  className,
}: {
  preset: PeriodActionPreset;
  from: string;
  to: string;
  labels: PeriodActionLabels;
  onPreset: (next: Exclude<PeriodActionPreset, "custom">) => void;
  onApplyCustom: (range: { from: string; to: string }) => void;
  onClearCustom?: () => void;
  clearLabel?: string;
  formatDay?: (ymd: string) => string;
  locale?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  useEffect(() => {
    if (!open) return;
    setDraftFrom(from);
    setDraftTo(to);
  }, [open, from, to]);

  const day = formatDay ?? ((ymd: string) => defaultDayLabel(ymd, locale));
  const customLabel =
    preset === "custom" && from && to ? `${day(from)} – ${day(to)}` : labels.custom;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <ToggleChip
        selected={preset === "thisMonth"}
        className="h-9"
        icon={CalendarRange}
        onClick={() => onPreset("thisMonth")}
      >
        {labels.thisMonth}
      </ToggleChip>
      <ToggleChip
        selected={preset === "lastMonth"}
        className="h-9"
        icon={CalendarRange}
        onClick={() => onPreset("lastMonth")}
      >
        {labels.lastMonth}
      </ToggleChip>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={cn(
            "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm",
            preset === "custom"
              ? "border-emerald-500 bg-emerald-100 font-semibold text-emerald-900 ring-1 ring-emerald-400/50 shadow-sm"
              : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60",
          )}
        >
          <CalendarRange
            className={cn("size-4 shrink-0", preset === "custom" ? "" : "opacity-50")}
          />
          {customLabel}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(340px,92vw)] p-3">
          <p className="mb-2 text-xs font-semibold text-foreground">{labels.customTitle}</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-[10px] text-muted-foreground">
              {labels.from}
              <Input
                type="date"
                value={draftFrom}
                onChange={(event) => setDraftFrom(event.target.value)}
                className="h-9"
              />
            </label>
            <label className="grid gap-1 text-[10px] text-muted-foreground">
              {labels.to}
              <Input
                type="date"
                value={draftTo}
                onChange={(event) => setDraftTo(event.target.value)}
                className="h-9"
              />
            </label>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => setOpen(false)}
            >
              {labels.cancel}
            </Button>
            <Button
              type="button"
              className="h-9"
              onClick={() => {
                onApplyCustom({ from: draftFrom, to: draftTo });
                setOpen(false);
              }}
            >
              {labels.apply}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {preset === "custom" && onClearCustom && clearLabel ? (
        <Button
          type="button"
          variant="outline"
          className="h-9"
          onClick={() => {
            onClearCustom();
            setOpen(false);
          }}
        >
          {clearLabel}
        </Button>
      ) : null}
    </div>
  );
}
