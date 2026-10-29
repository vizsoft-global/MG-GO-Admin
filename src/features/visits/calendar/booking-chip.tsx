"use client";

import { bookingStatusStyle } from "@/features/visits/calendar/colors";
import { cn } from "@/lib/utils";

type BookingChipProps = {
  name: string;
  statusLabel: string;
  status: string;
  selected?: boolean;
  onClick?: () => void;
};

export function BookingChip({ name, statusLabel, status, selected = false, onClick }: BookingChipProps) {
  const style = bookingStatusStyle(status);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-[34px] w-full overflow-hidden rounded-[4px] bg-card text-start",
        selected && "ring-2 ring-[var(--portal-ink)] ring-offset-1",
      )}
    >
      <span className={cn("w-[3px] shrink-0", style.bar)} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col justify-center py-1 ps-1.5 pe-1">
        <span className="truncate text-[11.5px] leading-4 font-semibold text-[var(--portal-ink)]">
          {name}
        </span>
        <span className={cn("truncate text-[10.5px] leading-3.5", style.text)}>{statusLabel}</span>
      </span>
    </button>
  );
}

