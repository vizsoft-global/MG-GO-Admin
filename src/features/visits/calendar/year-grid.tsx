"use client";

import { visitLoadLevel } from "@/features/visits/visit-board";
import { cn } from "@/lib/utils";
import { monthCells, type VisitCalendarDayStat } from "./calendar-model";
import { loadClass } from "./colors";

function weekdayMark(label: string): string {
  return label.length <= 2 ? label : label.slice(0, 1);
}

export function YearGrid({
  year,
  monthLabels,
  weekdayLabels,
  statFor,
  todayYmd,
  onOpenDay,
  onOpenMonth,
}: {
  year: number;
  monthLabels: readonly string[];
  weekdayLabels: readonly string[];
  statFor: (ymd: string) => VisitCalendarDayStat | undefined;
  todayYmd: string;
  onOpenDay: (ymd: string) => void;
  onOpenMonth: (monthIndex: number) => void;
}) {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4">
      {monthLabels.map((label, monthIndex) => {
        const cells = monthCells(year, monthIndex);
        return (
          <div key={label} className="rounded-lg border border-border bg-card p-1.5">
            <button
              type="button"
              onClick={() => onOpenMonth(monthIndex)}
              className="mb-1 h-9 w-full truncate rounded-md px-1 text-start text-xs font-semibold text-[var(--portal-ink)] hover:bg-muted/40"
            >
              {label}
            </button>
            <div className="grid grid-cols-7 gap-0.5">
              {weekdayLabels.map((day) => (
                <span key={day} className="text-center text-[9px] text-muted-foreground">
                  {weekdayMark(day)}
                </span>
              ))}
              {cells.map((cell) => {
                const stat = statFor(cell.ymd);
                const closed = stat?.closed === true;
                const faded = cell.outside || stat?.outside === true;
                const today = todayYmd === cell.ymd;
                const booked = stat?.booked ?? 0;
                const capacity = stat?.capacity ?? 0;
                return (
                  <button
                    key={cell.ymd}
                    type="button"
                    aria-current={today ? "date" : undefined}
                    onClick={() => onOpenDay(cell.ymd)}
                    className={cn(
                      "flex h-4 items-center justify-center rounded-[2px] text-[8px] leading-none",
                      closed
                        ? "bg-transparent"
                        : loadClass(visitLoadLevel(booked, capacity)),
                      faded && "opacity-40",
                      today && "ring-1 ring-[var(--visit-service-legal)]",
                    )}
                  >
                    {closed ? (
                      <span className="size-1.5 rounded-[1px] bg-[var(--visit-service-other)] opacity-40" />
                    ) : (
                      cell.day
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
