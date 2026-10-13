import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "../core/fs";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { requireStaff } from "../core/staff";
import { kuwaitDayRange, kuwaitDayString } from "../core/kuwait";
import { computeSourceCompanyIncentive, incentiveAccruesOnDate, roundKwd } from "../core/money";
import {
  companyConfigApplies,
  compareRulesForLoop,
  computeIncentiveAmount,
  deliveryMatchesRules,
  ruleAppliesOnDate,
  type IncentiveRule,
  type SourceCompanyConfig,
} from "../core/incentive";
import {
  countEligibleDeliveries,
  dpdTargetForRule,
  loadIncentiveContext,
  loadVerifiedDeliveriesForDeliveredDay,
  loadVerifiedDriverIdsForDeliveredDay,
  type IncentiveContext,
  type RawDelivery,
} from "../core/incentive-store";
import { driverRestaurantIds as restaurantIdsOf } from "./deliveries-shared";
import { applyDeliveryRollup } from "../core/rollups";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 400;
const GET_ALL_CHUNK = 300;
const SCAN_CAP = 40_000;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function daysBetween(from: string, to: string): number {
  const parse = (day: string) => {
    const [y, m, d] = day.split("-").map((part) => Number(part));
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((parse(to) - parse(from)) / (24 * 60 * 60 * 1000));
}

function requireDay(value: unknown, field: string): string {
  const text = typeof value === "string" ? value.slice(0, 10) : "";
  if (!DAY_RE.test(text)) throw new HttpsError("invalid-argument", `invalid_${field}`);
  return text;
}

/** Batched `getAll`, so a fleet-sized id list costs a fixed number of round trips. */
async function loadMap(
  collection: string,
  ids: readonly string[],
): Promise<Map<string, Record<string, unknown>>> {
  const db = getFirestore();
  const unique = [...new Set(ids)].filter((id) => id.length > 0);
  const out = new Map<string, Record<string, unknown>>();
  for (let index = 0; index < unique.length; index += GET_ALL_CHUNK) {
    const chunk = unique.slice(index, index + GET_ALL_CHUNK);
    const snaps = await db.getAll(...chunk.map((id) => db.collection(collection).doc(id)));
    for (const snap of snaps) out.set(snap.id, snap.data() ?? {});
  }
  return out;
}

/**
 * Restaurant names for a rider, mirroring the SQL's `string_agg` over
 * `driver_restaurants`.
 *
 * The names are read from the `restaurants` docs rather than a denormalised
 * `restaurant_name` on the driver, because the SQL aggregated **every**
 * assigned restaurant — the driver doc carries one primary name, and printing
 * that for a rider assigned to three would be a different (and wrong) answer.
 */
function restaurantNamesFor(
  driver: Record<string, unknown> | undefined,
  restaurantById: Map<string, Record<string, unknown>>,
): string | null {
  const names = restaurantIdsOf(driver)
    .map((id) => asString(restaurantById.get(id)?.["name"]))
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b));
  return names.length ? names.join(", ") : null;
}

function appliedRuleOf(raw: Record<string, unknown>): string | null {
  const breakdown = raw["breakdown"];
  if (Array.isArray(breakdown)) {
    const names = new Set<string>();
    for (const entry of breakdown) {
      if (entry && typeof entry === "object") {
        const name = trimmedOrNull((entry as Record<string, unknown>)["rule_name"]);
        if (name) names.add(name);
      }
    }
    return names.size ? [...names].sort((a, b) => a.localeCompare(b)).join(", ") : null;
  }
  if (breakdown && typeof breakdown === "object") {
    return trimmedOrNull((breakdown as Record<string, unknown>)["rule_name"]);
  }
  return null;
}

/**
 * `admin_incentive_daily_report`.
 *
 * Read-only and day-grain on `earn_date`, the Kuwait civil date the earnings row
 * was written under — never a converted timestamp, because the row's own day is
 * the only honest answer to "which day was this paid for".
 */
export const adminIncentiveDailyReport = onCall(async (request) => {
  await requireStaff(request, "earnings.view");
  const data = (request.data ?? {}) as Record<string, unknown>;

  const from = requireDay(data.from ?? data.p_from, "date_range");
  const to = requireDay(data.to ?? data.p_to, "date_range");
  if (to < from) throw new HttpsError("invalid-argument", "invalid_date_range");
  if (daysBetween(from, to) > MAX_RANGE_DAYS) {
    throw new HttpsError("failed-precondition", "range_too_large");
  }
  const driverId = trimmedOrNull(data.driverId ?? data.p_driver_id);
  const restaurantId = trimmedOrNull(data.restaurantId ?? data.p_restaurant_id);

  const db = getFirestore();
  let query = db
    .collection(COLLECTIONS.driverEarningsDaily)
    .where("earn_date", ">=", from)
    .where("earn_date", "<=", to);
  if (driverId) query = query.where("driver_id", "==", driverId);
  const snap = await query.limit(SCAN_CAP).get();

  const earnings = snap.docs
    .map((doc) => doc.data() ?? {})
    .map((raw) => ({
      id: asString(raw["id"]) ?? "",
      driverId: asString(raw["driver_id"]) ?? "",
      earnDate: asString(raw["earn_date"]) ?? "",
      deliveries: asNumber(raw["deliveries"]),
      incentiveKwd: asNumber(raw["incentive_kwd"]),
      appliedRule: appliedRuleOf(raw),
    }))
    .filter((row) => row.driverId.length > 0 && row.earnDate.length > 0);

  // Drivers first, then the restaurants and zones they point at: the second read
  // is derived from the first, so this cannot be one `Promise.all`.
  const driverById = await loadMap(
    COLLECTIONS.drivers,
    earnings.map((row) => row.driverId),
  );
  const [restaurantById, zoneById] = await Promise.all([
    loadMap(
      COLLECTIONS.restaurants,
      [...new Set(earnings.flatMap((row) => restaurantIdsOf(driverById.get(row.driverId))))],
    ),
    loadMap(
      COLLECTIONS.zones,
      [
        ...new Set(
          earnings
            .map((row) => asString(driverById.get(row.driverId)?.["zone_id"]) ?? "")
            .filter((id) => id.length > 0),
        ),
      ],
    ),
  ]);

  // The SQL's window partition: the per-driver period total is the sum over the
  // **scoped** rows, so the filter being applied to the rows also applies to the
  // total printed beside them.
  const scoped = earnings.filter((row) =>
    restaurantId
      ? restaurantIdsOf(driverById.get(row.driverId)).includes(restaurantId)
      : true,
  );

  const periodTotal = new Map<string, number>();
  for (const row of scoped) {
    periodTotal.set(row.driverId, (periodTotal.get(row.driverId) ?? 0) + row.incentiveKwd);
  }

  const rows = scoped
    .map((row) => {
      const driver = driverById.get(row.driverId);
      const zoneId = asString(driver?.["zone_id"]);
      return {
        id: row.id,
        driver_id: row.driverId,
        driver_name: trimmedOrNull(driver?.["name"]) ?? "—",
        employee_id: trimmedOrNull(driver?.["employee_id"]),
        driver_code: trimmedOrNull(driver?.["driver_code"]),
        earn_date: row.earnDate,
        restaurant_name: restaurantNamesFor(driver, restaurantById),
        zone_name: zoneId ? (asString(zoneById.get(zoneId)?.["name"]) ?? null) : null,
        deliveries: row.deliveries,
        applied_rule: row.appliedRule,
        daily_amount_kwd: row.incentiveKwd,
        period_total_kwd: periodTotal.get(row.driverId) ?? 0,
      };
    })
    .sort(
      (a, b) =>
        b.earn_date.localeCompare(a.earn_date) || a.driver_name.localeCompare(b.driver_name),
    );

  return { from, to, rows };
});

/**
 * `list_driver_earnings_daily`.
 *
 * The wallet columns are read from `driver_wallet_entries` rather than the
 * earnings row, because the ledger is the authority on whether a day's credit
 * has been approved — and a wallet row that has not been written yet must read
 * as absent, not as zero.
 */
export const listDriverEarningsDaily = onCall(async (request) => {
  await requireStaff(request, "earnings.view");
  const data = (request.data ?? {}) as Record<string, unknown>;

  const startDate = requireDay(data.startDate ?? data.p_start_date, "date_range");
  const endDate = requireDay(data.endDate ?? data.p_end_date, "date_range");
  if (endDate < startDate) throw new HttpsError("invalid-argument", "invalid_date_range");
  const driverId = trimmedOrNull(data.driverId ?? data.p_driver_id);

  const db = getFirestore();
  let query = db
    .collection(COLLECTIONS.driverEarningsDaily)
    .where("earn_date", ">=", startDate)
    .where("earn_date", "<=", endDate);
  if (driverId) query = query.where("driver_id", "==", driverId);

  let walletQuery = db
    .collection(COLLECTIONS.driverWalletEntries)
    .where("earn_date", ">=", startDate)
    .where("earn_date", "<=", endDate)
    .where("entry_type", "==", "earning_credit");
  if (driverId) walletQuery = walletQuery.where("driver_id", "==", driverId);

  const [earningsSnap, walletSnap] = await Promise.all([
    query.limit(SCAN_CAP).get(),
    walletQuery.limit(SCAN_CAP).get(),
  ]);

  const walletByDriverDay = new Map<string, Record<string, unknown>>();
  for (const doc of walletSnap.docs) {
    const raw = doc.data() ?? {};
    const rowDriverId = asString(raw["driver_id"]);
    const earnDate = asString(raw["earn_date"]);
    if (!rowDriverId || !earnDate) continue;
    walletByDriverDay.set(`${rowDriverId}|${earnDate}`, raw);
  }

  const earnings = earningsSnap.docs.map((doc) => {
    const raw = doc.data() ?? {};
    return {
      id: doc.id,
      raw,
      driverId: asString(raw["driver_id"]) ?? "",
      earnDate: asString(raw["earn_date"]) ?? "",
    };
  });

  const driverById = await loadMap(
    COLLECTIONS.drivers,
    earnings.map((row) => row.driverId),
  );

  const rows = earnings
    .filter((row) => row.driverId.length > 0 && row.earnDate.length > 0)
    .map((row) => {
      const raw = row.raw;
      const driver = driverById.get(row.driverId);
      const wallet = walletByDriverDay.get(`${row.driverId}|${row.earnDate}`);
      return {
        id: row.id,
        driver_id: row.driverId,
        driver_code: trimmedOrNull(driver?.["driver_code"]),
        driver_name: trimmedOrNull(driver?.["name"]) ?? "—",
        earn_date: row.earnDate,
        deliveries: asNumber(raw["deliveries"]),
        base_kwd: asNumber(raw["base_kwd"]),
        incentive_kwd: asNumber(raw["incentive_kwd"]),
        loan_deduction_kwd: asNumber(raw["loan_deduction_kwd"]),
        penalty_kwd: asNumber(raw["penalty_kwd"]),
        reimbursement_kwd: asNumber(raw["reimbursement_kwd"]),
        net_kwd: asNumber(raw["net_kwd"]),
        wallet_amount_kwd: wallet ? asNumber(wallet["amount_kwd"]) : null,
        wallet_status: wallet ? (asString(wallet["status"]) ?? null) : null,
      };
    })
    .sort(
      (a, b) =>
        b.earn_date.localeCompare(a.earn_date) || a.driver_name.localeCompare(b.driver_name),
    );

  return { start_date: startDate, end_date: endDate, rows };
});

/* ---------------------------------------------------------------------------
 * Recalculation, wallet sync and the earnings detail / preview readers.
 *
 * These five RPCs are one family: `recalculate_*` writes the earnings row and
 * (through the wallet sync) the ledger entry for it, and the two readers answer
 * the same question without writing — `get_driver_earnings_detail` for one
 * rider-day and `preview_driver_earnings` for a whole day's roster. Both readers
 * deliberately reproduce the **legacy** pricing loop rather than the one the
 * writers use, because that is what the SQL they replace does; the divergence is
 * recorded on `legacyIncentiveFor` below rather than quietly "fixed".
 * ------------------------------------------------------------------------- */

/** The earnings row's id — the SQL `(driver_id, earn_date)` primary key. */
function earningsDocId(driverId: string, earnDate: string): string {
  return `${driverId}_${earnDate}`;
}

/** The wallet ledger's `source_ref`, which is also its doc id: idempotent by construction. */
function walletSourceRef(driverId: string, earnDate: string): string {
  return `earning:${driverId}:${earnDate}`;
}

/** A `date` column that may arrive as `YYYY-MM-DD` or as a Timestamp. */
function dayOrNull(value: unknown): string | null {
  if (typeof value === "string") {
    const text = value.slice(0, 10);
    return DAY_RE.test(text) ? text : null;
  }
  return null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toIso(value: unknown): string | null {
  if (typeof value === "string") return value.length ? value : null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value && typeof value === "object" && "toDate" in (value as object)) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

/**
 * The outsourced company governing a rider's pay, or null when there is none.
 *
 * `source_companies` is keyed by its own `key` in the previous schema, but no
 * document-id convention for this collection is recorded anywhere in this repo,
 * so the read accepts either shape: the id first, then a `key` equality query.
 * That is deliberate rather than a guess — pricing an outsourced rider as if
 * they were in-house is silent (the company scheme simply never applies), and one
 * extra read on a miss is cheaper than a wrong payslip.
 */
async function loadSourceCompanyConfig(key: string): Promise<SourceCompanyConfig | null> {
  const db = getFirestore();
  const byId = await db.collection(COLLECTIONS.sourceCompanies).doc(key).get();
  let raw: Record<string, unknown> | null = byId.exists ? (byId.data() ?? {}) : null;
  if (raw === null) {
    const snap = await db
      .collection(COLLECTIONS.sourceCompanies)
      .where("key", "==", key)
      .limit(1)
      .get();
    if (!snap.empty) raw = snap.docs[0].data() ?? {};
  }
  if (raw === null) return null;

  return {
    key: trimmedOrNull(raw["key"]) ?? key,
    name: trimmedOrNull(raw["name"]) ?? key,
    incentive_enabled: raw["incentive_enabled"] === true,
    dpd_target: nullableNumber(raw["dpd_target"]),
    incentive_above_kwd: nullableNumber(raw["incentive_above_kwd"]),
    incentive_below_kwd: nullableNumber(raw["incentive_below_kwd"]),
    effective_from: dayOrNull(raw["effective_from"]),
  };
}

/**
 * `sync_driver_wallet_earning_credit` — one ledger row per rider-day, upserted.
 *
 * Returns early when there is no earnings row, which is what the SQL does and
 * what makes a blanket re-credit impossible: the ledger can only ever mirror a
 * row an admin can see.
 */
export async function syncDriverWalletEarningCredit(args: {
  driverId: string;
  earnDate: string;
  approvedBy?: string | null;
}): Promise<void> {
  const { driverId, earnDate } = args;
  const db = getFirestore();

  const earningsSnap = await db
    .collection(COLLECTIONS.driverEarningsDaily)
    .doc(earningsDocId(driverId, earnDate))
    .get();
  if (!earningsSnap.exists) return;

  const row = earningsSnap.data() ?? {};
  const sourceRef = walletSourceRef(driverId, earnDate);
  const walletRef = db.collection(COLLECTIONS.driverWalletEntries).doc(sourceRef);
  const walletSnap = await walletRef.get();
  const existing = walletSnap.data() ?? {};
  const net = asNumber(row["net_kwd"]);

  await walletRef.set({
    id: sourceRef,
    driver_id: driverId,
    earn_date: earnDate,
    entry_type: "earning_credit",
    amount_kwd: Math.max(net, 0),
    status: "approved",
    source_ref: sourceRef,
    approved_at: FieldValue.serverTimestamp(),
    approved_by: args.approvedBy ?? asString(existing["approved_by"]),
    meta: {
      deliveries: asNumber(row["deliveries"]),
      base_kwd: asNumber(row["base_kwd"]),
      incentive_kwd: asNumber(row["incentive_kwd"]),
      loan_deduction_kwd: asNumber(row["loan_deduction_kwd"]),
      penalty_kwd: asNumber(row["penalty_kwd"]),
      reimbursement_kwd: asNumber(row["reimbursement_kwd"]),
      net_kwd: net,
    },
    created_at: existing["created_at"] ?? FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
}

/** One rule line as the *writer's* breakdown records it. */
function recalcRuleLine(args: {
  rule: IncentiveRule;
  eligible: number;
  amount: number;
  accrues: boolean;
  context: IncentiveContext;
}): Record<string, unknown> {
  const { rule, eligible, amount, accrues, context } = args;
  return {
    rule_id: rule.id,
    rule_name: rule.name,
    period: rule.period,
    eligible_count: eligible,
    target_mode: rule.target_mode,
    base_minimum: rule.base_minimum_deliveries,
    target: rule.target_deliveries,
    reward_mode: rule.reward_mode,
    payout_mode: rule.payout_mode,
    overrides_others: rule.overrides_others,
    priority: rule.priority,
    amount_kwd: amount,
    accrues_on_date: accrues,
    tiers: tierLines(rule, eligible, context),
  };
}

function tierLines(
  rule: IncentiveRule,
  eligible: number,
  context: IncentiveContext,
): Record<string, unknown>[] {
  if (rule.target_mode !== "tiered") return [];
  return [...(context.tiersByRule.get(rule.id) ?? [])]
    .sort((a, b) => a.threshold_deliveries - b.threshold_deliveries)
    .map((tier) => ({
      threshold: tier.threshold_deliveries,
      reward_mode: tier.reward_mode,
      met: eligible >= tier.threshold_deliveries,
    }));
}

/** `delivery_matches_rules` for a delivery on the day being priced. */
function deliveryMatches(delivery: RawDelivery, checkDate: string, context: IncentiveContext): boolean {
  return deliveryMatchesRules({
    delivery: {
      status: delivery.status,
      zone_id: delivery.zone_id,
      partner_id: delivery.partner_id,
      scope_restaurant_id: delivery.restaurant_id,
    },
    checkDate,
    deliveryRules: context.deliveryRules,
    deliveryScopesByRule: context.deliveryScopesByRule,
  });
}

type RecalcOutcome = {
  recalculated: boolean;
  reason?: string;
  deliveries: number;
  incentive_kwd: number;
  net_kwd: number;
};

/**
 * `recalculate_driver_earnings` — prices one rider-day and writes the earnings
 * row plus its wallet credit.
 *
 * Manual adjustments are read from the existing row and written back unchanged:
 * a recalculation recomputes what the engine owes, and must never clear a loan
 * deduction or a penalty an admin entered by hand.
 */
export async function recalculateDriverEarningsCore(args: {
  driverId: string;
  earnDate: string;
  approvedBy?: string | null;
  context: IncentiveContext;
  companyCache: Map<string, SourceCompanyConfig | null>;
}): Promise<RecalcOutcome> {
  const { driverId, earnDate, context, companyCache } = args;
  const db = getFirestore();

  const driverSnap = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
  if (!driverSnap.exists) {
    return { recalculated: false, reason: "driver_not_found", deliveries: 0, incentive_kwd: 0, net_kwd: 0 };
  }
  const driver = driverSnap.data() ?? {};

  const earningsRef = db.collection(COLLECTIONS.driverEarningsDaily).doc(earningsDocId(driverId, earnDate));
  const existingSnap = await earningsRef.get();
  const existing = existingSnap.data() ?? {};

  const base = roundKwd(asNumber(driver["base_earnings_kwd"]));
  const loan = roundKwd(asNumber(existing["loan_deduction_kwd"]));
  const penalty = roundKwd(asNumber(existing["penalty_kwd"]));
  const reimbursement = roundKwd(asNumber(existing["reimbursement_kwd"]));

  const companyKey = trimmedOrNull(driver[FIELDS.drivers.sourceCompany]);
  if (companyKey && !companyCache.has(companyKey)) {
    companyCache.set(companyKey, await loadSourceCompanyConfig(companyKey));
  }
  const company = companyKey ? (companyCache.get(companyKey) ?? null) : null;
  const outsourced = companyConfigApplies({
    riderCategory: trimmedOrNull(driver["rider_category"]),
    company,
    onDate: earnDate,
  });

  const dayDeliveries = await loadVerifiedDeliveriesForDeliveredDay(driverId, earnDate);

  let deliveries = 0;
  let incentive = 0;
  let breakdown: Record<string, unknown>[] = [];

  if (outsourced && company) {
    // The company scheme prices **every** verified delivery for the day, across
    // all restaurants: an outsourced rider is contracted to the company, and
    // restaurant rules are not theirs to earn on.
    deliveries = dayDeliveries.length;
    if (company.incentive_enabled && company.dpd_target !== null) {
      const scheme = computeSourceCompanyIncentive(
        deliveries,
        company.dpd_target,
        company.incentive_above_kwd,
        company.incentive_below_kwd,
      );
      incentive = roundKwd(scheme.net_kwd);
      breakdown = [
        {
          kind: "source_company",
          company_key: company.key,
          company_name: company.name,
          deliveries,
          target: company.dpd_target,
          above_kwd: company.incentive_above_kwd,
          below_kwd: company.incentive_below_kwd,
          incentive_kwd: roundKwd(scheme.incentive_kwd),
          deduction_kwd: roundKwd(scheme.deduction_kwd),
          net_kwd: roundKwd(scheme.net_kwd),
        },
      ];
    }
  } else {
    deliveries = dayDeliveries.filter((delivery) => deliveryMatches(delivery, earnDate, context)).length;

    const rules = context.rules
      .filter((rule) => ruleAppliesOnDate(rule, earnDate, context.rules, context.restaurantIdsOf))
      .sort(compareRulesForLoop);

    let overrideAmount = -1;
    let overridePriority = -1;
    let overrideRuleId: string | null = null;

    for (const rule of rules) {
      const accrues = incentiveAccruesOnDate(rule.period, earnDate);
      const eligible = countEligibleDeliveries({
        driverId,
        earnDate,
        ruleId: rule.id,
        context,
        deliveries: dayDeliveries,
        scopeRestaurantIdOf: (delivery) => delivery.restaurant_id,
      });
      let amount = roundKwd(
        computeIncentiveAmount({
          rule,
          tiers: context.tiersByRule.get(rule.id) ?? [],
          eligibleCount: eligible,
          gateTarget: dpdTargetForRule(context, rule.id, earnDate),
        }),
      );
      // A rule whose period does not accrue today still records its line, but
      // pays nothing — crediting it early would pay a weekly rule seven times.
      if (!accrues) amount = 0;

      if (rule.overrides_others && amount > 0 && rule.priority > overridePriority) {
        overrideAmount = amount;
        overridePriority = rule.priority;
        overrideRuleId = rule.id;
      }
      if (amount > 0 || (accrues && eligible > 0)) {
        breakdown.push(recalcRuleLine({ rule, eligible, amount, accrues, context }));
      }
      incentive = roundKwd(incentive + amount);
    }

    if (overrideAmount >= 0) {
      incentive = overrideAmount;
      breakdown.push({
        override_rule_id: overrideRuleId,
        note: "override_applied",
        final_incentive_kwd: overrideAmount,
      });
    }
  }

  const net = roundKwd(base + incentive - loan - penalty + reimbursement);

  await earningsRef.set({
    id: earningsDocId(driverId, earnDate),
    driver_id: driverId,
    earn_date: earnDate,
    deliveries,
    base_kwd: base,
    incentive_kwd: incentive,
    loan_deduction_kwd: loan,
    penalty_kwd: penalty,
    reimbursement_kwd: reimbursement,
    net_kwd: net,
    breakdown,
    calculated_at: FieldValue.serverTimestamp(),
    created_at: existing["created_at"] ?? FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });

  await syncDriverWalletEarningCredit({ driverId, earnDate, approvedBy: args.approvedBy ?? null });

  for (const delivery of dayDeliveries) {
    await applyDeliveryRollup(db, {
      deliveryId: delivery.id,
      driverId,
      zoneId: delivery.zone_id,
      day: delivery.shift_date ?? earnDate,
      status: "verified",
    });
  }

  return { recalculated: true, deliveries, incentive_kwd: incentive, net_kwd: net };
}

/** `recalculate_driver_earnings(p_driver_id, p_earn_date, p_approved_by)`. */
export const recalculateDriverEarnings = onCall(async (request) => {
  await requireStaff(request, "earnings.manage");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const driverId = trimmedOrNull(data["driverId"] ?? data["p_driver_id"]);
  if (!driverId) throw new HttpsError("invalid-argument", "invalid_driver_id");
  const earnDate = requireDay(data["earnDate"] ?? data["p_earn_date"], "earn_date");
  const approvedBy = trimmedOrNull(data["approvedBy"] ?? data["p_approved_by"]);
  const context = await loadIncentiveContext();

  return recalculateDriverEarningsCore({
    driverId,
    earnDate,
    approvedBy,
    context,
    companyCache: new Map(),
  });
});

/**
 * `recalculate_earnings_for_date` — every rider who actually delivered that day.
 *
 * The roster comes from the deliveries themselves, not from every driver on the
 * books: recreating an empty earnings row for a rider who never worked would put
 * a zero day on their record that payroll then has to explain.
 */
export const recalculateEarningsForDate = onCall(async (request) => {
  await requireStaff(request, "earnings.manage");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const earnDate = requireDay(data["earnDate"] ?? data["p_earn_date"], "earn_date");

  const [driverIds, context] = await Promise.all([
    loadVerifiedDriverIdsForDeliveredDay(earnDate),
    loadIncentiveContext(),
  ]);
  const companyCache = new Map<string, SourceCompanyConfig | null>();

  for (const driverId of driverIds) {
    await recalculateDriverEarningsCore({ driverId, earnDate, context, companyCache });
  }

  return { earn_date: earnDate, recalculated_drivers: driverIds.length };
});

/**
 * `recalculate_earnings_for_range` — the same, swept day by day.
 *
 * The range is capped at 400 days for the reason the panel's own All-Time preset
 * is refused above 400: this is one callable doing a per-driver, per-day write,
 * and a silently truncated sweep is the same failure as a silently short report.
 * With `driverId` the sweep is one rider across the window, which is what the
 * earnings detail page asks for when it recalculates.
 */
export const recalculateEarningsForRange = onCall(async (request) => {
  await requireStaff(request, "earnings.manage");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const startDate = requireDay(data["startDate"] ?? data["p_start_date"], "date_range");
  const endDate = requireDay(data["endDate"] ?? data["p_end_date"], "date_range");
  if (endDate < startDate) throw new HttpsError("invalid-argument", "invalid_date_range");
  if (daysBetween(startDate, endDate) > MAX_RANGE_DAYS) {
    throw new HttpsError("invalid-argument", "range_too_large");
  }
  const driverId = trimmedOrNull(data["driverId"] ?? data["p_driver_id"]);
  const context = await loadIncentiveContext();
  const companyCache = new Map<string, SourceCompanyConfig | null>();

  let count = 0;
  for (const day of kuwaitDayRange(startDate, endDate)) {
    const driverIds = driverId
      ? (await loadVerifiedDeliveriesForDeliveredDay(driverId, day)).length > 0
        ? [driverId]
        : []
      : await loadVerifiedDriverIdsForDeliveredDay(day);

    for (const id of driverIds) {
      await recalculateDriverEarningsCore({ driverId: id, earnDate: day, context, companyCache });
      count += 1;
    }
  }

  return { start_date: startDate, end_date: endDate, recalculated_drivers: count };
});

/* ---------------------------------------------------------------------------
 * The two readers.
 * ------------------------------------------------------------------------- */

/**
 * The **legacy** pricing loop, kept for the readers on purpose.
 *
 * `get_driver_earnings_detail` and `preview_driver_earnings` call the 2-argument
 * `compute_incentive_amount(rule, count)` upstream, which differs from the
 * writer's loop in three ways, and the SQL has all three:
 *
 *  1. only `status = 'active'` rules whose window covers the day are considered
 *     — an *ended* rule that was replaced still pays its original days in the
 *     writer, but is absent from this list;
 *  2. no `incentive_rule_applies_on_date` overlap resolution;
 *  3. the DPD gate is resolved **at Kuwait `today`**, not at `earn_date`
 *     (`current_date` in the 2-arg function), so a rule added after a past day
 *     is gated by a target that did not exist then.
 *
 * Those are divergences, not features, and the readers are the surfaces an admin
 * uses to *reconcile* a payout — so they are reproduced rather than quietly
 * corrected here. Fixing them is a change to what the panel reports and needs
 * its own decision.
 */
function legacyIncentiveFor(args: {
  driverId: string;
  earnDate: string;
  dayDeliveries: readonly RawDelivery[];
  context: IncentiveContext;
  /** `false` omits `priority` and adds `reward_kwd`, matching each reader's shape. */
  forDetail: boolean;
}): { incentive: number; lines: Record<string, unknown>[] } {
  const { driverId, earnDate, dayDeliveries, context } = args;
  const today = kuwaitDayString(new Date());

  const rules = context.rules
    .filter(
      (rule) =>
        rule.status === "active" && earnDate >= rule.start_date && earnDate <= rule.end_date,
    )
    .sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  let incentive = 0;
  let overrideAmount = -1;
  let overridePriority = -1;
  let overrideRuleId: string | null = null;
  const lines: Record<string, unknown>[] = [];

  for (const rule of rules) {
    const eligible = countEligibleDeliveries({
      driverId,
      earnDate,
      ruleId: rule.id,
      context,
      deliveries: dayDeliveries,
      scopeRestaurantIdOf: (delivery) => delivery.restaurant_id,
    });
    const amount = roundKwd(
      computeIncentiveAmount({
        rule,
        tiers: context.tiersByRule.get(rule.id) ?? [],
        eligibleCount: eligible,
        gateTarget: dpdTargetForRule(context, rule.id, today),
      }),
    );
    if (amount <= 0) continue;

    incentive = roundKwd(incentive + amount);
    if (rule.overrides_others && rule.priority > overridePriority) {
      overrideAmount = amount;
      overridePriority = rule.priority;
      overrideRuleId = rule.id;
    }
    lines.push({
      rule_id: rule.id,
      rule_name: rule.name,
      period: rule.period,
      eligible_count: eligible,
      target_mode: rule.target_mode,
      base_minimum: rule.base_minimum_deliveries,
      target: rule.target_deliveries,
      reward_mode: rule.reward_mode,
      payout_mode: rule.payout_mode,
      overrides_others: rule.overrides_others,
      ...(args.forDetail ? { priority: rule.priority } : { reward_kwd: amount }),
      amount_kwd: amount,
      tiers: tierLines(rule, eligible, context),
    });
  }

  if (overrideAmount >= 0) {
    incentive = overrideAmount;
    lines.push({
      override_rule_id: overrideRuleId,
      note: "override_applied",
      final_incentive_kwd: overrideAmount,
    });
  }

  return { incentive, lines };
}

/**
 * `get_driver_earnings_detail` — the stored day, its wallet row, and what the
 * priced deliveries say it should have been.
 *
 * The stored row and the recomputed figure are returned **side by side** rather
 * than one overwriting the other: the whole point of this screen is to show an
 * admin where the two disagree.
 */
export const getDriverEarningsDetail = onCall(async (request) => {
  await requireStaff(request, "earnings.view");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const driverId = trimmedOrNull(data["driverId"] ?? data["p_driver_id"]);
  if (!driverId) throw new HttpsError("invalid-argument", "invalid_driver_id");
  const earnDate = requireDay(data["earnDate"] ?? data["p_earn_date"], "earn_date");

  const db = getFirestore();
  const context = await loadIncentiveContext();

  const [dailySnap, walletSnap, dayDeliveries] = await Promise.all([
    db.collection(COLLECTIONS.driverEarningsDaily).doc(earningsDocId(driverId, earnDate)).get(),
    db
      .collection(COLLECTIONS.driverWalletEntries)
      .where("driver_id", "==", driverId)
      .where("earn_date", "==", earnDate)
      .where("entry_type", "==", "earning_credit")
      .limit(1)
      .get(),
    loadVerifiedDeliveriesForDeliveredDay(driverId, earnDate),
  ]);

  const dailyRaw = dailySnap.exists ? (dailySnap.data() ?? {}) : null;
  const walletDoc = walletSnap.docs[0] ?? null;
  const walletRaw = walletDoc ? (walletDoc.data() ?? {}) : null;

  const eligible = dayDeliveries.filter((delivery) => deliveryMatches(delivery, earnDate, context)).length;
  const legacy = legacyIncentiveFor({ driverId, earnDate, dayDeliveries, context, forDetail: true });

  const [partnerById, restaurantById, zoneById] = await Promise.all([
    loadMap(
      COLLECTIONS.partners,
      dayDeliveries.map((delivery) => delivery.partner_id).filter((id): id is string => Boolean(id)),
    ),
    loadMap(
      COLLECTIONS.restaurants,
      dayDeliveries.map((delivery) => delivery.restaurant_id).filter((id): id is string => Boolean(id)),
    ),
    loadMap(
      COLLECTIONS.zones,
      dayDeliveries.map((delivery) => delivery.zone_id).filter((id): id is string => Boolean(id)),
    ),
  ]);

  return {
    driver_id: driverId,
    earn_date: earnDate,
    daily: dailyRaw
      ? {
          driver_id: driverId,
          earn_date: earnDate,
          deliveries: asNumber(dailyRaw["deliveries"]),
          base_kwd: asNumber(dailyRaw["base_kwd"]),
          incentive_kwd: asNumber(dailyRaw["incentive_kwd"]),
          loan_deduction_kwd: asNumber(dailyRaw["loan_deduction_kwd"]),
          penalty_kwd: asNumber(dailyRaw["penalty_kwd"]),
          reimbursement_kwd: asNumber(dailyRaw["reimbursement_kwd"]),
          net_kwd: asNumber(dailyRaw["net_kwd"]),
          breakdown: dailyRaw["breakdown"] ?? [],
          calculated_at: toIso(dailyRaw["calculated_at"]),
          updated_at: toIso(dailyRaw["updated_at"]),
        }
      : null,
    wallet: walletRaw
      ? {
          id: walletDoc?.id ?? walletSourceRef(driverId, earnDate),
          amount_kwd: asNumber(walletRaw["amount_kwd"]),
          status: asString(walletRaw["status"]),
          approved_at: toIso(walletRaw["approved_at"]),
          source_ref: asString(walletRaw["source_ref"]) ?? walletSourceRef(driverId, earnDate),
        }
      : null,
    eligible_deliveries_count: eligible,
    computed_incentive_kwd: legacy.incentive,
    deliveries: [...dayDeliveries]
      .sort((a, b) => {
        const aAt = a.delivered_at ? a.delivered_at.getTime() : 0;
        const bAt = b.delivered_at ? b.delivered_at.getTime() : 0;
        if (aAt !== bAt) return bAt - aAt;
        return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
      })
      .map((delivery) => ({
        id: delivery.id,
        external_order_id: delivery.external_order_id,
        status: delivery.status,
        delivered_at: delivery.delivered_at ? delivery.delivered_at.toISOString() : null,
        partner_id: delivery.partner_id,
        partner_name: delivery.partner_id
          ? asString(partnerById.get(delivery.partner_id)?.["name"])
          : null,
        restaurant_id: delivery.restaurant_id,
        restaurant_name: delivery.restaurant_id
          ? asString(restaurantById.get(delivery.restaurant_id)?.["name"])
          : null,
        zone_id: delivery.zone_id,
        zone_name: delivery.zone_id ? asString(zoneById.get(delivery.zone_id)?.["name"]) : null,
        counts_for_earnings: deliveryMatches(delivery, earnDate, context),
      })),
    rules: legacy.lines,
  };
});

/**
 * `preview_driver_earnings` — what the day would pay, for every rider who worked.
 *
 * Read-only by design: it answers "what is this date about to cost" before an
 * admin runs the sweep that writes it.
 */
export const previewDriverEarnings = onCall(async (request) => {
  await requireStaff(request, "earnings.view");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const earnDate = requireDay(data["earnDate"] ?? data["p_earn_date"], "earn_date");

  const context = await loadIncentiveContext();
  const driverIds = await loadVerifiedDriverIdsForDeliveredDay(earnDate);
  const rows: Record<string, unknown>[] = [];

  for (const driverId of driverIds) {
    const dayDeliveries = await loadVerifiedDeliveriesForDeliveredDay(driverId, earnDate);
    const legacy = legacyIncentiveFor({ driverId, earnDate, dayDeliveries, context, forDetail: false });
    rows.push({
      driver_id: driverId,
      deliveries: dayDeliveries.filter((delivery) => deliveryMatches(delivery, earnDate, context)).length,
      incentive_kwd: legacy.incentive,
      rules: legacy.lines,
    });
  }

  // The SQL appended in whatever order the drivers were read; an explicit key
  // keeps two runs of the same preview comparable.
  rows.sort((a, b) => String(a["driver_id"]).localeCompare(String(b["driver_id"])));

  return { earn_date: earnDate, drivers: rows };
});
