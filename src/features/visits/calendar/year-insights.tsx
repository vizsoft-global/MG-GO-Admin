"use client";

import { formatPct, formatUnitPct } from "@/lib/format/percent";
import { cn } from "@/lib/utils";
import { serviceColorVar } from "./colors";

export function YearInsights({
  year,
  months,
  mix,
  busiest,
  labels,
}: {
  year: number;
  months: { label: string; booked: number; isCurrent: boolean }[];
  mix: { key: string; label: string; count: number; share: number }[];
  busiest: { rank: number; label: string; booked: number; capacityPct: number }[];
  labels: { byMonth: string; serviceMix: string; share: string; busiestDays: string };
}) {
  const peak = months.reduce((max, month) => Math.max(max, month.booked), 0);
  return (
    <aside className="flex w-[380px] max-w-full shrink-0 flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <p className="text-sm font-semibold tabular-nums text-[var(--portal-ink)]">{year}</p>
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold">{labels.byMonth}</h2>
        {months.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <div className="flex h-28 items-end gap-1">
            {months.map((month, index) => {
              const height = peak > 0 ? Math.round((month.booked / peak) * 100) : 0;
              return (
                <div key={`${month.label}-${index}`} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <div className="relative h-20 w-full">
                    <div
                      className="absolute inset-x-0 bottom-0 rounded-sm"
                      style={{
                        height: `${height}%`,
                        backgroundColor: month.isCurrent ? "var(--portal-btn)" : "var(--visit-service-legal)",
                      }}
                      title={`${month.label} ${month.booked}`}
                    />
                  </div>
                  <span className="w-full truncate text-center text-[9px] text-muted-foreground">
                    {month.label.slice(0, 1)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold">{labels.serviceMix}</h2>
          <span className="text-[10px] text-muted-foreground">{labels.share}</span>
        </div>
        {mix.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          mix.map((row) => (
            <div key={row.key} className="flex items-center gap-2 text-xs">
              <span className={cn("size-2 shrink-0 rounded-full", serviceColorVar(row.key, row.label))} />
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              <span className="tabular-nums">{row.count}</span>
              <span className="w-12 text-end tabular-nums text-muted-foreground">
                {formatUnitPct(row.share)}
              </span>
            </div>
          ))
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold">{labels.busiestDays}</h2>
        {busiest.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          busiest.slice(0, 3).map((row) => (
            <div key={row.rank} className="flex items-center gap-2 text-xs">
              <span className="w-4 tabular-nums text-muted-foreground">{row.rank}</span>
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              <span className="tabular-nums">{row.booked}</span>
              <span className="w-12 text-end tabular-nums text-muted-foreground">
                {formatPct(row.capacityPct)}
              </span>
            </div>
          ))
        )}
      </section>
    </aside>
  );
}
