import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

test("rollback SQL drops only the new shift-date objects, in reverse order", () => {
  const sql = read("supabase/tests/delivery_shift_date_rollback.sql");
  const required = [
    "DROP TRIGGER IF EXISTS deliveries_stamp_shift_date ON public.deliveries",
    "DROP FUNCTION IF EXISTS public.deliveries_stamp_shift_date()",
    "DROP FUNCTION IF EXISTS public.delivery_shift_date(uuid, timestamptz)",
    "DROP INDEX IF EXISTS public.deliveries_driver_shift_date_idx",
    "ALTER TABLE public.deliveries DROP COLUMN IF EXISTS shift_date",
    "20261012100000_orders_report_time_window.sql",
    "20261016100000_driver_device_profile.sql",
  ];
  for (const snippet of required) {
    assert.match(sql, new RegExp(snippet.replace(/[()]/g, "\\$&")));
  }
  assert.doesNotMatch(sql, /DROP TABLE public\.deliveries/i);
  assert.doesNotMatch(sql, /DROP FUNCTION IF EXISTS public\.report_delivery_orders/);
});

test("migrations declare the objects the rollback removes", () => {
  const shift = read("supabase/migrations/20261028300000_delivery_shift_date.sql");
  const report = read("supabase/migrations/20261028400000_orders_report_operational_day.sql");
  assert.match(shift, /CREATE OR REPLACE FUNCTION public\.delivery_shift_date/);
  assert.match(shift, /ADD COLUMN IF NOT EXISTS shift_date date/);
  assert.match(shift, /CREATE TRIGGER deliveries_stamp_shift_date/);
  assert.match(shift, /CREATE OR REPLACE FUNCTION public\.driver_get_home_dashboard/);
  assert.match(report, /CREATE OR REPLACE FUNCTION public\.report_delivery_orders/);
  assert.match(report, /v_operational boolean := v_from_clock <> time '00:00:00'/);
  assert.match(report, /v_exclusive_end boolean := v_operational AND v_from_clock = v_to_clock/);
});
