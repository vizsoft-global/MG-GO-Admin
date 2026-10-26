"use client";

import { heatClass, monthMatrix, ymd, type VisitHeat } from "./visit-board";

export type CalendarDayStat = {
  booked: number;
  heat: VisitHeat;
  departments: Record<string, number>;
};

export function VisitYearGrid({
  year,
  statFor,
  weekdayLabels,
  monthLabels,
  onOpenDay,
  onOpenMonth,
}: {
  year: number;
  statFor: (ymd: string) => CalendarDayStat | undefined;
  weekdayLabels: readonly string[];
  monthLabels: string[];
  onOpenDay: (ymd: string) => void;
  onOpenMonth: (monthIndex: number) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {monthLabels.map((label, month) => {
        const cells = monthMatrix(year, month);
        return (
          <div key={label} className="rounded-xl border border-border bg-card p-2">
            <button
              type="button"
              className="mb-1 text-sm font-semibold text-foreground"
              onClick={() => onOpenMonth(month)}
            >
              {label}
            </button>
            <div className="grid grid-cols-7 gap-0.5">
              {weekdayLabels.map((day) => (
                <span key={day} className="text-center text-[10px] text-muted-foreground">
                  {day.slice(0, 1)}
                </span>
              ))}
              {cells.map((day, index) => {
                if (!day) return <span key={`e-${index}`} className="h-7" />;
                const key = ymd(year, month, day);
                const stat = statFor(key);
                const heat: VisitHeat = stat?.heat ?? "idle";
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onOpenDay(key)}
                    className={`h-7 rounded text-[10px] ${heatClass(heat)}`}
                  >
                    {stat && stat.booked > 0 ? stat.booked : day}
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

export function VisitMonthGrid({
  year,
  month,
  statFor,
  weekdayLabels,
  onOpenDay,
}: {
  year: number;
  month: number;
  statFor: (ymd: string) => CalendarDayStat | undefined;
  weekdayLabels: readonly string[];
  onOpenDay: (ymd: string) => void;
}) {
  const cells = monthMatrix(year, month);
  return (
    <div className="grid grid-cols-7 gap-1">
      {weekdayLabels.map((day) => (
        <span key={day} className="text-center text-[10px] font-semibold text-muted-foreground">
          {day}
        </span>
      ))}
      {cells.map((day, index) => {
        if (!day) return <span key={`e-${index}`} />;
        const key = ymd(year, month, day);
        const stat = statFor(key);
        const lines = Object.entries(stat?.departments ?? {}).slice(0, 3);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onOpenDay(key)}
            className={`min-h-[4.5rem] rounded-lg p-1 text-start ${heatClass(stat?.heat ?? "idle")}`}
          >
            <span className="text-xs font-semibold">{day}</span>
            {lines.map(([key, count]) => (
              <span key={key} className="block truncate text-[10px]">
                {key}: {count}
              </span>
            ))}
          </button>
        );
      })}
    </div>
  );
}
