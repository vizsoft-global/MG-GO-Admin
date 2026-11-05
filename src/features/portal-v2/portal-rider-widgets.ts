/**
 * The client dashboard's KPI widgets and the rider table they filter.
 *
 * Two rules this file exists to keep straight, because getting either wrong
 * makes the table disagree with the number above it:
 *
 *  * **A widget bucket is not `drivers.status`.** The KPI cards count what the
 *    phone and the leave ledger say happened *today* — `classify()` on the
 *    Cloud Function reads attendance, then a covering leave plan, then the
 *    account status. So a rider can be `running` as an account and still sit in
 *    "Absent / sick" today. The bucket is therefore computed on the server, in
 *    the same pass that fills the cards, and shipped per rider. Filtering the
 *    table by `status` would print 209 rows under a card that says 2.
 *  * **"Absent / sick" is two buckets.** The card adds `absent` and `sick`;
 *    the table has to select both or it will show one while counting the other.
 */
import type { ClientPortalRider, RiderBucket } from "@/features/client-portal/shape";

export const RIDER_WIDGETS = [
  "assigned",
  "working",
  "onLeave",
  "absentSick",
  "notMarked",
] as const;

export type RiderWidgetKey = (typeof RIDER_WIDGETS)[number];

export type PortalRiderRow = ClientPortalRider;

/** Which buckets a widget's table shows: one, or two for Absent / sick. */
export function bucketsForWidget(widget: RiderWidgetKey): readonly RiderBucket[] {
  switch (widget) {
    case "assigned":
      return ["working", "onLeave", "sick", "absent", "other"];
    case "working":
      return ["working"];
    case "onLeave":
      return ["onLeave"];
    case "absentSick":
      return ["absent", "sick"];
    case "notMarked":
      return ["other"];
    default: {
      const never: never = widget;
      return never;
    }
  }
}

export function riderMatchesWidget(row: PortalRiderRow, widget: RiderWidgetKey): boolean {
  if (widget === "assigned") return true;
  return bucketsForWidget(widget).includes(row.bucket);
}

export function filterRidersByWidget(
  rows: readonly PortalRiderRow[],
  widget: RiderWidgetKey | null,
): PortalRiderRow[] {
  if (!widget) return [];
  return rows.filter((row) => riderMatchesWidget(row, widget));
}

/** Per-widget counts, read off the same rows the table filters. */
export function riderCountsByWidget(
  rows: readonly PortalRiderRow[],
): Record<RiderWidgetKey, number> {
  const counts: Record<RiderWidgetKey, number> = {
    assigned: rows.length,
    working: 0,
    onLeave: 0,
    absentSick: 0,
    notMarked: 0,
  };
  for (const row of rows) {
    if (row.bucket === "working") counts.working += 1;
    else if (row.bucket === "onLeave") counts.onLeave += 1;
    else if (row.bucket === "sick" || row.bucket === "absent") counts.absentSick += 1;
    else counts.notMarked += 1;
  }
  return counts;
}

/** The bucket word a table row prints, so a row can be checked against its card. */
export function bucketLabelKey(bucket: RiderBucket): string {
  switch (bucket) {
    case "working":
      return "bucketWorking";
    case "onLeave":
      return "bucketOnLeave";
    case "sick":
      return "bucketSick";
    case "absent":
      return "bucketAbsent";
    case "other":
      return "bucketNotMarked";
    default: {
      const never: never = bucket;
      return never;
    }
  }
}

/** A page of rows, clamped so a shrinking filter can never strand the view. */
export function pageSlice<T>(
  rows: readonly T[],
  page: number,
  pageSize: number,
): { slice: T[]; page: number; pageCount: number; from: number; to: number } {
  const size = Math.max(1, Math.trunc(pageSize));
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(0, Math.trunc(page)), pageCount - 1);
  const start = current * size;
  const slice = rows.slice(start, start + size);
  return {
    slice,
    page: current,
    pageCount,
    from: rows.length === 0 ? 0 : start + 1,
    to: start + slice.length,
  };
}

/**
 * Page numbers to draw, with `null` for a gap.
 *
 * A 209-row roster at 8 per page is 27 pages; printing all of them is a wall of
 * numbers, so the window is first, last, and two either side of the current.
 */
export function pageWindow(page: number, pageCount: number, around = 2): Array<number | null> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index);
  const current = Math.min(Math.max(0, page), pageCount - 1);
  const keep = new Set<number>([0, pageCount - 1]);
  for (let delta = -around; delta <= around; delta += 1) {
    const index = current + delta;
    if (index >= 0 && index < pageCount) keep.add(index);
  }
  const sorted = [...keep].sort((left, right) => left - right);
  const out: Array<number | null> = [];
  let previous = -1;
  for (const index of sorted) {
    if (previous >= 0 && index - previous > 1) out.push(null);
    out.push(index);
    previous = index;
  }
  return out;
}
