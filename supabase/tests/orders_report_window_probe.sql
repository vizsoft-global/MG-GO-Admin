-- Run after 20261028400000 is applied. Entire script rolls back.
-- Probe: D 05:00 → D+1 05:00 exclusive end.

BEGIN;

-- These assertions use the operational-day math only (no live fleet writes).
DO $$
DECLARE
  v_from date := DATE '2026-09-20';
  v_to date := DATE '2026-09-21';
  v_clock time := time '05:00';
  v_from_ts timestamptz := (v_from::timestamp + v_clock) AT TIME ZONE 'Asia/Kuwait';
  v_to_ts timestamptz := (v_to::timestamp + v_clock) AT TIME ZONE 'Asia/Kuwait';
  v_at timestamptz;
  v_day date;
BEGIN
  IF NOT (
    ((v_from::timestamp + time '04:59') AT TIME ZONE 'Asia/Kuwait') < v_from_ts
  ) THEN
    RAISE EXCEPTION '04:59_same_day_should_be_before_window';
  END IF;

  FOREACH v_at IN ARRAY ARRAY[
    (v_from::timestamp + time '05:00') AT TIME ZONE 'Asia/Kuwait',
    (v_from::timestamp + time '23:59') AT TIME ZONE 'Asia/Kuwait',
    (v_to::timestamp + time '00:00') AT TIME ZONE 'Asia/Kuwait',
    (v_to::timestamp + time '02:00') AT TIME ZONE 'Asia/Kuwait',
    (v_to::timestamp + time '04:59') AT TIME ZONE 'Asia/Kuwait'
  ]
  LOOP
    IF v_at < v_from_ts OR v_at >= v_to_ts THEN
      RAISE EXCEPTION 'in_window_miss %', v_at;
    END IF;
    v_day := ((v_at AT TIME ZONE 'Asia/Kuwait') - v_clock)::date;
    IF v_day IS DISTINCT FROM v_from THEN
      RAISE EXCEPTION 'column_split % → %', v_at, v_day;
    END IF;
  END LOOP;

  v_at := (v_to::timestamp + time '05:00') AT TIME ZONE 'Asia/Kuwait';
  IF v_at < v_to_ts THEN
    RAISE EXCEPTION 'next_day_05:00_must_be_exclusive';
  END IF;
END
$$;

ROLLBACK;
