-- Rollback for 20261028400000 then 20261028300000.
-- Do not run against production unless an operator explicitly asks.
-- Function bodies are restored from the named prior migrations.

-- 1. 20261028400000 — restore the 00:00-only report.
-- Recreate public.report_delivery_orders(date, date, time, time)
-- from supabase/migrations/20261012100000_orders_report_time_window.sql

-- 2. 20261028300000 — drop shift_date and restore Home.
DROP TRIGGER IF EXISTS deliveries_stamp_shift_date ON public.deliveries;
DROP FUNCTION IF EXISTS public.deliveries_stamp_shift_date();
DROP FUNCTION IF EXISTS public.delivery_shift_date(uuid, timestamptz);
DROP INDEX IF EXISTS public.deliveries_driver_shift_date_idx;
ALTER TABLE public.deliveries DROP COLUMN IF EXISTS shift_date;
-- Recreate public.driver_get_home_dashboard()
-- from supabase/migrations/20261016100000_driver_device_profile.sql
