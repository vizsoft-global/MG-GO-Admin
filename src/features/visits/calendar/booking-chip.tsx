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
        "flex h-10 w-full overflow-hidden rounded-md text-start",
        style.wash,
        selected && "ring-2 ring-[var(--portal-ink)]",
      )}
    >
      <span className={cn("w-[3px] shrink-0", style.bar)} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col justify-center px-2">
        <span className="truncate text-xs font-semibold text-[#27273f]">{name}</span>
        <span className={cn("truncate text-[11px]", style.text)}>{statusLabel}</span>
      </span>
    </button>
  );
}
