"use client";

import type { ReactNode } from "react";

import { visitLoadLevel } from "@/features/visits/visit-board";
import { cn } from "@/lib/utils";
import { monthCells, topServices, type VisitCalendarDayStat } from "./calendar-model";
import { loadClass, serviceColorVar } from "./colors";

const CLOSED_HATCH =
  "repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in srgb, var(--portal-ink) 16%, transparent) 3px 4px)";

export function MonthGrid({
  title,
  subtitle,
  legend,
  year,
  monthIndex,
  weekdayLabels,
  statFor,
  selectedYmd,
  todayYmd,
  serviceLabel,
  onSelectDay,
  fullLabel,
}: {
  title: string;
  subtitle: string;
  legend?: ReactNode;
  year: number;
  monthIndex: number;
  weekdayLabels: readonly string[];
  statFor: (ymd: string) => VisitCalendarDayStat | undefined;
  selectedYmd: string | null;
  todayYmd: string;
  serviceLabel: (key: string) => string;
  onSelectDay: (ymd: string) => void;
  fullLabel: string;
}) {
  const cells = monthCells(year, monthIndex);
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--portal-border)] bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <div role="heading" aria-level={2} className="text-xl leading-7 font-bold text-[var(--portal-ink)]">{title}</div>
          <p className="text-xs leading-5 text-[var(--portal-muted)]">{subtitle}</p>
        </div>
        {legend}
      </header>
      <div className="grid grid-cols-7 border-t border-[var(--visit-line)]">
        {weekdayLabels.map((label) => (
          <div
            key={label}
            className="border-e border-b border-[var(--visit-line)] px-2.5 py-2 text-[10.5px] font-medium tracking-[0.06em] text-[var(--portal-muted)] uppercase last:border-e-0"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const stat = statFor(cell.ymd);
          const booked = stat?.booked ?? 0;
          const capacity = stat?.capacity ?? 0;
          const closed = stat?.closed === true;
          const faded = cell.outside || stat?.outside === true;
          const selected = selectedYmd === cell.ymd;
          const today = todayYmd === cell.ymd;
          const services = topServices(stat?.departments ?? {}, 3);
          const level = visitLoadLevel(booked, capacity);
          const full = level === 5;
          const fillPct =
            !closed && !full && capacity > 0 ? Math.round((booked / capacity) * 100) : null;
          return (
            <button
              key={cell.ymd}
              type="button"
              aria-pressed={selected}
              aria-current={today ? "date" : undefined}
              onClick={() => onSelectDay(cell.ymd)}
              style={closed ? { backgroundImage: CLOSED_HATCH } : undefined}
              className={cn(
                "flex min-h-[118px] flex-col gap-1 border-e border-b border-[var(--visit-line)] px-2.5 pt-2 pb-2 text-start align-top last:border-e-0",
                closed
                  ? "bg-[var(--visit-tint)] text-[var(--portal-muted)]"
                  : full
                    ? "bg-[var(--visit-full-wash)]"
                    : loadClass(level),
                faded && "opacity-40",
                selected && "ring-2 ring-inset ring-[var(--portal-ink)]",
                today && !selected && "ring-1 ring-inset ring-[var(--accent-rust)]",
              )}
            >
              <span className="flex items-center justify-between gap-1">
                <span
                  className={cn(
                    "flex size-[22px] items-center justify-center rounded-full text-[12.5px] font-semibold tabular-nums",
                    today
                      ? "bg-[var(--accent-rust)] text-white"
                      : full
                        ? "text-[var(--accent-rust)]"
                        : "text-[var(--portal-ink)]",
                  )}
                >
                  {cell.day}
                </span>
                {booked > 0 ? (
                  <span className="text-[11.5px] tabular-nums text-[var(--portal-muted)]">
                    {booked}
                  </span>
                ) : null}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                {services.map((row) => (
                  <span
                    key={row.key}
                    className="flex min-w-0 items-center gap-1 text-[10.5px] leading-4"
                  >
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-[2px]",
                        serviceColorVar(row.key, serviceLabel(row.key)),
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">{serviceLabel(row.key)}</span>
                    <span className="shrink-0 tabular-nums">{row.count}</span>
                  </span>
                ))}
              </span>
              <span className="mt-auto flex items-center gap-1.5">
                <span className="block h-[2px] flex-1 overflow-hidden rounded-full bg-[var(--visit-bar-track)]">
                  <span
                    className="block h-[2px] rounded-full"
                    style={{
                      width: `${capacity > 0 ? Math.min(100, (booked / capacity) * 100) : 0}%`,
                      backgroundColor: full ? "var(--visit-cap-full)" : "var(--visit-cap-open)",
                    }}
                  />
                </span>
                <span
                  className={cn(
                    "text-[10px] tabular-nums",
                    full
                      ? "font-semibold text-[var(--visit-cap-full)]"
                      : "text-[var(--portal-muted)]",
                  )}
                >
                  {full ? fullLabel : fillPct != null ? `${fillPct}%` : ""}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

