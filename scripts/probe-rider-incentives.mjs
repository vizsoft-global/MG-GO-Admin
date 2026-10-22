/**
 * Read-only probe: why does an Active delivery rule / incentive rule not reach
 * the rider app?
 *
 * Mirrors the functions' decisions for one rider — scope matching (legacy FK
 * union junction), the restaurant → zone → partner target chain, the eligible /
 * progress counts and the outsourced company gate — and prints a verdict for
 * each. It writes nothing: every call is a `get()`.
 *
 *   node scripts/probe-rider-incentives.mjs <employee_id|driver_id|name>
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const needle = (process.argv[2] ?? "").trim();
if (!needle) {
  console.error("usage: node scripts/probe-rider-incentives.mjs <employee_id|driver_id|name>");
  process.exit(1);
}

const PROGRESS_STATUSES = new Set(["in_transit", "pending", "under_review", "verified"]);

function kuwaitYmd(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

const TODAY = kuwaitYmd(new Date());

function asString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asDay(value) {
  if (typeof value === "string") return value.slice(0, 10);
  if (value && typeof value.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  return null;
}

function asNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function addDays(day, delta) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** `periodStart` from functions/src/core/money.ts (weekly = ISO week). */
function periodStart(period, earnDate) {
  if (period === "weekly") {
    const dow = new Date(`${earnDate}T00:00:00Z`).getUTCDay();
    const iso = dow === 0 ? 7 : dow;
    return addDays(earnDate, -((iso + 6) % 7));
  }
  if (period === "monthly") return `${earnDate.slice(0, 7)}-01`;
  return earnDate;
}

function dayOf(delivery) {
  if (delivery.shift_date) return delivery.shift_date;
  const instant = delivery.delivered_at ?? delivery.pickup_at;
  return instant ? kuwaitYmd(instant) : null;
}

async function findDrivers() {
  const found = new Map();
  const byId = await db.collection("drivers").doc(needle).get();
  if (byId.exists) found.set(byId.id, byId.data() ?? {});

  if (found.size === 0) {
    for (const field of ["employee_id", "driver_code"]) {
      const snap = await db.collection("drivers").where(field, "==", needle).limit(5).get();
      for (const doc of snap.docs) found.set(doc.id, doc.data() ?? {});
    }
  }

  if (found.size === 0) {
    const lower = needle.toLowerCase();
    const snap = await db.collection("drivers").limit(5_000).get();
    for (const doc of snap.docs) {
      const data = doc.data() ?? {};
      const hay = [data.employee_id, data.driver_code, data.full_name, data.name, data.phone]
        .filter((value) => typeof value === "string")
        .join(" | ")
        .toLowerCase();
      if (hay.includes(lower)) found.set(doc.id, data);
    }
  }

  return [...found.entries()].map(([id, data]) => ({ id, data }));
}

// ------------------------------------------------------------ config ----

const configSnaps = await Promise.all([
  db.collection("delivery_rules").limit(20_000).get(),
  db.collection("delivery_rule_scopes").limit(20_000).get(),
  db.collection("incentive_rules").limit(20_000).get(),
  db.collection("incentive_rule_scopes").limit(20_000).get(),
  db.collection("incentive_rule_tiers").limit(20_000).get(),
  db.collection("source_companies").limit(2_000).get(),
]);
const [
  deliveryRulesSnap,
  deliveryScopesSnap,
  incentiveRulesSnap,
  incentiveScopesSnap,
  tiersSnap,
  companiesSnap,
] = configSnaps;

function normaliseRule(doc) {
  const raw = doc.data() ?? {};
  return {
    id: doc.id,
    name: asString(raw.name) ?? "—",
    status: asString(raw.status) ?? "draft",
    scope_type: asString(raw.scope_type) ?? "restaurant",
    priority: asNumber(raw.priority),
    created_at: asString(raw.created_at) ?? "",
    start_date: asDay(raw.start_date) ?? "1970-01-01",
    end_date: asDay(raw.end_date) ?? "9999-12-31",
    dpd_target: typeof raw.dpd_target === "number" ? raw.dpd_target : null,
    dpd_period: asString(raw.dpd_period),
    zone_id: asString(raw.zone_id),
    partner_id: asString(raw.partner_id),
    restaurant_id: asString(raw.restaurant_id),
    period: asString(raw.period) ?? "daily",
    target_mode: asString(raw.target_mode) ?? "single",
    base_minimum_deliveries:
      typeof raw.base_minimum_deliveries === "number" ? raw.base_minimum_deliveries : null,
    target_deliveries: typeof raw.target_deliveries === "number" ? raw.target_deliveries : null,
  };
}

function scopeMap(snap, foreignKey) {
  const map = new Map();
  for (const doc of snap.docs) {
    const raw = doc.data() ?? {};
    const ruleId = asString(raw[foreignKey]);
    if (!ruleId) continue;
    map.set(ruleId, [
      ...(map.get(ruleId) ?? []),
      {
        zone_id: asString(raw.zone_id),
        partner_id: asString(raw.partner_id),
        restaurant_id: asString(raw.restaurant_id),
      },
    ]);
  }
  return map;
}

const deliveryRules = deliveryRulesSnap.docs.map(normaliseRule);
const deliveryScopesByRule = scopeMap(deliveryScopesSnap, "delivery_rule_id");
const incentiveRules = incentiveRulesSnap.docs.map(normaliseRule);
const incentiveScopesByRule = scopeMap(incentiveScopesSnap, "incentive_rule_id");

const tiersByRule = new Map();
for (const doc of tiersSnap.docs) {
  const raw = doc.data() ?? {};
  const ruleId = asString(raw.incentive_rule_id);
  if (!ruleId) continue;
  tiersByRule.set(ruleId, [
    ...(tiersByRule.get(ruleId) ?? []),
    { threshold_deliveries: asNumber(raw.threshold_deliveries) },
  ]);
}

const companies = new Map();
for (const doc of companiesSnap.docs) {
  const raw = doc.data() ?? {};
  companies.set(doc.id, raw);
  const key = asString(raw.key);
  if (key) companies.set(key, raw);
}

// ------------------------------------------------------------- helpers ----

/** The rule's legacy single-FK column unioned with its junction rows. */
function scopeRows(rule, scopes) {
  const rows = [...scopes];
  if (rule.scope_type === "zone" && rule.zone_id) {
    rows.push({ zone_id: rule.zone_id, partner_id: null, restaurant_id: null });
  } else if (rule.scope_type === "partner" && rule.partner_id) {
    rows.push({ zone_id: null, partner_id: rule.partner_id, restaurant_id: null });
  } else if (rule.scope_type === "restaurant" && rule.restaurant_id) {
    rows.push({ zone_id: null, partner_id: null, restaurant_id: rule.restaurant_id });
  }
  return rows;
}

function scopeIdOf(scopeType, row) {
  if (scopeType === "zone") return row.zone_id;
  if (scopeType === "partner") return row.partner_id;
  return row.restaurant_id;
}

function ruleMatchesScope(rule, scopes, targetId) {
  if (!targetId) return false;
  return scopeRows(rule, scopes).some((row) => {
    const id = scopeIdOf(rule.scope_type, row);
    return id !== null && id === targetId;
  });
}

function ruleMatchesRider(rule, scopes, rider) {
  if (rule.scope_type === "zone") return ruleMatchesScope(rule, scopes, rider.zoneId);
  if (rule.scope_type === "partner") return ruleMatchesScope(rule, scopes, rider.partnerId);
  return rider.restaurantIds.some((id) => ruleMatchesScope(rule, scopes, id));
}

function isDaily(rule) {
  return (
    rule.status === "active" &&
    (rule.dpd_target ?? 0) > 0 &&
    (rule.dpd_period === null || rule.dpd_period === undefined || rule.dpd_period === "daily") &&
    TODAY >= rule.start_date &&
    TODAY <= rule.end_date
  );
}

function pickDailyTarget(candidates) {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  });
  return Math.ceil(sorted[0].dpd_target);
}

function scopedDailyRules(scopeType, scopeId) {
  if (!scopeId) return [];
  return deliveryRules.filter(
    (rule) =>
      isDaily(rule) &&
      rule.scope_type === scopeType &&
      (scopeIdOf(scopeType, rule) === scopeId ||
        (deliveryScopesByRule.get(rule.id) ?? []).some(
          (scope) => scopeIdOf(scopeType, scope) === scopeId,
        )),
  );
}

/** `restaurantDailyDpdTarget`: store, then its zone, then its partner. */
function restaurantTarget(restaurant) {
  return (
    pickDailyTarget(scopedDailyRules("restaurant", restaurant.id)) ??
    pickDailyTarget(scopedDailyRules("zone", restaurant.zoneId)) ??
    pickDailyTarget(scopedDailyRules("partner", restaurant.partnerId))
  );
}

/** `delivery_matches_rules` — the junction only, as the functions read it. */
function deliveryCountsForRules(delivery, checkDate) {
  if (delivery.status !== "verified") return false;
  const active = deliveryRules.filter(
    (rule) => rule.status === "active" && checkDate >= rule.start_date && checkDate <= rule.end_date,
  );
  if (active.length === 0) return true;
  return active.some((rule) => {
    const scopes = deliveryScopesByRule.get(rule.id) ?? [];
    const target =
      rule.scope_type === "zone"
        ? delivery.zone_id
        : rule.scope_type === "partner"
          ? delivery.partner_id
          : delivery.restaurant_id;
    return scopes.some((scope) => {
      const id = scopeIdOf(rule.scope_type, scope);
      return id !== null && id === target;
    });
  });
}

function inPeriod(delivery, startDay, endDay) {
  if (delivery.shift_date) return delivery.shift_date >= startDay && delivery.shift_date <= endDay;
  const day = dayOf(delivery);
  return day !== null && day >= startDay && day <= endDay;
}

function deliveryInScope(rule, delivery, rider) {
  if (rule.scope_type === "zone") return delivery.zone_id === rider.zoneId;
  if (rule.scope_type === "partner") return delivery.partner_id === rider.partnerId;
  return rider.restaurantIds.includes(delivery.restaurant_id);
}

// ---------------------------------------------------------------- probe ----

const drivers = await findDrivers();
console.log(`Kuwait today: ${TODAY}`);
console.log(`drivers matched: ${drivers.length}`);
if (drivers.length === 0) process.exit(1);

for (const { id, data } of drivers) {
  console.log(`\n######## rider ${id}`);
  for (const key of [
    "employee_id",
    "driver_code",
    "full_name",
    "name",
    "rider_category",
    "source_company",
    "zone_id",
    "partner_id",
    "restaurant_id",
    "restaurant_ids",
    "status",
    "is_blocked",
    "archived_at",
  ]) {
    if (data[key] !== undefined) console.log(`  d.${key}: ${JSON.stringify(data[key])}`);
  }

  const junction = await db.collection("driver_restaurants").where("driver_id", "==", id).get();
  const restaurantIds = new Set();
  if (asString(data.restaurant_id)) restaurantIds.add(asString(data.restaurant_id));
  if (Array.isArray(data.restaurant_ids)) {
    for (const rid of data.restaurant_ids) if (asString(rid)) restaurantIds.add(rid);
  }
  for (const doc of junction.docs) {
    const rid = asString((doc.data() ?? {}).restaurant_id);
    console.log(`  driver_restaurants ${doc.id}: ${rid ?? "-"}`);
    if (rid) restaurantIds.add(rid);
  }
  if (restaurantIds.size === 0) {
    console.log("  >>> no assigned restaurant (restaurant-scoped rules cannot match)");
  }

  const restaurantDocs = restaurantIds.size
    ? await db.getAll(
        ...[...restaurantIds]
          .slice(0, 300)
          .map((rid) => db.collection("restaurants").doc(rid)),
      )
    : [];
  const restaurants = restaurantDocs
    .filter((doc) => doc.exists)
    .map((doc) => {
      const raw = doc.data() ?? {};
      return {
        id: doc.id,
        name: asString(raw.name) ?? "—",
        zoneId: asString(raw.zone_id),
        partnerId: asString(raw.partner_id),
        status: asString(raw.status),
        isActive: raw.is_active === true,
      };
    });

  const rider = {
    zoneId: asString(data.zone_id),
    partnerId: asString(data.partner_id),
    restaurantIds: [...restaurantIds],
  };

  console.log("\n  -- restaurants (store → zone → partner target)");
  if (restaurants.length === 0) console.log("    none");
  for (const restaurant of restaurants) {
    console.log(
      `    ${restaurant.id} ${restaurant.name} zone=${restaurant.zoneId ?? "-"} partner=${
        restaurant.partnerId ?? "-"
      } status=${restaurant.status}/${restaurant.isActive} daily_target=${
        restaurantTarget(restaurant) ?? "none"
      }`,
    );
  }

  console.log("\n  -- delivery rules (active today)");
  const activeDeliveryRules = deliveryRules.filter(
    (rule) => rule.status === "active" && TODAY >= rule.start_date && TODAY <= rule.end_date,
  );
  if (activeDeliveryRules.length === 0) console.log("    none");
  for (const rule of activeDeliveryRules) {
    const scopes = deliveryScopesByRule.get(rule.id) ?? [];
    console.log(
      `    ${rule.id} ${JSON.stringify(rule.name)} scope=${rule.scope_type} target=${
        rule.dpd_target ?? "-"
      } period=${rule.dpd_period ?? "null(daily)"} priority=${rule.priority} window=${
        rule.start_date
      }..${rule.end_date} matches_rider=${ruleMatchesRider(rule, scopes, rider)}`,
    );
    console.log(
      `      legacy=${JSON.stringify({
        zone_id: rule.zone_id,
        partner_id: rule.partner_id,
        restaurant_id: rule.restaurant_id,
      })} junction=${JSON.stringify(scopes.slice(0, 6))}${
        scopes.length > 6 ? ` +${scopes.length - 6}` : ""
      }`,
    );
    if (
      rule.status === "active" &&
      (rule.dpd_target ?? 0) > 0 &&
      rule.dpd_period &&
      rule.dpd_period !== "daily"
    ) {
      console.log("      !! dpd_period is not daily — the Daily DPD card ignores this target");
    }
  }

  console.log("\n  -- zone / partner targets above the stores");
  console.log(
    `    rider zone ${rider.zoneId ?? "-"} target=${
      pickDailyTarget(scopedDailyRules("zone", rider.zoneId)) ?? "none"
    }`,
  );
  console.log(
    `    rider partner ${rider.partnerId ?? "-"} target=${
      pickDailyTarget(scopedDailyRules("partner", rider.partnerId)) ?? "none"
    }`,
  );

  const deliveriesSnap = await db
    .collection("deliveries")
    .where("driver_id", "==", id)
    .where("status", "in", [...PROGRESS_STATUSES])
    .limit(2_000)
    .get();
  const deliveries = deliveriesSnap.docs.map((doc) => {
    const raw = doc.data() ?? {};
    return {
      id: doc.id,
      status: asString(raw.status) ?? "",
      shift_date: asDay(raw.shift_date),
      delivered_at:
        raw.delivered_at && typeof raw.delivered_at.toDate === "function"
          ? raw.delivered_at.toDate()
          : null,
      pickup_at:
        raw.pickup_at && typeof raw.pickup_at.toDate === "function"
          ? raw.pickup_at.toDate()
          : null,
      zone_id: asString(raw.zone_id),
      partner_id: asString(raw.partner_id),
      restaurant_id: asString(raw.restaurant_id),
    };
  });

  console.log("\n  -- incentive rules (active today)");
  const activeIncentiveRules = incentiveRules.filter(
    (rule) => rule.status === "active" && TODAY >= rule.start_date && TODAY <= rule.end_date,
  );
  if (activeIncentiveRules.length === 0) console.log("    none");
  const matchingOffers = [];
  for (const rule of activeIncentiveRules) {
    const scopes = incentiveScopesByRule.get(rule.id) ?? [];
    const matched = ruleMatchesRider(rule, scopes, rider);
    if (matched) matchingOffers.push(rule);
    const startDay = periodStart(rule.period, TODAY);
    const eligible = deliveries.filter(
      (delivery) =>
        delivery.status === "verified" &&
        inPeriod(delivery, startDay, TODAY) &&
        deliveryCountsForRules(delivery, TODAY) &&
        deliveryInScope(rule, delivery, rider),
    ).length;
    const progress = deliveries.filter(
      (delivery) =>
        PROGRESS_STATUSES.has(delivery.status) &&
        inPeriod(delivery, startDay, TODAY) &&
        deliveryInScope(rule, delivery, rider),
    ).length;
    const tiers = tiersByRule.get(rule.id) ?? [];
    const target =
      rule.target_mode === "tiered"
        ? Math.max(
            rule.base_minimum_deliveries ?? 0,
            ...tiers.map((tier) => tier.threshold_deliveries),
          )
        : (rule.target_deliveries ?? 0);
    console.log(
      `    ${rule.id} ${JSON.stringify(rule.name)} scope=${rule.scope_type} period=${rule.period} target=${target} eligible_today=${eligible} progress_today=${progress} matches_rider=${matched}`,
    );
    console.log(
      `      legacy=${JSON.stringify({
        zone_id: rule.zone_id,
        partner_id: rule.partner_id,
        restaurant_id: rule.restaurant_id,
      })} junction=${JSON.stringify(scopes.slice(0, 6))}${
        scopes.length > 6 ? ` +${scopes.length - 6}` : ""
      }`,
    );
    if (!matched) {
      console.log("      !! scope does not name this rider — the app will not list this offer");
    }
  }

  console.log("\n  -- company gate");
  const companyKey = asString(data.source_company);
  const company = companyKey ? (companies.get(companyKey) ?? null) : null;
  const riderCategory = asString(data.rider_category);
  const effectiveFrom = company ? asDay(company.effective_from) : null;
  const companyApplies =
    riderCategory === "outsourced" &&
    company !== null &&
    effectiveFrom !== null &&
    TODAY >= effectiveFrom;
  const companyGoverns =
    companyApplies && company.incentive_enabled === true && asNumber(company.dpd_target) > 0;
  console.log(
    `    rider_category=${riderCategory ?? "-"} source_company=${companyKey ?? "-"} company=${
      company ? JSON.stringify(company.name ?? companyKey) : "missing"
    }`,
  );
  console.log(
    `    effective_from=${effectiveFrom ?? "-"} incentive_enabled=${
      company?.incentive_enabled ?? "-"
    } dpd_target=${company?.dpd_target ?? "-"}`,
  );
  console.log(
    `    company_config_applies=${companyApplies} company_scheme_governs=${companyGoverns}`,
  );
  if (!companyGoverns) {
    console.log(
      `    -> Extra Earnings path: rules (${matchingOffers.length} matching offer(s))`,
    );
  } else {
    console.log("    -> Extra Earnings path: company_scheme only (rules suppressed by design)");
  }

  const storeCards = restaurants
    .map((restaurant) => ({ restaurant, target: restaurantTarget(restaurant) }))
    .filter((entry) => entry.target !== null);
  console.log(
    `\n  VERDICT: store cards=${storeCards.length}${
      storeCards.length
        ? ` ${JSON.stringify(storeCards.map((entry) => `${entry.restaurant.name}=${entry.target}`))}`
        : ""
    } | company_governs=${companyGoverns} | offers=${companyGoverns ? 0 : matchingOffers.length}`,
  );
}

process.exit(0);




