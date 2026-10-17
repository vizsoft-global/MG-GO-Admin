import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  partnerDailyDpdTarget,
  restaurantDailyDpdTarget,
  zoneDailyDpdTarget,
  type DeliveryRule,
  type RuleScope,
} from "./incentive";

const DAY = "2026-10-16";
const NO_SCOPES: ReadonlyMap<string, readonly RuleScope[]> = new Map();

/** One `delivery_rules` row, restaurant-scoped, active and daily unless overridden. */
function rule(over: Partial<DeliveryRule> & { id: string }): DeliveryRule {
  return {
    status: "active",
    scope_type: "restaurant",
    priority: 30,
    created_at: "2026-10-01T00:00:00.000Z",
    start_date: "2026-10-01",
    end_date: "2026-12-31",
    dpd_target: 20,
    dpd_period: "daily",
    zone_id: null,
    partner_id: null,
    restaurant_id: null,
    ...over,
  };
}

function scopeMap(
  entries: Record<string, readonly RuleScope[]>,
): ReadonlyMap<string, readonly RuleScope[]> {
  return new Map(Object.entries(entries));
}

function restaurantTarget(args: {
  rules: readonly DeliveryRule[];
  scopes?: ReadonlyMap<string, readonly RuleScope[]>;
  zoneId?: string | null;
  partnerId?: string | null;
}): number | null {
  return restaurantDailyDpdTarget({
    restaurantId: "r1",
    onDate: DAY,
    restaurantZoneId: args.zoneId ?? null,
    restaurantPartnerId: args.partnerId ?? null,
    deliveryRules: args.rules,
    deliveryScopesByRule: args.scopes ?? NO_SCOPES,
  });
}

describe("daily DPD target resolution", () => {
  it("prefers the store's own rule over the zone and partner it inherits", () => {
    const rules = [
      rule({ id: "store", restaurant_id: "r1", dpd_target: 20 }),
      rule({ id: "zone", scope_type: "zone", zone_id: "z1", dpd_target: 12 }),
      rule({ id: "partner", scope_type: "partner", partner_id: "p1", dpd_target: 30 }),
    ];
    // Ordering is the rule's scope, never the bigger number: a partner rule set
    // above a store must not become that store's own promise.
    assert.equal(restaurantTarget({ rules, zoneId: "z1", partnerId: "p1" }), 20);
  });

  it("falls back to the zone, then to the partner, when the store has no rule", () => {
    const zoneRule = rule({ id: "zone", scope_type: "zone", zone_id: "z1", dpd_target: 12 });
    const partnerRule = rule({ id: "partner", scope_type: "partner", partner_id: "p1", dpd_target: 18 });

    assert.equal(restaurantTarget({ rules: [zoneRule, partnerRule], zoneId: "z1", partnerId: "p1" }), 12);
    assert.equal(restaurantTarget({ rules: [partnerRule], partnerId: "p1" }), 18);
    assert.equal(restaurantTarget({ rules: [zoneRule, partnerRule], partnerId: "p1" }), 18);
    assert.equal(restaurantTarget({ rules: [zoneRule, partnerRule], zoneId: "z1" }), 12);
  });

  it("reaches the rider through a scope row as well as the legacy column", () => {
    const scopes = scopeMap({
      store_rule: [{ zone_id: null, partner_id: null, restaurant_id: "r1" }],
      zone_rule: [{ zone_id: "z1", partner_id: null, restaurant_id: null }],
      partner_rule: [{ zone_id: null, partner_id: "p1", restaurant_id: null }],
    });

    assert.equal(
      restaurantTarget({
        rules: [rule({ id: "store_rule" }), rule({ id: "zone_rule", scope_type: "zone", dpd_target: 12 })],
        scopes,
      }),
      20,
    );
    assert.equal(
      restaurantTarget({
        rules: [rule({ id: "zone_rule", scope_type: "zone", dpd_target: 12 })],
        scopes,
        zoneId: "z1",
      }),
      12,
    );
    assert.equal(
      restaurantTarget({
        rules: [rule({ id: "partner_rule", scope_type: "partner", dpd_target: 18 })],
        scopes,
        partnerId: "p1",
      }),
      18,
    );
    assert.equal(
      restaurantTarget({ rules: [rule({ id: "partner_rule", scope_type: "partner" })], scopes }),
      null,
    );
  });

  it("ignores a rule that is not active, not daily or out of window", () => {
    assert.equal(
      restaurantTarget({ rules: [rule({ id: "draft", restaurant_id: "r1", status: "draft" })] }),
      null,
    );
    assert.equal(
      restaurantTarget({ rules: [rule({ id: "ended", restaurant_id: "r1", status: "ended" })] }),
      null,
    );
    assert.equal(
      restaurantTarget({ rules: [rule({ id: "weekly", restaurant_id: "r1", dpd_period: "weekly" })] }),
      null,
    );
    assert.equal(
      restaurantTarget({ rules: [rule({ id: "later", restaurant_id: "r1", start_date: "2026-11-01" })] }),
      null,
    );
    assert.equal(
      restaurantTarget({ rules: [rule({ id: "gone", restaurant_id: "r1", end_date: "2026-10-15" })] }),
      null,
    );
    assert.equal(
      restaurantTarget({ rules: [rule({ id: "zero", restaurant_id: "r1", dpd_target: 0 })] }),
      null,
    );
    // A row written before `dpd_period` existed reads as daily.
    assert.equal(
      restaurantTarget({ rules: [rule({ id: "legacy", restaurant_id: "r1", dpd_period: null })] }),
      20,
    );
  });

  it("picks by priority then the older row, and ceils a fractional target", () => {
    const rules = [
      rule({ id: "newer", restaurant_id: "r1", dpd_target: 25, created_at: "2026-10-05T00:00:00.000Z" }),
      rule({ id: "older", restaurant_id: "r1", dpd_target: 21, created_at: "2026-10-02T00:00:00.000Z" }),
    ];
    assert.equal(restaurantTarget({ rules }), 21);
    assert.equal(
      restaurantTarget({
        rules: [...rules, rule({ id: "harder", restaurant_id: "r1", dpd_target: 24.4, priority: 40 })],
      }),
      25,
    );
  });

  it("resolves a zone or partner target on its own, and refuses a blank id", () => {
    const rules = [
      rule({ id: "zone", scope_type: "zone", zone_id: "z1", dpd_target: 12 }),
      rule({ id: "partner", scope_type: "partner", partner_id: "p1", dpd_target: 18 }),
    ];
    const args = { onDate: DAY, deliveryRules: rules, deliveryScopesByRule: NO_SCOPES };

    assert.equal(zoneDailyDpdTarget({ ...args, zoneId: "z1" }), 12);
    assert.equal(zoneDailyDpdTarget({ ...args, zoneId: "z2" }), null);
    assert.equal(zoneDailyDpdTarget({ ...args, zoneId: null }), null);
    assert.equal(partnerDailyDpdTarget({ ...args, partnerId: "p1" }), 18);
    assert.equal(partnerDailyDpdTarget({ ...args, partnerId: "p2" }), null);
    assert.equal(partnerDailyDpdTarget({ ...args, partnerId: null }), null);
  });
});
