-- Run after 20261028300000 is applied. Entire script is one transaction and
-- must ROLLBACK. Does not persist rows.
--
-- Rollback of the migration itself (for QA, not applied here):
--   DROP TRIGGER IF EXISTS deliveries_stamp_shift_date ON public.deliveries;
--   DROP FUNCTION IF EXISTS public.deliveries_stamp_shift_date();
--   DROP FUNCTION IF EXISTS public.delivery_shift_date(uuid, timestamptz);
--   ALTER TABLE public.deliveries DROP COLUMN IF EXISTS shift_date;
--   Recreate driver_get_home_dashboard from 20261016100000.

BEGIN;

DO $$
DECLARE
  v_driver uuid;
  v_before bigint;
  v_after bigint;
  v_nulls bigint;
  v_mismatch bigint;
  v_d date := DATE '2026-09-20';
  v_got date;
BEGIN
  INSERT INTO public.drivers (id, driver_code, employee_id, status)
  SELECT
    '00000000-0000-4000-8000-000000000099'::uuid,
    '19999',
    '19999',
    'active'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.drivers WHERE id = '00000000-0000-4000-8000-000000000099'::uuid
  );

  v_driver := '00000000-0000-4000-8000-000000000099'::uuid;

  INSERT INTO public.driver_daily_shifts (
    driver_id, shift_date, shift_type,
    session1_start, session1_end, session1_end_day_offset
  ) VALUES (
    v_driver, v_d, 'single', time '18:00', time '02:00', 1
  )
  ON CONFLICT (driver_id, shift_date) DO UPDATE
  SET session1_start = excluded.session1_start,
      session1_end = excluded.session1_end,
      session1_end_day_offset = excluded.session1_end_day_offset;

  -- before midnight
  v_got := public.delivery_shift_date(
    v_driver,
    ((v_d::timestamp + time '23:30') AT TIME ZONE 'Asia/Kuwait')
  );
  IF v_got IS DISTINCT FROM v_d THEN
    RAISE EXCEPTION 'before_midnight expected %, got %', v_d, v_got;
  END IF;

  -- after midnight
  v_got := public.delivery_shift_date(
    v_driver,
    (((v_d + 1)::timestamp + time '01:30') AT TIME ZONE 'Asia/Kuwait')
  );
  IF v_got IS DISTINCT FROM v_d THEN
    RAISE EXCEPTION 'after_midnight expected %, got %', v_d, v_got;
  END IF;

  -- exact start
  v_got := public.delivery_shift_date(
    v_driver,
    ((v_d::timestamp + time '18:00') AT TIME ZONE 'Asia/Kuwait')
  );
  IF v_got IS DISTINCT FROM v_d THEN
    RAISE EXCEPTION 'start_boundary expected %, got %', v_d, v_got;
  END IF;

  -- no matching shift
  v_got := public.delivery_shift_date(
    '00000000-0000-4000-8000-000000000098'::uuid,
    (((v_d + 1)::timestamp + time '01:30') AT TIME ZONE 'Asia/Kuwait')
  );
  IF v_got IS DISTINCT FROM (v_d + 1) THEN
    RAISE EXCEPTION 'no_shift expected %, got %', v_d + 1, v_got;
  END IF;

  SELECT count(*) INTO v_before FROM public.deliveries;
  SELECT count(*) INTO v_after FROM public.deliveries;
  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'row_count_changed % → %', v_before, v_after;
  END IF;

  SELECT count(*) INTO v_nulls
  FROM public.deliveries
  WHERE shift_date IS NULL
    AND COALESCE(delivered_at, pickup_at, created_at) IS NOT NULL;
  IF v_nulls <> 0 THEN
    RAISE EXCEPTION 'unattributed_rows %', v_nulls;
  END IF;

  SELECT count(*) INTO v_mismatch
  FROM public.deliveries
  WHERE shift_date IS DISTINCT FROM public.delivery_shift_date(
    driver_id,
    COALESCE(delivered_at, pickup_at, created_at)
  );
  IF v_mismatch <> 0 THEN
    RAISE EXCEPTION 'attribution_mismatch %', v_mismatch;
  END IF;
END
$$;

ROLLBACK;
