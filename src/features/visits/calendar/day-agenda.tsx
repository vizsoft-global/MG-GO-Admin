"use client";

import { cn } from "@/lib/utils";
import { serviceColorVar } from "./colors";

export function DayAgenda({
  dateLabel,
  hoursLabel,
  booked,
  checkedIn,
  noShows,
  services,
  onOpenDay,
  openDayLabel,
  emptyLabel,
  bookedLabel,
  checkedInLabel,
  noShowsLabel,
}: {
  dateLabel: string;
  hoursLabel: string;
  booked: number;
  checkedIn: number;
  noShows: number;
  services: { key: string; label: string; booked: number; capacity: number }[];
  onOpenDay: () => void;
  openDayLabel: string;
  emptyLabel: string;
  bookedLabel: string;
  checkedInLabel: string;
  noShowsLabel: string;
}) {
  const stats = [
    { label: bookedLabel, value: booked },
    { label: checkedInLabel, value: checkedIn },
    { label: noShowsLabel, value: noShows },
  ] as const;
  return (
    <aside className="flex w-[400px] max-w-full shrink-0 flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div>
        <p className="text-sm font-semibold text-[var(--portal-ink)]">{dateLabel}</p>
        <p className="text-[10px] text-muted-foreground">{hoursLabel}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {stats.map((stat) => (
          <div key={stat.label}>
            <p className="text-[10px] text-muted-foreground">{stat.label}</p>
            <p className="text-sm font-semibold tabular-nums text-[var(--portal-ink)]">{stat.value}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {services.length === 0 ? (
          <p className="text-xs text-muted-foreground">{emptyLabel}</p>
        ) : (
          services.map((row) => {
            const width = row.capacity > 0 ? Math.min(100, (row.booked / row.capacity) * 100) : 0;
            return (
              <div key={row.key} className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className={cn("size-2 shrink-0 rounded-full", serviceColorVar(row.key, row.label))} />
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  <span className="tabular-nums">
                    {row.booked}/{row.capacity}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", serviceColorVar(row.key, row.label))}
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
      <button
        type="button"
        onClick={onOpenDay}
        className={cn("h-9 self-start rounded-md px-2 text-sm font-semibold text-primary hover:bg-primary/10")}
      >
        {openDayLabel}
      </button>
    </aside>
  );
}
