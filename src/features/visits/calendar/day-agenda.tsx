"use client";

import { ArrowRight } from "lucide-react";

import { bookingStatusStyle, serviceColorVar } from "./colors";
import { cn } from "@/lib/utils";

type AgendaNext = {
  id: string;
  time: string;
  name: string;
  serviceLabel: string;
  status: string;
};

export function DayAgenda({
  dateLabel,
  hoursLabel,
  isToday,
  todayLabel,
  booked,
  checkedIn,
  noShows,
  services,
  upNext,
  fromLabel,
  onOpenDay,
  openDayLabel,
  emptyLabel,
  bookedLabel,
  checkedInLabel,
  noShowsLabel,
  byServiceLabel,
  capacityLabel,
  upNextLabel,
  statusLabel,
}: {
  dateLabel: string;
  hoursLabel: string;
  isToday: boolean;
  todayLabel: string;
  booked: number;
  checkedIn: number;
  noShows: number;
  services: { key: string; label: string; booked: number; capacity: number }[];
  upNext: AgendaNext[];
  fromLabel: string;
  onOpenDay: () => void;
  openDayLabel: string;
  emptyLabel: string;
  bookedLabel: string;
  checkedInLabel: string;
  noShowsLabel: string;
  byServiceLabel: string;
  capacityLabel: string;
  upNextLabel: string;
  statusLabel: (status: string) => string;
}) {
  const stats = [
    { label: bookedLabel, value: booked },
    { label: checkedInLabel, value: checkedIn },
    { label: noShowsLabel, value: noShows },
  ] as const;

  return (
    <aside className="flex w-[360px] max-w-full shrink-0 flex-col">
      <section className="overflow-hidden rounded-xl border border-[var(--portal-border)] bg-card">
        <header className="flex items-start justify-between gap-2 px-5 pt-5">
          <div className="min-w-0">
            <div role="heading" aria-level={2} className="text-xl leading-7 font-bold text-[var(--portal-ink)]">{dateLabel}</div>
            <p className="text-xs leading-5 text-[var(--portal-muted)]">{hoursLabel}</p>
          </div>
          {isToday ? (
            <span className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--visit-full-wash)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--accent-rust)]">
              <span className="size-1.5 rounded-full bg-current" aria-hidden />
              {todayLabel}
            </span>
          ) : null}
        </header>

        <div className="mt-4 grid grid-cols-3 gap-2 px-5">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-lg bg-[var(--visit-tint)] px-3 py-2">
              <p className="truncate text-[10.5px] text-[var(--portal-muted)]">{stat.label}</p>
              <p className="text-lg leading-6 font-bold tabular-nums text-[var(--portal-ink)]">
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-5 px-5">
          <div className="flex items-baseline justify-between gap-2">
            <div role="heading" aria-level={3} className="text-[12.5px] font-semibold text-[var(--portal-ink)]">
              {byServiceLabel}
            </div>
            <span className="text-[10px] text-[var(--portal-muted)]">{capacityLabel}</span>
          </div>
          {services.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--portal-muted)]">{emptyLabel}</p>
          ) : (
            <ul className="mt-2.5 flex flex-col gap-2">
              {services.map((row) => {
                const width =
                  row.capacity > 0 ? Math.min(100, (row.booked / row.capacity) * 100) : 0;
                return (
                  <li key={row.key} className="flex min-w-0 items-center gap-2 text-[11.5px]">
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-[2px]",
                        serviceColorVar(row.key, row.label),
                      )}
                      aria-hidden
                    />
                    <span className="w-[104px] shrink-0 truncate text-[var(--portal-ink)]">
                      {row.label}
                    </span>
                    <span className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--visit-bar-track)]">
                      <span
                        className={cn(
                          "block h-[3px] rounded-full",
                          serviceColorVar(row.key, row.label),
                        )}
                        style={{ width: `${width}%` }}
                      />
                    </span>
                    <span className="w-9 shrink-0 text-end tabular-nums text-[var(--portal-muted)]">
                      {row.booked}/{row.capacity}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {upNext.length > 0 ? (
        <div className="mt-5 px-5">
          <div className="flex items-baseline justify-between gap-2">
            <div role="heading" aria-level={3} className="text-[12.5px] font-semibold text-[var(--portal-ink)]">{upNextLabel}</div>
            <span className="text-[10px] text-[var(--portal-muted)]">{fromLabel}</span>
          </div>
          <ul className="mt-2.5 flex flex-col gap-2.5">
            {upNext.map((row) => {
                const style = bookingStatusStyle(row.status);
                return (
                  <li key={row.id} className="flex min-w-0 items-start gap-2.5">
                    <span className="w-10 shrink-0 text-[11.5px] tabular-nums text-[var(--portal-muted)]">
                      {row.time}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[12px] font-semibold text-[var(--portal-ink)]">
                        {row.name}
                      </span>
                      <span className="truncate text-[10.5px] text-[var(--portal-muted)]">
                        {row.serviceLabel}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                        style.wash,
                        style.text,
                      )}
                    >
                      <span className="size-1.5 rounded-full bg-current" aria-hidden />
                      {statusLabel(row.status)}
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
        ) : null}

        <button
          type="button"
          onClick={onOpenDay}
          className="mt-4 flex w-full items-center justify-between gap-2 border-t border-[var(--visit-line)] px-5 py-3 text-[12.5px] font-semibold text-[var(--accent-rust)] hover:bg-[var(--visit-tint)]"
        >
          {openDayLabel}
          <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
        </button>
      </section>
    </aside>
  );
}

