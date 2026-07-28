"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const KUWAIT_TZ = "Asia/Kuwait";
const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

function kuwaitToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KUWAIT_TZ }).format(new Date());
}

function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatDisplayDate(iso: string, locale?: string): string {
  const parsed = new Date(`${iso}T00:00:00+03:00`);
  return new Intl.DateTimeFormat(locale ?? "en", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: KUWAIT_TZ,
  }).format(parsed);
}

function monthLabel(year: number, month: number, locale?: string): string {
  const parsed = new Date(`${year}-${String(month).padStart(2, "0")}-01T12:00:00+03:00`);
  return new Intl.DateTimeFormat(locale ?? "en", {
    month: "long",
    year: "numeric",
    timeZone: KUWAIT_TZ,
  }).format(parsed);
}

function buildMonthGrid(year: number, month: number) {
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: Array<{ iso: string; day: number; inMonth: boolean } | null> = [];

  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push(null);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ iso: toIsoDate(year, month, day), day, inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

export function HistoryDatePicker({
  value,
  onChange,
  activeDates,
  disabled,
  locale,
  onViewMonthChange,
}: {
  value: string;
  onChange: (iso: string) => void;
  activeDates: Set<string>;
  disabled?: boolean;
  locale?: string;
  onViewMonthChange?: (yearMonth: string) => void;
}) {
  const t = useTranslations("pages.liveTracking");
  const [open, setOpen] = useState(false);
  const selected = parseIsoDate(value);
  const [viewYear, setViewYear] = useState(selected.year);
  const [viewMonth, setViewMonth] = useState(selected.month);

  const today = kuwaitToday();
  const cells = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth - 1 + delta, 1);
    const nextYear = d.getFullYear();
    const nextMonth = d.getMonth() + 1;
    setViewYear(nextYear);
    setViewMonth(nextMonth);
    onViewMonthChange?.(`${nextYear}-${String(nextMonth).padStart(2, "0")}`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "h-9 w-full cursor-pointer justify-start gap-2 rounded-lg px-3 text-sm font-normal",
              !value && "text-muted-foreground",
            )}
          />
        }
      >
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{formatDisplayDate(value, locale)}</span>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-3" align="start">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 cursor-pointer"
            onClick={() => shiftMonth(-1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <p className="text-sm font-semibold">{monthLabel(viewYear, viewMonth, locale)}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 cursor-pointer"
            onClick={() => shiftMonth(1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAY_LABELS.map((label) => (
            <span key={label} className="py-1 text-[10px] font-medium uppercase text-muted-foreground">
              {label}
            </span>
          ))}
          {cells.map((cell, index) => {
            if (!cell) {
              return <span key={`empty-${index}`} />;
            }
            const isSelected = cell.iso === value;
            const hasData = activeDates.has(cell.iso);
            const isToday = cell.iso === today;

            return (
              <button
                key={cell.iso}
                type="button"
                disabled={disabled}
                className={cn(
                  "relative flex h-8 w-full cursor-pointer items-center justify-center rounded-md text-xs font-medium transition-colors",
                  isSelected
                    ? "bg-emerald-600 text-white ring-2 ring-emerald-400/70"
                    : hasData
                      ? "border border-emerald-400/70 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-300/50 hover:bg-emerald-100"
                      : "text-foreground hover:bg-muted/60",
                  isToday && !isSelected && "font-semibold",
                )}
                onClick={() => {
                  onChange(cell.iso);
                  setOpen(false);
                }}
              >
                {cell.day}
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2">
          <button
            type="button"
            className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => {
              onChange(today);
              setViewYear(parseIsoDate(today).year);
              setViewMonth(parseIsoDate(today).month);
              setOpen(false);
            }}
          >
            {t("historyToday")}
          </button>
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="inline-block size-3 rounded border border-emerald-400/70 bg-emerald-50" />
            {t("historyDateHasData")}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
