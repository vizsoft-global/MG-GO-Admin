"use server";

import type { Firestore } from "firebase-admin/firestore";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import {
  applyRestaurantLogoFromForm,
  deleteRestaurantLogoFiles,
} from "@/features/restaurants/restaurant-logo-storage";
import {
  parseRestaurantFormData,
  validateRestaurantCoordinates,
} from "@/features/restaurants/parse-restaurant-form";
import { toDbRestaurantStatus } from "@/features/restaurants/restaurant-status";
import { isDpdErrorKey, type DpdErrorKey } from "./dpd-errors";
import {
  getDriverEarningsDetail,
  listDriverEarningsDaily,
  previewDriverEarnings,
  recalculateEarningsForDate,
  recalculateEarningsForRange,
  validateDeliveryForRules,
} from "./incentive-calculator";
import type {
  DeliveryRuleRow,
  DpdScopeOptions,
  EarningsDailyListResult,
  EarningsDetailResult,
  IncentivePayoutMode,
  IncentiveRewardMode,
  IncentiveRuleRow,
  IncentiveRuleTierRow,
  IncentiveTargetMode,
  IncentivePeriod,
  RuleScopeType,
  RuleStatus,
} from "./types";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import {
  applyableIncentiveImportRows,
  effectiveIncentiveImportStart,
  parseIsoDate,
  previewIncentiveRuleRows,
  uniqueRestaurantIds,
  type IncentiveImportInputRow,
} from "./incentive-rule-import";
import {
  applyableDpdTargetRows,
  previewDpdTargetRows,
  type DpdTargetImportInputRow,
  type DpdTargetImportPreviewRow,
} from "./delivery-rule-dpd-import";
import {
  FIXED_REWARD_STEP_KWD,
  isOnRewardStep,
  PER_DELIVERY_REWARD_STEP_KWD,
} from "./incentive-rule-form-validation";

export type {
  DpdTargetImportInputRow,
  DpdTargetImportPreviewRow as DpdTargetImportRow,
  DpdTargetImportStatus,
} from "./delivery-rule-dpd-import";

type PgLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

export type DpdMutationResult = {
  error?: DpdErrorKey | string;
  errorDetail?: string;
  success?: boolean;
  id?: string;
  logoWarning?: string;
};

function formatPgErrorDetail(error: PgLikeError | null | undefined): string | undefined {
  if (!error) return undefined;
  const parts: string[] = [];
  if (error.code) parts.push(`code ${error.code}`);
  if (error.message) parts.push(error.message);
  if (error.details) parts.push(error.details);
  if (error.hint) parts.push(`hint: ${error.hint}`);
  return parts.length > 0 ? parts.join(" — ") : undefined;
}

async function requireEarningsView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "earnings.view", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

async function requireEarningsManage() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "earnings.manage", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

async function restaurantNameClash(
  db: Firestore,
  name: string,
  partnerId: string | null,
  exceptId: string | null,
): Promise<boolean> {
  const snap = await db.collection(COLLECTIONS.restaurants).where("name", "==", name).get();
  return snap.docs.some((doc) => {
    if (exceptId && doc.id === exceptId) return false;
    return textOrNull(doc.data().partner_id) === partnerId;
  });
}

async function writeDoc(
  collection: string,
  id: string,
  payload: Record<string, unknown>,
  creating: boolean,
): Promise<string> {
  const db = await dpdDb();
  const ref = creating ? db.collection(collection).doc() : db.collection(collection).doc(id);
  await ref.set(payload, { merge: !creating });
  return ref.id;
}

async function dpdDb(): Promise<Firestore> {
  const db = await staffDb();
  if (!db) throw new Error("not_configured");
  return db;
}

function pgFail(err: unknown): PgLikeError {
  const message = err instanceof Error ? err.message : String(err ?? "save_failed");
  const code = /already exists|ALREADY_EXISTS|23505/i.test(message) ? "23505" : "firestore";
  return { code, message, details: null, hint: null };
}

async function deleteWhere(
  db: Firestore,
  collection: string,
  field: string,
  value: string,
): Promise<void> {
  const snap = await db.collection(collection).where(field, "==", value).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    for (const doc of snap.docs.slice(i, i + 400)) batch.delete(doc.ref);
    if (snap.docs.slice(i, i + 400).length) await batch.commit();
  }
}

async function insertRows(
  db: Firestore,
  collection: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += 400) {
    const batch = db.batch();
    for (const row of rows.slice(i, i + 400)) {
      batch.set(db.collection(collection).doc(), row);
    }
    await batch.commit();
  }
}

async function scopesForRules(
  db: Firestore,
  collection: string,
  foreignKey: string,
  ruleIds: string[],
): Promise<Map<string, RuleScopeRow[]>> {
  const map = new Map<string, RuleScopeRow[]>();
  for (let i = 0; i < ruleIds.length; i += 30) {
    const chunk = ruleIds.slice(i, i + 30);
    if (chunk.length === 0) continue;
    const snap = await db.collection(collection).where(foreignKey, "in", chunk).get();
    for (const doc of snap.docs) {
      const row = doc.data();
      const ruleId = String(row[foreignKey] ?? "");
      const list = map.get(ruleId) ?? [];
      list.push({
        zone_id: row.zone_id == null ? null : String(row.zone_id),
        partner_id: row.partner_id == null ? null : String(row.partner_id),
        restaurant_id: row.restaurant_id == null ? null : String(row.restaurant_id),
      });
      map.set(ruleId, list);
    }
  }
  return map;
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function isoOf(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  const ts = value as { toDate?: () => Date };
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  return null;
}

function logPgError(scope: string, error: PgLikeError | unknown): void {
  const e = error as PgLikeError;
  console.error(`[dpd-actions:${scope}] insert/update failed`, {
    code: e?.code ?? null,
    message: e?.message ?? null,
    details: e?.details ?? null,
    hint: e?.hint ?? null,
  });
}

type RuleScopeRow = {
  zone_id: string | null;
  partner_id: string | null;
  restaurant_id: string | null;
};

function extractScopeIds(scopes: RuleScopeRow[] | null | undefined): {
  zone_ids: string[];
  partner_ids: string[];
  restaurant_ids: string[];
} {
  const zone_ids: string[] = [];
  const partner_ids: string[] = [];
  const restaurant_ids: string[] = [];
  for (const s of scopes ?? []) {
    if (s.zone_id) zone_ids.push(s.zone_id);
    if (s.partner_id) partner_ids.push(s.partner_id);
    if (s.restaurant_id) restaurant_ids.push(s.restaurant_id);
  }
  return { zone_ids, partner_ids, restaurant_ids };
}

function scopeLabelMulti(
  scopeType: RuleScopeType,
  ids: string[],
  maps: Awaited<ReturnType<typeof loadScopeLabelMaps>>,
): string {
  if (ids.length === 0) return "—";

  const labels: string[] = [];
  for (const id of ids) {
    if (scopeType === "zone") {
      const z = maps.zones.get(id);
      if (z) labels.push(`${z.name} (${z.code})`);
    } else if (scopeType === "partner") {
      const p = maps.partners.get(id);
      if (p) labels.push(p.name);
    } else {
      const r = maps.restaurants.get(id);
      if (r) labels.push(r.name);
    }
  }

  if (labels.length === 0) return "—";
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

function parseScopeFromForm(formData: FormData): {
  scopeType: RuleScopeType;
  ids: string[];
} | { error: DpdErrorKey } {
  const scopeType = String(formData.get("scopeType") ?? "").trim() as RuleScopeType;
  const raw = String(formData.get("scopeIdsJson") ?? "").trim();

  if (!["zone", "partner", "restaurant"].includes(scopeType)) {
    return { error: "invalid_scope" };
  }

  let ids: string[] = [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return { error: "invalid_scope" };
    ids = [
      ...new Set(
        parsed
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return { error: "invalid_scope" };
  }

  if (ids.length === 0) return { error: "invalid_scope" };

  return { scopeType, ids };
}

async function replaceRuleScopes(
  collection: string,
  foreignKey: string,
  ruleId: string,
  scopeType: RuleScopeType,
  ids: string[],
): Promise<PgLikeError | null> {
  try {
    const db = await dpdDb();
    await deleteWhere(db, collection, foreignKey, ruleId);
    await insertRows(
      db,
      collection,
      ids.map((id) => ({
        [foreignKey]: ruleId,
        zone_id: scopeType === "zone" ? id : null,
        partner_id: scopeType === "partner" ? id : null,
        restaurant_id: scopeType === "restaurant" ? id : null,
      })),
    );
    return null;
  } catch (err) {
    const error = pgFail(err);
    logPgError(`${collection}:write`, error);
    return error;
  }
}

async function replaceIncentiveRuleScopes(
  ruleId: string,
  scopeType: RuleScopeType,
  ids: string[],
) {
  return replaceRuleScopes(
    COLLECTIONS.incentiveRuleScopes,
    "incentive_rule_id",
    ruleId,
    scopeType,
    ids,
  );
}

async function replaceDeliveryRuleScopes(
  ruleId: string,
  scopeType: RuleScopeType,
  ids: string[],
) {
  return replaceRuleScopes(
    COLLECTIONS.deliveryRuleScopes,
    "delivery_rule_id",
    ruleId,
    scopeType,
    ids,
  );
}

function parseDates(formData: FormData): { startDate: string; endDate: string } | { error: DpdErrorKey } {
  const startDate = String(formData.get("startDate") ?? "").trim();
  const endDate = String(formData.get("endDate") ?? "").trim();
  // A blank date and a reversed window are different mistakes and now say so.
  // The client validator names the same key for each, so a row that somehow
  // reaches the server without a date is not answered with "end date must be
  // on or after start date", which is what an empty start date used to say.
  if (!startDate || !endDate) return { error: "missing_fields" };
  if (endDate < startDate) return { error: "invalid_dates" };
  return { startDate, endDate };
}

function defaultPriority(scopeType: RuleScopeType): number {
  switch (scopeType) {
    case "restaurant":
      return 30;
    case "partner":
      return 20;
    case "zone":
      return 10;
    default:
      return 10;
  }
}

export async function fetchDpdScopeOptions(): Promise<DpdScopeOptions> {
  await requireEarningsView();
  const db = await dpdDb();

  const [zoneSnap, partnerSnap, restaurantSnap] = await Promise.all([
    db.collection(COLLECTIONS.zones).get(),
    db.collection(COLLECTIONS.partners).get(),
    db.collection(COLLECTIONS.restaurants).where("status", "==", "published").get(),
  ]);

  const zones = zoneSnap.docs
    .map((doc) => ({
      id: doc.id,
      name: String(doc.data().name ?? ""),
      code: String(doc.data().code ?? ""),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const partners = partnerSnap.docs
    .map((doc) => ({ id: doc.id, name: String(doc.data().name ?? "") }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const partnerMap = new Map(partners.map((p) => [p.id, p.name]));

  return {
    zones,
    partners,
    restaurants: restaurantSnap.docs
      .map((doc) => {
        const row = doc.data();
        const partnerId = textOrNull(row.partner_id);
        return {
          id: doc.id,
          name: String(row.name ?? ""),
          partner_id: partnerId,
          partner_name: partnerId ? (partnerMap.get(partnerId) ?? "—") : "—",
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function loadScopeLabelMaps() {
  const db = await dpdDb();
  const [zoneSnap, partnerSnap, restaurantSnap] = await Promise.all([
    db.collection(COLLECTIONS.zones).get(),
    db.collection(COLLECTIONS.partners).get(),
    db.collection(COLLECTIONS.restaurants).get(),
  ]);
  return {
    zones: new Map(
      zoneSnap.docs.map((doc) => [
        doc.id,
        { name: String(doc.data().name ?? ""), code: String(doc.data().code ?? "") },
      ]),
    ),
    partners: new Map(
      partnerSnap.docs.map((doc) => [doc.id, { name: String(doc.data().name ?? "") }]),
    ),
    restaurants: new Map(
      restaurantSnap.docs.map((doc) => [
        doc.id,
        {
          name: String(doc.data().name ?? ""),
          external_merchant_id: textOrNull(doc.data().external_merchant_id),
        },
      ]),
    ),
  };
}

function scopeSearch(
  scopeType: RuleScopeType,
  ids: string[],
  maps: Awaited<ReturnType<typeof loadScopeLabelMaps>>,
): string {
  const parts: string[] = [];
  for (const id of ids) {
    parts.push(id);
    if (scopeType === "zone") {
      const zone = maps.zones.get(id);
      if (zone) parts.push(zone.name, zone.code);
    } else if (scopeType === "partner") {
      const partner = maps.partners.get(id);
      if (partner) parts.push(partner.name);
    } else {
      const restaurant = maps.restaurants.get(id);
      if (restaurant) {
        parts.push(restaurant.name);
        if (restaurant.external_merchant_id) parts.push(restaurant.external_merchant_id);
      }
    }
  }
  return parts.filter((part) => part.trim() !== "").join(" ");
}

export async function fetchDeliveryRulesForAdmin(): Promise<DeliveryRuleRow[]> {
  await requireEarningsView();
  void logAdminRead("delivery_rules", "fetchDeliveryRulesForAdmin");
  const db = await dpdDb();
  const snap = await db.collection(COLLECTIONS.deliveryRules).get();
  const scopeMap = await scopesForRules(
    db,
    COLLECTIONS.deliveryRuleScopes,
    "delivery_rule_id",
    snap.docs.map((doc) => doc.id),
  );
  const maps = await loadScopeLabelMaps();
  const data = snap.docs
    .map((doc) => {
      const row = doc.data();
      return {
        id: doc.id,
        name: String(row.name ?? ""),
        status: row.status as DeliveryRuleRow["status"],
        scope_type: row.scope_type as RuleScopeType,
        zone_id: textOrNull(row.zone_id),
        partner_id: textOrNull(row.partner_id),
        restaurant_id: textOrNull(row.restaurant_id),
        start_date: String(row.start_date ?? ""),
        end_date: String(row.end_date ?? ""),
        priority: Number(row.priority ?? 0),
        dpd_target: row.dpd_target,
        dpd_period: row.dpd_period,
        created_at: isoOf(row.created_at) ?? "",
        delivery_rule_scopes: scopeMap.get(doc.id) ?? [],
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.priority - a.priority);

  return data.map((row) => {
    const scopes = extractScopeIds(
      row.delivery_rule_scopes as RuleScopeRow[] | null,
    );
    const junctionIds =
      row.scope_type === "zone"
        ? scopes.zone_ids
        : row.scope_type === "partner"
          ? scopes.partner_ids
          : scopes.restaurant_ids;
    // Legacy rows predate `delivery_rule_scopes`: their only scope is the
    // single-FK column. Without this fallback their scope label and search
    // text are empty, so a zone/partner/restaurant search returns nothing.
    const legacyId =
      row.scope_type === "zone"
        ? row.zone_id
        : row.scope_type === "partner"
          ? row.partner_id
          : row.restaurant_id;
    const activeIds =
      junctionIds.length > 0 ? junctionIds : legacyId ? [legacyId] : [];
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      scope_type: row.scope_type,
      zone_id: null,
      partner_id: null,
      restaurant_id: null,
      zone_ids: scopes.zone_ids,
      partner_ids: scopes.partner_ids,
      restaurant_ids: scopes.restaurant_ids,
      scope_label: scopeLabelMulti(row.scope_type, activeIds, maps),
      scope_search: scopeSearch(row.scope_type, activeIds, maps),
      start_date: row.start_date,
      end_date: row.end_date,
      priority: row.priority,
      dpd_target:
        (row as { dpd_target?: number | string | null }).dpd_target != null
          ? Number((row as { dpd_target?: number | string | null }).dpd_target)
          : null,
      dpd_period:
        ((row as { dpd_period?: IncentivePeriod | null }).dpd_period ?? null),
    };
  });
}

type IncentiveRuleDbRow = {
  id: string;
  name: string;
  status: RuleStatus;
  scope_type: RuleScopeType;
  zone_id: string | null;
  partner_id: string | null;
  restaurant_id: string | null;
  period: IncentivePeriod;
  target_mode: IncentiveTargetMode;
  base_minimum_deliveries: number;
  target_deliveries: number | null;
  reward_mode: IncentiveRewardMode;
  reward_kwd: number | string;
  reward_per_delivery_kwd: number | string | null;
  payout_mode: IncentivePayoutMode;
  overrides_others: boolean;
  start_date: string;
  end_date: string;
  priority: number;
  incentive_rule_tiers?: {
    id: string;
    threshold_deliveries: number;
    reward_mode: IncentiveRewardMode;
    reward_kwd: number | string | null;
    reward_per_delivery_kwd: number | string | null;
    sort_order: number;
  }[];
  incentive_rule_scopes?: RuleScopeRow[];
};

function mapIncentiveTierRow(
  tier: NonNullable<IncentiveRuleDbRow["incentive_rule_tiers"]>[number],
): IncentiveRuleTierRow {
  return {
    id: tier.id,
    threshold_deliveries: tier.threshold_deliveries,
    reward_mode: tier.reward_mode,
    reward_kwd: tier.reward_kwd != null ? Number(tier.reward_kwd) : null,
    reward_per_delivery_kwd:
      tier.reward_per_delivery_kwd != null
        ? Number(tier.reward_per_delivery_kwd)
        : null,
    sort_order: tier.sort_order,
  };
}

type ScopeLabelMaps = Awaited<ReturnType<typeof loadScopeLabelMaps>>;

function mapIncentiveRuleRow(
  row: IncentiveRuleDbRow,
  maps: ScopeLabelMaps,
): IncentiveRuleRow {
  const scopes = extractScopeIds(
    (row as IncentiveRuleDbRow & { incentive_rule_scopes?: RuleScopeRow[] })
      .incentive_rule_scopes,
  );
  const restaurant_ids = uniqueRestaurantIds([
    ...scopes.restaurant_ids,
    row.restaurant_id,
  ]);
  const activeIds =
    row.scope_type === "zone"
      ? scopes.zone_ids
      : row.scope_type === "partner"
        ? scopes.partner_ids
        : restaurant_ids;
  const tiers = (row.incentive_rule_tiers ?? [])
    .map(mapIncentiveTierRow)
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        a.threshold_deliveries - b.threshold_deliveries,
    );
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    scope_type: row.scope_type,
    zone_id: null,
    partner_id: null,
    restaurant_id: null,
    zone_ids: scopes.zone_ids,
    partner_ids: scopes.partner_ids,
    restaurant_ids,
    scope_label: scopeLabelMulti(row.scope_type, activeIds, maps),
    period: row.period,
    target_mode: row.target_mode ?? "single",
    base_minimum_deliveries: row.base_minimum_deliveries ?? 0,
    target_deliveries: row.target_deliveries,
    reward_mode: row.reward_mode ?? "fixed",
    reward_kwd: Number(row.reward_kwd),
    reward_per_delivery_kwd:
      row.reward_per_delivery_kwd != null
        ? Number(row.reward_per_delivery_kwd)
        : null,
    payout_mode: row.payout_mode ?? "milestone",
    overrides_others: row.overrides_others ?? false,
    tiers,
    start_date: row.start_date,
    end_date: row.end_date,
    priority: row.priority,
  };
}

async function loadIncentiveRuleRows(onlyId?: string): Promise<IncentiveRuleDbRow[]> {
  const db = await dpdDb();
  const snap = onlyId
    ? await db.collection(COLLECTIONS.incentiveRules).doc(onlyId).get().then((doc) => (doc.exists ? [doc] : []))
    : (await db.collection(COLLECTIONS.incentiveRules).get()).docs;
  const ids = snap.map((doc) => doc.id);
  const [scopeMap, tierSnapParts] = await Promise.all([
    scopesForRules(db, COLLECTIONS.incentiveRuleScopes, "incentive_rule_id", ids),
    (async () => {
      const tiers = new Map<string, NonNullable<IncentiveRuleDbRow["incentive_rule_tiers"]>>();
      for (let i = 0; i < ids.length; i += 30) {
        const chunk = ids.slice(i, i + 30);
        if (chunk.length === 0) continue;
        const tierSnap = await db
          .collection(COLLECTIONS.incentiveRuleTiers)
          .where("incentive_rule_id", "in", chunk)
          .get();
        for (const doc of tierSnap.docs) {
          const row = doc.data();
          const ruleId = String(row.incentive_rule_id ?? "");
          const list = tiers.get(ruleId) ?? [];
          list.push({
            id: doc.id,
            threshold_deliveries: Number(row.threshold_deliveries ?? 0),
            reward_mode: row.reward_mode as IncentiveRewardMode,
            reward_kwd: row.reward_kwd as number | string | null,
            reward_per_delivery_kwd: row.reward_per_delivery_kwd as number | string | null,
            sort_order: Number(row.sort_order ?? 0),
          });
          tiers.set(ruleId, list);
        }
      }
      return tiers;
    })(),
  ]);

  return snap
    .flatMap((doc) => {
      const row = doc.data();
      if (!row) return [];
      const mapped: IncentiveRuleDbRow = {
        id: doc.id,
        name: String(row.name ?? ""),
        status: row.status as RuleStatus,
        scope_type: row.scope_type as RuleScopeType,
        zone_id: textOrNull(row.zone_id),
        partner_id: textOrNull(row.partner_id),
        restaurant_id: textOrNull(row.restaurant_id),
        period: row.period as IncentivePeriod,
        target_mode: (row.target_mode ?? "single") as IncentiveTargetMode,
        base_minimum_deliveries: Number(row.base_minimum_deliveries ?? 0),
        target_deliveries: row.target_deliveries == null ? null : Number(row.target_deliveries),
        reward_mode: (row.reward_mode ?? "fixed") as IncentiveRewardMode,
        reward_kwd: row.reward_kwd as number | string,
        reward_per_delivery_kwd: row.reward_per_delivery_kwd as number | string | null,
        payout_mode: (row.payout_mode ?? "milestone") as IncentivePayoutMode,
        overrides_others: Boolean(row.overrides_others),
        start_date: String(row.start_date ?? ""),
        end_date: String(row.end_date ?? ""),
        priority: Number(row.priority ?? 0),
        incentive_rule_scopes: scopeMap.get(doc.id) ?? [],
        incentive_rule_tiers: tierSnapParts.get(doc.id) ?? [],
      };
      return [{ mapped, created: isoOf(row.created_at) ?? "" }];
    })
    .sort((a, b) => b.created.localeCompare(a.created) || b.mapped.priority - a.mapped.priority)
    .map((entry) => entry.mapped);
}

export async function fetchIncentiveRulesForAdmin(): Promise<IncentiveRuleRow[]> {
  await requireEarningsView();
  void logAdminRead("incentive_rules", "fetchIncentiveRulesForAdmin");
  const rows = await loadIncentiveRuleRows();
  const maps = await loadScopeLabelMaps();
  return rows.map((row) => mapIncentiveRuleRow(row, maps));
}

/**
 * One rule for the read-only detail page. Deliberately a single-row read rather
 * than a re-use of the list query: the list is the whole table, and a detail
 * deep link should not pay for rules it is going to throw away. Both paths go
 * through `mapIncentiveRuleRow`, so they cannot drift.
 */
export async function getIncentiveRuleById(
  id: string,
): Promise<IncentiveRuleRow | null> {
  await requireEarningsView();
  if (!id) return null;
  void logAdminRead("incentive_rules", "getIncentiveRuleById");
  const rows = await loadIncentiveRuleRows(id);
  const data = rows[0];
  if (!data) return null;
  const maps = await loadScopeLabelMaps();
  return mapIncentiveRuleRow(data, maps);
}

export async function saveRestaurant(formData: FormData): Promise<DpdMutationResult> {
  const auth = await requireEarningsManage();
  if (auth.error) return { error: auth.error };
  const { session } = auth;

  const parsed = parseRestaurantFormData(formData);
  const {
    id,
    partnerId,
    zoneId,
    name,
    externalMerchantId,
    mapLink,
    status,
    isActive,
    latitude,
    longitude,
  } = parsed;

  if (!name) return { error: "missing_fields" };

  const coordError = validateRestaurantCoordinates(latitude, longitude);
  if (coordError) return { error: coordError };

  const db = await dpdDb();
  const payload = {
    partner_id: partnerId || null,
    zone_id: zoneId || null,
    name,
    external_merchant_id: externalMerchantId || null,
    map_link: mapLink || null,
    latitude,
    longitude,
    status: toDbRestaurantStatus(status),
    is_active: isActive && status !== "archived",
    updated_at: new Date().toISOString(),
  };

  if (id) {
    const logoResult = await applyRestaurantLogoFromForm(id, formData, session.id);
    const patch = {
      ...payload,
      ...(logoResult.logoUrl !== undefined ? { logo_url: logoResult.logoUrl } : {}),
    };
    const clash = await restaurantNameClash(db, name, partnerId || null, id);
    if (clash) return { error: "restaurant_exists" };
    try {
      await db.collection(COLLECTIONS.restaurants).doc(id).set(patch, { merge: true });
    } catch (err) {
      const error = pgFail(err);
      if (error.code === "23505") return { error: "restaurant_exists" };
      logPgError("restaurants:update", error);
      return { error: "save_failed", errorDetail: formatPgErrorDetail(error) };
    }
    void logAdminMutation({
      action: "update",
      entityType: "restaurant",
      entityId: id,
      routeName: "saveRestaurant",
      after: { name, partner_id: partnerId, zone_id: zoneId, status },
    });
    return { success: true, id, logoWarning: logoResult.logoWarning };
  }

  const clash = await restaurantNameClash(db, name, partnerId || null, null);
  if (clash) return { error: "restaurant_exists" };
  const createdRef = db.collection(COLLECTIONS.restaurants).doc();
  try {
    await createdRef.set({ ...payload, created_by: session.id });
  } catch (err) {
    const error = pgFail(err);
    if (error.code === "23505") return { error: "restaurant_exists" };
    logPgError("restaurants:insert", error);
    return { error: "save_failed", errorDetail: formatPgErrorDetail(error) };
  }
  const data = { id: createdRef.id };

  const logoResult = await applyRestaurantLogoFromForm(data.id, formData, session.id);
  if (logoResult.logoUrl !== undefined) {
    await db.collection(COLLECTIONS.restaurants).doc(data.id).set(
      { logo_url: logoResult.logoUrl, updated_at: new Date().toISOString() },
      { merge: true },
    );
  }

  void logAdminMutation({
    action: "create",
    entityType: "restaurant",
    entityId: data.id,
    routeName: "saveRestaurant",
    after: { name, partner_id: partnerId, zone_id: zoneId, status },
  });
  return { success: true, id: data.id, logoWarning: logoResult.logoWarning };
}

export async function deleteRestaurant(id: string): Promise<DpdMutationResult> {
  const auth = await requireEarningsManage();
  if (auth.error) return { error: auth.error };
  if (!id) return { error: "missing_fields" };

  const db = await dpdDb();
  await deleteRestaurantLogoFiles(id);
  try {
    await deleteWhere(db, COLLECTIONS.deliveryRuleScopes, "restaurant_id", id);
    await deleteWhere(db, COLLECTIONS.incentiveRuleScopes, "restaurant_id", id);
    await deleteWhere(db, COLLECTIONS.driverRestaurants, "restaurant_id", id);
    await db.collection(COLLECTIONS.restaurants).doc(id).delete();
  } catch {
    return { error: "delete_failed" };
  }
  void logAdminMutation({
    action: "delete",
    entityType: "restaurant",
    entityId: id,
    routeName: "deleteRestaurant",
  });
  return { success: true };
}

export async function saveDeliveryRule(formData: FormData): Promise<DpdMutationResult> {
  const auth = await requireEarningsManage();
  if (auth.error) return { error: auth.error };

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const status = String(formData.get("status") ?? "draft").trim() as RuleStatus;
  const priorityRaw = String(formData.get("priority") ?? "").trim();
  const dpdTargetRaw = String(formData.get("dpdTarget") ?? "").trim();

  // Per-field validation: each failure names the field so the form can
  // highlight exactly what is missing instead of a generic "missing fields".
  if (!name) return { error: "name_required" };
  if (priorityRaw && !Number.isFinite(Number(priorityRaw))) {
    return { error: "invalid_priority" };
  }
  if (dpdTargetRaw) {
    const target = Number(dpdTargetRaw);
    if (!Number.isFinite(target) || target <= 0) {
      return { error: "invalid_target" };
    }
  }

  const scope = parseScopeFromForm(formData);
  if ("error" in scope) return { error: scope.error };

  const dates = parseDates(formData);
  if ("error" in dates) return { error: dates.error };

  const priority = priorityRaw ? Number(priorityRaw) : defaultPriority(scope.scopeType);

  // Populate the legacy single-FK column with the first selected scope id.
  // The new `delivery_rule_scopes` junction table is the source of truth, but
  // older databases still have the `delivery_rules_scope_check` CHECK
  // constraint that requires the legacy column to be set when the matching
  // scope_type is used. Setting the first id keeps inserts compatible with
  // both the old and new schema versions.
  const legacyScopeId = scope.ids[0] ?? null;
  const payload = {
    name,
    status,
    scope_type: scope.scopeType,
    zone_id: scope.scopeType === "zone" ? legacyScopeId : null,
    partner_id: scope.scopeType === "partner" ? legacyScopeId : null,
    restaurant_id: scope.scopeType === "restaurant" ? legacyScopeId : null,
    start_date: dates.startDate,
    end_date: dates.endDate,
    priority,
    require_verified: true,
    updated_at: new Date().toISOString(),
    dpd_target: (() => {
      const raw = String(formData.get("dpdTarget") ?? "").trim();
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
    dpd_period: (() => {
      const raw = String(formData.get("dpdPeriod") ?? "").trim();
      if (raw === "daily" || raw === "weekly" || raw === "monthly") {
        return raw as IncentivePeriod;
      }
      return null;
    })(),
  };

  let ruleId = id;
  try {
    ruleId = await writeDoc(COLLECTIONS.deliveryRules, id, payload, !id);
  } catch (err) {
    const error = pgFail(err);
    logPgError("delivery_rules:write", error);
    return { error: "save_failed", errorDetail: formatPgErrorDetail(error) };
  }

  const scopeErr = await replaceDeliveryRuleScopes(
    ruleId,
    scope.scopeType,
    scope.ids,
  );
  if (scopeErr) {
    return {
      error: "save_failed",
      errorDetail: formatPgErrorDetail(scopeErr as PgLikeError),
    };
  }

  void logAdminMutation({
    action: id ? "update" : "create",
    entityType: "delivery_rule",
    entityId: ruleId,
    routeName: "saveDeliveryRule",
    after: { name, status, scope_type: scope.scopeType },
  });

  return { success: true, id: ruleId };
}

export async function deleteDeliveryRule(id: string): Promise<DpdMutationResult> {
  const auth = await requireEarningsManage();
  if (auth.error) return { error: auth.error };
  if (!id) return { error: "missing_fields" };

  try {
    const db = await dpdDb();
    await deleteWhere(db, COLLECTIONS.deliveryRuleScopes, "delivery_rule_id", id);
    await db.collection(COLLECTIONS.deliveryRules).doc(id).delete();
  } catch {
    return { error: "delete_failed" };
  }
  void logAdminMutation({
    action: "delete",
    entityType: "delivery_rule",
    entityId: id,
    routeName: "deleteDeliveryRule",
  });
  return { success: true };
}

type TierInput = {
  threshold_deliveries: number;
  reward_mode: IncentiveRewardMode;
  reward_kwd: number | null;
  reward_per_delivery_kwd: number | null;
};

function parseTiersJson(raw: string): TierInput[] | { error: DpdErrorKey } {
  if (!raw.trim()) return { error: "invalid_tiers" };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return { error: "invalid_tiers" };
    const tiers: TierInput[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") return { error: "invalid_tiers" };
      const row = item as Record<string, unknown>;
      const threshold = Number(row.threshold_deliveries);
      const rewardMode = String(row.reward_mode ?? "") as IncentiveRewardMode;
      if (!Number.isFinite(threshold) || threshold < 1) return { error: "invalid_tiers" };
      if (rewardMode !== "fixed" && rewardMode !== "per_delivery") {
        return { error: "invalid_reward_mode" };
      }
      const rewardKwd =
        row.reward_kwd != null && row.reward_kwd !== ""
          ? Number(row.reward_kwd)
          : null;
      const perDelivery =
        row.reward_per_delivery_kwd != null && row.reward_per_delivery_kwd !== ""
          ? Number(row.reward_per_delivery_kwd)
          : null;
      if (rewardMode === "fixed") {
        if (
          !Number.isFinite(rewardKwd!) ||
          rewardKwd! < 0 ||
          !isOnRewardStep(rewardKwd!, FIXED_REWARD_STEP_KWD)
        ) {
          return { error: "invalid_reward" };
        }
      } else if (
        !Number.isFinite(perDelivery!) ||
        perDelivery! < 0 ||
        !isOnRewardStep(perDelivery!, PER_DELIVERY_REWARD_STEP_KWD)
      ) {
        return { error: "invalid_reward" };
      }
      tiers.push({
        threshold_deliveries: threshold,
        reward_mode: rewardMode,
        reward_kwd: rewardMode === "fixed" ? rewardKwd : null,
        reward_per_delivery_kwd:
          rewardMode === "per_delivery" ? perDelivery : null,
      });
    }
    tiers.sort((a, b) => a.threshold_deliveries - b.threshold_deliveries);
    for (let i = 1; i < tiers.length; i++) {
      if (tiers[i].threshold_deliveries <= tiers[i - 1].threshold_deliveries) {
        return { error: "invalid_tiers" };
      }
    }
    return tiers;
  } catch {
    return { error: "invalid_tiers" };
  }
}

export async function saveIncentiveRule(formData: FormData): Promise<DpdMutationResult> {
  const auth = await requireEarningsManage();
  if (auth.error) return { error: auth.error };

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const status = String(formData.get("status") ?? "draft").trim() as RuleStatus;
  const period = String(formData.get("period") ?? "").trim() as IncentivePeriod;
  const targetMode = String(formData.get("targetMode") ?? "single").trim() as IncentiveTargetMode;
  const baseRaw = String(formData.get("baseMinimumDeliveries") ?? "0").trim();
  const rewardMode = String(formData.get("rewardMode") ?? "fixed").trim() as IncentiveRewardMode;
  const payoutMode = (String(formData.get("payoutMode") ?? "milestone").trim() === "cumulative"
    ? "cumulative"
    : "milestone") as IncentivePayoutMode;
  const overridesOthers = String(formData.get("overridesOthers") ?? "false") === "true";
  const targetRaw = String(formData.get("targetDeliveries") ?? "").trim();
  const rewardRaw = String(formData.get("rewardKwd") ?? "").trim();
  const perDeliveryRaw = String(formData.get("rewardPerDeliveryKwd") ?? "").trim();
  const tiersRaw = String(formData.get("tiersJson") ?? "").trim();
  const priorityRaw = String(formData.get("priority") ?? "").trim();

  if (!name) return { error: "name_required" };
  if (!period) return { error: "missing_fields" };
  if (targetMode !== "single" && targetMode !== "tiered") return { error: "invalid_target" };

  const baseMinimum = Number(baseRaw);
  if (!Number.isFinite(baseMinimum) || baseMinimum < 0) return { error: "invalid_base" };

  const scope = parseScopeFromForm(formData);
  if ("error" in scope) return { error: scope.error };

  const dates = parseDates(formData);
  if ("error" in dates) return { error: dates.error };

  const priority = priorityRaw ? Number(priorityRaw) : defaultPriority(scope.scopeType);

  let targetDeliveries: number | null = null;
  let rewardKwd = 0;
  let rewardPerDeliveryKwd: number | null = null;
  let tiers: TierInput[] = [];

  if (targetMode === "single") {
    const target = Number(targetRaw);
    if (!Number.isFinite(target) || target <= baseMinimum) return { error: "invalid_target" };
    if (payoutMode === "cumulative" && rewardMode === "fixed") {
      // Cumulative + fixed pays as soon as eligible > base; target still required for validation
    }
    targetDeliveries = target;
    if (rewardMode !== "fixed" && rewardMode !== "per_delivery") {
      return { error: "invalid_reward_mode" };
    }
    if (rewardMode === "fixed") {
      const reward = Number(rewardRaw);
      if (
        !Number.isFinite(reward) ||
        reward < 0 ||
        !isOnRewardStep(reward, FIXED_REWARD_STEP_KWD)
      ) {
        return { error: "invalid_reward" };
      }
      rewardKwd = reward;
    } else {
      const rate = Number(perDeliveryRaw);
      if (
        !Number.isFinite(rate) ||
        rate < 0 ||
        !isOnRewardStep(rate, PER_DELIVERY_REWARD_STEP_KWD)
      ) {
        return { error: "invalid_reward" };
      }
      rewardPerDeliveryKwd = rate;
    }
  } else {
    const parsedTiers = parseTiersJson(tiersRaw);
    if ("error" in parsedTiers) return { error: parsedTiers.error };
    tiers = parsedTiers;
    if (tiers[0].threshold_deliveries <= baseMinimum) return { error: "invalid_tiers" };
  }

  // Same backwards-compat shim as saveDeliveryRule — keep the legacy single-FK
  // column populated with the first selected scope id so inserts pass even on
  // older databases that still enforce `incentive_rules_scope_check`.
  const legacyScopeId = scope.ids[0] ?? null;
  const payload = {
    name,
    status,
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
      targetMode === "single" && rewardMode === "per_delivery"
        ? rewardPerDeliveryKwd
        : null,
    payout_mode: payoutMode,
    overrides_others: overridesOthers,
    start_date: dates.startDate,
    end_date: dates.endDate,
    priority,
    updated_at: new Date().toISOString(),
  };

  let ruleId = id;
  const db = await dpdDb();
  try {
    ruleId = await writeDoc(COLLECTIONS.incentiveRules, id, payload, !id);
    await deleteWhere(db, COLLECTIONS.incentiveRuleTiers, "incentive_rule_id", ruleId);
    if (targetMode === "tiered" && tiers.length > 0) {
      await insertRows(
        db,
        COLLECTIONS.incentiveRuleTiers,
        tiers.map((tier, index) => ({
          incentive_rule_id: ruleId,
          sort_order: index,
          threshold_deliveries: tier.threshold_deliveries,
          reward_mode: tier.reward_mode,
          reward_kwd: tier.reward_mode === "fixed" ? tier.reward_kwd : null,
          reward_per_delivery_kwd:
            tier.reward_mode === "per_delivery" ? tier.reward_per_delivery_kwd : null,
        })),
      );
    }
  } catch (err) {
    const error = pgFail(err);
    logPgError("incentive_rules:write", error);
    return { error: "save_failed", errorDetail: formatPgErrorDetail(error) };
  }

  const scopeErr = await replaceIncentiveRuleScopes(
    ruleId,
    scope.scopeType,
    scope.ids,
  );
  if (scopeErr) {
    return {
      error: "save_failed",
      errorDetail: formatPgErrorDetail(scopeErr as PgLikeError),
    };
  }

  void logAdminMutation({
    action: ruleId ? "update" : "create",
    entityType: "incentive_rule",
    entityId: ruleId,
    routeName: "saveIncentiveRule",
    after: { name, status, scope_type: scope.scopeType, period },
  });

  return { success: true, id: ruleId };
}

export async function deleteIncentiveRule(id: string): Promise<DpdMutationResult> {
  const auth = await requireEarningsManage();
  if (auth.error) return { error: auth.error };
  if (!id) return { error: "missing_fields" };

  try {
    const db = await dpdDb();
    await deleteWhere(db, COLLECTIONS.incentiveRuleTiers, "incentive_rule_id", id);
    await deleteWhere(db, COLLECTIONS.incentiveRuleScopes, "incentive_rule_id", id);
    await db.collection(COLLECTIONS.incentiveRules).doc(id).delete();
  } catch {
    return { error: "delete_failed" };
  }
  void logAdminMutation({
    action: "delete",
    entityType: "incentive_rule",
    entityId: id,
    routeName: "deleteIncentiveRule",
  });
  return { success: true };
}

export async function runPreviewEarnings(earnDate: string) {
  const auth = await requireEarningsView();
  if (auth.error) return { error: auth.error };
  if (!earnDate) return { error: "missing_fields" as const };
  void logAdminRead("earnings_preview", "runPreviewEarnings", { earnDate });
  return previewDriverEarnings(earnDate);
}

export async function runRecalculateEarnings(earnDate: string) {
  const auth = await requireEarningsManage();
  if (auth.error) return { error: auth.error };
  if (!earnDate) return { error: "missing_fields" as const };
  const result = await recalculateEarningsForDate(earnDate);
  void logAdminMutation({
    action: "recalculate",
    entityType: "driver_earnings_daily",
    routeName: "runRecalculateEarnings",
    context: { earnDate, count: "count" in result ? result.count : null },
    success: !("error" in result),
    errorMessage: "error" in result ? result.error : undefined,
  });
  return result;
}

export async function runRecalculateEarningsRange(
  startDate: string,
  endDate: string,
  driverId?: string | null,
) {
  const auth = await requireEarningsManage();
  if (auth.error) return { error: auth.error };
  if (!startDate || !endDate) return { error: "missing_fields" as const };
  const result = await recalculateEarningsForRange(startDate, endDate, driverId);
  void logAdminMutation({
    action: "recalculate",
    entityType: "driver_earnings_daily",
    entityId: driverId ?? undefined,
    routeName: "runRecalculateEarningsRange",
    context: { startDate, endDate, count: "count" in result ? result.count : null },
    success: !("error" in result),
    errorMessage: "error" in result ? result.error : undefined,
  });
  return result;
}

export async function runGetEarningsDetail(driverId: string, earnDate: string) {
  const auth = await requireEarningsView();
  if (auth.error) return { error: auth.error };
  if (!driverId || !earnDate) return { error: "missing_fields" as const };
  void logAdminRead("driver_earnings_detail", "runGetEarningsDetail", {
    driverId,
    earnDate,
  });
  return getDriverEarningsDetail(driverId, earnDate);
}

export async function runListDriverEarningsDaily(
  startDate: string,
  endDate: string,
  driverId?: string | null,
): Promise<EarningsDailyListResult | { error: string }> {
  const auth = await requireEarningsView();
  if (auth.error) return { error: auth.error };
  if (!startDate || !endDate) return { error: "missing_fields" as const };
  void logAdminRead("driver_earnings_daily", "runListDriverEarningsDaily", {
    startDate,
    endDate,
    driverId: driverId ?? null,
  });
  return listDriverEarningsDaily(startDate, endDate, driverId);
}

export async function runValidateDelivery(deliveryId: string) {
  const auth = await requireEarningsView();
  if (auth.error) return { error: auth.error };
  if (!deliveryId) return { error: "missing_fields" as const };
  return validateDeliveryForRules(deliveryId);
}

export async function previewDpdTargetImport(
  rows: DpdTargetImportInputRow[],
): Promise<DpdTargetImportPreviewRow[]> {
  await requireEarningsView();
  const rules = await fetchDeliveryRulesForAdmin();
  const scopes = await fetchDpdScopeOptions();
  return previewDpdTargetRows({
    rows,
    restaurants: scopes.restaurants.map((r) => ({
      id: r.id,
      name: r.name,
      partner_name: r.partner_name,
    })),
    zones: scopes.zones.map((z) => ({
      id: z.id,
      name: z.name,
      code: z.code,
    })),
    rules: rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      status: rule.status,
      priority: rule.priority,
      scope_type: rule.scope_type,
      restaurant_ids: rule.restaurant_ids,
      zone_ids: rule.zone_ids,
    })),
  });
}

export async function applyDpdTargetImport(
  rows: DpdTargetImportInputRow[],
): Promise<
  { updated: number; created: number; rejected: number } | { error: string }
> {
  const auth = await requireEarningsManage();
  if (auth.error) return { error: auth.error };

  const preview = await previewDpdTargetImport(rows);
  const db = await dpdDb();
  let updated = 0;
  let created = 0;
  for (const row of applyableDpdTargetRows(preview)) {
    const period = row.dpd_period.trim().toLowerCase();
    const window = row.start_date && row.end_date
      ? { start_date: row.start_date, end_date: row.end_date }
      : null;
    if (row.status === "ok" && row.rule_id) {
      try {
        await db.collection(COLLECTIONS.deliveryRules).doc(row.rule_id).set(
          {
            dpd_target: Number(row.dpd_target),
            dpd_period: period,
            ...(window ?? {}),
            updated_at: new Date().toISOString(),
          },
          { merge: true },
        );
      } catch {
        return { error: "save_failed" };
      }
      updated += 1;
      continue;
    }
    if (row.status !== "create" || !row.scope_id || !row.resolved_scope) continue;
    const { error } = await callAdminFunction("admin_insert_delivery_rule_with_scope", {
      p_name: row.name,
      p_scope_type: row.resolved_scope,
      p_scope_id: row.scope_id,
      p_dpd_target: Number(row.dpd_target),
      p_dpd_period: period,
      name: row.name,
      scopeType: row.resolved_scope,
      scopeId: row.scope_id,
      dpdTarget: Number(row.dpd_target),
      dpdPeriod: period,
      ...(window
        ? {
            p_start_date: window.start_date,
            p_end_date: window.end_date,
            startDate: window.start_date,
            endDate: window.end_date,
          }
        : {}),
    });
    if (error) {
      logPgError("admin_insert_delivery_rule_with_scope", pgFail(error));
      return { error: "save_failed" };
    }
    created += 1;
  }

  void logAdminMutation({
    action: created > 0 && updated === 0 ? "create" : "update",
    entityType: "delivery_rule",
    entityId: "bulk-dpd-targets",
    routeName: "applyDpdTargetImport",
    after: { updated, created },
  });

  return {
    updated,
    created,
    rejected: preview.filter((r) => r.status !== "ok" && r.status !== "create")
      .length,
  };
}

async function previewIncentiveRuleImportRows(
  rows: IncentiveImportInputRow[],
) {
  const [scopes, rules] = await Promise.all([
    fetchDpdScopeOptions(),
    fetchIncentiveRulesForAdmin(),
  ]);
  return previewIncentiveRuleRows({
    rows,
    restaurants: scopes.restaurants.map((r) => ({ id: r.id, name: r.name })),
    existing: rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      status: rule.status,
      restaurant_ids: uniqueRestaurantIds([
        ...rule.restaurant_ids,
        rule.restaurant_id,
      ]),
      start_date: rule.start_date,
      end_date: rule.end_date,
    })),
    kuwaitToday: kuwaitTodayYmd(),
  });
}

export async function previewIncentiveRuleImport(rows: IncentiveImportInputRow[]) {
  const auth = await requireEarningsView();
  if (auth.error) return [];
  return previewIncentiveRuleImportRows(rows);
}

export async function applyIncentiveRuleImport(
  rows: IncentiveImportInputRow[],
): Promise<{ applied: number; replaced: number; rejected: number } | { error: string }> {
  const auth = await requireEarningsManage();
  if (auth.error) return { error: auth.error };

  const preview = await previewIncentiveRuleImportRows(rows);
  const ready = applyableIncentiveImportRows(preview);
  if (ready.length === 0) return { applied: 0, replaced: 0, rejected: preview.length };

  const db = await dpdDb();
  const ended = new Set<string>();
  let applied = 0;
  let replaced = 0;

  for (const row of ready) {
    if (!row.restaurant_id) continue;
    if (row.target_mode === "tiered" && row.parsed_tiers.length === 0) continue;
    const start = parseIsoDate(row.start);
    const end = parseIsoDate(row.end);
    if (!start || !end) continue;

    for (const replaceId of row.replace_rule_ids) {
      if (ended.has(replaceId)) continue;
      try {
        await db.collection(COLLECTIONS.incentiveRules).doc(replaceId).set(
          { status: "ended", updated_at: new Date().toISOString() },
          { merge: true },
        );
      } catch (err) {
        logPgError("incentive_rules:admin-end", pgFail(err));
        return { error: "save_failed" };
      }
      ended.add(replaceId);
      replaced += 1;
    }

    const uploadedStart = start;
    const effectiveStart = effectiveIncentiveImportStart({
      uploadedStart,
      kuwaitToday: kuwaitTodayYmd(),
      replaces: row.replace_rule_ids.length > 0,
    });
    if (effectiveStart > end) {
      return { error: "invalid_range" };
    }

    const payload = {
      name: row.rule_name,
      status: row.rule_status,
      scope_type: "restaurant" as const,
      zone_id: null,
      partner_id: null,
      restaurant_id: row.restaurant_id,
      period: row.period,
      target_mode: row.target_mode,
      base_minimum_deliveries: row.base_minimum_deliveries,
      target_deliveries:
        row.target_mode === "single" ? row.target_deliveries : null,
      reward_mode: row.reward_mode,
      reward_kwd: row.reward_mode === "fixed" ? row.reward_kwd : 0,
      reward_per_delivery_kwd:
        row.reward_mode === "per_delivery" ? row.reward_per_delivery_kwd : null,
      payout_mode: "milestone" as const,
      overrides_others: row.overrides_others,
      start_date: effectiveStart,
      end_date: end,
      priority: row.priority ?? defaultPriority("restaurant"),
      updated_at: new Date().toISOString(),
    };

    let ruleId: string;
    try {
      ruleId = await writeDoc(COLLECTIONS.incentiveRules, "", payload, true);
      if (row.target_mode === "tiered") {
        await insertRows(
          db,
          COLLECTIONS.incentiveRuleTiers,
          row.parsed_tiers.map((tier, index) => ({
            incentive_rule_id: ruleId,
            sort_order: index,
            threshold_deliveries: tier.threshold_deliveries,
            reward_mode: tier.reward_mode,
            reward_kwd: tier.reward_mode === "fixed" ? tier.amount : null,
            reward_per_delivery_kwd:
              tier.reward_mode === "per_delivery" ? tier.amount : null,
          })),
        );
      }
    } catch (err) {
      logPgError("incentive_rules:admin-insert", pgFail(err));
      return { error: "save_failed" };
    }

    const scopeErr = await replaceIncentiveRuleScopes(
      ruleId,
      "restaurant",
      [row.restaurant_id],
    );
    if (scopeErr) return { error: "save_failed" };
    applied += 1;
  }

  void logAdminMutation({
    action: "create",
    entityType: "incentive_rule",
    entityId: "bulk-incentive-import",
    routeName: "applyIncentiveRuleImport",
    after: { applied, replaced, rejected: preview.length - ready.length },
  });

  return { applied, replaced, rejected: preview.length - ready.length };
}

export { isDpdErrorKey };
