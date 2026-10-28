"use client";

import { visitLoadLevel } from "@/features/visits/visit-board";
import { cn } from "@/lib/utils";
import { monthCells, topServices, type VisitCalendarDayStat } from "./calendar-model";
import { loadClass, serviceColorVar } from "./colors";

const CLOSED_HATCH =
  "repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in srgb, var(--portal-ink) 20%, transparent) 3px 4px)";

export function MonthGrid({
  year,
  monthIndex,
  weekdayLabels,
  statFor,
  selectedYmd,
  todayYmd,
  serviceLabel,
  onSelectDay,
}: {
  year: number;
  monthIndex: number;
  weekdayLabels: readonly string[];
  statFor: (ymd: string) => VisitCalendarDayStat | undefined;
  selectedYmd: string | null;
  todayYmd: string;
  serviceLabel: (key: string) => string;
  onSelectDay: (ymd: string) => void;
}) {
  const cells = monthCells(year, monthIndex);
  return (
    <div className="grid grid-cols-7 gap-1">
      {weekdayLabels.map((label) => (
        <span key={label} className="px-1 text-center text-[10px] font-semibold text-muted-foreground">
          {label}
        </span>
      ))}
      {cells.map((cell) => {
        const stat = statFor(cell.ymd);
        const booked = stat?.booked ?? 0;
        const capacity = stat?.capacity ?? 0;
        const closed = stat?.closed === true;
        const faded = cell.outside || stat?.outside === true;
        const selected = selectedYmd === cell.ymd;
        const today = todayYmd === cell.ymd;
        const services = topServices(stat?.departments ?? {}, 3);
        const fillPct = !closed && capacity > 0 ? Math.round((booked / capacity) * 100) : null;
        return (
          <button
            key={cell.ymd}
            type="button"
            aria-pressed={selected}
            aria-current={today ? "date" : undefined}
            onClick={() => onSelectDay(cell.ymd)}
            style={closed ? { backgroundImage: CLOSED_HATCH } : undefined}
            className={cn(
              "flex min-h-[4.75rem] flex-col gap-0.5 rounded-md border border-border p-1 text-start",
              closed
                ? "bg-muted/40 text-muted-foreground"
                : loadClass(visitLoadLevel(booked, capacity)),
              faded && "opacity-40",
              selected && "ring-2 ring-[var(--portal-ink)]",
              today && !selected && "ring-1 ring-[var(--visit-service-legal)]",
              today && selected && "shadow-[inset_0_0_0_1px_var(--visit-service-legal)]",
            )}
          >
            <span className="flex items-center justify-between gap-1">
              <span className="text-xs font-semibold tabular-nums">{cell.day}</span>
              {fillPct != null ? (
                <span className="text-[10px] tabular-nums">{fillPct}%</span>
              ) : null}
            </span>
            <span className="text-[10px] font-semibold tabular-nums">{booked}</span>
            {services.map((row) => (
              <span key={row.key} className="flex items-center gap-1 text-[10px] leading-tight">
                <span
                  className={cn("size-1.5 shrink-0 rounded-full", serviceColorVar(row.key, serviceLabel(row.key)))}
                />
                <span className="min-w-0 flex-1 truncate">{serviceLabel(row.key)}</span>
                <span className="tabular-nums">{row.count}</span>
              </span>
            ))}
          </button>
        );
      })}
    </div>
  );
}
