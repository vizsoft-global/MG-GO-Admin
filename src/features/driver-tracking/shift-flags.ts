import type { Database } from "@/types/database";

export type ShiftRow = Database["public"]["Tables"]["driver_daily_shifts"]["Row"];

function shiftSessionInstant(shiftDate: string, time: string, dayOffset: number): number {
  const base = addDaysIso(shiftDate, dayOffset);
  const t = time.length >= 8 ? time.slice(0, 8) : `${time.slice(0, 5)}:00`;
  return new Date(`${base}T${t}+03:00`).getTime();
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Matches Postgres _driver_shift_end_at. */
export function computeShiftEndAt(row: ShiftRow): number {
  const s1End = shiftSessionInstant(
    row.shift_date,
    row.session1_end,
    row.session1_end_day_offset,
  );

  if (row.shift_type === "split" && row.session2_end) {
    const s2End = shiftSessionInstant(
      row.shift_date,
      row.session2_end,
      row.session2_end_day_offset ?? 0,
    );
    return Math.max(s1End, s2End);
  }

  return s1End;
}

export function shiftEndAtIso(row: ShiftRow): string {
  return new Date(computeShiftEndAt(row)).toISOString();
}

export function shiftLifecycle(
  shiftEndMs: number,
  nowMs: number = Date.now(),
): { isActive: boolean; isExpired: boolean; isLocked: boolean } {
  const isActive = nowMs < shiftEndMs;
  return {
    isActive,
    isExpired: !isActive,
    isLocked: isActive,
  };
}

export function computeShiftFlags(
  row: ShiftRow,
  nowMs: number = Date.now(),
): { isWithinWindow: boolean; isLocked: boolean; shiftEndMs: number; isActive: boolean; isExpired: boolean } {
  const s1Start = shiftSessionInstant(row.shift_date, row.session1_start, 0);
  const s1End = shiftSessionInstant(
    row.shift_date,
    row.session1_end,
    row.session1_end_day_offset,
  );

  let shiftEndMs = s1End;
  let within = nowMs >= s1Start && nowMs < s1End;

  if (row.shift_type === "split" && row.session2_start && row.session2_end) {
    const s2Start = shiftSessionInstant(
      row.shift_date,
      row.session2_start,
      row.session2_start_day_offset,
    );
    const s2End = shiftSessionInstant(
      row.shift_date,
      row.session2_end,
      row.session2_end_day_offset,
    );
    shiftEndMs = Math.max(s1End, s2End);
    within =
      (nowMs >= s1Start && nowMs < s1End) || (nowMs >= s2Start && nowMs < s2End);
  }

  const lifecycle = shiftLifecycle(shiftEndMs, nowMs);

  return {
    isWithinWindow: within,
    isLocked: lifecycle.isLocked,
    shiftEndMs,
    isActive: lifecycle.isActive,
    isExpired: lifecycle.isExpired,
  };
}

export function formatSessionRange(
  start: string,
  end: string,
  endOffset: number,
): string {
  const overnight = endOffset > 0 ? " (+1d)" : "";
  return `${start.slice(0, 5)}–${end.slice(0, 5)}${overnight}`;
}

/** Resolve active shift: today or yesterday row while now < shift_end_at. */
export function findActiveShiftRow(
  rows: ShiftRow[],
  today: string,
  nowMs: number = Date.now(),
): ShiftRow | null {
  const yesterday = addDaysIso(today, -1);
  for (const date of [today, yesterday]) {
    const row = rows.find((r) => r.shift_date === date);
    if (!row) continue;
    if (nowMs < computeShiftEndAt(row)) return row;
  }
  return null;
}

export function shiftRowToListFields(
  row: ShiftRow,
  nowMs: number = Date.now(),
): {
  session1_label: string;
  session2_label: string | null;
  shift_end_at: string;
  is_within_window: boolean;
  is_locked: boolean;
  is_active: boolean;
  is_expired: boolean;
} {
  const flags = computeShiftFlags(row, nowMs);
  const session1 = formatSessionRange(
    row.session1_start,
    row.session1_end,
    row.session1_end_day_offset,
  );
  const session2 =
    row.shift_type === "split" && row.session2_start && row.session2_end
      ? formatSessionRange(
          row.session2_start,
          row.session2_end,
          row.session2_end_day_offset,
        )
      : null;

  return {
    session1_label: session1,
    session2_label: session2,
    shift_end_at: new Date(flags.shiftEndMs).toISOString(),
    is_within_window: flags.isWithinWindow,
    is_locked: flags.isLocked,
    is_active: flags.isActive,
    is_expired: flags.isExpired,
  };
}
