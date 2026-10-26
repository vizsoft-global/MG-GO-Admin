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
 *
 * The PAYROLL status (OFF, Absent, Sick, …) does not change this number.
 * An overnight shift can finish after 05:00 on a day payroll marks OFF, and
 * those orders still belong on that date. Zeroing them would drop them from
 * the day cell and from any total built out of the day cells.
 */
export function aoShownOrders(
  info: {
    orders: number;
    displayOrders?: number;
  } | null | undefined,
  _status?: string | null,
): number {
  if (!info) return 0;
  if (typeof info.displayOrders === "number" && Number.isFinite(info.displayOrders)) {
    return info.displayOrders;
  }
  return info.orders;
}

function finiteOrder(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** Trust a server `mo` flag. `0` is a correction, not a missing count. */
export function foldPayrollDayOrders(day: {
  o?: unknown;
  do?: unknown;
  mo?: unknown;
}): { orders: number; displayOrders: number; overridden: boolean } {
  const overridden = day.mo != null && day.mo !== "";
  if (overridden) {
    const orders = finiteOrder(day.mo, 0);
    return { orders, displayOrders: orders, overridden: true };
  }
  const orders = finiteOrder(day.o, 0);
  return {
    orders,
    displayOrders: day.do == null || day.do === "" ? orders : finiteOrder(day.do, orders),
    overridden: false,
  };
}
