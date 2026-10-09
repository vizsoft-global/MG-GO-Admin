import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "../core/fs";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { parseId, parseIdList } from "../core/query";
import { requireStaff } from "../core/staff";
import {
  adminPurgeAssetCatalog,
  adminPurgeDeliveries,
  adminPurgeDeliveryRules,
  adminPurgeDrivers,
  adminPurgeIncentiveRules,
  adminPurgeIntakes,
  adminPurgeRestaurants,
  adminPurgeZones,
  collectStorageKeys,
  deleteByIds,
  releaseForeignKeyGuards,
} from "./purge-entities";
import {
  canonicalPurgeEntity,
  countOf,
  purgeBlockersFor,
  purgeRowMatches,
  purgeRowsOf,
  purgeSlugForEntity,
  validatePurgeFilters,
} from "./purge";

export {
  adminPurgeAssetCatalog,
  adminPurgeDeliveries,
  adminPurgeDeliveryRules,
  adminPurgeDrivers,
  adminPurgeIncentiveRules,
  adminPurgeIntakes,
  adminPurgeRestaurants,
  adminPurgeZones,
};

/**
 * The filtered-clear trio already lives in `purge.ts`, which owns the filter
 * catalogue and the matcher they read through. They are re-exported here rather
 * than re-implemented, because a second copy of a delete path is exactly the
 * drift the shared-catalogue rule exists to prevent — this module is the single
 * door for the group, and a re-export keeps the implementation in one place.
 */
export {
  adminPurgeFilteredPage,
  adminPurgeFilteredPreview,
  adminPurgeFilteredValues,
} from "./purge";

/**
 * `delivery_matches_rules` — the predicate every payout path is gated by.
 *
 * The SQL is a `STABLE` helper reached from `compute_incentive_amount`, not a
 * client-callable RPC, and the panel never invokes it directly — so the port is
 * a plain exported function rather than an `onCall`. Wrapping it would advertise
 * a door that does not exist in the database.
 */
export { deliveryMatchesRules } from "../core/incentive";

/**
 * The intake↔restaurant junction.
 *
 * It has no `COLLECTIONS` entry yet, and a junction the purge cannot name is a
 * junction it silently leaves behind — so the name is pinned here, in one place,
 * rather than typed at each call site.
 */
const DRIVER_INTAKE_RESTAURANTS = "driver_intake_restaurants";

/**
 * The intake's link to the profile it became.
 *
 * Clear all's `drivers` branch is a pair of deletes, and this field is what
 * separates them: a rider the panel lists is a `profiles` document, while an
 * intake with no link is a record an approval never finished. It has no `FIELDS`
 * entry yet, so it is pinned here rather than typed at the one call site.
 */
const INTAKE_LINKED_PROFILE_ID = "linked_profile_id";

/**
 * The rider's running verification total.
 *
 * `verification_balances.last_verification_id` is `NO ACTION` in the SQL, so a
 * matched verification must release the link before it goes — but a balance is a
 * running total per rider, not a child of one verification, so the row is kept.
 * It has no `COLLECTIONS` entry yet, and a reference the purge cannot name is a
 * reference it silently leaves dangling, so the name is pinned here.
 */
const VERIFICATION_BALANCES = "verification_balances";

/** Firestore caps an `in` filter at 30 values. */
const IN_CHUNK = 30;

/**
 * One entity's rows, spelled as the collections a clear actually empties.
 *
 * The SQL reached the dependents through `ON DELETE CASCADE`; Firestore has no
 * such thing, so the children are named here. A missing child would not throw —
 * it would leave invisible debris behind a module that reads empty in the panel,
 * which is the one outcome a purge must never produce.
 */
type PurgeTarget = {
  /** Collections emptied by a plain clear of this entity. */
  collections: readonly string[];
  /** The collection a filtered clear deletes its matched ids out of. */
  primary: string;
};

const PURGE_TARGETS: Readonly<Record<string, PurgeTarget>> = {
  deliveries: { collections: [COLLECTIONS.deliveries], primary: COLLECTIONS.deliveries },
  attendance: { collections: [COLLECTIONS.attendanceLogs], primary: COLLECTIONS.attendanceLogs },
  earnings: {
    collections: [COLLECTIONS.driverEarningsDaily, COLLECTIONS.driverWalletEntries],
    primary: COLLECTIONS.driverEarningsDaily,
  },
  payouts: {
    collections: [COLLECTIONS.driverPayouts, COLLECTIONS.payoutRuns],
    primary: COLLECTIONS.driverPayouts,
  },
  requests: {
    collections: [
      COLLECTIONS.requests,
      COLLECTIONS.requestApprovalSteps,
      COLLECTIONS.requestClarifications,
      COLLECTIONS.requestAttachments,
      COLLECTIONS.requestComments,
      COLLECTIONS.requestExceptionActions,
    ],
    primary: COLLECTIONS.requests,
  },
  visits: {
    collections: [COLLECTIONS.visitBookings, COLLECTIONS.visitBookingNotes],
    primary: COLLECTIONS.visitBookings,
  },
  notifications: {
    collections: [
      COLLECTIONS.notificationDispatchItems,
      COLLECTIONS.notificationDispatchRuns,
      COLLECTIONS.notificationClientEvents,
      COLLECTIONS.notificationAutomationEvents,
      COLLECTIONS.notificationAudienceSnapshots,
      COLLECTIONS.notificationTimeline,
      COLLECTIONS.notificationCampaigns,
    ],
    primary: COLLECTIONS.notificationCampaigns,
  },
  esign: {
    collections: [
      COLLECTIONS.esignRequestSigners,
      COLLECTIONS.esignBatchRows,
      COLLECTIONS.esignBatches,
      COLLECTIONS.esignDrafts,
      COLLECTIONS.esignAuditEvents,
      COLLECTIONS.esignRequests,
    ],
    primary: COLLECTIONS.esignRequests,
  },
  drivers: {
    collections: [
      COLLECTIONS.drivers,
      COLLECTIONS.driverIntakes,
      COLLECTIONS.driverDocuments,
      COLLECTIONS.driverRestaurants,
      COLLECTIONS.driverOffStructure,
      COLLECTIONS.driverEarningsDaily,
      COLLECTIONS.driverWalletEntries,
      COLLECTIONS.driverPayouts,
      COLLECTIONS.driverDailyShifts,
      COLLECTIONS.attendanceLogs,
      COLLECTIONS.driverSessions,
      COLLECTIONS.driverLocations,
      COLLECTIONS.driverLocationEvents,
      COLLECTIONS.documentTracking,
    ],
    primary: COLLECTIONS.drivers,
  },
  driver_groups: { collections: [COLLECTIONS.driverGroups], primary: COLLECTIONS.driverGroups },
  vehicles: { collections: [COLLECTIONS.vehicles], primary: COLLECTIONS.vehicles },
  assets: {
    collections: [COLLECTIONS.assetCatalog, COLLECTIONS.assetAssignments],
    primary: COLLECTIONS.assetCatalog,
  },
  fuel: { collections: [COLLECTIONS.fuelFills], primary: COLLECTIONS.fuelFills },
  restaurants: {
    collections: [COLLECTIONS.restaurantGeofences, COLLECTIONS.restaurants],
    primary: COLLECTIONS.restaurants,
  },
  zones: { collections: [COLLECTIONS.zones], primary: COLLECTIONS.zones },
  partners: { collections: [COLLECTIONS.partners], primary: COLLECTIONS.partners },
  companies: { collections: [COLLECTIONS.sourceCompanies], primary: COLLECTIONS.sourceCompanies },
  delivery_rules: {
    collections: [COLLECTIONS.deliveryRuleScopes, COLLECTIONS.deliveryRules],
    primary: COLLECTIONS.deliveryRules,
  },
  incentive_rules: {
    collections: [
      COLLECTIONS.incentiveRuleScopes,
      COLLECTIONS.incentiveRuleTiers,
      COLLECTIONS.incentiveRules,
    ],
    primary: COLLECTIONS.incentiveRules,
  },
  wrong_actions: { collections: [COLLECTIONS.wrongActions], primary: COLLECTIONS.wrongActions },
  documents: {
    collections: [COLLECTIONS.documentTracking],
    primary: COLLECTIONS.documentTracking,
  },
  order_recon: {
    collections: [COLLECTIONS.orderReconRows, COLLECTIONS.orderReconRuns],
    primary: COLLECTIONS.orderReconRuns,
  },
  verifications: {
    collections: [COLLECTIONS.deliveryVerifications],
    primary: COLLECTIONS.deliveryVerifications,
  },
  payroll: {
    collections: [COLLECTIONS.driverOffStructure],
    primary: COLLECTIONS.driverOffStructure,
  },
};

function purgeTarget(entity: string): PurgeTarget {
  const target = PURGE_TARGETS[entity];
  if (!target) throw new HttpsError("failed-precondition", "unknown_entity");
  return target;
}

/** The `*.bulk_delete` tick the caller must hold — the SQL's `_admin_purge_require`. */
async function requirePurgeSlug(
  request: CallableRequest<unknown>,
  entity: string,
): Promise<{ isSuperAdmin: boolean }> {
  const staff = await requireStaff(request, purgeSlugForEntity(entity));
  return { isSuperAdmin: staff.isSuperAdmin };
}

/**
 * `_admin_purge_require_super_admin` — Clear *filtered* is the stricter door.
 *
 * Clearing a whole module needs the entity's `*.bulk_delete` tick; deleting a
 * slice of one is a different decision, so the SQL raised the bar for it and the
 * port keeps it. `requireStaff` resolves Manager and super admin to the whole
 * catalogue, which is what makes those two pass without a per-entity tick.
 */
async function requireSuperAdminPurge(request: CallableRequest<unknown>): Promise<void> {
  const staff = await requireStaff(request);
  if (!staff.isSuperAdmin) {
    throw new HttpsError("permission-denied", "not_authorized");
  }
}

/** The request's entity, canonicalised the way the filter catalogue expects. */
function entityOf(data: Record<string, unknown>): string {
  const raw =
    parseId(data.entity) ??
    parseId(data.p_entity) ??
    parseId(data.entityType) ??
    parseId(data.p_entity_type) ??
    "";
  return canonicalPurgeEntity(raw);
}

/** `GREATEST(1, LEAST(COALESCE(p_limit, 500), 500))`. */
function purgeLimit(data: Record<string, unknown>): number {
  return Math.max(1, Math.min(500, Math.trunc(Number(data.p_limit ?? data.limit ?? 500))));
}

function purgeFilters(data: Record<string, unknown>): Record<string, unknown> {
  const raw = data.p_filters ?? data.filters;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/**
 * `admin_purge_run_all`'s child sweep.
 *
 * The children are cleared *before* the parent so a batch that stops early
 * leaves orphaned children behind a parent that is still listed — recoverable —
 * rather than a parent with no children, which reads as a module that is already
 * clean and hides the remainder behind a count of zero.
 */
async function clearEntityBatch(
  entity: string,
  limit: number,
): Promise<{
  deleted: number;
  remaining: number;
  storageKeys: string[];
  manifest: Array<{ auth_user_id: string }>;
}> {
  const db = getFirestore();
  const target = purgeTarget(entity);
  const storageKeys: string[] = [];
  const manifest: Array<{ auth_user_id: string }> = [];
  let deleted = 0;

  for (const collection of target.collections) {
    if (deleted >= limit) break;
    const remainingLimit = limit - deleted;
    const snap = await db.collection(collection).limit(remainingLimit).get();
    if (snap.empty) continue;

    const ids = snap.docs.map((doc) => doc.id);
    for (const doc of snap.docs) {
      collectStorageKeys(entity, collection, doc.data() as Record<string, unknown>, storageKeys);
    }
    await deleteByIds(collection, ids);
    deleted += ids.length;
  }

  // `companies` deliberately spares the system rows, so the remainder has to be
  // counted with the same predicate the delete used, or the panel loops forever
  // on a row the delete will never take.
  const remaining = await remainingCount(entity);
  return { deleted, remaining, storageKeys, manifest };
}

async function remainingCount(entity: string): Promise<number> {
  const db = getFirestore();
  switch (entity) {
    case "companies": {
      const [total, system] = await Promise.all([
        countOf(db.collection(COLLECTIONS.sourceCompanies)),
        countOf(db.collection(COLLECTIONS.sourceCompanies).where("is_system", "==", true)),
      ]);
      return Math.max(0, total - system);
    }
    case "drivers": {
      // The remainder is the same pair the delete consumes: the riders the panel
      // lists plus the intakes no approval ever linked. Counting riders alone
      // would keep the panel on a module that still holds unlinked intakes, and
      // counting intakes alone would do the reverse.
      const [riders, orphans] = await Promise.all([
        countOf(db.collection(COLLECTIONS.profiles).where(FIELDS.profiles.role, "==", "rider")),
        countOf(
          db.collection(COLLECTIONS.driverIntakes).where(INTAKE_LINKED_PROFILE_ID, "==", null),
        ),
      ]);
      return riders + orphans;
    }
    default: {
      const target = purgeTarget(entity);
      const counts = await Promise.all(
        target.collections.map((collection) => countOf(db.collection(collection))),
      );
      return counts.reduce((sum, count) => sum + count, 0);
    }
  }
}

/**
 * `admin_purge_preview_all`'s blocker set for the entity being cleared.
 *
 * `purgeBlockersFor` already answers the two reference modules it was written
 * for; the third is `vehicles`, where `fuel_fills.vehicle_id` is RESTRICT and a
 * fill is a record of fuel bought for one vehicle. Nulling that attribution to
 * get the vehicle out would destroy a link the operator never selected, so the
 * SQL refused a fleet with *any* fill at all, and a clear that skipped the check
 * would leave a receipt pointing at a vehicle that no longer exists. The blocker
 * is appended rather than replacing the shared set, so both callers of Clear all
 * speak the same words.
 */
async function runAllBlockers(entity: string): Promise<string[]> {
  const blockers = await purgeBlockersFor(entity);
  if (entity !== "vehicles") return blockers;

  const db = getFirestore();
  const fill = await db.collection(COLLECTIONS.fuelFills).limit(1).get();
  if (!fill.empty) blockers.push("blocked_by_fuel");
  return blockers;
}

/**
 * Clear all's `drivers` branch, which is the one module whose clear is a pair of
 * deletes: the riders the panel lists are `profiles` documents, and the rows an
 * abandoned intake left behind are not riders at all.
 *
 * It calls the per-id purgers instead of sweeping collections generically,
 * because the rider delete owns the Auth-user manifest, the dependent sweep and
 * the storage keys — a second copy here is exactly the drift that would let
 * Clear all and Clear filtered disagree about what deleting a rider leaves
 * behind. The pair is also why the generic sweep could never finish this module:
 * it would delete `drivers` and `driver_intakes` while the profiles it counted
 * as the remainder stayed put, and the panel would loop on a count that no path
 * could reduce.
 */
async function clearDriversBatch(
  request: CallableRequest<unknown>,
  limit: number,
): Promise<{
  deleted: number;
  storageKeys: string[];
  manifest: Array<Record<string, unknown>>;
}> {
  const db = getFirestore();

  const riders = await db
    .collection(COLLECTIONS.profiles)
    .where(FIELDS.profiles.role, "==", "rider")
    .limit(limit)
    .get();

  if (!riders.empty) {
    const ids = riders.docs.map((doc) => doc.id);
    const result = (await adminPurgeDrivers.run(purgerRequest(request, ids))) as PurgerResult;
    return {
      deleted: result.deleted ?? ids.length,
      storageKeys: result.storage_keys ?? [],
      manifest: result.manifest ?? [],
    };
  }

  const orphans = await db
    .collection(COLLECTIONS.driverIntakes)
    .where(INTAKE_LINKED_PROFILE_ID, "==", null)
    .limit(limit)
    .get();
  if (orphans.empty) return { deleted: 0, storageKeys: [], manifest: [] };

  const ids = orphans.docs.map((doc) => doc.id);
  const result = (await adminPurgeIntakes.run(purgerRequest(request, ids))) as PurgerResult;
  return {
    deleted: result.deleted ?? ids.length,
    storageKeys: result.storage_keys ?? [],
    manifest: [],
  };
}

/**
 * `admin_purge_run_all` — one batch, one `remaining`, and the storage keys the
 * caller sweeps *after* the rows are gone.
 */
export const adminPurgeRunAll = onCall(
  { region: "me-central2", maxInstances: 20, cors: true },
  async (request) => {
    const data = (request.data ?? {}) as Record<string, unknown>;
    const entity = entityOf(data);
    await requirePurgeSlug(request, entity);

    const limit = purgeLimit(data);

    // A module that is blocked by a live reference is reported, never partially
    // cleared: emptying the zones a delivery still points at is not a state anyone
    // asked for, and the SQL refused it too.
    const blockers = await runAllBlockers(entity);
    if (blockers.length > 0) {
      return {
        deleted: 0,
        remaining: await remainingCount(entity),
        blockers,
        storage_keys: [],
        manifest: [],
      };
    }

    await releaseForeignKeyGuards(entity);

    if (entity === "drivers") {
      const { deleted, storageKeys, manifest } = await clearDriversBatch(request, limit);
      return {
        deleted,
        remaining: await remainingCount(entity),
        blockers: [],
        storage_keys: storageKeys,
        manifest,
      };
    }

    const { deleted, remaining, storageKeys, manifest } = await clearEntityBatch(entity, limit);

    return {
      deleted,
      remaining,
      blockers: [],
      storage_keys: storageKeys,
      manifest,
    };
  },
);

/* ------------------------------------------------------------------ */
/* Clear filtered                                                      */
/* ------------------------------------------------------------------ */

/** The entities `admin_purge_filtered_run` dispatches. The rest raise. */
const FILTERED_PURGE_ENTITIES: ReadonlySet<string> = new Set([
  "drivers",
  "deliveries",
  "restaurants",
  "zones",
  "assets",
  "delivery_rules",
  "incentive_rules",
  "vehicles",
  "attendance",
  "earnings",
  "payouts",
  "requests",
  "visits",
  "notifications",
  "esign",
  "fuel",
  "wrong_actions",
  "documents",
  "order_recon",
  "verifications",
  "partners",
  "companies",
  "driver_groups",
  "payroll",
]);

type PurgerResult = {
  deleted?: number;
  storage_keys?: string[];
  storage_prefixes?: string[];
  manifest?: Array<Record<string, unknown>>;
};

type PurgeCallable = { run: (request: CallableRequest<unknown>) => unknown };

/**
 * The per-id purgers a filtered clear reuses.
 *
 * Reuse is the whole point: storage sweeps, the Auth-user manifest and the FK
 * release order are one implementation, so Clear all and Clear filtered cannot
 * drift apart. `admin_purge_intakes` is absent deliberately — a matched *driver*
 * row is a profile here, so a filtered clear never produces an intake id to hand
 * it.
 */
const FILTERED_ENTITY_PURGERS: Readonly<Record<string, PurgeCallable>> = {
  drivers: adminPurgeDrivers,
  deliveries: adminPurgeDeliveries,
  restaurants: adminPurgeRestaurants,
  zones: adminPurgeZones,
  assets: adminPurgeAssetCatalog,
  delivery_rules: adminPurgeDeliveryRules,
  incentive_rules: adminPurgeIncentiveRules,
};

/** The inner request a reused purger sees, carrying the caller's own auth. */
function purgerRequest(
  request: CallableRequest<unknown>,
  ids: readonly string[],
): CallableRequest<unknown> {
  return {
    data: { p_ids: [...ids] },
    auth: request.auth,
    app: request.app,
    instanceIdToken: request.instanceIdToken,
    rawRequest: request.rawRequest,
    acceptsStreaming: request.acceptsStreaming,
  };
}

function isText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** The proof slots a delivery row can carry. `order_proof_url` maps to the first. */
function deliveryHasProof(data: Record<string, unknown>): boolean {
  return isText(data.delivery_proof_key) || isText(data.pickup_proof_key) || isText(data.cancel_proof_key);
}

/**
 * A scoped `SET <fields> = NULL`, chunked the way `deleteWhereIn` is.
 *
 * `releaseForeignKeyGuards` nulls globally because Clear all empties the table;
 * a filtered clear must release only the references pointing at the rows it
 * matched, or it would rewrite fleet state the operator never selected.
 */
async function nullFieldsWhereIn(
  collection: string,
  where: string,
  values: readonly string[],
  fields: readonly string[],
  also?: Record<string, unknown>,
): Promise<void> {
  if (values.length === 0) return;
  const db = getFirestore();
  for (let index = 0; index < values.length; index += IN_CHUNK) {
    const slice = values.slice(index, index + IN_CHUNK);
    const snap = await db.collection(collection).where(where, "in", slice).limit(400).get();
    if (snap.empty) continue;
    const batch = db.batch();
    for (const doc of snap.docs) {
      const update: Record<string, unknown> = { ...also };
      for (const field of fields) update[field] = null;
      batch.update(doc.ref, update);
    }
    await batch.commit();
  }
}

/**
 * The live duty rows of the drivers whose logs are going.
 *
 * Leaving a session open beside a deleted log is the state that keeps a rider
 * reading Clocked In with nothing behind it. `is_online` is this schema's
 * "not signed out" flag, which is what the SQL's `went_offline_at IS NULL` says.
 */
async function deleteOpenSessionsFor(driverIds: readonly string[]): Promise<void> {
  if (driverIds.length === 0) return;
  const db = getFirestore();
  for (let index = 0; index < driverIds.length; index += IN_CHUNK) {
    const slice = driverIds.slice(index, index + IN_CHUNK);
    const snap = await db
      .collection(COLLECTIONS.driverSessions)
      .where("driver_id", "in", slice)
      .limit(400)
      .get();
    const open = snap.docs.filter((doc) => doc.data().is_online === true);
    if (open.length === 0) continue;
    const batch = db.batch();
    for (const doc of open) batch.delete(doc.ref);
    await batch.commit();
  }
}

/** A delete that spares the rows `keep` claims, for `companies`. */
async function deleteScopedByIds(
  collection: string,
  ids: readonly string[],
  keep: (data: Record<string, unknown>) => boolean,
): Promise<void> {
  const db = getFirestore();
  const doomed: string[] = [];
  for (const id of ids) {
    const snap = await db.collection(collection).doc(id).get();
    if (!snap.exists) continue;
    if (keep((snap.data() ?? {}) as Record<string, unknown>)) continue;
    doomed.push(id);
  }
  await deleteByIds(collection, doomed);
}

/**
 * The entities with no per-id purger, whose filtered branch the SQL spelled out.
 *
 * Each one is a reference release or a child sweep the SQL performed inline, not
 * a policy decision of its own — so this stays a direct transcription of the
 * `ELSIF` bodies, in the same order.
 */
async function releaseFilteredReferences(entity: string, ids: readonly string[]): Promise<void> {
  const db = getFirestore();

  switch (entity) {
    case "vehicles": {
      await Promise.all([
        nullFieldsWhereIn(
          COLLECTIONS.drivers,
          FIELDS.drivers.vehicleId,
          ids,
          [FIELDS.drivers.vehicleId],
        ),
        nullFieldsWhereIn(
          COLLECTIONS.driverIntakes,
          FIELDS.drivers.vehicleId,
          ids,
          [FIELDS.drivers.vehicleId],
        ),
        // A matched vehicle whose current rider is pointed at it would otherwise
        // name a plate that no longer exists.
        nullFieldsWhereIn(COLLECTIONS.vehicles, "current_driver_id", ids, ["current_driver_id"]),
      ]);
      // `fuel_fills` is never touched: the preview already refused a matched
      // vehicle that has a fill, and a fill is the record of which vehicle the
      // fuel went into.
      await deleteByIds(COLLECTIONS.vehicles, ids);
      return;
    }
    case "attendance": {
      const logs = await Promise.all(
        ids.map((id) => db.collection(COLLECTIONS.attendanceLogs).doc(id).get()),
      );
      const driverIds = [
        ...new Set(
          logs
            .map((snap) => snap.data()?.[FIELDS.attendanceLogs.driverId])
            .filter((value): value is string => typeof value === "string"),
        ),
      ];
      await deleteOpenSessionsFor(driverIds);
      await deleteByIds(COLLECTIONS.attendanceLogs, ids);
      return;
    }
    case "earnings": {
      await Promise.all([
        deleteByIds(COLLECTIONS.driverEarningsDaily, ids),
        deleteByIds(COLLECTIONS.driverWalletEntries, ids),
      ]);
      return;
    }
    case "payouts": {
      await Promise.all([
        deleteByIds(COLLECTIONS.payoutRuns, ids),
        deleteByIds(COLLECTIONS.driverPayouts, ids),
      ]);
      return;
    }
    case "visits": {
      // A booking another rider was rescheduled off is NO ACTION in the SQL and
      // would hold the row in place.
      await nullFieldsWhereIn(
        COLLECTIONS.visitBookings,
        "rescheduled_from_id",
        ids,
        ["rescheduled_from_id"],
      );
      await deleteByIds(COLLECTIONS.visitBookings, ids);
      return;
    }
    case "esign": {
      await nullFieldsWhereIn(COLLECTIONS.esignBatchRows, "esign_request_id", ids, [
        "esign_request_id",
      ]);
      await deleteByIds(COLLECTIONS.esignRequests, ids);
      return;
    }
    case "verifications": {
      // The balance is a running total per rider, not a child of one
      // verification, so the link is released rather than the balance deleted.
      await nullFieldsWhereIn(VERIFICATION_BALANCES, "last_verification_id", ids, [
        "last_verification_id",
      ]);
      await deleteByIds(COLLECTIONS.deliveryVerifications, ids);
      return;
    }
    case "partners": {
      await Promise.all([
        nullFieldsWhereIn(COLLECTIONS.restaurants, FIELDS.drivers.partnerId, ids, [
          FIELDS.drivers.partnerId,
        ]),
        nullFieldsWhereIn(COLLECTIONS.drivers, FIELDS.drivers.partnerId, ids, [
          FIELDS.drivers.partnerId,
        ]),
        nullFieldsWhereIn(COLLECTIONS.driverIntakes, FIELDS.drivers.partnerId, ids, [
          FIELDS.drivers.partnerId,
        ]),
        nullFieldsWhereIn(COLLECTIONS.deliveries, FIELDS.deliveries.partnerId, ids, [
          FIELDS.deliveries.partnerId,
        ]),
      ]);
      await deleteByIds(COLLECTIONS.partners, ids);
      return;
    }
    case "companies": {
      await Promise.all([
        nullFieldsWhereIn(COLLECTIONS.drivers, FIELDS.drivers.sourceCompany, ids, [
          FIELDS.drivers.sourceCompany,
        ]),
        nullFieldsWhereIn(COLLECTIONS.driverIntakes, FIELDS.drivers.sourceCompany, ids, [
          FIELDS.drivers.sourceCompany,
        ]),
      ]);
      // The system row cannot be deleted at all, which is the guard the SQL
      // honoured by setting `mggo.allow_company_purge` and still excluding it.
      await deleteScopedByIds(
        COLLECTIONS.sourceCompanies,
        ids,
        (data) => data.is_system === true,
      );
      return;
    }
    case "requests":
      await deleteByIds(COLLECTIONS.requests, ids);
      return;
    case "notifications":
      await deleteByIds(COLLECTIONS.notificationCampaigns, ids);
      return;
    case "fuel":
      // Deliberately not Clear all's behaviour of wiping fuel_withdrawn_overrides:
      // those are per rider / vehicle / month, not per fill, and a narrow purge
      // must not delete rows the operator did not select.
      await deleteByIds(COLLECTIONS.fuelFills, ids);
      return;
    case "wrong_actions":
      await deleteByIds(COLLECTIONS.wrongActions, ids);
      return;
    case "documents":
      await deleteByIds(COLLECTIONS.documentTracking, ids);
      return;
    case "order_recon":
      await deleteByIds(COLLECTIONS.orderReconRuns, ids);
      return;
    case "driver_groups":
      await deleteByIds(COLLECTIONS.driverGroups, ids);
      return;
    case "payroll":
      // The off-structure row is keyed by the composite `driver_id|YYYYMMDD`,
      // which is the document id, so the matched ids delete directly. Nothing
      // points at this table, which is what the SQL's comment recorded — no link
      // needs releasing first.
      await deleteByIds(COLLECTIONS.driverOffStructure, ids);
      return;
    default:
      throw new HttpsError("failed-precondition", "unknown_entity");
  }
}

/**
 * The blockers a *narrow* clear can hit, scoped to the matched ids.
 *
 * `purgeBlockersFor` answers the fleet-wide question Clear all asks, so reusing
 * it here would refuse a purge of three rows because some unrelated restaurant
 * still has deliveries. The SQL scoped its filtered blockers to the matched set
 * and this is the same three checks.
 */
async function filteredBlockersFor(
  entity: string,
  filters: Record<string, unknown>,
): Promise<string[]> {
  const db = getFirestore();
  const blockers: string[] = [];

  if (entity !== "restaurants" && entity !== "zones" && entity !== "vehicles") return blockers;

  const matched = (await purgeRowsOf(entity))
    .filter((row) => purgeRowMatches(entity, row, filters))
    .sort((left, right) => left.purgeId.localeCompare(right.purgeId));
  const ids = matched.map((row) => row.purgeId);
  if (ids.length === 0) return blockers;

  const existsWhereIn = async (collection: string, field: string): Promise<boolean> => {
    for (let index = 0; index < ids.length; index += IN_CHUNK) {
      const slice = ids.slice(index, index + IN_CHUNK);
      const snap = await db.collection(collection).where(field, "in", slice).limit(1).get();
      if (!snap.empty) return true;
    }
    return false;
  };

  if (entity === "restaurants") {
    if (await existsWhereIn(COLLECTIONS.deliveries, FIELDS.deliveries.restaurantId)) {
      blockers.push("blocked_by_deliveries");
    }
    if (await existsWhereIn(COLLECTIONS.drivers, FIELDS.drivers.restaurantId)) {
      blockers.push("blocked_by_drivers");
    }
    return blockers;
  }

  if (entity === "zones") {
    if (await existsWhereIn(COLLECTIONS.deliveries, FIELDS.deliveries.zoneId)) {
      blockers.push("blocked_by_deliveries");
    }
    if (await existsWhereIn(COLLECTIONS.restaurants, "zone_id")) {
      blockers.push("blocked_by_restaurants");
    }
    // The per-id purger refuses a zone an intake still points at. Without this
    // the preview would clear and the delete would raise mid-run.
    if (await existsWhereIn(COLLECTIONS.driverIntakes, FIELDS.drivers.zoneId)) {
      blockers.push("blocked_by_intakes");
    }
    return blockers;
  }

  // `fuel_fills.vehicle_id` is ON DELETE RESTRICT, and a fill is a record of fuel
  // bought for a specific vehicle: nulling it to get the vehicle out would
  // destroy attribution the operator never selected. Clear all refuses a fleet
  // with any fill at all; here the refusal is scoped to the matched vehicles.
  if (await existsWhereIn(COLLECTIONS.fuelFills, "vehicle_id")) {
    blockers.push("blocked_by_fuel");
  }
  return blockers;
}

/**
 * `admin_purge_filtered_run` — the same shape as the clear-all run, restricted
 * to the rows the filter engine matched.
 */
export const adminPurgeFilteredRun = onCall(
  { region: "me-central2", maxInstances: 20, cors: true },
  async (request) => {
    const data = (request.data ?? {}) as Record<string, unknown>;
    const entity = entityOf(data);
    const limit = purgeLimit(data);

    await requireSuperAdminPurge(request);

    if (!FILTERED_PURGE_ENTITIES.has(entity)) {
      throw new HttpsError("failed-precondition", "unknown_entity");
    }

    const filters = purgeFilters(data);
    validatePurgeFilters(entity, filters);

    const matched = (await purgeRowsOf(entity))
      .filter((row) => purgeRowMatches(entity, row, filters))
      .sort((left, right) => left.purgeId.localeCompare(right.purgeId));

    const blockers = await filteredBlockersFor(entity, filters);
    if (blockers.length > 0) {
      return {
        deleted: 0,
        remaining: matched.length,
        blockers,
        storage_keys: [],
        manifest: [],
      };
    }

    const ids = matched.slice(0, limit).map((row) => row.purgeId);
    if (ids.length === 0) {
      return { deleted: 0, remaining: matched.length, blockers: [], storage_keys: [], manifest: [] };
    }

    const purger = FILTERED_ENTITY_PURGERS[entity];
    let storageKeys: string[] = [];
    let manifest: Array<Record<string, unknown>> = [];

    if (purger) {
      const result = (await purger.run(purgerRequest(request, ids))) as PurgerResult;
      // An intake purge answers with prefixes rather than keys — a folder per
      // intake — and the SQL folded both into one `storage_keys` array.
      storageKeys = [...(result.storage_keys ?? []), ...(result.storage_prefixes ?? [])];
      manifest = result.manifest ?? [];
    } else {
      await releaseFilteredReferences(entity, ids);
    }

    return {
      deleted: ids.length,
      remaining: Math.max(0, matched.length - ids.length),
      blockers: [],
      storage_keys: storageKeys,
      manifest,
    };
  },
);

/* ------------------------------------------------------------------ */
/* Preview                                                             */
/* ------------------------------------------------------------------ */

/** The only entity types `admin_preview_purge` knows, exactly as the SQL's CASE. */
const PREVIEW_ENTITY_TYPES: ReadonlySet<string> = new Set([
  "delivery",
  "driver",
  "intake",
  "restaurant",
  "zone",
  "delivery_rule",
  "incentive_rule",
  "asset_catalog",
]);

type PreviewItem = {
  id: string;
  counts: Record<string, number>;
  storage_key_count: number;
  blockers: string[];
};

/**
 * The slug for a preview's entity type, or null when the SQL's mapping had none.
 *
 * `_admin_purge_slug_for_entity` returns NULL for an unknown type and the SQL
 * then refused with `not_authorized` — a User could not use the unknown type as
 * a probe. Null is carried out rather than thrown so the gate can keep that
 * order: unauthorized callers learn nothing, a Manager learns `invalid_entity_type`.
 */
function previewSlug(rawType: string): string | null {
  try {
    return purgeSlugForEntity(canonicalPurgeEntity(rawType));
  } catch {
    return null;
  }
}

async function previewDelivery(id: string): Promise<PreviewItem> {
  const snap = await getFirestore().collection(COLLECTIONS.deliveries).doc(id).get();
  if (!snap.exists) {
    return { id, counts: {}, storage_key_count: 0, blockers: ["not_found"] };
  }
  const proof = deliveryHasProof((snap.data() ?? {}) as Record<string, unknown>);
  return {
    id,
    counts: { deliveries: 1, has_proof: proof ? 1 : 0 },
    storage_key_count: proof ? 1 : 0,
    blockers: [],
  };
}

async function previewDriver(id: string): Promise<PreviewItem> {
  const db = getFirestore();
  const profile = await db.collection(COLLECTIONS.profiles).doc(id).get();
  if (profile.data()?.[FIELDS.profiles.role] !== "rider") {
    return { id, counts: {}, storage_key_count: 0, blockers: ["not_rider_profile"] };
  }

  const [deliveries, attendance, documents, assets, linkedIntakes, proofs] = await Promise.all([
    countOf(db.collection(COLLECTIONS.deliveries).where(FIELDS.deliveries.driverId, "==", id)),
    countOf(db.collection(COLLECTIONS.attendanceLogs).where(FIELDS.attendanceLogs.driverId, "==", id)),
    countOf(db.collection(COLLECTIONS.driverDocuments).where("driver_id", "==", id)),
    countOf(db.collection(COLLECTIONS.assetAssignments).where("driver_id", "==", id)),
    countOf(db.collection(COLLECTIONS.driverIntakes).where("linked_profile_id", "==", id)),
    // `order_proof_url` in the SQL is the delivered proof slot here; the pickup
    // and cancel slots are not part of that figure.
    countOf(
      db
        .collection(COLLECTIONS.deliveries)
        .where(FIELDS.deliveries.driverId, "==", id)
        .where("delivery_proof_key", "!=", null),
    ),
  ]);

  return {
    id,
    // `driver_attendance` is a SQL view with no Firestore counterpart — the
    // online-seconds figure lives on `attendance_logs` — so counting it here
    // would report the same rows twice.
    counts: {
      deliveries,
      attendance_logs: attendance,
      driver_documents: documents,
      asset_assignments: assets,
      linked_intakes: linkedIntakes,
    },
    storage_key_count: documents + proofs + 1,
    blockers: [],
  };
}

async function previewIntake(id: string): Promise<PreviewItem> {
  const db = getFirestore();
  const snap = await db.collection(COLLECTIONS.driverIntakes).doc(id).get();
  if (snap.data()?.linked_profile_id) {
    // The rider already exists, so the profile-side purge owns the cleanup; an
    // intake-only delete would leave a driver with no intake behind it.
    return { id, counts: {}, storage_key_count: 0, blockers: ["linked_profile_use_driver_purge"] };
  }

  const [assets, restaurants] = await Promise.all([
    countOf(db.collection(COLLECTIONS.assetAssignments).where("intake_id", "==", id)),
    countOf(db.collection(DRIVER_INTAKE_RESTAURANTS).where("intake_id", "==", id)),
  ]);

  return {
    id,
    counts: { asset_assignments: assets, intake_restaurants: restaurants },
    // An intake owns a whole R2 folder rather than named objects.
    storage_key_count: 4,
    blockers: [],
  };
}

async function previewRestaurant(id: string): Promise<PreviewItem> {
  const db = getFirestore();
  const [deliveries, assigned, intakes, drivers] = await Promise.all([
    countOf(db.collection(COLLECTIONS.deliveries).where(FIELDS.deliveries.restaurantId, "==", id)),
    countOf(db.collection(COLLECTIONS.driverRestaurants).where("restaurant_id", "==", id)),
    countOf(db.collection(DRIVER_INTAKE_RESTAURANTS).where("restaurant_id", "==", id)),
    countOf(db.collection(COLLECTIONS.drivers).where(FIELDS.drivers.restaurantId, "==", id)),
  ]);

  const blockers: string[] = [];
  if (deliveries > 0) blockers.push("has_deliveries");
  if (drivers > 0) blockers.push("has_drivers");

  return {
    id,
    counts: { deliveries, driver_restaurants: assigned, intake_restaurants: intakes },
    storage_key_count: 1,
    blockers,
  };
}

async function previewZone(id: string): Promise<PreviewItem> {
  const db = getFirestore();
  const [drivers, intakes, restaurants, deliveries] = await Promise.all([
    countOf(db.collection(COLLECTIONS.drivers).where(FIELDS.drivers.zoneId, "==", id)),
    countOf(db.collection(COLLECTIONS.driverIntakes).where(FIELDS.drivers.zoneId, "==", id)),
    countOf(db.collection(COLLECTIONS.restaurants).where("zone_id", "==", id)),
    countOf(db.collection(COLLECTIONS.deliveries).where(FIELDS.deliveries.zoneId, "==", id)),
  ]);

  const blockers: string[] = [];
  if (intakes > 0) blockers.push("has_intakes");
  if (restaurants > 0) blockers.push("has_restaurants");
  if (deliveries > 0) blockers.push("has_deliveries");

  return {
    id,
    counts: { drivers, intakes, restaurants, deliveries },
    storage_key_count: 0,
    blockers,
  };
}

async function previewDeliveryRule(id: string): Promise<PreviewItem> {
  const db = getFirestore();
  const snap = await db.collection(COLLECTIONS.deliveryRules).doc(id).get();
  if (!snap.exists) {
    return { id, counts: {}, storage_key_count: 0, blockers: ["not_found"] };
  }
  const scopes = await countOf(
    db.collection(COLLECTIONS.deliveryRuleScopes).where("rule_id", "==", id),
  );
  return { id, counts: { scopes }, storage_key_count: 0, blockers: [] };
}

async function previewIncentiveRule(id: string): Promise<PreviewItem> {
  const db = getFirestore();
  const snap = await db.collection(COLLECTIONS.incentiveRules).doc(id).get();
  if (!snap.exists) {
    return { id, counts: {}, storage_key_count: 0, blockers: ["not_found"] };
  }
  const [scopes, tiers] = await Promise.all([
    countOf(db.collection(COLLECTIONS.incentiveRuleScopes).where("rule_id", "==", id)),
    countOf(db.collection(COLLECTIONS.incentiveRuleTiers).where("rule_id", "==", id)),
  ]);
  return { id, counts: { scopes, tiers }, storage_key_count: 0, blockers: [] };
}

async function previewAssetCatalog(id: string): Promise<PreviewItem> {
  const db = getFirestore();
  const snap = await db.collection(COLLECTIONS.assetCatalog).doc(id).get();
  if (!snap.exists) {
    return { id, counts: {}, storage_key_count: 0, blockers: ["not_found"] };
  }
  const assignments = await countOf(
    db
      .collection(COLLECTIONS.assetAssignments)
      .where("catalog_item_id", "==", id)
      .where("status", "==", "assigned"),
  );
  const blockers: string[] = [];
  if (assignments > 0) blockers.push("has_active_assignments");

  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const hasImage = isText(data.image_key) || isText(data.image_url);
  return {
    id,
    counts: { assignments },
    storage_key_count: hasImage ? 1 : 0,
    blockers,
  };
}

async function previewItem(rawType: string, id: string): Promise<PreviewItem> {
  switch (rawType) {
    case "delivery":
      return previewDelivery(id);
    case "driver":
      return previewDriver(id);
    case "intake":
      return previewIntake(id);
    case "restaurant":
      return previewRestaurant(id);
    case "zone":
      return previewZone(id);
    case "delivery_rule":
      return previewDeliveryRule(id);
    case "incentive_rule":
      return previewIncentiveRule(id);
    case "asset_catalog":
      return previewAssetCatalog(id);
    default:
      throw new HttpsError("failed-precondition", "invalid_entity_type");
  }
}

/**
 * `admin_preview_purge` — per-id counts and blockers, never a delete.
 *
 * The caller sends the ids it has selected; the answer names what each one would
 * take with it, so a delete is confirmed against the same arithmetic that was
 * shown rather than against a fleet-wide total.
 */
export const adminPreviewPurge = onCall(
  { region: "me-central2", maxInstances: 20, cors: true },
  async (request) => {
    const data = (request.data ?? {}) as Record<string, unknown>;
    const rawType = parseId(data.p_entity_type) ?? parseId(data.entityType) ?? "";
    const ids = parseIdList(data.p_ids ?? data.ids) ?? [];

    const slug = previewSlug(rawType);
    if (slug === null) {
      // The SQL gated on the NULL slug before it validated the type, and the order
      // is the point: an unauthorized caller must not be able to tell an unknown
      // entity type from a forbidden one. A Manager gets past the gate, which is
      // what makes `invalid_entity_type` reachable for them below.
      const staff = await requireStaff(request);
      if (!staff.isManager) {
        throw new HttpsError("permission-denied", "not_authorized");
      }
    } else {
      await requireStaff(request, slug);
    }

    // The SQL returned an empty answer before it ever dispatched on the type, so
    // a selected-nothing call is legal for a type it would otherwise refuse.
    if (ids.length === 0) {
      return { items: [] };
    }
    if (!PREVIEW_ENTITY_TYPES.has(rawType)) {
      throw new HttpsError("failed-precondition", "invalid_entity_type");
    }

    const items = await Promise.all(ids.map((id) => previewItem(rawType, id)));
    return { items };
  },
);
