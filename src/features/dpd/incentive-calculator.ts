import type { Firestore } from "firebase-admin/firestore";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import type {
  DeliveryValidationResult,
  EarningsDailyListResult,
  EarningsDetailResult,
  EarningsPreviewResult,
} from "./types";

type RuleScopeRow = {
  zone_id: string | null;
  partner_id: string | null;
  restaurant_id: string | null;
};

type DeliveryRuleWithScopes = {
  id: string;
  name: string;
  scope_type: "zone" | "partner" | "restaurant";
  start_date: string;
  end_date: string;
  delivery_rule_scopes: RuleScopeRow[] | null;
};

function deliveryMatchesRuleScopes(
  rule: DeliveryRuleWithScopes,
  delivery: {
    zone_id: string | null;
    partner_id: string | null;
    restaurant_id: string | null;
  },
): boolean {
  const scopes = rule.delivery_rule_scopes ?? [];
  return scopes.some(
    (scope) =>
      (rule.scope_type === "zone" && scope.zone_id === delivery.zone_id) ||
      (rule.scope_type === "partner" && scope.partner_id === delivery.partner_id) ||
      (rule.scope_type === "restaurant" &&
        scope.restaurant_id === delivery.restaurant_id),
  );
}

function isoOf(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  const ts = value as { toDate?: () => Date };
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  return null;
}

async function calculatorDb(): Promise<Firestore | null> {
  return staffDb();
}

export async function validateDeliveryForRules(
  deliveryId: string,
): Promise<DeliveryValidationResult> {
  const db = await calculatorDb();
  if (!db) {
    return { eligible: false, matchedRuleIds: [], reasons: ["validation_failed"] };
  }

  const deliverySnap = await db.collection(COLLECTIONS.deliveries).doc(deliveryId).get();
  const deliveryData = deliverySnap.data();
  if (!deliverySnap.exists || !deliveryData) {
    return {
      eligible: false,
      matchedRuleIds: [],
      reasons: ["delivery_not_found"],
    };
  }

  const delivery = {
    id: deliverySnap.id,
    status: deliveryData.status == null ? null : String(deliveryData.status),
    zone_id: deliveryData.zone_id == null ? null : String(deliveryData.zone_id),
    partner_id: deliveryData.partner_id == null ? null : String(deliveryData.partner_id),
    restaurant_id: deliveryData.restaurant_id == null ? null : String(deliveryData.restaurant_id),
    delivered_at: isoOf(deliveryData.delivered_at),
  };

  if (delivery.status !== "verified") {
    return {
      eligible: false,
      matchedRuleIds: [],
      reasons: ["not_verified"],
    };
  }

  const deliverDate = delivery.delivered_at
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kuwait",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(delivery.delivered_at))
    : null;

  const { data: matches, error: matchError } = await callAdminFunction(
    "delivery_matches_rules",
    {
      p_delivery_id: deliveryId,
      p_on_date: deliverDate ?? undefined,
    },
  );

  if (matchError) {
    return {
      eligible: false,
      matchedRuleIds: [],
      reasons: ["validation_failed"],
    };
  }

  const rulesSnap = await db
    .collection(COLLECTIONS.deliveryRules)
    .where("status", "==", "active")
    .get();
  const ruleIds = rulesSnap.docs.map((doc) => doc.id);
  const scopesByRule = new Map<string, RuleScopeRow[]>();
  for (let i = 0; i < ruleIds.length; i += 30) {
    const chunk = ruleIds.slice(i, i + 30);
    const scopeSnap = await db
      .collection(COLLECTIONS.deliveryRuleScopes)
      .where("delivery_rule_id", "in", chunk)
      .get();
    for (const doc of scopeSnap.docs) {
      const data = doc.data();
      const ruleId = data.delivery_rule_id == null ? "" : String(data.delivery_rule_id);
      if (!ruleId) continue;
      const list = scopesByRule.get(ruleId) ?? [];
      list.push({
        zone_id: data.zone_id == null ? null : String(data.zone_id),
        partner_id: data.partner_id == null ? null : String(data.partner_id),
        restaurant_id: data.restaurant_id == null ? null : String(data.restaurant_id),
      });
      scopesByRule.set(ruleId, list);
    }
  }

  const rules: DeliveryRuleWithScopes[] = rulesSnap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      name: String(data.name ?? ""),
      scope_type: String(data.scope_type ?? "zone") as DeliveryRuleWithScopes["scope_type"],
      start_date: String(data.start_date ?? ""),
      end_date: String(data.end_date ?? ""),
      delivery_rule_scopes: scopesByRule.get(doc.id) ?? [],
    };
  });

  const matchedRuleIds: string[] = [];
  const reasons: string[] = [];

  for (const rule of rules) {
    if (
      deliverDate &&
      (deliverDate < rule.start_date || deliverDate > rule.end_date)
    ) {
      continue;
    }
    if (deliveryMatchesRuleScopes(rule, delivery)) {
      matchedRuleIds.push(rule.id);
    }
  }

  if (!matches && rules.length > 0) {
    reasons.push("no_matching_scope");
  }

  return {
    eligible: Boolean(matches),
    matchedRuleIds,
    reasons,
  };
}

export async function previewDriverEarnings(
  earnDate: string,
): Promise<EarningsPreviewResult | { error: string }> {
  const { data, error } = await callAdminFunction("preview_driver_earnings", {
    p_earn_date: earnDate,
  });

  if (error) return { error: "preview_failed" };
  return data as EarningsPreviewResult;
}

export async function recalculateEarningsForDate(
  earnDate: string,
): Promise<{ count: number } | { error: string }> {
  const { data, error } = await callAdminFunction("recalculate_earnings_for_date", {
    p_earn_date: earnDate,
  });

  if (error) return { error: "recalc_failed" };
  return { count: (data as number | null) ?? 0 };
}

export async function recalculateDriverEarnings(
  driverId: string,
  earnDate: string,
): Promise<{ success: true } | { error: string }> {
  const { error } = await callAdminFunction("recalculate_driver_earnings", {
    p_driver_id: driverId,
    p_earn_date: earnDate,
  });

  if (error) return { error: "recalc_failed" };
  return { success: true };
}

export async function recalculateEarningsForRange(
  startDate: string,
  endDate: string,
  driverId?: string | null,
): Promise<{ count: number } | { error: string }> {
  const { data, error } = await callAdminFunction("recalculate_earnings_for_range", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_driver_id: driverId ?? undefined,
  });

  if (error) return { error: "recalc_failed" };
  return { count: (data as number | null) ?? 0 };
}

export async function getDriverEarningsDetail(
  driverId: string,
  earnDate: string,
): Promise<EarningsDetailResult | { error: string }> {
  const { data, error } = await callAdminFunction("get_driver_earnings_detail", {
    p_driver_id: driverId,
    p_earn_date: earnDate,
  });

  if (error) return { error: "detail_failed" };
  return data as EarningsDetailResult;
}

export async function listDriverEarningsDaily(
  startDate: string,
  endDate: string,
  driverId?: string | null,
): Promise<EarningsDailyListResult | { error: string }> {
  const { data, error } = await callAdminFunction("list_driver_earnings_daily", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_driver_id: driverId ?? undefined,
  });

  if (error) return { error: "list_failed" };
  return data as EarningsDailyListResult;
}
