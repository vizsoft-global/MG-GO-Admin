-- The period-over-period delta has to say when it is not comparing like with like.
--
-- Measured on production the moment the trend function went in: August 2026
-- scores 66.0 against July's 81.8, which reads as a fleet falling apart. It is
-- not. `fleet_events` retention had pruned July before the retention bump, so
-- every July row carries NULL for overspeed, zone and GPS — 0 of 731 rows have
-- them, against 433 of 912 in August. The drop-and-renormalise rule then scored
-- July on three components and August on six, and the "decline" is almost
-- entirely the three harder components arriving.
--
-- Renormalising is still right: it is what stops an unmeasured day from being
-- scored as a failed one. What is wrong is presenting the difference between two
-- differently-composed blends as a change in performance. So each half now
-- reports which components it actually measured, and the tab compares the two
-- sets before it is willing to call a delta a delta.
--
-- This is not a backfill problem that will age out. Any component can go dark
-- for a window — a Worker outage, a retention change, a component switched off
-- and back on — and the next person to read a delta across that boundary
-- deserves the same warning rather than a plausible-looking number.
--
-- Patched at the one anchor rather than re-emitting 400 lines, with the same
-- uniqueness guard the conduct patch used.

DO $$
DECLARE
  v_oid oid;
  v_count integer;
  v_src text;
  v_anchor text := '''conduct_weighted'', COALESCE(SUM(d.conduct_weighted), 0)';
  v_addition text;
  v_hits integer;
BEGIN
  SELECT count(*), min(p.oid)
  INTO v_count, v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'admin_performance_trend';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one public.admin_performance_trend, found %', v_count;
  END IF;

  v_src := pg_get_functiondef(v_oid);
  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);

  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'expected exactly one halves anchor, found %', v_hits;
  END IF;

  -- A component counts as measured in a half if any driver-day in that half
  -- produced a score for it. COUNT ignores NULLs, which is exactly the test.
  v_addition := v_anchor || ',
        ''components_measured'', (
          ARRAY[]::text[]
          || CASE WHEN COUNT(d.s_punctuality) > 0 THEN ARRAY[''punctuality''] ELSE ARRAY[]::text[] END
          || CASE WHEN COUNT(d.s_duty_ratio) > 0 THEN ARRAY[''duty_ratio''] ELSE ARRAY[]::text[] END
          || CASE WHEN COUNT(d.s_on_time) > 0 THEN ARRAY[''on_time''] ELSE ARRAY[]::text[] END
          || CASE WHEN COUNT(d.s_speed) > 0 THEN ARRAY[''speed''] ELSE ARRAY[]::text[] END
          || CASE WHEN COUNT(d.s_zone) > 0 THEN ARRAY[''zone''] ELSE ARRAY[]::text[] END
          || CASE WHEN COUNT(d.s_gps) > 0 THEN ARRAY[''gps''] ELSE ARRAY[]::text[] END
          || CASE WHEN COUNT(d.s_conduct) > 0 THEN ARRAY[''conduct''] ELSE ARRAY[]::text[] END
        )';

  EXECUTE replace(v_src, v_anchor, v_addition);
END $$;
