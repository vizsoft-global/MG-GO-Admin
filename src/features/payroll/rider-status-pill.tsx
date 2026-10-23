"use client";

import { cn } from "@/lib/utils";
import { resolveRiderStatus } from "./payroll-rider-columns";
import type { PayrollRiderRow } from "./payroll-types";

/** A day status without a legend colour still needs to be readable. */
const FALLBACK_HEX = "#94a3b8";

/**
 * One rider's current status as a colour-coded pill.
 *
 * Today's cell wins; a past month (or a rider whose today cell is still blank)
 * shows the account status instead. The label is `resolveRiderStatus().label`,
 * the same string the column filter, the sort and the CSV read.
 */
export function RiderStatusPill({
  row,
  today,
  className,
}: {
  row: PayrollRiderRow;
  /** Kuwait date the page is showing as today; defaults to the live date. */
  today?: string;
  className?: string;
}) {
  const status = resolveRiderStatus(row, today);
  if (status.kind === "account") {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap",
          status.status === "active"
            ? "bg-emerald-100 text-emerald-800"
            : "bg-muted text-muted-foreground",
          className,
        )}
      >
        {status.label}
      </span>
    );
  }
  const hex = status.hex ?? FALLBACK_HEX;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap",
        className,
      )}
      style={{ borderColor: `${hex}66`, backgroundColor: `${hex}1f` }}
      title={status.date ? `${status.label} · ${status.date}` : status.label}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: hex }} />
      {status.label}
    </span>
  );
}
