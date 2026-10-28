"use client";

import { BookingChip } from "@/features/visits/calendar/booking-chip";
import { serviceColorVar } from "@/features/visits/calendar/colors";
import { cn } from "@/lib/utils";

const SERVICE_COLUMN_PX = 206;
const TIME_COLUMN_PX = 96;

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

function emptySlotText(cell: DayGridCell, labels: DayGridLabels): string {
  if (cell.blocked) return labels.blocked;
  if (cell.open > 0) return labels.open(cell.open);
  return labels.unused(0);
}

export function DayGrid({
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
  const gridWidth = SERVICE_COLUMN_PX + times.length * TIME_COLUMN_PX;
  const firstMinutes = times[0] ? minutesOf(times[0]) : 0;
  const showNow = nowMinutes != null && times.length > 0 && slotMinutes > 0;
  let nowStart = SERVICE_COLUMN_PX;
  if (showNow && nowMinutes != null) {
    const raw =
      SERVICE_COLUMN_PX + ((nowMinutes - firstMinutes) / slotMinutes) * TIME_COLUMN_PX;
    const maxStart = Math.max(SERVICE_COLUMN_PX, gridWidth - 2);
    nowStart = Math.min(Math.max(raw, SERVICE_COLUMN_PX), maxStart);
  }
  const labelInward = nowStart > gridWidth - 56;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <div className="relative" style={{ width: gridWidth }}>
        <div
          className="grid"
          style={{
            gridTemplateColumns: `${SERVICE_COLUMN_PX}px repeat(${times.length}, ${TIME_COLUMN_PX}px)`,
          }}
        >
          <div className="sticky start-0 z-40 flex h-9 items-center border-b border-e border-border bg-muted/40 px-2 text-start text-xs font-semibold text-foreground">
            {labels.serviceDesk}
          </div>
          {times.map((time, index) => (
            <div
              key={`${time}-${index}`}
              className="flex h-9 items-center justify-center border-b border-e border-border bg-muted/40 text-xs font-medium tabular-nums text-muted-foreground"
            >
              {time}
            </div>
          ))}
          {services.map((service) => {
            const ratio =
              service.capacity > 0 ? Math.min(service.booked / service.capacity, 1) : 0;
            const full = service.capacity > 0 && service.booked >= service.capacity;
            return [
              <div
                key={`${service.key}-service`}
                className="sticky start-0 z-30 flex min-w-0 items-start gap-2 border-b border-e border-border bg-card px-2 py-2"
              >
                <span
                  className={cn(
                    "mt-0.5 size-2.5 shrink-0 rounded-full",
                    serviceColorVar(service.key, service.label),
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{service.label}</p>
                  <p className="text-[10px] tabular-nums text-muted-foreground">
                    {service.booked}/{service.capacity}
                  </p>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div
                      className="h-full"
                      style={{
                        width: `${ratio * 100}%`,
                        backgroundColor: full ? "var(--visit-cap-full)" : "var(--visit-cap-open)",
                      }}
                    />
                  </div>
                </div>
              </div>,
              ...times.map((time, index) => {
                const slot = cell(service.key, time);
                return (
                  <div
                    key={`${service.key}-${time}-${index}`}
                    className={cn(
                      "flex min-h-14 flex-col gap-0.5 border-b border-e border-border p-1",
                      slot.blocked && slot.rows.length === 0 && "bg-muted/40",
                    )}
                  >
                    {slot.rows.length > 0 ? (
                      slot.rows.map((row) => (
                        <BookingChip
                          key={row.id}
                          name={row.name}
                          status={row.status}
                          statusLabel={statusLabel(row.status)}
                          selected={selectedId === row.id}
                          onClick={() => onSelect(row)}
                        />
                      ))
                    ) : (
                      <p className="px-0.5 py-2 text-center text-[10px] text-muted-foreground">
                        {emptySlotText(slot, labels)}
                      </p>
                    )}
                  </div>
                );
              }),
            ];
          })}
        </div>
        {showNow && nowMinutes != null ? (
          <div
            className="pointer-events-none absolute inset-y-0 z-20 w-0.5"
            style={{
              insetInlineStart: nowStart,
              backgroundColor: "var(--visit-now, var(--destructive))",
            }}
          >
            <span
              className={cn(
                "absolute top-0.5 whitespace-nowrap rounded px-1 text-[10px] font-medium tabular-nums text-white",
                labelInward ? "end-1" : "start-1",
              )}
              style={{ backgroundColor: "var(--visit-now, var(--destructive))" }}
            >
              {formatMinutes(nowMinutes)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
