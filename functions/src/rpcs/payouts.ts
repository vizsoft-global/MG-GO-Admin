/**
 * Payout runs and the grouped earnings readers.
 *
 * Ports of `generate_payout_run`, `approve_payout_run`, `mark_payout_run_paid`,
 * `void_payout_run`, `get_payout_run_detail`, `get_earnings_overview` and
 * `list_earnings_grouped` (migration `20260626800000`).
 *
 * The run document is the state machine: every transition reads and writes it
 * inside a transaction, so two admins approving and voiding the same run cannot
 * both win. The per-driver lines and wallet entries a transition fans out to are
 * then written in batches, because a fleet-sized run exceeds what one
 * transaction should carry.
 */
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  FieldValue,
  getFirestore,
  Timestamp,
  type DocumentReference,
  type WriteBatch,
} from "firebase-admin/firestore";
import { COLLECTIONS } from "../core/collections";
import { requireStaff } from "../core/staff";
import { kuwaitDayEnd, kuwaitDayStart, kuwaitDayString } from "../core/kuwait";
import { roundKwd } from "../core/money";
import {
  BATCH_LIMIT,
  IN_FILTER_LIMIT,
  chunk,
  isoTimestamp,
  loadDocMap,
  numberOrNull,
  pickDay,
  pickIdList,
  pickId,
  pickInstant,
  pickObject,
  pickText,
  textOrNull,
  type Dict,
} from "./_shared";

const ROW_SCAN_CAP = 40_000;
const RUN_SCAN_CAP = 2_000;

type RunStatus = "draft" | "approved" | "paid" | "voided";

function num(value: unknown): number {
  return numberOrNull(value) ?? 0;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requireRange(data: Dict, startNames: string[], endNames: string[]): {
  start: string;
  end: string;
} {
  const start = pickDay(data, ...startNames);
  const end = pickDay(data, ...endNames);
  if (!start || !end) throw new HttpsError("invalid-argument", "invalid_date_range");
  return { start, end };
}

function requireRunId(data: Dict): string {
  const runId = pickId(data, "runId", "p_run_id", "id");
  if (!runId) throw new HttpsError("invalid-argument", "run_not_found");
  return runId;
}

function payoutLineId(runId: string, driverId: string): string {
  return `${runId}_${driverId}`;
}

function payoutSourceRef(runId: string, driverId: string): string {
  return `payout:${runId}:${driverId}`;
}

/** `concat_ws(E'\n', notes, line)` — a null `notes` is skipped, not printed. */
function appendNote(notes: unknown, line: string): string {
  const existing = typeof notes === "string" ? notes : null;
  return existing === null ? line : `${existing}\n${line}`;
}

async function commitInBatches(
  ops: ReadonlyArray<(batch: WriteBatch) => void>,
): Promise<void> {
  const db = getFirestore();
  for (const group of chunk(ops, BATCH_LIMIT)) {
    const batch = db.batch();
    for (const op of group) op(batch);
    await batch.commit();
  }
}

function capped<T>(docs: T[], cap: number): T[] {
  if (docs.length > cap) throw new HttpsError("out-of-range", "too_many_rows");
  return docs;
}

/* ---------------------------------------------------------------------------
 * Filters shared by the two readers.
 * ------------------------------------------------------------------------- */

type EarningsFilters = {
  driverIds: string[];
  zoneIds: string[];
  partnerIds: string[];
  restaurantIds: string[];
};

function parseFilters(data: Dict): EarningsFilters {
  const filters = pickObject(data, "filters", "p_filters") ?? {};
  return {
    driverIds: pickIdList(filters, "driver_ids", "driverIds") ?? [],
    zoneIds: pickIdList(filters, "zone_ids", "zoneIds") ?? [],
    partnerIds: pickIdList(filters, "partner_ids", "partnerIds") ?? [],
    restaurantIds: pickIdList(filters, "restaurant_ids", "restaurantIds") ?? [],
  };
}

type EarningsRow = {
  id: string;
  driverId: string;
  earnDate: string;
  deliveries: number;
  baseKwd: number;
  incentiveKwd: number;
  loanKwd: number;
  penaltyKwd: number;
  reimbursementKwd: number;
  netKwd: number;
  breakdown: unknown[];
  calculatedAt: Date | null;
};

function toEarningsRow(id: string, raw: Dict): EarningsRow | null {
  const driverId = str(raw["driver_id"]);
  const earnDate = typeof raw["earn_date"] === "string" ? raw["earn_date"].slice(0, 10) : null;
  if (!driverId || !earnDate) return null;
  const breakdown = raw["breakdown"];
  return {
    id,
    driverId,
    earnDate,
    deliveries: num(raw["deliveries"]),
    baseKwd: num(raw["base_kwd"]),
    incentiveKwd: num(raw["incentive_kwd"]),
    loanKwd: num(raw["loan_deduction_kwd"]),
    penaltyKwd: num(raw["penalty_kwd"]),
    reimbursementKwd: num(raw["reimbursement_kwd"]),
    netKwd: num(raw["net_kwd"]),
    breakdown: Array.isArray(breakdown) ? breakdown : [],
    calculatedAt: pickInstant(raw, "calculated_at"),
  };
}

/**
 * `driver_earnings_daily` rows with `earn_date` in the window, optionally for a
 * driver list. A list longer than one `in` filter is read in chunks so a large
 * selection is still exact rather than silently truncated.
 */
async function loadEarningsRows(
  start: string,
  end: string,
  driverIds: readonly string[],
): Promise<EarningsRow[]> {
  const db = getFirestore();
  const base = db
    .collection(COLLECTIONS.driverEarningsDaily)
    .where("earn_date", ">=", start)
    .where("earn_date", "<=", end);

  const snaps =
    driverIds.length === 0
      ? [await base.limit(ROW_SCAN_CAP + 1).get()]
      : await Promise.all(
          chunk([...new Set(driverIds)], IN_FILTER_LIMIT).map((group) =>
            base.where("driver_id", "in", group).limit(ROW_SCAN_CAP + 1).get(),
          ),
        );

  const docs = capped(
    snaps.flatMap((snap) => snap.docs),
    ROW_SCAN_CAP,
  );
  return docs
    .map((doc) => toEarningsRow(doc.id, (doc.data() ?? {}) as Dict))
    .filter((row): row is EarningsRow => row !== null);
}

type DeliveryRow = {
  id: string;
  driverId: string;
  day: string;
  zoneId: string | null;
  partnerId: string | null;
  restaurantId: string | null;
};

/**
 * Verified deliveries whose Kuwait civil day of `delivered_at` is in the window,
 * with every filter applied — the `del.status = 'verified' AND (delivered_at AT
 * TIME ZONE 'Asia/Kuwait')::date BETWEEN …` predicate the SQL repeats.
 */
async function loadVerifiedDeliveries(
  start: string,
  end: string,
  filters: EarningsFilters,
): Promise<DeliveryRow[]> {
  const db = getFirestore();
  const snap = await db
    .collection(COLLECTIONS.deliveries)
    .where("status", "==", "verified")
    .where("delivered_at", ">=", kuwaitDayStart(start))
    .where("delivered_at", "<", kuwaitDayEnd(end))
    .select("driver_id", "delivered_at", "zone_id", "partner_id", "restaurant_id")
    .limit(ROW_SCAN_CAP + 1)
    .get();

  const driverSet = new Set(filters.driverIds);
  const zoneSet = new Set(filters.zoneIds);
  const partnerSet = new Set(filters.partnerIds);
  const restaurantSet = new Set(filters.restaurantIds);

  const out: DeliveryRow[] = [];
  for (const doc of capped(snap.docs, ROW_SCAN_CAP)) {
    const raw = (doc.data() ?? {}) as Dict;
    const driverId = str(raw["driver_id"]);
    const deliveredAt = pickInstant(raw, "delivered_at");
    if (!driverId || !deliveredAt) continue;
    const row: DeliveryRow = {
      id: doc.id,
      driverId,
      day: kuwaitDayString(deliveredAt),
      zoneId: str(raw["zone_id"]),
      partnerId: str(raw["partner_id"]),
      restaurantId: str(raw["restaurant_id"]),
    };
    if (driverSet.size > 0 && !driverSet.has(row.driverId)) continue;
    if (zoneSet.size > 0 && !(row.zoneId && zoneSet.has(row.zoneId))) continue;
    if (partnerSet.size > 0 && !(row.partnerId && partnerSet.has(row.partnerId))) continue;
    if (restaurantSet.size > 0 && !(row.restaurantId && restaurantSet.has(row.restaurantId))) {
      continue;
    }
    out.push(row);
  }
  return out;
}

/** `ORDER BY deliveries DESC, name LIMIT 1` over the joined (existing) entities. */
async function topEntity(
  collection: string,
  ids: Array<string | null>,
): Promise<Dict> {
  const counts = new Map<string, number>();
  for (const id of ids) {
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (counts.size === 0) return {};
  const docs = await loadDocMap(collection, [...counts.keys()]);
  let best: { id: string; name: string; deliveries: number } | null = null;
  for (const [id, deliveries] of counts) {
    const doc = docs.get(id);
    if (!doc) continue;
    const name = typeof doc["name"] === "string" ? doc["name"] : "";
    if (
      best === null ||
      deliveries > best.deliveries ||
      (deliveries === best.deliveries && name.localeCompare(best.name) < 0)
    ) {
      best = { id, name, deliveries };
    }
  }
  return best ?? {};
}

/* ---------------------------------------------------------------------------
 * Readers.
 * ------------------------------------------------------------------------- */

/** `get_earnings_overview(p_start_date, p_end_date, p_filters)`. */
export const getEarningsOverview = onCall(async (request) => {
  await requireStaff(request, "earnings.view");
  const data = (request.data ?? {}) as Dict;
  const { start, end } = requireRange(
    data,
    ["startDate", "p_start_date"],
    ["endDate", "p_end_date"],
  );
  const filters = parseFilters(data);
  const scoped =
    filters.zoneIds.length > 0 || filters.partnerIds.length > 0 || filters.restaurantIds.length > 0;

  const [earnings, deliveries] = await Promise.all([
    loadEarningsRows(start, end, filters.driverIds),
    loadVerifiedDeliveries(start, end, filters),
  ]);

  // The EXISTS branch: with a zone/partner/restaurant filter, an earnings row
  // counts only when that rider had a matching verified delivery on that day.
  const deliveredDriverDays = new Set(deliveries.map((row) => `${row.driverId}|${row.day}`));
  const filtered = scoped
    ? earnings.filter((row) => deliveredDriverDays.has(`${row.driverId}|${row.earnDate}`))
    : earnings;

  let totalPayable = 0;
  let totalIncentive = 0;
  let totalDeliveries = 0;
  let latest: Date | null = null;
  const drivers = new Set<string>();
  for (const row of filtered) {
    totalPayable += row.netKwd;
    totalIncentive += row.incentiveKwd;
    totalDeliveries += row.deliveries;
    drivers.add(row.driverId);
    if (row.calculatedAt && (latest === null || row.calculatedAt > latest)) {
      latest = row.calculatedAt;
    }
  }

  const [topZone, topPartner, topRestaurant] = await Promise.all([
    topEntity(COLLECTIONS.zones, deliveries.map((row) => row.zoneId)),
    topEntity(COLLECTIONS.partners, deliveries.map((row) => row.partnerId)),
    topEntity(COLLECTIONS.restaurants, deliveries.map((row) => row.restaurantId)),
  ]);

  return {
    start_date: start,
    end_date: end,
    kpis: {
      total_payable_kwd: roundKwd(totalPayable),
      total_incentive_kwd: roundKwd(totalIncentive),
      total_deliveries: totalDeliveries,
      active_drivers: drivers.size,
      calculated_rows: filtered.length,
      latest_calculated_at: latest ? latest.toISOString() : null,
    },
    top_zone: topZone,
    top_partner: topPartner,
    top_restaurant: topRestaurant,
  };
});

type GroupBy = "day" | "driver" | "zone" | "partner" | "restaurant";

function parseGroupBy(value: unknown): GroupBy {
  switch (value) {
    case "day":
    case "driver":
    case "zone":
    case "partner":
    case "restaurant":
      return value;
    default:
      throw new HttpsError("invalid-argument", "invalid_group_by");
  }
}

function groupByDay(rows: readonly EarningsRow[]): Dict[] {
  const groups = new Map<
    string,
    { deliveries: number; drivers: Set<string>; incentive: number; net: number }
  >();
  for (const row of rows) {
    const group = groups.get(row.earnDate) ?? {
      deliveries: 0,
      drivers: new Set<string>(),
      incentive: 0,
      net: 0,
    };
    group.deliveries += row.deliveries;
    group.drivers.add(row.driverId);
    group.incentive += row.incentiveKwd;
    group.net += row.netKwd;
    groups.set(row.earnDate, group);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, group]) => ({
      group_type: "day",
      group_id: day,
      group_name: day,
      delivery_count: group.deliveries,
      driver_count: group.drivers.size,
      incentive_kwd: roundKwd(group.incentive),
      net_kwd: roundKwd(group.net),
    }));
}

async function groupByDriver(rows: readonly EarningsRow[]): Promise<Dict[]> {
  const ids = [...new Set(rows.map((row) => row.driverId))];
  const [driverById, profileById] = await Promise.all([
    loadDocMap(COLLECTIONS.drivers, ids),
    loadDocMap(COLLECTIONS.profiles, ids),
  ]);

  const groups = new Map<
    string,
    { deliveries: number; days: number; incentive: number; net: number }
  >();
  for (const row of rows) {
    // `JOIN public.drivers` — an earnings row for a deleted driver drops out.
    if (!driverById.has(row.driverId)) continue;
    const group = groups.get(row.driverId) ?? { deliveries: 0, days: 0, incentive: 0, net: 0 };
    group.deliveries += row.deliveries;
    group.days += 1;
    group.incentive += row.incentiveKwd;
    group.net += row.netKwd;
    groups.set(row.driverId, group);
  }

  return [...groups.entries()]
    .map(([driverId, group]) => {
      const driverCode = textOrNull(driverById.get(driverId)?.["driver_code"]);
      const fullName = textOrNull(profileById.get(driverId)?.["full_name"]);
      return {
        group_type: "driver",
        group_id: driverId,
        group_name: fullName ?? driverCode ?? "—",
        driver_code: driverCode,
        delivery_count: group.deliveries,
        days_count: group.days,
        incentive_kwd: roundKwd(group.incentive),
        net_kwd: roundKwd(group.net),
        sortNet: group.net,
      };
    })
    .sort((a, b) => b.sortNet - a.sortNet || a.group_name.localeCompare(b.group_name))
    .map(({ sortNet: _sortNet, ...row }) => row);
}

/**
 * Zone / partner / restaurant grouping: each rider-day's incentive and net are
 * split evenly across the verified deliveries that rider made that day, then
 * summed per group — the SQL's `f.net_kwd / NULLIF(t.total_deliveries, 0)`.
 */
async function groupByEntity(
  groupBy: "zone" | "partner" | "restaurant",
  rows: readonly EarningsRow[],
  deliveries: readonly DeliveryRow[],
): Promise<Dict[]> {
  const earningsByDriverDay = new Map<string, EarningsRow>();
  for (const row of rows) earningsByDriverDay.set(`${row.driverId}|${row.earnDate}`, row);

  const totals = new Map<string, number>();
  for (const delivery of deliveries) {
    const key = `${delivery.driverId}|${delivery.day}`;
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }

  const entityIdOf = (delivery: DeliveryRow): string | null => {
    switch (groupBy) {
      case "zone":
        return delivery.zoneId;
      case "partner":
        return delivery.partnerId;
      case "restaurant":
        return delivery.restaurantId;
      default: {
        const exhaustive: never = groupBy;
        return exhaustive;
      }
    }
  };
  const collection =
    groupBy === "zone"
      ? COLLECTIONS.zones
      : groupBy === "partner"
        ? COLLECTIONS.partners
        : COLLECTIONS.restaurants;

  const entityById = await loadDocMap(
    collection,
    deliveries.map(entityIdOf).filter((id): id is string => id !== null),
  );

  const groups = new Map<
    string,
    {
      id: string | null;
      name: string;
      deliveries: number;
      drivers: Set<string>;
      incentive: number;
      net: number;
    }
  >();
  for (const delivery of deliveries) {
    const key = `${delivery.driverId}|${delivery.day}`;
    const earnings = earningsByDriverDay.get(key);
    if (!earnings) continue;
    const total = totals.get(key) ?? 0;
    const id = entityIdOf(delivery);
    const name = (id ? textOrNull(entityById.get(id)?.["name"]) : null) ?? "Unassigned";
    const groupKey = `${id ?? ""}|${name}`;
    const group = groups.get(groupKey) ?? {
      id,
      name,
      deliveries: 0,
      drivers: new Set<string>(),
      incentive: 0,
      net: 0,
    };
    group.deliveries += 1;
    group.drivers.add(delivery.driverId);
    if (total > 0) {
      group.incentive += earnings.incentiveKwd / total;
      group.net += earnings.netKwd / total;
    }
    groups.set(groupKey, group);
  }

  return [...groups.values()]
    .sort((a, b) => b.net - a.net || a.name.localeCompare(b.name))
    .map((group) => ({
      group_type: groupBy,
      group_id: group.id,
      group_name: group.name,
      delivery_count: group.deliveries,
      driver_count: group.drivers.size,
      incentive_kwd: roundKwd(group.incentive),
      net_kwd: roundKwd(group.net),
    }));
}

/** `list_earnings_grouped(p_start_date, p_end_date, p_group_by, p_filters)`. */
export const listEarningsGrouped = onCall(async (request) => {
  await requireStaff(request, "earnings.view");
  const data = (request.data ?? {}) as Dict;
  const { start, end } = requireRange(
    data,
    ["startDate", "p_start_date"],
    ["endDate", "p_end_date"],
  );
  const groupBy = parseGroupBy(pickText(data, "groupBy", "p_group_by"));
  const filters = parseFilters(data);

  let rows: Dict[];
  switch (groupBy) {
    case "day":
      rows = groupByDay(await loadEarningsRows(start, end, filters.driverIds));
      break;
    case "driver":
      rows = await groupByDriver(await loadEarningsRows(start, end, filters.driverIds));
      break;
    case "zone":
    case "partner":
    case "restaurant": {
      const [earnings, deliveries] = await Promise.all([
        loadEarningsRows(start, end, filters.driverIds),
        loadVerifiedDeliveries(start, end, filters),
      ]);
      rows = await groupByEntity(groupBy, earnings, deliveries);
      break;
    }
    default: {
      const exhaustive: never = groupBy;
      throw new HttpsError("invalid-argument", `invalid_group_by:${String(exhaustive)}`);
    }
  }

  return { start_date: start, end_date: end, group_by: groupBy, rows };
});

/* ---------------------------------------------------------------------------
 * Payout runs.
 * ------------------------------------------------------------------------- */

/**
 * The `payout_overlap_exists` guard: any non-voided run whose lines cover a day
 * in the window for one of the requested drivers (or for anyone, when no driver
 * list was given).
 */
async function payoutOverlapExists(
  start: string,
  end: string,
  driverIds: readonly string[],
): Promise<boolean> {
  const db = getFirestore();
  const runsSnap = await db
    .collection(COLLECTIONS.payoutRuns)
    .where("period_start", "<=", end)
    .limit(RUN_SCAN_CAP + 1)
    .get();
  const runIds = capped(runsSnap.docs, RUN_SCAN_CAP)
    .filter((doc) => {
      const raw = doc.data() ?? {};
      return raw["status"] !== "voided" && String(raw["period_end"] ?? "") >= start;
    })
    .map((doc) => doc.id);

  for (const runId of runIds) {
    const lines = db.collection(COLLECTIONS.driverPayouts).where("run_id", "==", runId);
    if (driverIds.length === 0) {
      const any = await lines.limit(1).get();
      if (!any.empty) return true;
      continue;
    }
    for (const group of chunk([...new Set(driverIds)], IN_FILTER_LIMIT)) {
      const hit = await lines.where("driver_id", "in", group).limit(1).get();
      if (!hit.empty) return true;
    }
  }
  return false;
}

/** `generate_payout_run(p_period_start, p_period_end, p_driver_ids, p_notes)` → run id. */
export const generatePayoutRun = onCall(async (request) => {
  const staff = await requireStaff(request, "earnings.manage");
  const data = (request.data ?? {}) as Dict;
  const { start, end } = requireRange(
    data,
    ["periodStart", "p_period_start"],
    ["periodEnd", "p_period_end"],
  );
  if (end < start) throw new HttpsError("invalid-argument", "invalid_date_range");
  const driverIds = pickIdList(data, "driverIds", "p_driver_ids") ?? [];
  const notes = pickText(data, "notes", "p_notes");

  if (await payoutOverlapExists(start, end, driverIds)) {
    throw new HttpsError("failed-precondition", "payout_overlap_exists");
  }

  const earnings = await loadEarningsRows(start, end, driverIds);

  type Line = {
    driverId: string;
    base: number;
    incentive: number;
    loan: number;
    penalty: number;
    reimbursement: number;
    net: number;
    deliveries: number;
    days: EarningsRow[];
  };
  const lines = new Map<string, Line>();
  for (const row of earnings) {
    const line = lines.get(row.driverId) ?? {
      driverId: row.driverId,
      base: 0,
      incentive: 0,
      loan: 0,
      penalty: 0,
      reimbursement: 0,
      net: 0,
      deliveries: 0,
      days: [],
    };
    line.base += row.baseKwd;
    line.incentive += row.incentiveKwd;
    line.loan += row.loanKwd;
    line.penalty += row.penaltyKwd;
    line.reimbursement += row.reimbursementKwd;
    // Recomputed from the components, not `net_kwd`, exactly as the SQL sums it.
    line.net +=
      row.baseKwd + row.incentiveKwd - row.loanKwd - row.penaltyKwd + row.reimbursementKwd;
    line.deliveries += row.deliveries;
    line.days.push(row);
    lines.set(row.driverId, line);
  }

  const db = getFirestore();
  const runRef = db.collection(COLLECTIONS.payoutRuns).doc();
  const runId = runRef.id;
  const totalPayable = roundKwd([...lines.values()].reduce((sum, line) => sum + line.net, 0));

  await db.runTransaction(async (tx) => {
    tx.create(runRef, {
      id: runId,
      period_start: start,
      period_end: end,
      status: "draft" satisfies RunStatus,
      notes,
      total_drivers: 0,
      total_payable_kwd: 0,
      created_by: staff.uid,
      approved_by: null,
      paid_by: null,
      created_at: FieldValue.serverTimestamp(),
      approved_at: null,
      paid_at: null,
      updated_at: FieldValue.serverTimestamp(),
    });
  });

  await commitInBatches(
    [...lines.values()].map((line) => (batch: WriteBatch) => {
      const lineId = payoutLineId(runId, line.driverId);
      const breakdown = [...line.days]
        .sort((a, b) => a.earnDate.localeCompare(b.earnDate))
        .flatMap((day) => day.breakdown);
      batch.set(db.collection(COLLECTIONS.driverPayouts).doc(lineId), {
        id: lineId,
        run_id: runId,
        driver_id: line.driverId,
        period_start: start,
        period_end: end,
        base_kwd: roundKwd(line.base),
        incentive_kwd: roundKwd(line.incentive),
        loan_deduction_kwd: roundKwd(line.loan),
        penalty_kwd: roundKwd(line.penalty),
        reimbursement_kwd: roundKwd(line.reimbursement),
        adjustment_kwd: 0,
        net_payable_kwd: roundKwd(line.net),
        delivery_count: line.deliveries,
        breakdown_snapshot: breakdown,
        status: "draft" satisfies RunStatus,
        notes: null,
        paid_at: null,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
    }),
  );

  await runRef.update({
    total_drivers: lines.size,
    total_payable_kwd: totalPayable,
    updated_at: FieldValue.serverTimestamp(),
  });

  return runId;
});

async function loadRunLineRefs(runId: string): Promise<
  Array<{ ref: DocumentReference; raw: Dict }>
> {
  const db = getFirestore();
  const snap = await db
    .collection(COLLECTIONS.driverPayouts)
    .where("run_id", "==", runId)
    .limit(ROW_SCAN_CAP + 1)
    .get();
  return capped(snap.docs, ROW_SCAN_CAP).map((doc) => ({
    ref: doc.ref,
    raw: (doc.data() ?? {}) as Dict,
  }));
}

/** `approve_payout_run(p_run_id)`. */
export const approvePayoutRun = onCall(async (request) => {
  const staff = await requireStaff(request, "earnings.manage");
  const data = (request.data ?? {}) as Dict;
  const runId = requireRunId(data);
  const db = getFirestore();
  const runRef = db.collection(COLLECTIONS.payoutRuns).doc(runId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    if (!snap.exists) throw new HttpsError("not-found", "run_not_found");
    const status = (snap.data() ?? {})["status"];
    if (status === "voided") throw new HttpsError("failed-precondition", "run_voided");
    const existingApprover = str((snap.data() ?? {})["approved_by"]);
    tx.update(runRef, {
      status: "approved" satisfies RunStatus,
      approved_at: FieldValue.serverTimestamp(),
      approved_by: staff.uid ?? existingApprover,
      updated_at: FieldValue.serverTimestamp(),
    });
  });

  const lines = await loadRunLineRefs(runId);
  const walletRefs = lines.map(({ raw }) =>
    db
      .collection(COLLECTIONS.driverWalletEntries)
      .doc(payoutSourceRef(runId, String(raw["driver_id"] ?? ""))),
  );
  const existingWallet = new Map<string, Dict>();
  for (const group of chunk(walletRefs, 300)) {
    if (group.length === 0) continue;
    const snaps = await db.getAll(...group);
    for (const snap of snaps) {
      if (snap.exists) existingWallet.set(snap.id, (snap.data() ?? {}) as Dict);
    }
  }

  const ops: Array<(batch: WriteBatch) => void> = [];
  lines.forEach(({ ref, raw }, index) => {
    ops.push((batch) =>
      batch.update(ref, {
        status: "approved" satisfies RunStatus,
        updated_at: FieldValue.serverTimestamp(),
      }),
    );
    const driverId = String(raw["driver_id"] ?? "");
    if (!driverId) return;
    const walletRef = walletRefs[index];
    const existing = existingWallet.get(walletRef.id);
    const net = num(raw["net_payable_kwd"]);
    const adjustment = num(raw["adjustment_kwd"]);
    ops.push((batch) =>
      batch.set(walletRef, {
        id: walletRef.id,
        driver_id: driverId,
        earn_date: str(raw["period_end"]),
        entry_type: "payout_debit",
        amount_kwd: roundKwd(Math.max(net + adjustment, 0)),
        status: "approved",
        source_ref: walletRef.id,
        run_id: runId,
        approved_at: FieldValue.serverTimestamp(),
        approved_by: staff.uid ?? str(existing?.["approved_by"]),
        meta: {
          run_id: runId,
          period_start: str(raw["period_start"]),
          period_end: str(raw["period_end"]),
          delivery_count: num(raw["delivery_count"]),
          net_payable_kwd: net,
          adjustment_kwd: adjustment,
        },
        created_at: existing?.["created_at"] ?? FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }),
    );
  });
  await commitInBatches(ops);

  return null;
});

/** `mark_payout_run_paid(p_run_id, p_paid_at, p_reference)`. */
export const markPayoutRunPaid = onCall(async (request) => {
  const staff = await requireStaff(request, "earnings.manage");
  const data = (request.data ?? {}) as Dict;
  const runId = requireRunId(data);
  const paidAt = Timestamp.fromDate(pickInstant(data, "paidAt", "p_paid_at") ?? new Date());
  const reference = pickText(data, "reference", "p_reference");
  const db = getFirestore();
  const runRef = db.collection(COLLECTIONS.payoutRuns).doc(runId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    const raw = (snap.data() ?? {}) as Dict;
    if (!snap.exists || (raw["status"] !== "approved" && raw["status"] !== "paid")) {
      throw new HttpsError("failed-precondition", "run_not_approved");
    }
    tx.update(runRef, {
      status: "paid" satisfies RunStatus,
      paid_at: paidAt,
      paid_by: staff.uid ?? str(raw["paid_by"]),
      notes: reference ? appendNote(raw["notes"], `reference: ${reference}`) : (raw["notes"] ?? null),
      updated_at: FieldValue.serverTimestamp(),
    });
  });

  const lines = await loadRunLineRefs(runId);
  await commitInBatches(
    lines
      .filter(({ raw }) => raw["status"] === "approved" || raw["status"] === "paid")
      .map(({ ref }) => (batch: WriteBatch) =>
        batch.update(ref, {
          status: "paid" satisfies RunStatus,
          paid_at: paidAt,
          updated_at: FieldValue.serverTimestamp(),
        }),
      ),
  );

  return null;
});

/** `void_payout_run(p_run_id, p_reason)` — a no-op for a missing or already-voided run. */
export const voidPayoutRun = onCall(async (request) => {
  await requireStaff(request, "earnings.manage");
  const data = (request.data ?? {}) as Dict;
  const runId = requireRunId(data);
  const reason = pickText(data, "reason", "p_reason");
  const db = getFirestore();
  const runRef = db.collection(COLLECTIONS.payoutRuns).doc(runId);

  const transitioned = await db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    if (!snap.exists) return false;
    const raw = (snap.data() ?? {}) as Dict;
    if (raw["status"] === "voided") return false;
    tx.update(runRef, {
      status: "voided" satisfies RunStatus,
      notes: reason ? appendNote(raw["notes"], `void_reason: ${reason}`) : (raw["notes"] ?? null),
      updated_at: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (!transitioned) return null;

  const prefix = `payout:${runId}:`;
  const [lines, walletSnap] = await Promise.all([
    loadRunLineRefs(runId),
    db
      .collection(COLLECTIONS.driverWalletEntries)
      .where("source_ref", ">=", prefix)
      .where("source_ref", "<", `${prefix}\uf8ff`)
      .limit(ROW_SCAN_CAP + 1)
      .get(),
  ]);

  const ops: Array<(batch: WriteBatch) => void> = lines.map(({ ref }) => (batch: WriteBatch) =>
    batch.update(ref, {
      status: "voided" satisfies RunStatus,
      updated_at: FieldValue.serverTimestamp(),
    }),
  );
  for (const doc of capped(walletSnap.docs, ROW_SCAN_CAP)) {
    if ((doc.data() ?? {})["entry_type"] !== "payout_debit") continue;
    ops.push((batch) =>
      batch.update(doc.ref, {
        status: "voided",
        updated_at: FieldValue.serverTimestamp(),
      }),
    );
  }
  await commitInBatches(ops);

  return null;
});

/** `get_payout_run_detail(p_run_id)`. */
export const getPayoutRunDetail = onCall(async (request) => {
  await requireStaff(request, "earnings.view");
  const data = (request.data ?? {}) as Dict;
  const runId = requireRunId(data);
  const db = getFirestore();

  const runSnap = await db.collection(COLLECTIONS.payoutRuns).doc(runId).get();
  if (!runSnap.exists) throw new HttpsError("not-found", "run_not_found");
  const run = (runSnap.data() ?? {}) as Dict;

  const lines = await loadRunLineRefs(runId);
  const driverIds = lines.map(({ raw }) => String(raw["driver_id"] ?? "")).filter(Boolean);
  const [driverById, profileById] = await Promise.all([
    loadDocMap(COLLECTIONS.drivers, driverIds),
    loadDocMap(COLLECTIONS.profiles, driverIds),
  ]);

  const rows = lines
    .map(({ ref, raw }) => {
      const driverId = String(raw["driver_id"] ?? "");
      const driver = driverById.get(driverId);
      // `JOIN public.drivers` — a line for a deleted driver drops out.
      if (!driver) return null;
      const fullName = textOrNull(profileById.get(driverId)?.["full_name"]);
      const driverCode = textOrNull(driver["driver_code"]);
      return {
        sortKey: fullName ?? driverCode,
        line: {
          id: str(raw["id"]) ?? ref.id,
          driver_id: driverId,
          driver_code: driverCode,
          driver_name: fullName ?? "—",
          period_start: str(raw["period_start"]),
          period_end: str(raw["period_end"]),
          base_kwd: num(raw["base_kwd"]),
          incentive_kwd: num(raw["incentive_kwd"]),
          loan_deduction_kwd: num(raw["loan_deduction_kwd"]),
          penalty_kwd: num(raw["penalty_kwd"]),
          reimbursement_kwd: num(raw["reimbursement_kwd"]),
          adjustment_kwd: num(raw["adjustment_kwd"]),
          net_payable_kwd: num(raw["net_payable_kwd"]),
          delivery_count: num(raw["delivery_count"]),
          status: str(raw["status"]),
          notes: raw["notes"] ?? null,
          paid_at: isoTimestamp(raw["paid_at"]),
          breakdown_snapshot: Array.isArray(raw["breakdown_snapshot"])
            ? raw["breakdown_snapshot"]
            : [],
        },
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    // Postgres sorts NULLs last in an ascending ORDER BY.
    .sort((a, b) => {
      if (a.sortKey === null && b.sortKey === null) return 0;
      if (a.sortKey === null) return 1;
      if (b.sortKey === null) return -1;
      return a.sortKey.localeCompare(b.sortKey);
    })
    .map((row) => row.line);

  return {
    run: {
      id: runSnap.id,
      period_start: str(run["period_start"]),
      period_end: str(run["period_end"]),
      status: str(run["status"]),
      notes: run["notes"] ?? null,
      total_drivers: num(run["total_drivers"]),
      total_payable_kwd: num(run["total_payable_kwd"]),
      created_by: str(run["created_by"]),
      approved_by: str(run["approved_by"]),
      paid_by: str(run["paid_by"]),
      created_at: isoTimestamp(run["created_at"]),
      approved_at: isoTimestamp(run["approved_at"]),
      paid_at: isoTimestamp(run["paid_at"]),
    },
    lines: rows,
  };
});
