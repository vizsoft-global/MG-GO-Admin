"use client";

import type { ReactNode } from "react";

import { BookingChip } from "@/features/visits/calendar/booking-chip";
import { serviceColorVar } from "@/features/visits/calendar/colors";
import { cn } from "@/lib/utils";

const SERVICE_COLUMN_PX = 206;
const HEADER_PX = 40;

export type DayGridService = {
  key: string;
  label: string;
  booked: number;
  capacity: number;
};

export type DayGridRow = {
  id: string;
  name: string;
  status: string;
  phone: string;
};

export type DayGridCell = {
  rows: DayGridRow[];
  open: number;
  blocked: boolean;
};

export type DayGridLabels = {
  serviceDesk: string;
  unused: (n: number) => string;
  open: (n: number) => string;
  blocked: string;
  deskBooked: (desk: number, booked: number, capacity: number) => string;
};

function minutesOf(hhmm: string): number {
  const [hours, mins] = hhmm.split(":");
  const h = Number(hours);
  const m = Number(mins);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

function formatMinutes(total: number): string {
  const day = 24 * 60;
  const wrapped = ((Math.trunc(total) % day) + day) % day;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function DayGrid({
  title,
  subtitle,
  legend,
  services,
  times,
  cell,
  nowMinutes,
  slotMinutes,
  selectedId,
  onSelect,
  labels,
  statusLabel,
}: {
  title: string;
  subtitle: string;
  legend?: ReactNode;
  services: DayGridService[];
  times: string[];
  cell: (serviceKey: string, time: string) => DayGridCell;
  nowMinutes: number | null;
  slotMinutes: number;
  selectedId: string | null;
  onSelect: (row: DayGridRow) => void;
  labels: DayGridLabels;
  statusLabel: (status: string) => string;
}) {
  const firstMinutes = times[0] ? minutesOf(times[0]) : 0;
  const showNow = nowMinutes != null && times.length > 0 && slotMinutes > 0;
  const currentIndex =
    showNow && nowMinutes != null
      ? Math.min(
          Math.max(Math.floor((nowMinutes - firstMinutes) / slotMinutes), 0),
          times.length - 1,
        )
      : -1;

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
        <div className="min-w-[1120px]">
          <div
            className="grid"
            style={{
              gridTemplateColumns: `${SERVICE_COLUMN_PX}px repeat(${times.length}, minmax(0, 1fr))`,
            }}
          >
            <div className="sticky start-0 z-40 flex items-center border-y border-e border-[var(--visit-line)] bg-[var(--visit-tint)] px-3 text-[11px] font-medium tracking-[0.02em] text-[var(--portal-muted)] uppercase">
              {labels.serviceDesk}
            </div>
            {times.map((time, index) => {
              const current = index === currentIndex;
              return (
                <div
                  key={`${time}-${index}`}
                  className={cn(
                    "flex items-center justify-center border-y border-e border-[var(--visit-line)] bg-[var(--visit-tint)] text-[11.5px] tabular-nums",
                    current
                      ? "font-semibold text-[var(--accent-rust)]"
                      : "font-medium text-[var(--portal-muted)]",
                  )}
                  style={{ height: HEADER_PX }}
                >
                  <span
                    className={cn(
                      "inline-flex h-6 items-center rounded-[4px] px-2",
                      current && "border border-[var(--accent-rust)]",
                    )}
                  >
                    {time}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="relative">
            <div
              className="grid"
              style={{
                gridTemplateColumns: `${SERVICE_COLUMN_PX}px repeat(${times.length}, minmax(0, 1fr))`,
              }}
            >
              {services.map((service, serviceIndex) => {
                const ratio =
                  service.capacity > 0 ? Math.min(service.booked / service.capacity, 1) : 0;
                return [
                  <div
                    key={`${service.key}-service`}
                    className="sticky start-0 z-30 flex min-w-0 flex-col justify-center gap-1 border-b border-e border-[var(--visit-line)] bg-card px-3 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-[2px]",
                          serviceColorVar(service.key, service.label),
                        )}
                        aria-hidden
                      />
                      <p className="truncate text-[13px] font-medium text-[var(--portal-ink)]">
                        {service.label}
                      </p>
                    </div>
                    <p className="truncate text-[11.5px] tabular-nums text-[var(--portal-muted)]">
                      {labels.deskBooked(1, service.booked, service.capacity)}
                    </p>
                    <div
                      className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--visit-bar-track)]"
                      aria-hidden
                    >
                      <div
                        className={cn(
                          "h-full rounded-full",
                          serviceColorVar(service.key, service.label),
                        )}
                        style={{ width: `${ratio * 100}%` }}
                      />
                    </div>
                  </div>,
                  ...times.map((time, index) => {
                    const slot = cell(service.key, time);
                    const spare = slot.rows.length > 0 && slot.open > 0;
                    return (
                      <div
                        key={`${service.key}-${time}-${index}`}
                        className={cn(
                          "flex min-h-[68px] flex-col gap-1 border-b border-e border-[var(--visit-line)] p-1.5",
                          serviceIndex === services.length - 1 && "border-b-0",
                        )}
                      >
                        {slot.rows.length > 0 ? (
                          <>
                            {slot.rows.map((row) => (
                              <BookingChip
                                key={row.id}
                                name={row.name}
                                status={row.status}
                                statusLabel={statusLabel(row.status)}
                                selected={selectedId === row.id}
                                onClick={() => onSelect(row)}
                              />
                            ))}
                            {spare ? (
                              <p className="mt-auto text-center text-[10.5px] text-[var(--portal-muted)]">
                                {labels.open(slot.open)}
                              </p>
                            ) : null}
                          </>
                        ) : slot.blocked ? (
                          <p className="flex flex-1 items-center justify-center text-[10.5px] text-[var(--portal-muted)]">
                            {labels.blocked}
                          </p>
                        ) : slot.open > 0 ? (
                          <p className="flex flex-1 items-center justify-center rounded-[4px] bg-[var(--visit-tint)] text-[10.5px] text-[var(--portal-muted)]">
                            {labels.unused(slot.open)}
                          </p>
                        ) : null}
                      </div>
                    );
                  }),
                ];
              })}
            </div>
            {showNow && nowMinutes != null && currentIndex >= 0 ? (
              <div
                className="pointer-events-none absolute inset-y-0 z-20"
                style={{
                  insetInlineStart: `calc(${SERVICE_COLUMN_PX}px + (100% - ${SERVICE_COLUMN_PX}px) * ${
                    (currentIndex + 0.5) / times.length
                  })`,
                }}
              >
                <span
                  className="absolute inset-y-0 w-px"
                  style={{ backgroundColor: "var(--visit-now, var(--accent-rust))" }}
                />
                <span
                  className={cn(
                    "absolute top-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white",
                    currentIndex >= times.length - 1
                      ? "end-0 -translate-y-1/2"
                      : "start-0 -translate-x-1/2 -translate-y-1/2",
                  )}
                  style={{ backgroundColor: "var(--visit-now, var(--accent-rust))" }}
                >
                  {formatMinutes(nowMinutes)}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

