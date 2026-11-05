"use client";

import { cn } from "@/lib/utils";
import { hrStatusStyle } from "./hr-payroll-status";
import { resolveRiderStatus } from "./payroll-rider-columns";
import { payrollStatusDisplayLabel } from "./payroll-column-labels";
import type { PayrollRiderRow } from "./payroll-types";

/**
 * One rider's current status as a colour-coded pill.
 *
 * A hand-set status wins. Otherwise the employee catalog paints, then today's
 * folded cell, then the account. Fill and text come from `hrStatusPaint`.
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
  // The stored label for a working rider is `Active`; the printed word is
  // `Running`. One mapping, so the pill and the Status column cannot disagree.
  const label = payrollStatusDisplayLabel(status.label);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        className,
      )}
      style={hrStatusStyle(status.paint)}
      title={status.date ? `${label} · ${status.date}` : label}
    >
      {label}
    </span>
  );
}
