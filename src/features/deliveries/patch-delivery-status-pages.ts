export function patchDeliveryStatusesInPages<
  T extends { rows: Array<{ id: string; status: string }> },
>(pages: T[], deliveryIds: Iterable<string>, status: string): T[] {
  const ids = new Set(deliveryIds);
  if (ids.size === 0) return pages;
  return pages.map((page) => ({
    ...page,
    rows: page.rows.map((row) =>
      ids.has(row.id) ? { ...row, status } : row,
    ),
  }));
}

export function patchDeliveryStatusInPages<
  T extends { rows: Array<{ id: string; status: string }> },
>(pages: T[], deliveryId: string, status: string): T[] {
  return patchDeliveryStatusesInPages(pages, [deliveryId], status);
}
