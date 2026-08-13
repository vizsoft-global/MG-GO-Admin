export function deliveryDetailNav(
  index: number,
  count: number,
  hasNextPage: boolean,
): { hasPrevious: boolean; hasNext: boolean } {
  if (index < 0 || count <= 0) {
    return { hasPrevious: false, hasNext: false };
  }
  return {
    hasPrevious: index > 0,
    hasNext: index < count - 1 || hasNextPage,
  };
}

/** After a list refetch, never reopen a sheet the user already closed. */
export function nextSelectedDeliveryAfterRefresh<T extends { id: string }>(
  stillOpenId: string | null,
  rows: T[],
): T | null {
  if (!stillOpenId) return null;
  return rows.find((row) => row.id === stillOpenId) ?? null;
}
