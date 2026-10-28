"use client";

import { Fragment } from "react";

import { cn } from "@/lib/utils";

import { serviceColorVar } from "./colors";

export type WeekGridDay = {
  ymd: string;
  label: string;
  dateLabel: string;
  isToday: boolean;
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
}: {
  day: WeekGridDay;
  time: string;
  slot: WeekGridCell;
  fullLabel: string;
  onOpenSlot: (ymd: string, time: string, anchor: HTMLElement) => void;
}) {
  const tone = capTone(slot.booked, slot.capacity);
  const ratio = slot.capacity > 0 ? slot.booked / slot.capacity : 0;
  const width = `${Math.min(100, Math.max(0, ratio) * 100)}%`;
  const shown = slot.blocked ? [] : slot.services.slice(0, 3);
  const extra = slot.blocked ? 0 : Math.max(0, slot.services.length - shown.length);
  const className = cn(
    "flex min-h-[4.75rem] min-w-0 flex-col gap-1 border-b border-s border-border p-1 text-start",
    day.isToday && "bg-[var(--visit-load-1)]",
    slot.blocked && "bg-muted text-muted-foreground",
    slot.past && "opacity-60",
  );
  const body = (
    <>
      {shown.length > 0 ? (
        <span className="flex min-w-0 flex-col gap-0.5">
          {shown.map((service) => (
            <span
              key={service.key}
              className="flex min-w-0 items-center gap-1 text-[10px] leading-4"
            >
              <span
                aria-hidden
                className={cn("size-1.5 shrink-0 rounded-full", serviceColorVar(service.key, service.label))}
              />
              <span className="min-w-0 flex-1 truncate">{service.label}</span>
              <span className="shrink-0 tabular-nums">{service.count}</span>
            </span>
          ))}
          {extra > 0 ? (
            <span className="text-[10px] leading-4 text-muted-foreground">+{extra}</span>
          ) : null}
        </span>
      ) : null}
      <span className="mt-auto flex items-center gap-1 text-[10px] leading-4">
        <span className="tabular-nums">
          {slot.booked}/{slot.capacity}
        </span>
        {tone === "full" ? (
          <span className="font-semibold text-[var(--visit-cap-full)]">{fullLabel}</span>
        ) : null}
      </span>
      <span className="block h-1 overflow-hidden rounded-full bg-foreground/10">
        <span className={cn("block h-1", capBarClass(tone))} style={{ width }} />
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
        "cursor-pointer transition-colors duration-150 hover:bg-muted/40",
      )}
      onClick={(event) => onOpenSlot(day.ymd, time, event.currentTarget)}
    >
      {body}
    </button>
  );
}

export function WeekGrid({
  days,
  times,
  cell,
  onOpenSlot,
  labels,
}: {
  days: WeekGridDay[];
  times: string[];
  cell: (ymd: string, time: string) => WeekGridCell;
  onOpenSlot: (ymd: string, time: string, anchor: HTMLElement) => void;
  labels: { full: string };
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <div
        className="grid w-max min-w-full"
        style={{
          gridTemplateColumns: `4.5rem repeat(${days.length}, minmax(8.5rem, 1fr))`,
        }}
      >
        <div className="sticky start-0 z-20 border-b border-s border-border bg-card" />
        {days.map((day) => (
          <div
            key={day.ymd}
            className={cn(
              "border-b border-s border-border px-1.5 py-1 text-start",
              day.isToday && "bg-[var(--visit-load-1)]",
            )}
          >
            <div className="truncate text-[10px] font-semibold leading-4 text-muted-foreground">
              {day.label}
            </div>
            <div className="truncate text-xs font-semibold leading-4">{day.dateLabel}</div>
          </div>
        ))}
        {times.map((time, index) => (
          <Fragment key={`${time}-${index}`}>
            <div className="sticky start-0 z-10 border-b border-s border-border bg-card px-1.5 py-1 text-start text-[10px] leading-4 whitespace-nowrap text-muted-foreground">
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
              />
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
