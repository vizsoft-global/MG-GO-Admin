-- 20261107000000_incentive_verified_completion_and_breakdown.sql
--
-- QA #25 / #20 / #21 — the Rider App was crediting incentive tiers before the
-- admin verified the orders, and itemising a day from a different source than
-- the total it printed.
--
-- #25 — `driver_get_extra_earnings` marked an offer `completed` from the
--   *submitted* count (`count_progress_deliveries`: in_transit + pending +
--   under_review + verified). A rider who had logged a 4th order that was still
--   `under_review` therefore saw the Home quest read "4 / 4" and
--   `questUnlockedEarned(+5 KD)` — the full tier reward — before the order paid.
--   `completed` is now derived from the *verified* count
--   (`count_eligible_deliveries`), and a new `pending_verification` flag says the
--   submitted count has reached the target while verification has not. The app
--   shows "verification pending" instead of an unlocked reward.
--
--   `remaining_deliveries` was also progress-based (`target - progress`), which
--   is why the quest could read "0 more to unlock" while nothing was verified.
--   It is now `target - eligible`, so the "X more" line counts orders that
--   actually pay. `current_count` (verified, from `count_eligible_deliveries`)
--   and `progress_count` (submitted) are unchanged, so the app can still show
--   both sides of the pair.
--
-- #20 — Extra Earnings read progress (2/2) while the day drilldown read verified
--   (1/2), two screens describing one day with two numbers. With `completed`,
--   `remaining_deliveries` and the app's progress display all on the verified
--   count, both surfaces now agree (see the Rider App change in the same batch).
--
-- #21 — `get_driver_earnings_detail` returned `daily` without `breakdown`, so the
--   day drilldown rebuilt its rule list by re-running the incentive math while
--   the totals card read the stored `incentive_kwd`. The two could disagree
--   ("+15 KD" total against "+2 KD" itemised, an override applied after the fact),
--   and nothing in the payload let the app see they were different runs.
--   `daily` now carries `breakdown` and `calculated_at` verbatim from
--   `driver_earnings_daily`, so the total and the itemisation come from one row.
--
-- Applied by patching the live `pg_get_functiondef` output (the technique
-- 20261028700000 used) rather than retyping 240-line bodies: the portions that
-- are not the subject of this migration — including the 3-arg band-math call in
-- `get_driver_earnings_detail` — are preserved byte-for-byte. Every needle is
-- count-guarded so a future rename fails loudly instead of silently no-op'ing.
--
-- SCOPE: two read-only SECURITY DEFINER functions. No table, column, RLS policy,
-- grant or route is touched. No driver-app surface beyond the response shape of
-- two RPCs the app already calls.

DO $$
DECLARE
  v_def text;
  v_needle text;
  v_n int;
BEGIN
  -- -----------------------------------------------------------------------
  -- driver_get_extra_earnings — completed is verified-based
  -- -----------------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid)
  INTO v_def
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'driver_get_extra_earnings';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'verified completion: public.driver_get_extra_earnings not found';
  END IF;

  -- remaining counts orders that pay, i.e. against the verified count.
  v_needle := 'v_remaining := GREATEST(0, v_target - v_progress);';
  v_n := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'verified completion: expected 1 remaining assignment, found %', v_n;
  END IF;
  v_def := replace(v_def, v_needle,
    'v_remaining := GREATEST(0, v_target - v_eligible);');

  -- completed no longer fires on submitted orders; a separate flag records that
  -- the submitted count has hit the target but verification has not.
  v_needle := '''completed'', v_remaining <= 0,';
  v_n := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'verified completion: expected 1 completed flag, found %', v_n;
  END IF;
  v_def := replace(v_def, v_needle,
    '''completed'', (v_target <= 0 OR v_eligible >= v_target),' || chr(10) ||
    '        ''pending_verification'', (v_target > 0 AND v_progress >= v_target AND v_eligible < v_target),');

  EXECUTE v_def;

  -- -----------------------------------------------------------------------
  -- get_driver_earnings_detail — daily carries its stored breakdown
  -- -----------------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid)
  INTO v_def
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'get_driver_earnings_detail';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'verified completion: public.get_driver_earnings_detail not found';
  END IF;

  v_needle := '''net_kwd'', d.net_kwd,';
  v_n := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'verified completion: expected 1 daily net_kwd build, found %', v_n;
  END IF;
  v_def := replace(v_def, v_needle,
    '''net_kwd'', d.net_kwd,' || chr(10) ||
    '    ''breakdown'', COALESCE(d.breakdown, ''[]''::jsonb),' || chr(10) ||
    '    ''calculated_at'', d.calculated_at,');

  EXECUTE v_def;
END;
$$;

-- Re-assert the grants: CREATE OR REPLACE preserves an ACL, but re-asserting
-- costs nothing and documents that both stay driver-callable to authenticated.
REVOKE ALL ON FUNCTION public.driver_get_extra_earnings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_get_extra_earnings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_get_extra_earnings() TO service_role;

GRANT EXECUTE ON FUNCTION public.get_driver_earnings_detail(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_driver_earnings_detail(uuid, date) TO service_role;
