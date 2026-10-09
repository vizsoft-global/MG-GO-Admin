/**
 * Shared delivery helpers for the admin RPC ports.
 *
 * Mirrors `attendance-shared.ts`: a piece of SQL that more than one function
 * needs, kept in one place so two ports cannot disagree about it.
 */
import { getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";

const SCAN_CAP = 40_000;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

function createdAtOf(raw: Record<string, unknown>): number {
  const value = raw["created_at"];
  if (value && typeof value === "object" && "toDate" in (value as object)) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return 0;
}

/**
 * The restaurants a rider is assigned to, mirroring `driver_restaurants`.
 *
 * The junction table is denormalised onto the driver doc as a primary
 * `restaurant_id` plus a `restaurant_ids` array, and both are read here because
 * a rider whose single assignment was written by an older admin path exists only
 * in the scalar column. Deduped, so `cardinality(v_assigned)` in the SQL and
 * `assigned.length` here mean the same thing.
 */
export function driverRestaurantIds(driver: Record<string, unknown> | undefined): string[] {
  if (!driver) return [];
  const ids = new Set<string>();
  const single = asString(driver["restaurant_id"]);
  if (single) ids.add(single);
  const list = driver["restaurant_ids"];
  if (Array.isArray(list)) {
    for (const id of list) if (typeof id === "string" && id) ids.add(id);
  }
  return [...ids];
}

/**
 * Every restaurant belonging to a partner, in the order the SQL's
 * `ORDER BY created_at ASC LIMIT 1` would pick from.
 *
 * The tie-break on doc id is not in the SQL, which left the order of two
 * restaurants created in the same millisecond to the planner; an id keys it
 * deterministically without changing which row the sort puts first in the
 * realistic case.
 */
export async function loadRestaurantsByPartner(
  partnerIds: readonly string[],
): Promise<Map<string, string[]>> {
  const db = getFirestore();
  const unique = [...new Set(partnerIds.filter((id) => id.length > 0))];
  const out = new Map<string, string[]>();
  if (unique.length === 0) return out;

  const wanted = new Set(unique);
  const rows: Array<{ id: string; partner_id: string | null; data: Record<string, unknown> }> = [];

  // Firestore's `in` takes at most 30 values, so the partner list is paged
  // rather than truncated: a bulk action can touch 100 deliveries and therefore
  // up to 100 partners, and quietly reading only the first 30 would leave the
  // rest resolving to `null`.
  for (let index = 0; index < unique.length; index += 30) {
    const chunk = unique.slice(index, index + 30);
    const snap = await db
      .collection(COLLECTIONS.restaurants)
      .where("partner_id", "in", chunk)
      .limit(SCAN_CAP)
      .get();
    for (const doc of snap.docs) {
      const partnerId = asString((doc.data() ?? {})["partner_id"]);
      if (partnerId === null || !wanted.has(partnerId)) continue;
      rows.push({ id: doc.id, partner_id: partnerId, data: doc.data() ?? {} });
    }
  }

  rows.sort((a, b) => {
    const diff = createdAtOf(a.data) - createdAtOf(b.data);
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  for (const row of rows) {
    if (!row.partner_id) continue;
    const list = out.get(row.partner_id) ?? [];
    list.push(row.id);
    out.set(row.partner_id, list);
  }
  return out;
}

/**
 * `_delivery_resolve_restaurant_id` — which restaurant a verified delivery
 * belongs to.
 *
 * This exists because incentive rules are restaurant-scoped and a delivery that
 * verifies without a restaurant is a delivery no rule can match, so the rider
 * earns nothing for work that was actually done. The SQL walks four increasingly
 * weak signals in a fixed order, and the order is the whole point: the delivery's
 * own value, then the rider's single assignment, then the partner's single
 * assignment, then nothing. Returning `null` is a real answer — a rider on three
 * restaurants under a partner with four is genuinely ambiguous, and guessing
 * would pay them under the wrong rule.
 */
export function resolveDeliveryRestaurantId(args: {
  deliveryRestaurantId: string | null;
  assignedRestaurantIds: readonly string[];
  partnerId: string | null;
  partnerRestaurantIds: readonly string[];
}): string | null {
  const { deliveryRestaurantId, partnerId } = args;
  // The junction table is unique on `(driver_id, restaurant_id)`, so the dedupe
  // cannot change the answer — it only makes the cardinality checks below mean
  // what they say.
  const assigned = [...new Set(args.assignedRestaurantIds.filter((id) => id.length > 0))];
  const partnerIds = new Set(args.partnerRestaurantIds);

  if (deliveryRestaurantId) return deliveryRestaurantId;

  if (partnerId === null && assigned.length === 1) return assigned[0];

  if (partnerId !== null && assigned.length > 0) {
    const matched = assigned.filter((id) => partnerIds.has(id));
    if (matched.length === 1) return matched[0];
  }

  if (partnerId === null) return null;

  if (args.partnerRestaurantIds.length === 1) return args.partnerRestaurantIds[0];

  return null;
}
