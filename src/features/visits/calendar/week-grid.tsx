"use client";

import { Fragment, type ReactNode } from "react";

import { serviceColorVar } from "@/features/visits/calendar/colors";
import { cn } from "@/lib/utils";

export type WeekGridDay = {
  ymd: string;
  label: string;
  dateLabel: string;
  isToday: boolean;
  dayNumber: number;
  weekday: string;
  bookings: number;
};

export type WeekGridService = {
  key: string;
  label: string;
  count: number;
};

export type WeekGridCell = {
  services: WeekGridService[];
  booked: number;
  capacity: number;
  past: boolean;
  blocked: boolean;
};

type CapTone = "open" | "high" | "full";

function capTone(booked: number, capacity: number): CapTone {
  if (capacity > 0 && booked >= capacity) return "full";
  if (capacity > 0 && booked / capacity >= 0.8) return "high";
  return "open";
}

function capBarClass(tone: CapTone): string {
  switch (tone) {
    case "open":
      return "bg-[var(--visit-cap-open)]";
    case "high":
      return "bg-[var(--visit-cap-high)]";
    case "full":
      return "bg-[var(--visit-cap-full)]";
    default: {
      const uncovered: never = tone;
      return uncovered;
    }
  }
}

function WeekSlotCell({
  day,
  time,
  slot,
  fullLabel,
  onOpenSlot,
  shortLabel,
}: {
  day: WeekGridDay;
  time: string;
  slot: WeekGridCell;
  fullLabel: string;
  onOpenSlot: (ymd: string, time: string, anchor: HTMLElement) => void;
  shortLabel: (service: WeekGridService) => string;
}) {
  const tone = capTone(slot.booked, slot.capacity);
  const ratio = slot.capacity > 0 ? slot.booked / slot.capacity : 0;
  const width = `${Math.min(100, Math.max(0, ratio) * 100)}%`;
  const shown = slot.blocked ? [] : slot.services.slice(0, 3);
  const extra = slot.blocked ? 0 : Math.max(0, slot.services.length - shown.length);
  const className = cn(
    "flex min-h-[58px] min-w-0 flex-col gap-0.5 border-b border-e border-[var(--visit-line)] px-1.5 py-1 text-start",
    day.isToday && "bg-[var(--visit-today-tint)]",
    slot.blocked && "bg-[var(--visit-tint)] text-[var(--portal-muted)]",
    slot.past && "opacity-70",
  );
  const body = (
    <>
      {shown.map((service) => (
        <span
          key={service.key}
          className="flex min-w-0 items-center gap-1 text-[10px] leading-[14px] text-[var(--portal-ink)]"
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-[2px]",
              serviceColorVar(service.key, service.label),
            )}
          />
          <span className="min-w-0 flex-1 truncate">{shortLabel(service)}</span>
          <span className="shrink-0 tabular-nums">{service.count}</span>
        </span>
      ))}
      {extra > 0 ? (
        <span className="text-[10px] leading-[14px] text-[var(--portal-muted)]">+{extra}</span>
      ) : null}
      <span className="mt-auto flex items-center justify-end gap-1 text-[10px] leading-[14px] text-[var(--portal-muted)]">
        <span className="tabular-nums">
          {slot.booked}/{slot.capacity}
        </span>
        {tone === "full" ? (
          <span className="font-semibold text-[var(--visit-cap-full)]">{fullLabel}</span>
        ) : null}
      </span>
      <span className="block h-[3px] overflow-hidden rounded-full bg-[var(--visit-bar-track)]">
        <span className={cn("block h-[3px] rounded-full", capBarClass(tone))} style={{ width }} />
      </span>
    </>
  );

  if (slot.blocked) {
    return <div className={className}>{body}</div>;
  }

  return (
    <button
      type="button"
      className={cn(
        className,
        "cursor-pointer transition-colors duration-150 hover:bg-[var(--visit-tint)]",
      )}
      onClick={(event) => onOpenSlot(day.ymd, time, event.currentTarget)}
    >
      {body}
    </button>
  );
}

export function WeekGrid({
  title,
  subtitle,
  legend,
  days,
  times,
  cell,
  onOpenSlot,
  labels,
  shortLabel,
  timeLabel,
  bookingsLabel,
  todayLabel,
}: {
  title: string;
  subtitle: string;
  legend?: ReactNode;
  days: WeekGridDay[];
  times: string[];
  cell: (ymd: string, time: string) => WeekGridCell;
  onOpenSlot: (ymd: string, time: string, anchor: HTMLElement) => void;
  labels: { full: string };
  shortLabel: (service: WeekGridService) => string;
  timeLabel: string;
  bookingsLabel: (count: number) => string;
  todayLabel: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--portal-border)] bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <div role="heading" aria-level={2} className="text-xl leading-7 font-bold text-[var(--portal-ink)]">{title}</div>
          <p className="text-xs leading-5 text-[var(--portal-muted)]">{subtitle}</p>
        </div>
        {legend}
      </header>
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[1080px]"
          style={{
            gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))`,
          }}
        >
          <div className="sticky start-0 z-20 flex items-end border-y border-e border-[var(--visit-line)] bg-[var(--visit-tint)] px-2 py-2 text-[11px] font-medium tracking-[0.02em] text-[var(--portal-muted)] uppercase">
            {timeLabel}
          </div>
          {days.map((day) => (
            <div
              key={day.ymd}
              className={cn(
                "flex flex-col gap-1 border-y border-e border-[var(--visit-line)] px-2.5 py-2",
                day.isToday ? "bg-[var(--visit-today-tint)]" : "bg-[var(--visit-tint)]",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-lg leading-none font-bold tabular-nums",
                    day.isToday
                      ? "bg-[var(--accent-rust)] text-white"
                      : "text-[var(--portal-ink)]",
                  )}
                >
                  {day.dayNumber}
                </span>
                <span
                  className={cn(
                    "truncate text-xs font-medium",
                    day.isToday ? "text-[var(--accent-rust)]" : "text-[var(--portal-muted)]",
                  )}
                >
                  {day.isToday ? `${day.weekday} · ${todayLabel}` : day.weekday}
                </span>
              </div>
              <p className="truncate text-[11px] text-[var(--portal-muted)]">
                {bookingsLabel(day.bookings)}
              </p>
            </div>
          ))}
          {times.map((time, index) => (
            <Fragment key={`${time}-${index}`}>
              <div className="sticky start-0 z-10 flex items-center border-b border-e border-[var(--visit-line)] bg-card px-2 text-[11px] tabular-nums whitespace-nowrap text-[var(--portal-muted)]">
                {time}
              </div>
              {days.map((day) => (
                <WeekSlotCell
                  key={`${day.ymd}-${time}`}
                  day={day}
                  time={time}
                  slot={cell(day.ymd, time)}
                  fullLabel={labels.full}
                  onOpenSlot={onOpenSlot}
                  shortLabel={shortLabel}
                />
              ))}
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

