import { parseOffDaysCell } from "@/features/payroll/off-structure-bulk";
import { PAYROLL_DEFAULT_OFF_DAYS } from "@/features/payroll/payroll-formulas";

export function kuwaitCalendarMonthDays(ymd: string): number {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseImportOffDays(
  raw: string | null | undefined,
  monthDays: number,
): {
  offDays: number | null;
  error: "invalid_off_days" | "off_days_exceeds_month" | null;
} {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { offDays: null, error: null };
  const offDays = parseOffDaysCell(trimmed);
  if (offDays == null) return { offDays: null, error: "invalid_off_days" };
  if (offDays > monthDays) return { offDays, error: "off_days_exceeds_month" };
  return { offDays, error: null };
}

/** OFF writes need a live drivers.id — approve now, or an already-linked rider. */
export function importOffNeedsApprovedDriver(
  offDays: number | null,
  hasLiveDriver: boolean,
  willApprove: boolean,
): boolean {
  return offDays != null && !hasLiveDriver && !willApprove;
}

/** Explicit 2 is the implicit default — clear an override instead of storing 2. */
export function offDaysForRpc(offDays: number): number | null {
  return offDays === PAYROLL_DEFAULT_OFF_DAYS ? null : offDays;
}
