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
