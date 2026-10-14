/** Recon keys that may identify the same rider on an AM sheet. */
export function reconLookupKeys(
  ...ids: Array<string | null | undefined>
): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const id of ids) {
    const key = id?.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function lookupReconOrders(
  byId: ReadonlyMap<string, ReadonlyMap<string, number>>,
  date: string,
  ...ids: Array<string | null | undefined>
): number | null {
  for (const key of reconLookupKeys(...ids)) {
    const perDate = byId.get(key);
    if (!perDate?.has(date)) continue;
    return perDate.get(date) ?? 0;
  }
  return null;
}

export function lookupReconCount<T extends { orders: number }>(
  byKeyDay: ReadonlyMap<string, T>,
  date: string,
  ...ids: Array<string | null | undefined>
): number | null {
  for (const key of reconLookupKeys(...ids)) {
    const hit = byKeyDay.get(`${key}|${date}`);
    if (hit) return hit.orders;
  }
  return null;
}

/**
 * Grid / CSV number. Recon wins; completed deliveries fill a missing recon row.
 * Never write this onto the rule engine's `orders`.
 */
export function aoShownOrders(info: {
  orders: number;
  displayOrders?: number;
} | null | undefined): number {
  if (!info) return 0;
  if (typeof info.displayOrders === "number" && Number.isFinite(info.displayOrders)) {
    return info.displayOrders;
  }
  return info.orders;
}
