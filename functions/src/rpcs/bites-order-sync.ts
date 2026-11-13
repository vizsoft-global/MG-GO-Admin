import {
  Timestamp,
  type DocumentReference,
  type Firestore,
} from "firebase-admin/firestore";
import {
  BITES_COLLECTIONS,
  BITES_DELIVERY_FIELDS,
  BITES_ORDER_FIELDS,
  getBitesFirestore,
} from "../core/bites";

/**
 * Writes the delivery milestones onto the customer app's order.
 *
 * Everything here is best-effort: the rider has already physically picked up or
 * delivered by the time these run, so a Bites-side failure is logged and
 * swallowed rather than failing the callable. The opposite order would trap the
 * rider in a "pickup failed" loop over a downstream bookkeeping problem.
 */

export type BitesPartnerStamp = {
  uid?: string | null;
  name?: string | null;
  phone?: string | null;
};

export type BitesMilestone = {
  /** Value written to both `order_status` and `delivery_info.status`. */
  status: string;
  /** `delivery_info` field holding the milestone timestamp. */
  timeField: string;
  at: Date;
  partner?: BitesPartnerStamp;
};

export type BitesSyncOutcome = {
  synced: boolean;
  reason: "ok" | "missing_order_id" | "order_not_found" | "write_failed";
  error?: string;
  orderId?: string;
};

/**
 * `orders.order_id` spellings to try, most likely first.
 *
 * New orders carry the digits alone, which is also what the rider app stores, so the
 * plain lookup is the one that hits. Orders placed before the prefix was dropped hold
 * `ORDBTS` + the digits, and the customer app always spelled that in capitals, so
 * that form is tried as well. Firestore has no collation, so each spelling costs one
 * read; the hash a printed docket carries is stripped first.
 */
export function bitesOrderIdCandidates(raw: string | null | undefined): string[] {
  const trimmed = (raw ?? "")
    .trim()
    .replace(/^#+|#+$/g, "")
    .replace(/^ORDBTS(?=[0-9])/i, "");
  if (!trimmed) return [];
  const candidates: string[] = [];
  for (const candidate of [trimmed, `ORDBTS${trimmed}`]) {
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}

/** The Bites order document for a rider-entered order id, or null. */
export async function findBitesOrder(
  db: Firestore,
  rawOrderId: string | null | undefined,
): Promise<DocumentReference | null> {
  for (const candidate of bitesOrderIdCandidates(rawOrderId)) {
    const snap = await db
      .collection(BITES_COLLECTIONS.orders)
      .where(BITES_ORDER_FIELDS.id, "==", candidate)
      .limit(1)
      .get();
    if (!snap.empty) return snap.docs[0].ref;
  }
  return null;
}

/**
 * Dotted-path payload for one milestone.
 *
 * The paths are dotted on purpose: a plain `delivery_info` object would replace
 * the whole map and drop `created_at`, `shipping_address` and the other fields
 * checkout wrote alongside it.
 */
export function bitesMilestoneData(milestone: BitesMilestone): Record<string, unknown> {
  const stamp = Timestamp.fromDate(milestone.at);
  const delivery = BITES_ORDER_FIELDS.deliveryInfo;
  const data: Record<string, unknown> = {
    [BITES_ORDER_FIELDS.status]: milestone.status,
    [BITES_ORDER_FIELDS.updatedAt]: stamp,
    [`${delivery}.${BITES_DELIVERY_FIELDS.status}`]: milestone.status,
    [`${delivery}.${milestone.timeField}`]: stamp,
  };
  const partner = milestone.partner;
  if (partner?.uid) data[`${delivery}.${BITES_DELIVERY_FIELDS.partnerUid}`] = partner.uid;
  if (partner?.name) data[`${delivery}.${BITES_DELIVERY_FIELDS.partnerName}`] = partner.name;
  if (partner?.phone) data[`${delivery}.${BITES_DELIVERY_FIELDS.partnerPhone}`] = partner.phone;
  return data;
}

export async function applyBitesMilestone(
  db: Firestore,
  rawOrderId: string | null | undefined,
  milestone: BitesMilestone,
): Promise<BitesSyncOutcome> {
  if (bitesOrderIdCandidates(rawOrderId).length === 0) {
    return { synced: false, reason: "missing_order_id" };
  }
  const ref = await findBitesOrder(db, rawOrderId);
  if (!ref) {
    return { synced: false, reason: "order_not_found" };
  }
  await ref.update(bitesMilestoneData(milestone));
  return { synced: true, reason: "ok", orderId: ref.id };
}

/**
 * Milestone write that never throws, so a callable can await it inline.
 *
 * Pass [db] in tests; production resolves the Bites Firestore lazily so a
 * misconfigured Bites project cannot crash module load for every callable in
 * the delivery project.
 */
export async function syncBitesOrderMilestone(
  rawOrderId: string | null | undefined,
  milestone: BitesMilestone,
  db?: Firestore,
): Promise<BitesSyncOutcome> {
  try {
    return await applyBitesMilestone(db ?? getBitesFirestore(), rawOrderId, milestone);
  } catch (error) {
    return {
      synced: false,
      reason: "write_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
