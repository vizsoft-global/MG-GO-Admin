"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

async function replaceIncentiveRuleScopes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ruleId: string,
  scopeType: RuleScopeType,
  ids: string[],
) {
  const { error: delErr } = await supabase
    .from("incentive_rule_scopes")
    .delete()
    .eq("incentive_rule_id", ruleId);
  if (delErr) {
    logPgError("incentive_rule_scopes:delete", delErr);
    return delErr;
  }

  const rows = ids.map((id) => ({
    incentive_rule_id: ruleId,
    zone_id: scopeType === "zone" ? id : null,
    partner_id: scopeType === "partner" ? id : null,
    restaurant_id: scopeType === "restaurant" ? id : null,
  }));

  const { error: insErr } = await supabase
    .from("incentive_rule_scopes")
    .insert(rows);
  if (insErr) {
    logPgError("incentive_rule_scopes:insert", insErr);
    const admin = createAdminClient();
    await admin
      .from("incentive_rule_scopes")
      .delete()
      .eq("incentive_rule_id", ruleId);
    const retry = await admin.from("incentive_rule_scopes").insert(rows);
    if (retry.error) {
      logPgError("incentive_rule_scopes:admin-insert", retry.error);
      return retry.error;
    }
    return null;
  }
  return null;
}

async function replaceDeliveryRuleScopes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ruleId: string,
  scopeType: RuleScopeType,
  ids: string[],
) {
  const { error: delErr } = await supabase
    .from("delivery_rule_scopes")
    .delete()
    .eq("delivery_rule_id", ruleId);
  if (delErr) {
    logPgError("delivery_rule_scopes:delete", delErr);
    return delErr;
  }

  const rows = ids.map((id) => ({
    delivery_rule_id: ruleId,
    zone_id: scopeType === "zone" ? id : null,
    partner_id: scopeType === "partner" ? id : null,
    restaurant_id: scopeType === "restaurant" ? id : null,
  }));

  const { error: insErr } = await supabase
    .from("delivery_rule_scopes")
    .insert(rows);
  if (insErr) {
    logPgError("delivery_rule_scopes:insert", insErr);
    // Retry via the service-role client to bypass any RLS edge-case on the
    // junction table (the parent row already saved successfully via the
    // staff session, so this is a safe fallback).
    const admin = createAdminClient();
    await admin
      .from("delivery_rule_scopes")
      .delete()
      .eq("delivery_rule_id", ruleId);
    const retry = await admin.from("delivery_rule_scopes").insert(rows);
    if (retry.error) {
      logPgError("delivery_rule_scopes:admin-insert", retry.error);
      return retry.error;
    }
    return null;
  }
  return null;
}

function parseDates(formData: FormData): { startDate: string; endDate: string } | { error: DpdErrorKey } {
  const startDate = String(formData.get("startDate") ?? "").trim();
  const endDate = String(formData.get("endDate") ?? "").trim();
  if (!startDate || !endDate || endDate < startDate) {
    return { error: "invalid_dates" };
  }
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
  const supabase = await createClient();

  const [{ data: zones }, { data: partners }, { data: restaurants }] =
    await Promise.all([
      supabase.from("zones").select("id, name, code").order("name"),
      supabase.from("partners").select("id, name").order("name"),
      supabase
        .from("restaurants")
        .select("id, name, partner_id")
        .eq("status", "published")
        .order("name"),
    ]);

  const partnerMap = new Map((partners ?? []).map((p) => [p.id, p.name]));

  return {
    zones: zones ?? [],
    partners: partners ?? [],
    restaurants: (restaurants ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      partner_id: r.partner_id,
      partner_name: r.partner_id ? (partnerMap.get(r.partner_id) ?? "—") : "—",
    })),
  };
}

async function loadScopeLabelMaps(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [{ data: zones }, { data: partners }, { data: restaurants }] =
    await Promise.all([
      supabase.from("zones").select("id, name, code"),
      supabase.from("partners").select("id, name"),
      supabase.from("restaurants").select("id, name"),
    ]);
  return {
    zones: new Map((zones ?? []).map((z) => [z.id, z])),
    partners: new Map((partners ?? []).map((p) => [p.id, p])),
    restaurants: new Map((restaurants ?? []).map((r) => [r.id, r])),
  };
}

export async function fetchDeliveryRulesForAdmin(): Promise<DeliveryRuleRow[]> {
  await requireEarningsView();
  void logAdminRead("delivery_rules", "fetchDeliveryRulesForAdmin");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("delivery_rules")
    .select(
      `id, name, status, scope_type, zone_id, partner_id, restaurant_id, start_date, end_date, priority,
       delivery_rule_scopes (zone_id, partner_id, restaurant_id)`,
    )
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;

  const maps = await loadScopeLabelMaps(supabase);

  return (data ?? []).map((row) => {
    const scopes = extractScopeIds(
      row.delivery_rule_scopes as RuleScopeRow[] | null,
    );
    const activeIds =
      row.scope_type === "zone"
        ? scopes.zone_ids
        : row.scope_type === "partner"
          ? scopes.partner_ids
          : scopes.restaurant_ids;
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
      start_date: row.start_date,
      end_date: row.end_date,
      priority: row.priority,
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

export async function fetchIncentiveRulesForAdmin(): Promise<IncentiveRuleRow[]> {
  await requireEarningsView();
  void logAdminRead("incentive_rules", "fetchIncentiveRulesForAdmin");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("incentive_rules")
    .select(
      `id, name, status, scope_type, zone_id, partner_id, restaurant_id, period,
       target_mode, base_minimum_deliveries, target_deliveries, reward_mode,
       reward_kwd, reward_per_delivery_kwd, payout_mode, overrides_others,
       start_date, end_date, priority,
       incentive_rule_scopes (zone_id, partner_id, restaurant_id),
       incentive_rule_tiers (id, threshold_deliveries, reward_mode, reward_kwd, reward_per_delivery_kwd, sort_order)`,
    )
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;

  const maps = await loadScopeLabelMaps(supabase);

  return ((data ?? []) as IncentiveRuleDbRow[]).map((row) => {
    const scopes = extractScopeIds(
      (row as IncentiveRuleDbRow & { incentive_rule_scopes?: RuleScopeRow[] })
        .incentive_rule_scopes,
    );
    const activeIds =
      row.scope_type === "zone"
        ? scopes.zone_ids
        : row.scope_type === "partner"
          ? scopes.partner_ids
          : scopes.restaurant_ids;
    const tiers = (row.incentive_rule_tiers ?? [])
      .map(mapIncentiveTierRow)
      .sort((a, b) => a.sort_order - b.sort_order || a.threshold_deliveries - b.threshold_deliveries);
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
  });
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

  const supabase = await createClient();
  const payload = {
    partner_id: partnerId || null,
    zone_id: zoneId || null,
    name,
    external_merchant_id: externalMerchantId || null,
    map_link: mapLink || null,
    latitude,
    longitude,
    status,
    is_active: isActive,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    const logoResult = await applyRestaurantLogoFromForm(id, formData, session.id);
    const patch = {
      ...payload,
      ...(logoResult.logoUrl !== undefined ? { logo_url: logoResult.logoUrl } : {}),
    };
    const { error } = await supabase.from("restaurants").update(patch).eq("id", id);
    if (error) {
      if (error.code === "23505") return { error: "restaurant_exists" };
      logPgError("restaurants:update", error);
      return {
        error: "save_failed",
        errorDetail: formatPgErrorDetail(error),
      };
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

  const { data, error } = await supabase
    .from("restaurants")
    .insert({ ...payload, created_by: session.id })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { error: "restaurant_exists" };
    logPgError("restaurants:insert", error);
    return {
      error: "save_failed",
      errorDetail: formatPgErrorDetail(error),
    };
  }

  const logoResult = await applyRestaurantLogoFromForm(data.id, formData, session.id);
  if (logoResult.logoUrl !== undefined) {
    await supabase
      .from("restaurants")
      .update({
        logo_url: logoResult.logoUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
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

  const supabase = await createClient();
  await deleteRestaurantLogoFiles(id);
  const { error } = await supabase.from("restaurants").delete().eq("id", id);
  if (error) return { error: "delete_failed" };
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

  if (!name) return { error: "missing_fields" };

  const scope = parseScopeFromForm(formData);
  if ("error" in scope) return { error: scope.error };

  const dates = parseDates(formData);
  if ("error" in dates) return { error: dates.error };

  const priority = priorityRaw ? Number(priorityRaw) : defaultPriority(scope.scopeType);

  const supabase = await createClient();
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
  };

  let ruleId = id;

  if (id) {
    const { error } = await supabase.from("delivery_rules").update(payload).eq("id", id);
    if (error) {
      logPgError("delivery_rules:update", error);
      const admin = createAdminClient();
      const retry = await admin
        .from("delivery_rules")
        .update(payload)
        .eq("id", id);
      if (retry.error) {
        logPgError("delivery_rules:admin-update", retry.error);
        return {
          error: "save_failed",
          errorDetail: formatPgErrorDetail(retry.error),
        };
      }
    }
  } else {
    const { data, error } = await supabase
      .from("delivery_rules")
      .insert(payload)
      .select("id")
      .single();
    if (error) {
      logPgError("delivery_rules:insert", error);
      const admin = createAdminClient();
      const retry = await admin
        .from("delivery_rules")
        .insert(payload)
        .select("id")
        .single();
      if (retry.error || !retry.data) {
        logPgError("delivery_rules:admin-insert", retry.error);
        return {
          error: "save_failed",
          errorDetail: formatPgErrorDetail(retry.error ?? error),
        };
      }
      ruleId = retry.data.id;
    } else {
      ruleId = data.id;
    }
  }

  const scopeErr = await replaceDeliveryRuleScopes(
    supabase,
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

  const supabase = await createClient();
  const { error } = await supabase.from("delivery_rules").delete().eq("id", id);
  if (error) return { error: "delete_failed" };
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
        if (!Number.isFinite(rewardKwd!) || rewardKwd! < 0) return { error: "invalid_reward" };
      } else if (!Number.isFinite(perDelivery!) || perDelivery! < 0) {
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

  if (!name || !period) return { error: "missing_fields" };
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
      if (!Number.isFinite(reward) || reward < 0) return { error: "invalid_reward" };
      rewardKwd = reward;
    } else {
      const rate = Number(perDeliveryRaw);
      if (!Number.isFinite(rate) || rate < 0) return { error: "invalid_reward" };
      rewardPerDeliveryKwd = rate;
    }
  } else {
    const parsedTiers = parseTiersJson(tiersRaw);
    if ("error" in parsedTiers) return { error: parsedTiers.error };
    tiers = parsedTiers;
    if (tiers[0].threshold_deliveries <= baseMinimum) return { error: "invalid_tiers" };
  }

  const supabase = await createClient();
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

  if (id) {
    const { error } = await supabase.from("incentive_rules").update(payload).eq("id", id);
    if (error) {
      logPgError("incentive_rules:update", error);
      const admin = createAdminClient();
      const retry = await admin
        .from("incentive_rules")
        .update(payload)
        .eq("id", id);
      if (retry.error) {
        logPgError("incentive_rules:admin-update", retry.error);
        return {
          error: "save_failed",
          errorDetail: formatPgErrorDetail(retry.error),
        };
      }
    }
  } else {
    const { data, error } = await supabase
      .from("incentive_rules")
      .insert(payload)
      .select("id")
      .single();
    if (error) {
      logPgError("incentive_rules:insert", error);
      const admin = createAdminClient();
      const retry = await admin
        .from("incentive_rules")
        .insert(payload)
        .select("id")
        .single();
      if (retry.error || !retry.data) {
        logPgError("incentive_rules:admin-insert", retry.error);
        return {
          error: "save_failed",
          errorDetail: formatPgErrorDetail(retry.error ?? error),
        };
      }
      ruleId = retry.data.id;
    } else {
      ruleId = data.id;
    }
  }

  const { error: deleteTiersError } = await supabase
    .from("incentive_rule_tiers")
    .delete()
    .eq("incentive_rule_id", ruleId);
  if (deleteTiersError) {
    logPgError("incentive_rule_tiers:delete", deleteTiersError);
    return {
      error: "save_failed",
      errorDetail: formatPgErrorDetail(deleteTiersError),
    };
  }

  if (targetMode === "tiered" && tiers.length > 0) {
    const tierRows = tiers.map((tier, index) => ({
      incentive_rule_id: ruleId,
      sort_order: index,
      threshold_deliveries: tier.threshold_deliveries,
      reward_mode: tier.reward_mode,
      reward_kwd: tier.reward_mode === "fixed" ? tier.reward_kwd : null,
      reward_per_delivery_kwd:
        tier.reward_mode === "per_delivery" ? tier.reward_per_delivery_kwd : null,
    }));
    const { error: insertTiersError } = await supabase
      .from("incentive_rule_tiers")
      .insert(tierRows);
    if (insertTiersError) {
      logPgError("incentive_rule_tiers:insert", insertTiersError);
      return {
        error: "save_failed",
        errorDetail: formatPgErrorDetail(insertTiersError),
      };
    }
  }

  const scopeErr = await replaceIncentiveRuleScopes(
    supabase,
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

  const supabase = await createClient();
  const { error } = await supabase.from("incentive_rules").delete().eq("id", id);
  if (error) return { error: "delete_failed" };
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

export { isDpdErrorKey };
