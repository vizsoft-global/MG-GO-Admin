import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore, type Query } from "firebase-admin/firestore";
import { COLLECTIONS, DELIVERY_STATUSES, FIELDS, IN_PROGRESS_STATUSES } from "../core/collections";
import { parseId, parseInstant } from "../core/query";
import { requireStaff } from "../core/staff";

const DEL = FIELDS.deliveries;

export type DeliveryCountFilters = {
  from?: Date | null;
  to?: Date | null;
  zoneId?: string | null;
  partnerId?: string | null;
  driverId?: string | null;
  restaurantId?: string | null;
};

/**
 * The SQL bounds `delivered_at` for the "strict completed-only" basis. In
 * Firestore a range on a missing-or-null field excludes the document, so a
 * `>=`/`<=` pair already does what `delivered_at IS NOT NULL` did. When a window
 * has no bound at all, the `>` against epoch is what keeps pending rows out —
 * without it, the delivered basis would silently behave like the created basis
 * for an unbounded All-time call.
 */
function baseQuery(filters: DeliveryCountFilters, basis: "created" | "delivered"): Query {
  const db = getFirestore();
  let query: Query = db.collection(COLLECTIONS.deliveries);

  if (filters.zoneId) query = query.where(DEL.zoneId, "==", filters.zoneId);
  if (filters.partnerId) query = query.where(DEL.partnerId, "==", filters.partnerId);
  if (filters.driverId) query = query.where(DEL.driverId, "==", filters.driverId);
  if (filters.restaurantId) query = query.where(DEL.restaurantId, "==", filters.restaurantId);

  const rangeField = basis === "delivered" ? DEL.deliveredAt : DEL.createdAt;
  if (filters.from) query = query.where(rangeField, ">=", filters.from);
  if (filters.to) query = query.where(rangeField, "<=", filters.to);
  if (basis === "delivered" && !filters.from) {
    query = query.where(rangeField, ">", new Date(0));
  }

  return query;
}

async function countOf(query: Query): Promise<number> {
  const snapshot = await query.count().get();
  return snapshot.data().count;
}

/**
 * Seven counts in parallel rather than one scan with FILTER clauses.
 *
 * Firestore has no per-status grouping in a single aggregation, and the
 * alternative — reading the rows and counting in the function — bills a document
 * read each over 180k deliveries. `count()` bills index entries read instead, so
 * seven aggregations stay cheap and each is exact.
 */
async function statusCounts(query: Query, statuses: readonly string[]) {
  const [total, ...perStatus] = await Promise.all([
    countOf(query),
    ...statuses.map((status) => countOf(query.where(DEL.status, "==", status))),
  ]);

  const byStatus = new Map<string, number>();
  statuses.forEach((status, index) => byStatus.set(status, perStatus[index] ?? 0));

  const inProgress = IN_PROGRESS_STATUSES.reduce(
    (sum, status) => sum + (byStatus.get(status) ?? 0),
    0,
  );

  return { total, byStatus, inProgress };
}

function readFilters(data: Record<string, unknown>) {
  const basis = data.dateBasis === "delivered" ? "delivered" : "created";
  const filters: DeliveryCountFilters = {
    from: parseInstant(data.from, "from"),
    to: parseInstant(data.to, "to"),
    zoneId: parseId(data.zoneId),
    partnerId: parseId(data.partnerId),
    driverId: parseId(data.driverId),
    restaurantId: parseId(data.restaurantId),
  };
  if (filters.from && filters.to && filters.from > filters.to) {
    throw new HttpsError("invalid-argument", "invalid_range");
  }
  return { filters, basis } as const;
}

/**
 * `admin_deliveries_status_counts`.
 *
 * Key names are the SQL's bytes, not the column names: the panel reads
 * `under_review` and `in_progress` directly off the JSON, and renaming them here
 * would break the KPI strip with no error anywhere.
 */
export const adminDeliveriesStatusCounts = onCall(async (request) => {
  await requireStaff(request, "deliveries.view");

  const data = (request.data ?? {}) as Record<string, unknown>;
  const { filters, basis } = readFilters(data);
  const query = baseQuery({ ...filters, driverId: null, restaurantId: null }, basis);

  const { total, byStatus, inProgress } = await statusCounts(query, DELIVERY_STATUSES);

  return {
    total,
    active: byStatus.get("in_transit") ?? 0,
    verified: byStatus.get("verified") ?? 0,
    pending: byStatus.get("pending") ?? 0,
    rejected: byStatus.get("rejected") ?? 0,
    cancelled: byStatus.get("cancelled") ?? 0,
    under_review: byStatus.get("under_review") ?? 0,
    in_progress: inProgress,
  };
});

/** `admin_deliveries_counts_by_filters` — the same counts plus driver/restaurant. */
export const adminDeliveriesCountsByFilters = onCall(async (request) => {
  await requireStaff(request, "deliveries.view");

  const data = (request.data ?? {}) as Record<string, unknown>;
  const { filters, basis } = readFilters(data);
  const query = baseQuery(filters, basis);

  const { total, byStatus } = await statusCounts(query, DELIVERY_STATUSES);

  return {
    total,
    verified: byStatus.get("verified") ?? 0,
    pending: byStatus.get("pending") ?? 0,
    rejected: byStatus.get("rejected") ?? 0,
    cancelled: byStatus.get("cancelled") ?? 0,
    in_transit: byStatus.get("in_transit") ?? 0,
    under_review: byStatus.get("under_review") ?? 0,
  };
});
