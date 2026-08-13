export function patchDeliveryStatusInPages<
  T extends { rows: Array<{ id: string; status: string }> },
>(pages: T[], deliveryId: string, status: string): T[] {
  return pages.map((page) => ({
    ...page,
    rows: page.rows.map((row) =>
      row.id === deliveryId ? { ...row, status } : row,
    ),
  }));
}
