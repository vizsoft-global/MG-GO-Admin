import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import { parseId } from "../core/query";
import { requireStaff } from "../core/staff";

const DELIVERY_RULES = COLLECTIONS.deliveryRules;
const DELIVERY_RULE_SCOPES = COLLECTIONS.deliveryRuleScopes;
const INCENTIVE_RULES = COLLECTIONS.incentiveRules;
const INCENTIVE_RULE_SCOPES = COLLECTIONS.incentiveRuleScopes;
const INCENTIVE_RULE_TIERS = COLLECTIONS.incentiveRuleTiers;
const SOURCE_COMPANIES = COLLECTIONS.sourceCompanies;
const RESTAURANTS = COLLECTIONS.restaurants;
const ZONES = COLLECTIONS.zones;
const PARTNERS = COLLECTIONS.partners;
const EXCEPTION_ACTIONS = "attendance_exception_actions";

const COMPANY_KEY_RE = /^[a-z0-9_]{1,24}$/;
const CLIENT_CODE_RE = /^[A-Z0-9-]{1,32}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const FIXED_REWARD_STEP_KWD = 0.5;
const PER_DELIVERY_REWARD_STEP_KWD = 0.05;

type ScopeType = "zone" | "partner" | "restaurant";
type RuleStatus = "draft" | "active" | "ended" | "paused";
type IncentivePeriod = "daily" | "weekly" | "monthly";
type IncentiveTargetMode = "single" | "tiered";
type IncentiveRewardMode = "fixed" | "per_delivery";
type IncentivePayoutMode = "milestone" | "cumulative";

const dbs = () => getFirestore();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(data: Record<string, unknown>, key: string): string {
  const raw = data[key];
  return typeof raw === "string" ? raw.trim() : "";
}

function readNumber(data: Record<string, unknown>, key: string): number | null {
  const raw = data[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readBool(data: Record<string, unknown>, key: string): boolean {
  return data[key] === true;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  ];
}

function docRecord(snap: FirebaseFirestore.DocumentSnapshot): Record<string, unknown> {
  return snap.data() ?? {};
}

function docString(doc: Record<string, unknown>, key: string): string | null {
  const raw = doc[key];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function docNumber(doc: Record<string, unknown>, key: string): number | null {
  const raw = doc[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function instantString(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

function isOnRewardStep(value: number, step: number): boolean {
  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}

function defaultPriority(scopeType: ScopeType): number {
  switch (scopeType) {
    case "restaurant":
      return 30;
    case "partner":
      return 20;
    case "zone":
      return 10;
    default: {
      const exhaustive: never = scopeType;
      return exhaustive;
    }
  }
}

function requireScopeType(value: unknown): ScopeType {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "zone" || text === "partner" || text === "restaurant") return text;
  throw new HttpsError("invalid-argument", "invalid_scope");
}

function requirePeriod(value: unknown): IncentivePeriod {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "daily" || text === "weekly" || text === "monthly") return text;
  throw new HttpsError("invalid-argument", "invalid_period");
}

function requireStatus(value: unknown, fallback: RuleStatus): RuleStatus {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "draft" || text === "active" || text === "ended" || text === "paused") {
    return text;
  }
  return fallback;
}

function dayOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return DAY_RE.test(text) ? text : null;
}

async function scopeExists(scopeType: ScopeType, id: string): Promise<boolean> {
  const collection =
    scopeType === "restaurant" ? RESTAURANTS : scopeType === "zone" ? ZONES : PARTNERS;
  const snap = await dbs().collection(collection).doc(id).get();
  return snap.exists;
}

async function labelMaps(): Promise<{
  zones: Map<string, { name: string; code: string }>;
  partners: Map<string, { name: string }>;
  restaurants: Map<string, { name: string }>;
}> {
  const [zonesSnap, partnersSnap, restaurantsSnap] = await Promise.all([
    dbs().collection(ZONES).get(),
    dbs().collection(PARTNERS).get(),
    dbs().collection(RESTAURANTS).get(),
  ]);
  const zones = new Map<string, { name: string; code: string }>();
  for (const doc of zonesSnap.docs) {
    const data = docRecord(doc);
    zones.set(doc.id, {
      name: docString(data, "name") ?? "—",
      code: docString(data, "code") ?? "",
    });
  }
  const partners = new Map<string, { name: string }>();
  for (const doc of partnersSnap.docs) {
    partners.set(doc.id, { name: docString(docRecord(doc), "name") ?? "—" });
  }
  const restaurants = new Map<string, { name: string }>();
  for (const doc of restaurantsSnap.docs) {
    restaurants.set(doc.id, { name: docString(docRecord(doc), "name") ?? "—" });
  }
  return { zones, partners, restaurants };
}

function scopeLabel(
  scopeType: ScopeType,
  ids: string[],
  maps: Awaited<ReturnType<typeof labelMaps>>,
): string {
  if (ids.length === 0) return "—";
  const labels: string[] = [];
  for (const id of ids) {
    if (scopeType === "zone") {
      const zone = maps.zones.get(id);
      if (zone) labels.push(`${zone.name} (${zone.code})`);
    } else if (scopeType === "partner") {
      const partner = maps.partners.get(id);
      if (partner) labels.push(partner.name);
    } else {
      const restaurant = maps.restaurants.get(id);
      if (restaurant) labels.push(restaurant.name);
    }
  }
  if (labels.length === 0) return "—";
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

async function replaceScopes(
  junction: string,
  parentKey: string,
  parentId: string,
  scopeType: ScopeType,
  ids: string[],
): Promise<void> {
  const db = dbs();
  const existing = await db.collection(junction).where(parentKey, "==", parentId).get();
  const batch = db.batch();
  for (const doc of existing.docs) batch.delete(doc.ref);
  for (const id of ids) {
    const ref = db.collection(junction).doc();
    batch.set(ref, {
      [parentKey]: parentId,
      zone_id: scopeType === "zone" ? id : null,
      partner_id: scopeType === "partner" ? id : null,
      restaurant_id: scopeType === "restaurant" ? id : null,
    });
  }
  await batch.commit();
}

function assertDates(start: string | null, end: string | null): { startDate: string; endDate: string } {
  if (!start || !end) throw new HttpsError("invalid-argument", "missing_fields");
  if (end < start) throw new HttpsError("invalid-argument", "invalid_dates");
  return { startDate: start, endDate: end };
}

/**
 * `admin_insert_delivery_rule_with_scope` — inserts one active delivery rule and
 * its single scope in one transaction. Priority is locked: restaurant 30, zone 10.
 */
export const adminInsertDeliveryRuleWithScope = onCall(async (request) => {
  await requireStaff(request, "earnings.manage");

  const data = asRecord(request.data);
  const name = readString(data, "name");
  const scopeType = requireScopeType(data.scopeType);
  const scopeId = parseId(data.scopeId);
  if (!name || !scopeId) throw new HttpsError("invalid-argument", "missing_fields");

  const dpdTarget = readNumber(data, "dpdTarget");
  if (dpdTarget === null || dpdTarget <= 0) {
    throw new HttpsError("invalid-argument", "invalid_target");
  }
  const period = requirePeriod(data.dpdPeriod);

  const today = kuwaitDayString(new Date());
  const startDate = dayOrNull(data.startDate) ?? today;
  const endDate = dayOrNull(data.endDate) ?? "2099-12-31";
  if (endDate < startDate) throw new HttpsError("invalid-argument", "invalid_dates");

  if (!(await scopeExists(scopeType, scopeId))) {
    throw new HttpsError("invalid-argument", "unknown_scope");
  }

  const db = dbs();
  const ruleRef = db.collection(DELIVERY_RULES).doc();
  const batch = db.batch();
  batch.set(ruleRef, {
    name,
    status: "active",
    scope_type: scopeType,
    zone_id: scopeType === "zone" ? scopeId : null,
    partner_id: null,
    restaurant_id: scopeType === "restaurant" ? scopeId : null,
    start_date: startDate,
    end_date: endDate,
    priority: defaultPriority(scopeType),
    require_verified: true,
    dpd_target: dpdTarget,
    dpd_period: period,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
  const scopeRef = db.collection(DELIVERY_RULE_SCOPES).doc();
  batch.set(scopeRef, {
    delivery_rule_id: ruleRef.id,
    zone_id: scopeType === "zone" ? scopeId : null,
    partner_id: null,
    restaurant_id: scopeType === "restaurant" ? scopeId : null,
  });
  await batch.commit();

  return ruleRef.id;
});

/** `admin_upsert_source_company` — keyed on the lowercased key. */
export const adminUpsertSourceCompany = onCall(async (request) => {
  await requireStaff(request, "companies.manage");

  const data = asRecord(request.data);
  const key = readString(data, "key").toLowerCase();
  const name = readString(data, "name");
  const clientCodeRaw = readString(data, "clientCode").toUpperCase();
  const clientCode = clientCodeRaw.length ? clientCodeRaw : null;

  if (!COMPANY_KEY_RE.test(key)) throw new HttpsError("invalid-argument", "invalid_company_key");
  if (!name || name.length > 120) {
    throw new HttpsError("invalid-argument", "invalid_company_name");
  }
  if (clientCode && !CLIENT_CODE_RE.test(clientCode)) {
    throw new HttpsError("invalid-argument", "invalid_client_code");
  }

  const db = dbs();
  if (clientCode) {
    const clash = await db.collection(SOURCE_COMPANIES).where("client_code", "==", clientCode).get();
    if (clash.docs.some((doc) => doc.id !== key)) {
      throw new HttpsError("already-exists", "client_code_taken");
    }
  }

  const dpdTarget = readNumber(data, "dpdTarget");
  if (dpdTarget !== null && dpdTarget <= 0) {
    throw new HttpsError("invalid-argument", "invalid_dpd_target");
  }

  const incentiveEnabled = readBool(data, "incentiveEnabled");
  let above = readNumber(data, "incentiveAboveKwd");
  let below = readNumber(data, "incentiveBelowKwd");
  const effectiveFrom = dayOrNull(data.effectiveFrom);

  if (incentiveEnabled) {
    if (dpdTarget === null || dpdTarget <= 0) {
      throw new HttpsError("invalid-argument", "invalid_dpd_target");
    }
    if (above === null || above <= 0) {
      throw new HttpsError("invalid-argument", "invalid_incentive_rate");
    }
    if (below === null || below <= 0) {
      throw new HttpsError("invalid-argument", "invalid_incentive_rate");
    }
    if (!effectiveFrom) {
      throw new HttpsError("invalid-argument", "incentive_effective_from_required");
    }
  } else {
    above = null;
    below = null;
  }

  const ref = db.collection(SOURCE_COMPANIES).doc(key);
  const existing = await ref.get();
  const sortOrder = readNumber(data, "sortOrder") ?? (existing.exists ? null : 100);

  const payload: Record<string, unknown> = {
    key,
    name,
    client_code: clientCode,
    is_active: data.isActive === false ? false : true,
    dpd_target: dpdTarget,
    incentive_enabled: incentiveEnabled,
    incentive_above_kwd: above,
    incentive_below_kwd: below,
    effective_from: effectiveFrom,
    updated_at: FieldValue.serverTimestamp(),
  };
  if (sortOrder !== null) payload.sort_order = sortOrder;

  if (!existing.exists) {
    payload.is_system = false;
    payload.created_at = FieldValue.serverTimestamp();
  }
  await ref.set(payload, { merge: true });

  const saved = docRecord(await ref.get());
  return {
    key: docString(saved, "key") ?? key,
    name: docString(saved, "name") ?? name,
    client_code: docString(saved, "client_code"),
    is_active: saved.is_active === true,
    is_system: saved.is_system === true,
    sort_order: docNumber(saved, "sort_order"),
    dpd_target: docNumber(saved, "dpd_target"),
    incentive_enabled: saved.incentive_enabled === true,
    incentive_above_kwd: docNumber(saved, "incentive_above_kwd"),
    incentive_below_kwd: docNumber(saved, "incentive_below_kwd"),
    effective_from: docString(saved, "effective_from"),
  };
});

type ScopeInput = { scopeType: ScopeType; ids: string[] };

function parseScopeInput(data: Record<string, unknown>): ScopeInput {
  const scopeType = requireScopeType(data.scopeType);
  const ids = readStringArray(data.scopeIds);
  if (ids.length === 0) throw new HttpsError("invalid-argument", "invalid_scope");
  return { scopeType, ids };
}

function parseWindow(data: Record<string, unknown>): { startDate: string; endDate: string } {
  return assertDates(dayOrNull(data.startDate), dayOrNull(data.endDate));
}

/**
 * `admin_upsert_delivery_rule` / `saveDeliveryRule` — per-field validation so the
 * form highlights the exact field instead of a generic `missing_fields`.
 */
export const adminUpsertDeliveryRule = onCall(async (request) => {
  await requireStaff(request, "earnings.manage");

  const data = asRecord(request.data);
  const id = parseId(data.id);
  const name = readString(data, "name");
  if (!name) throw new HttpsError("invalid-argument", "name_required");

  const priorityRaw = readNumber(data, "priority");
  if (data.priority !== undefined && data.priority !== null && data.priority !== "" && priorityRaw === null) {
    throw new HttpsError("invalid-argument", "invalid_priority");
  }

  const dpdTarget = readNumber(data, "dpdTarget");
  if (data.dpdTarget !== undefined && data.dpdTarget !== null && data.dpdTarget !== "" && (dpdTarget === null || dpdTarget <= 0)) {
    throw new HttpsError("invalid-argument", "invalid_target");
  }

  const scope = parseScopeInput(data);
  const { startDate, endDate } = parseWindow(data);
  const priority = priorityRaw ?? defaultPriority(scope.scopeType);

  const periodRaw = readString(data, "dpdPeriod").toLowerCase();
  const period =
    periodRaw === "daily" || periodRaw === "weekly" || periodRaw === "monthly"
      ? (periodRaw as IncentivePeriod)
      : null;

  const legacyScopeId = scope.ids[0] ?? null;
  const payload: Record<string, unknown> = {
    name,
    status: requireStatus(data.status, "draft"),
    scope_type: scope.scopeType,
    zone_id: scope.scopeType === "zone" ? legacyScopeId : null,
    partner_id: scope.scopeType === "partner" ? legacyScopeId : null,
    restaurant_id: scope.scopeType === "restaurant" ? legacyScopeId : null,
    start_date: startDate,
    end_date: endDate,
    priority,
    require_verified: true,
    dpd_target: dpdTarget !== null && dpdTarget > 0 ? dpdTarget : null,
    dpd_period: period,
    updated_at: FieldValue.serverTimestamp(),
  };

  const db = dbs();
  const ref = id ? db.collection(DELIVERY_RULES).doc(id) : db.collection(DELIVERY_RULES).doc();
  if (id) {
    const existing = await ref.get();
    if (!existing.exists) throw new HttpsError("not-found", "save_failed");
    await ref.set(payload, { merge: true });
  } else {
    await ref.set({ ...payload, created_at: FieldValue.serverTimestamp() });
  }

  await replaceScopes(DELIVERY_RULE_SCOPES, "delivery_rule_id", ref.id, scope.scopeType, scope.ids);
  return { success: true, id: ref.id };
});

export const adminDeleteDeliveryRule = onCall(async (request) => {
  await requireStaff(request, "earnings.manage");

  const id = parseId(asRecord(request.data).id);
  if (!id) throw new HttpsError("invalid-argument", "missing_fields");

  const db = dbs();
  const scopes = await db.collection(DELIVERY_RULE_SCOPES).where("delivery_rule_id", "==", id).get();
  const batch = db.batch();
  batch.delete(db.collection(DELIVERY_RULES).doc(id));
  for (const doc of scopes.docs) batch.delete(doc.ref);
  await batch.commit();
  return { success: true };
});

/** `admin_list_delivery_rules` / `fetchDeliveryRulesForAdmin`. */
export const adminListDeliveryRules = onCall(async (request) => {
  await requireStaff(request, "earnings.view");

  const db = dbs();
  const [rulesSnap, maps] = await Promise.all([db.collection(DELIVERY_RULES).get(), labelMaps()]);
  const scopeSnaps = await Promise.all(
    rulesSnap.docs.map((doc) =>
      db.collection(DELIVERY_RULE_SCOPES).where("delivery_rule_id", "==", doc.id).get(),
    ),
  );

  const rows = rulesSnap.docs.map((doc, index) => {
    const data = docRecord(doc);
    const scopeType = (docString(data, "scope_type") ?? "zone") as ScopeType;
    const zoneIds: string[] = [];
    const partnerIds: string[] = [];
    const restaurantIds: string[] = [];
    for (const scopeDoc of scopeSnaps[index]?.docs ?? []) {
      const scopeData = docRecord(scopeDoc);
      const zone = docString(scopeData, "zone_id");
      const partner = docString(scopeData, "partner_id");
      const restaurant = docString(scopeData, "restaurant_id");
      if (zone) zoneIds.push(zone);
      if (partner) partnerIds.push(partner);
      if (restaurant) restaurantIds.push(restaurant);
    }
    const allIds = [...zoneIds, ...partnerIds, ...restaurantIds];
    return {
      id: doc.id,
      name: docString(data, "name") ?? "",
      status: docString(data, "status") ?? "draft",
      scope_type: scopeType,
      zone_ids: zoneIds,
      partner_ids: partnerIds,
      restaurant_ids: restaurantIds,
      scope_label: scopeLabel(scopeType, allIds, maps),
      start_date: docString(data, "start_date"),
      end_date: docString(data, "end_date"),
      priority: docNumber(data, "priority") ?? defaultPriority(scopeType),
      require_verified: data.require_verified !== false,
      dpd_target: docNumber(data, "dpd_target"),
      dpd_period: docString(data, "dpd_period"),
      zone_id: docString(data, "zone_id"),
      partner_id: docString(data, "partner_id"),
      restaurant_id: docString(data, "restaurant_id"),
      created_at: instantString(data.created_at),
      updated_at: instantString(data.updated_at),
    };
  });

  return rows;
});

/**
 * `admin_bulk_update_delivery_rules` / `applyDpdTargetImport` — updates the rules
 * the sheet matched and creates the ones it could not, leaving the window alone
 * when the sheet stated none.
 */
export const adminBulkUpdateDeliveryRules = onCall(async (request) => {
  await requireStaff(request, "earnings.manage");

  const data = asRecord(request.data);
  const rows = Array.isArray(data.rows) ? data.rows.map(asRecord) : [];
  if (rows.length === 0) return { updated: 0, created: 0, rejected: 0 };

  const db = dbs();
  let updated = 0;
  let created = 0;
  let rejected = 0;

  for (const row of rows) {
    const status = readString(row, "status");
    const period = requirePeriod(row.dpd_period === undefined ? row.dpdPeriod : row.dpd_period);
    const dpdTarget = readNumber(row, "dpd_target") ?? readNumber(row, "dpdTarget");
    if (dpdTarget === null || dpdTarget <= 0) {
      rejected += 1;
      continue;
    }
    const startRaw = dayOrNull(row.start_date ?? row.startDate);
    const endRaw = dayOrNull(row.end_date ?? row.endDate);
    const window = startRaw && endRaw ? { start_date: startRaw, end_date: endRaw } : null;

    if (status === "ok") {
      const ruleId = parseId(row.rule_id ?? row.ruleId);
      if (!ruleId) {
        rejected += 1;
        continue;
      }
      await db
        .collection(DELIVERY_RULES)
        .doc(ruleId)
        .set(
          {
            dpd_target: dpdTarget,
            dpd_period: period,
            ...(window ?? {}),
            updated_at: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      updated += 1;
      continue;
    }

    if (status !== "create") {
      rejected += 1;
      continue;
    }
    const scopeId = parseId(row.scope_id ?? row.scopeId);
    const resolvedScopeRaw = readString(row, "resolved_scope") || readString(row, "resolvedScope");
    if (!scopeId || !resolvedScopeRaw || !["zone", "partner", "restaurant"].includes(resolvedScopeRaw)) {
      rejected += 1;
      continue;
    }
    const scopeType = resolvedScopeRaw as ScopeType;
    if (!(await scopeExists(scopeType, scopeId))) {
      rejected += 1;
      continue;
    }
    const name = readString(row, "name");
    if (!name) {
      rejected += 1;
      continue;
    }

    const today = kuwaitDayString(new Date());
    const startDate = startRaw ?? today;
    const endDate = endRaw ?? "2099-12-31";
    if (endDate < startDate) {
      rejected += 1;
      continue;
    }

    const ruleRef = db.collection(DELIVERY_RULES).doc();
    const batch = db.batch();
    batch.set(ruleRef, {
      name,
      status: "active",
      scope_type: scopeType,
      zone_id: scopeType === "zone" ? scopeId : null,
      partner_id: null,
      restaurant_id: scopeType === "restaurant" ? scopeId : null,
      start_date: startDate,
      end_date: endDate,
      priority: defaultPriority(scopeType),
      require_verified: true,
      dpd_target: dpdTarget,
      dpd_period: period,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
    batch.set(db.collection(DELIVERY_RULE_SCOPES).doc(), {
      delivery_rule_id: ruleRef.id,
      zone_id: scopeType === "zone" ? scopeId : null,
      partner_id: null,
      restaurant_id: scopeType === "restaurant" ? scopeId : null,
    });
    await batch.commit();
    created += 1;
  }

  return { updated, created, rejected };
});

type TierInput = {
  threshold_deliveries: number;
  reward_mode: IncentiveRewardMode;
  reward_kwd: number | null;
  reward_per_delivery_kwd: number | null;
};

function parseTiers(value: unknown): TierInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpsError("invalid-argument", "invalid_tiers");
  }
  const tiers: TierInput[] = [];
  for (const item of value) {
    const row = asRecord(item);
    const threshold = readNumber(row, "threshold_deliveries");
    const rewardMode = readString(row, "reward_mode");
    if (threshold === null || threshold < 1) {
      throw new HttpsError("invalid-argument", "invalid_tiers");
    }
    if (rewardMode !== "fixed" && rewardMode !== "per_delivery") {
      throw new HttpsError("invalid-argument", "invalid_reward_mode");
    }
    if (rewardMode === "fixed") {
      const reward = readNumber(row, "reward_kwd");
      if (reward === null || reward < 0 || !isOnRewardStep(reward, FIXED_REWARD_STEP_KWD)) {
        throw new HttpsError("invalid-argument", "invalid_reward");
      }
      tiers.push({
        threshold_deliveries: threshold,
        reward_mode: rewardMode,
        reward_kwd: reward,
        reward_per_delivery_kwd: null,
      });
    } else {
      const rate = readNumber(row, "reward_per_delivery_kwd");
      if (rate === null || rate < 0 || !isOnRewardStep(rate, PER_DELIVERY_REWARD_STEP_KWD)) {
        throw new HttpsError("invalid-argument", "invalid_reward");
      }
      tiers.push({
        threshold_deliveries: threshold,
        reward_mode: rewardMode,
        reward_kwd: null,
        reward_per_delivery_kwd: rate,
      });
    }
  }
  return tiers;
}

/** `admin_upsert_incentive_rule` / `saveIncentiveRule`. */
export const adminUpsertIncentiveRule = onCall(async (request) => {
  await requireStaff(request, "earnings.manage");

  const data = asRecord(request.data);
  const id = parseId(data.id);
  const name = readString(data, "name");
  if (!name) throw new HttpsError("invalid-argument", "name_required");

  const periodRaw = readString(data, "period");
  if (!periodRaw) throw new HttpsError("invalid-argument", "missing_fields");
  const period = requirePeriod(periodRaw);

  const targetModeRaw = readString(data, "targetMode") || "single";
  if (targetModeRaw !== "single" && targetModeRaw !== "tiered") {
    throw new HttpsError("invalid-argument", "invalid_target");
  }
  const targetMode = targetModeRaw as IncentiveTargetMode;

  const baseMinimum = readNumber(data, "baseMinimumDeliveries") ?? 0;
  if (baseMinimum < 0) throw new HttpsError("invalid-argument", "invalid_base");

  const scope = parseScopeInput(data);
  const { startDate, endDate } = parseWindow(data);

  const priorityRaw = readNumber(data, "priority");
  const priority = priorityRaw ?? defaultPriority(scope.scopeType);

  const payoutMode: IncentivePayoutMode =
    readString(data, "payoutMode") === "cumulative" ? "cumulative" : "milestone";
  const overridesOthers = data.overridesOthers === true;

  let targetDeliveries: number | null = null;
  let rewardKwd = 0;
  let rewardPerDeliveryKwd: number | null = null;
  let tiers: TierInput[] = [];

  if (targetMode === "single") {
    const target = readNumber(data, "targetDeliveries");
    if (target === null || target <= baseMinimum) {
      throw new HttpsError("invalid-argument", "invalid_target");
    }
    targetDeliveries = target;
    const rewardMode = readString(data, "rewardMode") || "fixed";
    if (rewardMode !== "fixed" && rewardMode !== "per_delivery") {
      throw new HttpsError("invalid-argument", "invalid_reward_mode");
    }
    if (rewardMode === "fixed") {
      const reward = readNumber(data, "rewardKwd");
      if (reward === null || reward < 0 || !isOnRewardStep(reward, FIXED_REWARD_STEP_KWD)) {
        throw new HttpsError("invalid-argument", "invalid_reward");
      }
      rewardKwd = reward;
    } else {
      const rate = readNumber(data, "rewardPerDeliveryKwd");
      if (rate === null || rate < 0 || !isOnRewardStep(rate, PER_DELIVERY_REWARD_STEP_KWD)) {
        throw new HttpsError("invalid-argument", "invalid_reward");
      }
      rewardPerDeliveryKwd = rate;
    }
  } else {
    tiers = parseTiers(data.tiers);
    if (tiers[0].threshold_deliveries <= baseMinimum) {
      throw new HttpsError("invalid-argument", "invalid_tiers");
    }
  }

  const rewardMode = readString(data, "rewardMode") || "fixed";
  const legacyScopeId = scope.ids[0] ?? null;
  const payload: Record<string, unknown> = {
    name,
    status: requireStatus(data.status, "draft"),
    scope_type: scope.scopeType,
    zone_id: scope.scopeType === "zone" ? legacyScopeId : null,
    partner_id: scope.scopeType === "partner" ? legacyScopeId : null,
    restaurant_id: scope.scopeType === "restaurant" ? legacyScopeId : null,
    period,
    target_mode: targetMode,
    base_minimum_deliveries: baseMinimum,
    target_deliveries: targetMode === "single" ? targetDeliveries : null,
    reward_mode: targetMode === "single" ? rewardMode : "fixed",
    reward_kwd: targetMode === "single" && rewardMode === "fixed" ? rewardKwd : 0,
    reward_per_delivery_kwd:
      targetMode === "single" && rewardMode === "per_delivery" ? rewardPerDeliveryKwd : null,
    payout_mode: payoutMode,
    overrides_others: overridesOthers,
    start_date: startDate,
    end_date: endDate,
    priority,
    updated_at: FieldValue.serverTimestamp(),
  };

  const db = dbs();
  const ref = id ? db.collection(INCENTIVE_RULES).doc(id) : db.collection(INCENTIVE_RULES).doc();
  if (id) {
    const existing = await ref.get();
    if (!existing.exists) throw new HttpsError("not-found", "save_failed");
    await ref.set(payload, { merge: true });
  } else {
    await ref.set({ ...payload, created_at: FieldValue.serverTimestamp() });
  }

  const existingTiers = await db.collection(INCENTIVE_RULE_TIERS).where("incentive_rule_id", "==", ref.id).get();
  const batch = db.batch();
  for (const doc of existingTiers.docs) batch.delete(doc.ref);
  if (targetMode === "tiered") {
    tiers.forEach((tier, index) => {
      batch.set(db.collection(INCENTIVE_RULE_TIERS).doc(), {
        incentive_rule_id: ref.id,
        sort_order: index,
        threshold_deliveries: tier.threshold_deliveries,
        reward_mode: tier.reward_mode,
        reward_kwd: tier.reward_mode === "fixed" ? tier.reward_kwd : null,
        reward_per_delivery_kwd:
          tier.reward_mode === "per_delivery" ? tier.reward_per_delivery_kwd : null,
      });
    });
  }
  await batch.commit();

  await replaceScopes(INCENTIVE_RULE_SCOPES, "incentive_rule_id", ref.id, scope.scopeType, scope.ids);
  return { success: true, id: ref.id };
});

export const adminDeleteIncentiveRule = onCall(async (request) => {
  await requireStaff(request, "earnings.manage");

  const id = parseId(asRecord(request.data).id);
  if (!id) throw new HttpsError("invalid-argument", "missing_fields");

  const db = dbs();
  const [scopes, tiers] = await Promise.all([
    db.collection(INCENTIVE_RULE_SCOPES).where("incentive_rule_id", "==", id).get(),
    db.collection(INCENTIVE_RULE_TIERS).where("incentive_rule_id", "==", id).get(),
  ]);
  const batch = db.batch();
  batch.delete(db.collection(INCENTIVE_RULES).doc(id));
  for (const doc of scopes.docs) batch.delete(doc.ref);
  for (const doc of tiers.docs) batch.delete(doc.ref);
  await batch.commit();
  return { success: true };
});

async function listIncentiveRuleRows(): Promise<Array<Record<string, unknown>>> {
  const db = dbs();
  const [rulesSnap, maps] = await Promise.all([db.collection(INCENTIVE_RULES).get(), labelMaps()]);
  const [scopeSnaps, tierSnaps] = await Promise.all([
    Promise.all(
      rulesSnap.docs.map((doc) =>
        db.collection(INCENTIVE_RULE_SCOPES).where("incentive_rule_id", "==", doc.id).get(),
      ),
    ),
    Promise.all(
      rulesSnap.docs.map((doc) =>
        db.collection(INCENTIVE_RULE_TIERS).where("incentive_rule_id", "==", doc.id).get(),
      ),
    ),
  ]);

  return rulesSnap.docs.map((doc, index) => {
    const data = docRecord(doc);
    const scopeType = (docString(data, "scope_type") ?? "restaurant") as ScopeType;
    const zoneIds: string[] = [];
    const partnerIds: string[] = [];
    const restaurantIds: string[] = [];
    for (const scopeDoc of scopeSnaps[index]?.docs ?? []) {
      const scopeData = docRecord(scopeDoc);
      const zone = docString(scopeData, "zone_id");
      const partner = docString(scopeData, "partner_id");
      const restaurant = docString(scopeData, "restaurant_id");
      if (zone) zoneIds.push(zone);
      if (partner) partnerIds.push(partner);
      if (restaurant) restaurantIds.push(restaurant);
    }
    const allIds = [...zoneIds, ...partnerIds, ...restaurantIds];
    const tiers = (tierSnaps[index]?.docs ?? [])
      .map((tierDoc) => {
        const tier = docRecord(tierDoc);
        return {
          sort_order: docNumber(tier, "sort_order") ?? 0,
          threshold_deliveries: docNumber(tier, "threshold_deliveries") ?? 0,
          reward_mode: docString(tier, "reward_mode") ?? "fixed",
          reward_kwd: docNumber(tier, "reward_kwd"),
          reward_per_delivery_kwd: docNumber(tier, "reward_per_delivery_kwd"),
        };
      })
      .sort((a, b) => a.sort_order - b.sort_order);

    return {
      id: doc.id,
      name: docString(data, "name") ?? "",
      status: docString(data, "status") ?? "draft",
      scope_type: scopeType,
      zone_ids: zoneIds,
      partner_ids: partnerIds,
      restaurant_ids: restaurantIds,
      scope_label: scopeLabel(scopeType, allIds, maps),
      period: docString(data, "period") ?? "daily",
      target_mode: docString(data, "target_mode") ?? "single",
      base_minimum_deliveries: docNumber(data, "base_minimum_deliveries") ?? 0,
      target_deliveries: docNumber(data, "target_deliveries"),
      reward_mode: docString(data, "reward_mode") ?? "fixed",
      reward_kwd: docNumber(data, "reward_kwd"),
      reward_per_delivery_kwd: docNumber(data, "reward_per_delivery_kwd"),
      payout_mode: docString(data, "payout_mode") ?? "milestone",
      overrides_others: data.overrides_others === true,
      start_date: docString(data, "start_date"),
      end_date: docString(data, "end_date"),
      priority: docNumber(data, "priority") ?? defaultPriority(scopeType),
      zone_id: docString(data, "zone_id"),
      partner_id: docString(data, "partner_id"),
      restaurant_id: docString(data, "restaurant_id"),
      tiers,
      created_at: instantString(data.created_at),
      updated_at: instantString(data.updated_at),
    };
  });
}

/** `admin_list_incentive_rules` / `fetchIncentiveRulesForAdmin`. */
export const adminListIncentiveRules = onCall(async (request) => {
  await requireStaff(request, "earnings.view");
  return listIncentiveRuleRows();
});

/** `admin_export_incentive_rules` — the same rows the list returns, export-shaped. */
export const adminExportIncentiveRules = onCall(async (request) => {
  await requireStaff(request, "earnings.view");
  const rows = await listIncentiveRuleRows();
  return {
    total: rows.length,
    rows: rows.map((row) => ({
      ...row,
      tiers_json: JSON.stringify(row.tiers ?? []),
    })),
  };
});

/**
 * `admin_upsert_exception_action` — keyed on `exception_key`, which is the
 * idempotency key the caller supplies.
 */
export const adminUpsertExceptionAction = onCall(async (request) => {
  await requireStaff(request);

  const data = asRecord(request.data);
  const exceptionKey = readString(data, "exceptionKey");
  const driverId = parseId(data.driverId);
  const exceptionType = readString(data, "exceptionType");
  const exceptionDate = dayOrNull(data.exceptionDate);
  const resolutionStatus = readString(data, "resolutionStatus") || "open";
  const action = readString(data, "action");
  const note = readString(data, "note");

  if (!exceptionKey || !driverId || !exceptionType || !exceptionDate) {
    throw new HttpsError("invalid-argument", "missing_fields");
  }

  const ref = dbs().collection(EXCEPTION_ACTIONS).doc(exceptionKey);
  const existing = await ref.get();
  const prior = docRecord(existing);
  const payload: Record<string, unknown> = {
    exception_key: exceptionKey,
    driver_id: driverId,
    exception_type: exceptionType,
    exception_date: exceptionDate,
    supervisor_id: request.auth?.uid ?? null,
    action: action.length ? action : prior.action ?? null,
    resolution_status: resolutionStatus,
    note: note.length ? note : prior.note ?? null,
    updated_at: FieldValue.serverTimestamp(),
  };
  if (!existing.exists) payload.created_at = FieldValue.serverTimestamp();
  await ref.set(payload, { merge: true });

  return { id: ref.id, exception_key: exceptionKey, resolution_status: resolutionStatus };
});
