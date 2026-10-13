/**
 * `admin_bulk_update_deliveries` — verify or reject up to 100 deliveries at once.
 *
 * Three things happen in one call and cannot be split: the status guard, the
 * restaurant stamp a verified delivery needs before any rule can match it, and
 * the repricing of every rider-day the change touched. That last part is why the
 * panel's bulk bar is not a plain batch write — verifying a delivery is a payout,
 * so a bulk action that moved rows without repricing them would leave the
 * earnings screen disagreeing with the deliveries screen.
 */
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "../core/fs";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { requireStaff } from "../core/staff";
import { kuwaitDayString } from "../core/kuwait";
import { type SourceCompanyConfig } from "../core/incentive";
import { loadIncentiveContext, type IncentiveContext } from "../core/incentive-store";
import { recalculateDriverEarningsCore } from "./earnings";
import { applyDeliveryRollup } from "../core/rollups";
import {
  driverRestaurantIds,
  loadRestaurantsByPartner,
  resolveDeliveryRestaurantId,
} from "./deliveries-shared";

const MAX_IDS = 100;
/** The only two statuses this action can write. */
const TARGET_STATUSES: readonly string[] = ["verified", "rejected"];
/** The only statuses a row can be moved *from*. */
const DECIDABLE_STATUSES: readonly string[] = ["pending", "under_review"];

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

/** `COALESCE(delivered_at, pickup_at)` as a Kuwait civil date, or null. */
function earnDateOf(raw: Record<string, unknown>): string | null {
  for (const key of [FIELDS.deliveries.deliveredAt, FIELDS.deliveries.pickupAt]) {
    const value = raw[key];
    if (value && typeof value === "object" && "toDate" in (value as object)) {
      return kuwaitDayString((value as { toDate: () => Date }).toDate());
    }
  }
  return null;
}

export const adminBulkUpdateDeliveries = onCall(async (request) => {
  await requireStaff(request, "deliveries.manage");
  const data = (request.data ?? {}) as Record<string, unknown>;

  const status = asString(data["status"] ?? data["p_status"]);
  if (status === null || !TARGET_STATUSES.includes(status)) {
    throw new HttpsError("invalid-argument", "invalid_status");
  }

  const rawReason = asString(data["reason"] ?? data["p_reason"]);
  const reason = rawReason ? rawReason.trim() || null : null;
  if (status === "rejected" && reason === null) {
    throw new HttpsError("invalid-argument", "reason_required");
  }

  const rawIds = data["ids"] ?? data["p_ids"];
  const ids = [
    ...new Set(
      (Array.isArray(rawIds) ? rawIds : []).filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      ),
    ),
  ];
  if (ids.length === 0) return { updated: 0, skipped: 0, failed: 0 };
  if (ids.length > MAX_IDS) throw new HttpsError("invalid-argument", "too_many");

  const db = getFirestore();
  const refs = ids.map((id) => db.collection(COLLECTIONS.deliveries).doc(id));

  // The restaurant inputs are read outside the transaction on purpose:
  // Firestore transactions run no queries, and this needs the rider's own
  // assignments plus a query over the partner's restaurants. Neither input is
  // something this action writes, so preparing them first cannot race the status
  // change itself — only a *concurrent* reassignment of the rider could, which
  // is the same window the SQL's inline call had.
  const preflight = await db.getAll(...refs);
  const decidable = preflight.filter((snap) => {
    const current = snap.exists ? asString((snap.data() ?? {})[FIELDS.deliveries.status]) : null;
    return current !== null && DECIDABLE_STATUSES.includes(current);
  });

  const resolvedRestaurantId = new Map<string, string | null>();
  if (status === "verified" && decidable.length > 0) {
    const driverIds = [
      ...new Set(
        decidable
          .map((snap) => asString((snap.data() ?? {})[FIELDS.deliveries.driverId]))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const driverSnaps = await db.getAll(
      ...driverIds.map((id) => db.collection(COLLECTIONS.drivers).doc(id)),
    );
    const driverById = new Map<string, Record<string, unknown>>();
    for (const snap of driverSnaps) {
      if (snap.exists) driverById.set(snap.id, snap.data() ?? {});
    }

    const partnerIds = decidable
      .map((snap) => asString((snap.data() ?? {})[FIELDS.deliveries.partnerId]))
      .filter((id): id is string => Boolean(id));
    const restaurantsByPartner = await loadRestaurantsByPartner(partnerIds);

    for (const snap of decidable) {
      const raw = snap.data() ?? {};
      const partnerId = asString(raw[FIELDS.deliveries.partnerId]);
      resolvedRestaurantId.set(
        snap.id,
        resolveDeliveryRestaurantId({
          deliveryRestaurantId: asString(raw[FIELDS.deliveries.restaurantId]),
          assignedRestaurantIds: driverRestaurantIds(
            driverById.get(asString(raw[FIELDS.deliveries.driverId]) ?? ""),
          ),
          partnerId,
          partnerRestaurantIds: partnerId ? (restaurantsByPartner.get(partnerId) ?? []) : [],
        }),
      );
    }
  }

  // The repricing set is derived inside the transaction from the state the
  // writes produce, which is what the SQL's follow-up SELECT reads. That matters
  // for one case a "only the rows I changed" set would miss: an id that was
  // **already** verified before this call still triggers its day to be repriced,
  // because the SQL selects on `status = p_status`, not on what the UPDATE
  // touched.
  const changed = await db.runTransaction(async (transaction) => {
    const snaps = await Promise.all(refs.map((ref) => transaction.get(ref)));
    const dayKeys = new Set<string>();
    const touches: Array<{
      id: string;
      driverId: string;
      zoneId: string | null;
      day: string | null;
      status: string;
    }> = [];
    let updated = 0;

    for (const snap of snaps) {
      if (!snap.exists) continue;
      const raw = snap.data() ?? {};
      const current = asString(raw[FIELDS.deliveries.status]);
      const isDecidable = current !== null && DECIDABLE_STATUSES.includes(current);

      // A row that is neither decidable nor already at the target keeps its own
      // status, so it contributes nothing here — matching the SQL's WHERE.
      const resultingStatus: string | null = isDecidable ? status : current;
      if (resultingStatus !== status) continue;

      if (isDecidable) {
        const patch: Record<string, unknown> = {
          [FIELDS.deliveries.status]: status,
          rejection_reason: status === "rejected" ? reason : null,
          updated_at: FieldValue.serverTimestamp(),
        };
        if (status === "verified") {
          const resolved = resolvedRestaurantId.get(snap.id) ?? null;
          // `COALESCE(d.restaurant_id, …)` — an existing stamp is never overwritten.
          if (resolved && !asString(raw[FIELDS.deliveries.restaurantId])) {
            patch[FIELDS.deliveries.restaurantId] = resolved;
          }
        }
        transaction.update(snap.ref, patch);
        updated += 1;
        const driverId = asString(raw[FIELDS.deliveries.driverId]);
        const shift = asString(raw[FIELDS.deliveries.shiftDate]);
        const day = shift && /^\d{4}-\d{2}-\d{2}$/.test(shift) ? shift : earnDateOf(raw);
        if (driverId) {
          touches.push({
            id: snap.id,
            driverId,
            zoneId: asString(raw[FIELDS.deliveries.zoneId]),
            day,
            status,
          });
        }
      }

      if (status === "verified") {
        const driverId = asString(raw[FIELDS.deliveries.driverId]);
        const earnDate = earnDateOf(raw);
        if (driverId && earnDate) dayKeys.add(`${driverId}|${earnDate}`);
      }
    }

    return { updated, dayKeys, touches };
  });

  if (status === "verified" && changed.dayKeys.size > 0) {
    const context: IncentiveContext = await loadIncentiveContext();
    const companyCache = new Map<string, SourceCompanyConfig | null>();

    // One repricing pass per rider-day: two verified deliveries on the same day
    // are one earnings row, and pricing it twice would double the work without
    // changing the answer.
    for (const key of changed.dayKeys) {
      const separator = key.indexOf("|");
      await recalculateDriverEarningsCore({
        driverId: key.slice(0, separator),
        earnDate: key.slice(separator + 1),
        approvedBy: null,
        context,
        companyCache,
      });
    }
  }

  for (const touch of changed.touches) {
    if (!touch.day) continue;
    await applyDeliveryRollup(db, {
      deliveryId: touch.id,
      driverId: touch.driverId,
      zoneId: touch.zoneId,
      day: touch.day,
      status: touch.status,
    });
  }

  return {
    updated: changed.updated,
    skipped: Math.max(0, ids.length - changed.updated),
    failed: 0,
  };
});
