/** Shared attendance list pagination math for toolbar + footer summaries. */
export function getAttendancePaginationState(
  page: number,
  pageSize: number,
  totalCount: number,
): { from: number; to: number; pageCount: number } {
  const safePage = Math.max(0, page);
  const safeSize = Math.max(1, pageSize);
  const total = Math.max(0, totalCount);
  if (total === 0) {
    return { from: 0, to: 0, pageCount: 1 };
  }
  const from = safePage * safeSize + 1;
  const to = Math.min(total, (safePage + 1) * safeSize);
  const pageCount = Math.max(1, Math.ceil(total / safeSize));
  return { from, to, pageCount };
}
