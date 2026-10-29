"use client";

import type { ReactNode } from "react";
import { useLocale } from "next-intl";

import { visitLoadLevel } from "@/features/visits/visit-board";
import { cn } from "@/lib/utils";
import { monthCells, type VisitCalendarDayStat } from "./calendar-model";
import { loadClass } from "./colors";

function weekdayMark(label: string): string {
  return label.length <= 2 ? label : label.slice(0, 1);
}

export function YearGrid({
  title,
  subtitle,
  legend,
  year,
  monthLabels,
  monthTotals,
  weekdayLabels,
  statFor,
  todayYmd,
  onOpenDay,
  onOpenMonth,
  peakLabel,
  bookedSuffix,
}: {
  title: string;
  subtitle: string;
  legend?: ReactNode;
  year: number;
  monthLabels: readonly string[];
  monthTotals: readonly { booked: number; isFuture: boolean }[];
  weekdayLabels: readonly string[];
  statFor: (ymd: string) => VisitCalendarDayStat | undefined;
  todayYmd: string;
  onOpenDay: (ymd: string) => void;
  onOpenMonth: (monthIndex: number) => void;
  peakLabel: (day: string, count: number) => string;
  bookedSuffix: string;
}) {
  const locale = useLocale();
  const numberFormat = new Intl.NumberFormat(locale === "ar" ? "ar" : "en-US", {
    numberingSystem: "latn",
  });

  return (
    <section className="rounded-xl border border-[var(--portal-border)] bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <div role="heading" aria-level={2} className="text-xl leading-7 font-bold text-[var(--portal-ink)]">{title}</div>
          <p className="text-xs leading-5 text-[var(--portal-muted)]">{subtitle}</p>
        </div>
        {legend}
      </header>
      <div className="grid grid-cols-1 gap-x-5 gap-y-6 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-4">
        {monthLabels.map((label, monthIndex) => {
          const cells = monthCells(year, monthIndex);
          let peakDay = 0;
          let peakCount = 0;
          for (const cell of cells) {
            if (!cell) continue;
            const booked = statFor(cell.ymd)?.booked ?? 0;
            if (booked > peakCount) {
              peakCount = booked;
              peakDay = cell.day;
            }
          }
          const total = monthTotals[monthIndex];
          return (
            <div key={label} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onOpenMonth(monthIndex)}
                  className="truncate text-[13px] font-semibold text-[var(--portal-ink)] hover:underline"
                >
                  {label}
                </button>
                <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--portal-muted)]">
                  {total?.isFuture
                    ? `${numberFormat.format(total.booked)} ${bookedSuffix}`
                    : numberFormat.format(total?.booked ?? 0)}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-7 gap-[2px]">
                {weekdayLabels.map((day) => (
                  <span
                    key={day}
                    className="text-center text-[9px] font-medium text-[var(--portal-muted)]"
                  >
                    {weekdayMark(day)}
                  </span>
                ))}
                {cells.map((cell, index) => {
                  if (!cell) return <span key={`e-${index}`} className="h-[22px]" />;
                  const stat = statFor(cell.ymd);
                  const booked = stat?.booked ?? 0;
                  const capacity = stat?.capacity ?? 0;
                  const closed = stat?.closed === true;
                  const today = todayYmd === cell.ymd;
                  const level = visitLoadLevel(booked, capacity);
                  return (
                    <button
                      key={cell.ymd}
                      type="button"
                      aria-current={today ? "date" : undefined}
                      onClick={() => onOpenDay(cell.ymd)}
                      className={cn(
                        "flex h-[22px] items-center justify-center rounded-[3px] text-[9.5px] leading-none tabular-nums text-[var(--portal-ink)]",
                        closed ? "bg-[var(--visit-tint)] text-[var(--portal-muted)]" : loadClass(level),
                        level === 5 && "text-[var(--accent-rust)]",
                        today && "ring-1 ring-[var(--accent-rust)] ring-offset-[1px]",
                      )}
                    >
                      {cell.day}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 truncate text-[10px] text-[var(--portal-muted)]">
                {peakCount > 0 ? peakLabel(`${peakDay} ${label.slice(0, 3)}`, peakCount) : ""}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
