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

/** Day statuses that keep no orders on the Attendance & Orders sheet. */
const NO_ORDERS_STATUSES = new Set<string>([
  "off",
  "sick",
  "accident",
  "vehicle",
  "absent",
  "abs_lh",
  "abs_lo",
  "cancelled",
  "leave",
  "terminated",
  "phone_issue",
  "id_suspended",
  "new_hire",
  "training",
]);

export function dayKeepsOrders(status: string | null | undefined): boolean {
  if (!status || status === "blank") return true;
  return !NO_ORDERS_STATUSES.has(status);
}

/**
 * Grid / CSV number. Recon wins; completed deliveries fill a missing recon row.
 * Never write this onto the rule engine's `orders`.
 *
 * A day the PAYROLL column marked as not worked reads 0 here, because the
 * ORDERS column on the same row is the same edit seen from the other side:
 * recon still holds the sheet's number, and printing it beside `Sick` or `OFF`
 * would claim the rider delivered on a day payroll says they did not.
 */
export function aoShownOrders(
  info: {
    orders: number;
    displayOrders?: number;
  } | null | undefined,
  status?: string | null,
): number {
  if (!dayKeepsOrders(status)) return 0;
  if (!info) return 0;
  if (typeof info.displayOrders === "number" && Number.isFinite(info.displayOrders)) {
    return info.displayOrders;
  }
  return info.orders;
}
