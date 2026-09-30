import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { dailyDpdDisplayCount } from "./daily-dpd-display";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("Daily DPD card prefers progress_today and falls back to verified", () => {
  assert.equal(
    dailyDpdDisplayCount({ progress_today: 7, completed_today: 0 }),
    7,
  );
  assert.equal(dailyDpdDisplayCount({ completed_today: 3 }), 3);
  assert.equal(
    dailyDpdDisplayCount({ progress_today: null, completed_today: 2 }),
    2,
  );
});

test("306 adds progress_today without changing verified remaining / achieved", () => {
  const sql = readFileSync(
    join(root, "supabase/migrations/20261030600000_apply_delivery_shift_date.sql"),
    "utf8",
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS shift_date date/);
  assert.match(sql, /CREATE TRIGGER deliveries_stamp_shift_date/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.delivery_shift_date/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.driver_get_home_dashboard/);
  assert.match(sql, /'progress_today', v_progress/);
  assert.match(sql, /count_eligible_deliveries/);
  assert.match(sql, /count_progress_deliveries/);
  assert.match(sql, /'remaining', GREATEST\(0, v_target - v_completed\)/);
  assert.match(sql, /'achieved', v_completed >= v_target/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.compute_incentive_amount/);
});

function extract308DailyDpdFn(): string {
  const sql = readFileSync(
    join(root, "supabase/migrations/20261030800000_source_company_dpd_incentive.sql"),
    "utf8",
  );
  const fnStart = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public._driver_daily_dpd_state(",
  );
  assert.ok(fnStart >= 0, "308 is missing _driver_daily_dpd_state");
  const fnEnd = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.driver_get_extra_earnings()",
    fnStart,
  );
  assert.ok(fnEnd > fnStart, "308 is missing driver_get_extra_earnings after daily DPD");
  return sql.slice(fnStart, fnEnd);
}

function extract308CompanyDailyDpdBranch(): string {
  const fn = extract308DailyDpdFn();
  const companyStart = fn.indexOf("IF public.company_config_applies");
  const restaurantStart = fn.indexOf("-- Primary offer:");
  assert.ok(companyStart >= 0, "308 daily DPD is missing the company branch");
  assert.ok(
    restaurantStart > companyStart,
    "308 daily DPD is missing the restaurant branch after the company branch",
  );
  return fn.slice(companyStart, restaurantStart);
}

test("308 company Daily DPD uses submitted progress_today and verified remaining/achieved", () => {
  const fn = extract308DailyDpdFn();
  const company = extract308CompanyDailyDpdBranch();
  const restaurant = fn.slice(fn.indexOf("-- Primary offer:"));
  const completedQuery = company.slice(
    company.indexOf("INTO v_completed"),
    company.indexOf("INTO v_progress"),
  );
  const progressQuery = company.slice(
    company.indexOf("INTO v_progress"),
    company.indexOf("RETURN jsonb_build_object"),
  );

  assert.match(completedQuery, /d\.status = 'verified'/);
  assert.doesNotMatch(completedQuery, /in_transit/);
  assert.match(
    progressQuery,
    /d\.status IN \('in_transit', 'pending', 'under_review', 'verified'\)/,
  );
  assert.match(company, /'completed_today', v_completed/);
  assert.match(company, /'progress_today', v_progress/);
  assert.match(company, /'remaining', GREATEST\(0, v_target - v_completed\)/);
  assert.match(company, /'achieved', v_completed >= v_target/);
  assert.doesNotMatch(company, /v_target - v_progress/);
  assert.doesNotMatch(company, /v_progress >= v_target/);
  assert.match(restaurant, /count_eligible_deliveries/);
  assert.match(restaurant, /count_progress_deliveries/);
});


test("company Daily DPD card: submitted numerator, verified remaining and achieved", () => {
  const target = 15;
  const completedToday = 5;
  const progressToday = 8;

  assert.equal(
    dailyDpdDisplayCount({
      progress_today: progressToday,
      completed_today: completedToday,
    }),
    8,
  );
  assert.equal(Math.max(0, target - completedToday), 10);
  assert.equal(completedToday >= target, false);
  assert.equal(progressToday >= target, false);

  const atTargetVerified = 15;
  const stillInTransit = 18;
  assert.equal(
    dailyDpdDisplayCount({
      progress_today: stillInTransit,
      completed_today: atTargetVerified,
    }),
    18,
  );
  assert.equal(Math.max(0, target - atTargetVerified), 0);
  assert.equal(atTargetVerified >= target, true);
});
