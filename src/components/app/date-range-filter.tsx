"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type DateRangePreset =
  | "all"
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "last90"
  | "custom";

export type DateRangeValue = {
  preset: DateRangePreset;
  /** Inclusive ISO bound (start of range) or null when unbounded. */
  from: string | null;
  /** Inclusive ISO bound (end of range) or null when unbounded. */
  to: string | null;
};

export const DATE_RANGE_ALL: DateRangeValue = {
  preset: "all",
  from: null,
  to: null,
};

type Ymd = { y: number; m: number; d: number };

const KUWAIT_OFFSET = "+03:00";

/** Today's calendar date in Kuwait (fixed UTC+3, no DST). */
function kuwaitTodayYmd(): Ymd {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = parts.split("-").map(Number);
  return { y, m, d };
}

function ymdAddDays(ymd: Ymd, days: number): Ymd {
  const date = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + days, 12));
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parseTimeValue(value: string): { hh: number; mm: number } {
  const [h, m] = value.split(":").map((part) => Number.parseInt(part, 10));
  return {
    hh: Number.isFinite(h) ? Math.min(Math.max(h, 0), 23) : 0,
    mm: Number.isFinite(m) ? Math.min(Math.max(m, 0), 59) : 0,
  };
}

function dayStartIso(ymd: Ymd): string {
  return `${ymd.y}-${pad(ymd.m)}-${pad(ymd.d)}T00:00:00.000${KUWAIT_OFFSET}`;
}

function dayEndIso(ymd: Ymd): string {
  return `${ymd.y}-${pad(ymd.m)}-${pad(ymd.d)}T23:59:59.999${KUWAIT_OFFSET}`;
}

function dayIsoAt(ymd: Ymd, timeValue: string, endOfMinute = false): string {
  const { hh, mm } = parseTimeValue(timeValue);
  const ms = endOfMinute ? ".999" : ".000";
  return `${ymd.y}-${pad(ymd.m)}-${pad(ymd.d)}T${pad(hh)}:${pad(mm)}:${endOfMinute ? "59" : "00"}${ms}${KUWAIT_OFFSET}`;
}

function dateToYmd(date: Date): Ymd {
  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
}

function isoTimePart(iso: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kuwait",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(iso));
    const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
    const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
    return `${hh}:${mm}`;
  } catch {
    return "00:00";
  }
}

function isFullDayRange(from: string, to: string): boolean {
  return isoTimePart(from) === "00:00" && (isoTimePart(to) === "23:59" || isoTimePart(to) === "24:00");
}

/** Resolve a preset to inclusive ISO bounds (Kuwait day boundaries). */
export function rangeForPreset(
  preset: Exclude<DateRangePreset, "custom">,
): Pick<DateRangeValue, "from" | "to"> {
  if (preset === "all") return { from: null, to: null };
  const today = kuwaitTodayYmd();
  switch (preset) {
    case "today":
      return { from: dayStartIso(today), to: dayEndIso(today) };
    case "yesterday": {
      const y = ymdAddDays(today, -1);
      return { from: dayStartIso(y), to: dayEndIso(y) };
    }
    case "last7":
      return { from: dayStartIso(ymdAddDays(today, -6)), to: dayEndIso(today) };
    case "last30":
      return { from: dayStartIso(ymdAddDays(today, -29)), to: dayEndIso(today) };
    case "last90":
      return { from: dayStartIso(ymdAddDays(today, -89)), to: dayEndIso(today) };
  }
}

function formatRangeLabel(from: string, to: string): string {
  const dateFmt = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Kuwait",
  });
  const timeFmt = new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kuwait",
  });
  const fromDate = dateFmt.format(new Date(from));
  const toDate = dateFmt.format(new Date(to));
  const fullDay = isFullDayRange(from, to);
  if (fromDate === toDate && fullDay) return fromDate;
  if (fromDate === toDate) {
    return `${fromDate} ${timeFmt.format(new Date(from))} – ${timeFmt.format(new Date(to))}`;
  }
  if (fullDay) return `${fromDate} – ${toDate}`;
  return `${fromDate} ${timeFmt.format(new Date(from))} – ${toDate} ${timeFmt.format(new Date(to))}`;
}

const PRESETS: Array<Exclude<DateRangePreset, "custom">> = [
  "all",
  "today",
  "yesterday",
  "last7",
  "last30",
  "last90",
];

export function DateRangeFilter({
  value,
  onChange,
  className,
}: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  className?: string;
}) {
  const t = useTranslations("common.dateRange");
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime] = useState("23:59");

  const isActive = value.preset !== "all";
  const triggerLabel =
    value.preset === "custom" && value.from && value.to
      ? formatRangeLabel(value.from, value.to)
      : t(value.preset);

  const selectPreset = (preset: Exclude<DateRangePreset, "custom">) => {
    onChange({ preset, ...rangeForPreset(preset) });
    setShowCustom(false);
    setOpen(false);
  };

  const applyCustom = () => {
    if (!draft?.from) return;
    const fromYmd = dateToYmd(draft.from);
    const toYmd = dateToYmd(draft.to ?? draft.from);
    onChange({
      preset: "custom",
      from: dayIsoAt(fromYmd, startTime, false),
      to: dayIsoAt(toYmd, endTime, true),
    });
    setShowCustom(false);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setShowCustom(false);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-9 cursor-pointer rounded-lg",
              isActive && "border-primary/30 bg-primary/5 text-primary hover:text-primary",
              className,
            )}
          />
        }
      >
        <CalendarDays className="me-2 h-3.5 w-3.5" />
        {triggerLabel}
        <ChevronDown className="ms-1.5 h-3.5 w-3.5 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="flex">
          <div className="flex w-40 flex-col gap-0.5 p-1.5">
            {PRESETS.map((preset) => {
              const selected = value.preset === preset && !showCustom;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => selectPreset(preset)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-start text-sm transition-colors hover:bg-muted",
                    selected && "bg-primary/10 font-medium text-primary hover:bg-primary/10",
                  )}
                >
                  {t(preset)}
                  {selected ? <Check className="h-3.5 w-3.5" /> : null}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setShowCustom(true);
                if (value.preset === "custom" && value.from && value.to) {
                  setDraft({
                    from: new Date(value.from),
                    to: new Date(value.to),
                  });
                  setStartTime(isoTimePart(value.from));
                  setEndTime(isoTimePart(value.to));
                } else {
                  setDraft(undefined);
                  setStartTime("00:00");
                  setEndTime("23:59");
                }
              }}
              className={cn(
                "flex cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-start text-sm transition-colors hover:bg-muted",
                (showCustom || value.preset === "custom") &&
                  "bg-primary/10 font-medium text-primary hover:bg-primary/10",
              )}
            >
              {t("custom")}
              {value.preset === "custom" && !showCustom ? (
                <Check className="h-3.5 w-3.5" />
              ) : null}
            </button>
          </div>
          {showCustom ? (
            <div className="flex flex-col border-s border-border">
              <p className="px-3 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("pickStartEnd")}
              </p>
              <Calendar
                mode="range"
                selected={draft}
                onSelect={setDraft}
                defaultMonth={draft?.from}
                disabled={{ after: new Date() }}
              />
              <div className="grid grid-cols-2 gap-2 border-t border-border px-3 py-2">
                <div className="space-y-1">
                  <Label htmlFor="date-range-start-time" className="text-[10px] text-muted-foreground">
                    {t("startTime")}
                  </Label>
                  <Input
                    id="date-range-start-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="h-9 cursor-pointer rounded-lg"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="date-range-end-time" className="text-[10px] text-muted-foreground">
                    {t("endTime")}
                  </Label>
                  <Input
                    id="date-range-end-time"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="h-9 cursor-pointer rounded-lg"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 cursor-pointer rounded-lg"
                  onClick={() => {
                    setShowCustom(false);
                    setDraft(undefined);
                  }}
                >
                  {t("cancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 cursor-pointer rounded-lg"
                  disabled={!draft?.from}
                  onClick={applyCustom}
                >
                  {t("apply")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
