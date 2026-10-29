"use client";

import { useLocale } from "next-intl";

import { cn } from "@/lib/utils";
import { serviceColorVar } from "./colors";

type MixRow = { key: string; label: string; count: number; share: number };
type MonthRow = { label: string; booked: number; isCurrent: boolean; isFuture: boolean };
type BusiestRow = { rank: number; label: string; booked: number; capacityPct: number };

export function YearInsights({
  year,
  months,
  mix,
  busiest,
  labels,
}: {
  year: number;
  months: MonthRow[];
  mix: MixRow[];
  busiest: BusiestRow[];
  labels: {
    byMonth: string;
    serviceMix: string;
    share: string;
    busiestDays: string;
    topThree: string;
    completed: string;
    thisMonth: string;
    scheduled: string;
    ofCapacity: (pct: number) => string;
  };
}) {
  const locale = useLocale();
  const numberFormat = new Intl.NumberFormat(locale === "ar" ? "ar" : "en-US", {
    numberingSystem: "latn",
  });
  const peak = months.reduce((max, month) => Math.max(max, month.booked), 0);
  const mixTotal = mix.reduce((total, row) => total + row.count, 0);

  return (
    <aside className="flex w-[360px] max-w-full shrink-0 flex-col gap-4">
      <section className="rounded-xl border border-[var(--portal-border)] bg-card p-5">
        <div className="flex items-baseline justify-between gap-2">
          <div role="heading" aria-level={2} className="text-[13px] font-semibold text-[var(--portal-ink)]">{labels.byMonth}</div>
          <span className="text-[11.5px] tabular-nums text-[var(--portal-muted)]">{year}</span>
        </div>
        <div className="mt-4 flex h-[150px] items-stretch gap-1.5">
          {months.map((month, index) => {
            const height = peak > 0 ? Math.max(2, Math.round((month.booked / peak) * 100)) : 2;
            return (
              <div
                key={`${month.label}-${index}`}
                className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                title={`${month.label} ${numberFormat.format(month.booked)}`}
              >
                {month.isCurrent ? (
                  <span className="text-[9.5px] font-semibold tabular-nums text-[var(--accent-rust)]">
                    {numberFormat.format(month.booked)}
                  </span>
                ) : null}
                <span
                  className="w-full rounded-t-[3px]"
                  style={{
                    height: `${height}%`,
                    backgroundColor: month.isCurrent
                      ? "var(--accent-rust)"
                      : month.isFuture
                        ? "var(--visit-bar-track)"
                        : "var(--visit-load-3)",
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex gap-1.5">
          {months.map((month, index) => (
            <span
              key={`${month.label}-axis-${index}`}
              className="min-w-0 flex-1 text-center text-[9.5px] text-[var(--portal-muted)]"
            >
              {month.label.slice(0, 1)}
            </span>
          ))}
        </div>
        <ul className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-[var(--portal-muted)]">
          <li className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-[var(--visit-load-3)]" aria-hidden />
            {labels.completed}
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-[var(--accent-rust)]" aria-hidden />
            {labels.thisMonth}
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-[var(--visit-bar-track)]" aria-hidden />
            {labels.scheduled}
          </li>
        </ul>
      </section>

      <section className="rounded-xl border border-[var(--portal-border)] bg-card p-5">
        <div className="flex items-baseline justify-between gap-2">
          <div role="heading" aria-level={2} className="text-[13px] font-semibold text-[var(--portal-ink)]">{labels.serviceMix}</div>
          <span className="text-[10.5px] text-[var(--portal-muted)]">{labels.share}</span>
        </div>
        {mix.length === 0 ? (
          <p className="mt-3 text-xs text-[var(--portal-muted)]">—</p>
        ) : (
          <>
            <div className="mt-3 flex h-1.5 overflow-hidden rounded-full">
              {mix.map((row) => (
                <span
                  key={`bar-${row.key}`}
                  className={cn("h-full", serviceColorVar(row.key, row.label))}
                  style={{ width: `${mixTotal > 0 ? (row.count / mixTotal) * 100 : 0}%` }}
                  aria-hidden
                />
              ))}
            </div>
            <ul className="mt-3 flex flex-col gap-1.5">
              {mix.map((row) => (
                <li key={row.key} className="flex min-w-0 items-center gap-2 text-[11.5px]">
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-[2px]",
                      serviceColorVar(row.key, row.label),
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-[var(--portal-ink)]">
                    {row.label}
                  </span>
                  <span className="shrink-0 tabular-nums text-[var(--portal-muted)]">
                    {numberFormat.format(row.count)}
                  </span>
                  <span className="w-9 shrink-0 text-end tabular-nums text-[var(--portal-ink)]">
                    {Math.round(row.share * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="rounded-xl border border-[var(--portal-border)] bg-card p-5">
        <div className="flex items-baseline justify-between gap-2">
          <div role="heading" aria-level={2} className="text-[13px] font-semibold text-[var(--portal-ink)]">{labels.busiestDays}</div>
          <span className="text-[10.5px] text-[var(--portal-muted)]">{labels.topThree}</span>
        </div>
        {busiest.length === 0 ? (
          <p className="mt-3 text-xs text-[var(--portal-muted)]">—</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2.5">
            {busiest.slice(0, 3).map((row) => (
              <li key={row.rank} className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--visit-tint)] text-[10.5px] font-semibold tabular-nums text-[var(--portal-muted)]">
                  {row.rank}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[12px] font-semibold text-[var(--portal-ink)]">
                    {row.label}
                  </span>
                  <span className="truncate text-[10px] text-[var(--portal-muted)]">
                    {labels.ofCapacity(row.capacityPct)}
                  </span>
                </span>
                <span className="shrink-0 text-[14px] font-bold tabular-nums text-[var(--accent-rust)]">
                  {numberFormat.format(row.booked)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

