import { createClient } from "@/lib/supabase/server";
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

export async function validateDeliveryForRules(
  deliveryId: string,
): Promise<DeliveryValidationResult> {
  const supabase = await createClient();

  const { data: delivery, error } = await supabase
    .from("deliveries")
    .select("id, status, zone_id, partner_id, restaurant_id, delivered_at")
    .eq("id", deliveryId)
    .maybeSingle();

  if (error || !delivery) {
    return {
      eligible: false,
      matchedRuleIds: [],
      reasons: ["delivery_not_found"],
    };
  }

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

  const { data: matches, error: matchError } = await supabase.rpc(
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

  const { data: rules } = await supabase
    .from("delivery_rules")
    .select(
      "id, name, scope_type, start_date, end_date, delivery_rule_scopes (zone_id, partner_id, restaurant_id)",
    )
    .eq("status", "active");

  const matchedRuleIds: string[] = [];
  const reasons: string[] = [];

  for (const rule of (rules ?? []) as DeliveryRuleWithScopes[]) {
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

  if (!matches && (rules?.length ?? 0) > 0) {
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
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_driver_earnings", {
    p_earn_date: earnDate,
  });

  if (error) return { error: "preview_failed" };
  return data as EarningsPreviewResult;
}

export async function recalculateEarningsForDate(
  earnDate: string,
): Promise<{ count: number } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recalculate_earnings_for_date", {
    p_earn_date: earnDate,
  });

  if (error) return { error: "recalc_failed" };
  return { count: data ?? 0 };
}

export async function recalculateDriverEarnings(
  driverId: string,
  earnDate: string,
): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("recalculate_driver_earnings", {
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
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recalculate_earnings_for_range", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_driver_id: driverId ?? undefined,
  });

  if (error) return { error: "recalc_failed" };
  return { count: data ?? 0 };
}

export async function getDriverEarningsDetail(
  driverId: string,
  earnDate: string,
): Promise<EarningsDetailResult | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_driver_earnings_detail", {
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
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_driver_earnings_daily", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_driver_id: driverId ?? undefined,
  });

  if (error) return { error: "list_failed" };
  return data as EarningsDailyListResult;
}
