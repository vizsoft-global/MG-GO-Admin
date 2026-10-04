-- 20261109000300_incentive_offer_override_flag.sql
--
-- QA #15 — the rider saw an incentive the ledger would never pay.
--
-- `driver_get_extra_earnings` lists every active rule that matches the rider,
-- but `compute_incentive_amount` / `recalculate_driver_earnings` only ever pay
-- one of them: a rule with `overrides_others = true` and a positive amount
-- takes over the day, discarding every lower-priority rule (the accumulator in
-- `compute_incentive_amount`, unchanged since `20260529100000`). So a rider
-- sitting under both a high-priority override and a lower-priority weekly quest
-- saw the overridden quest on Home with its own progress and reward, and the
-- earnings rows could never contain it.
--
-- The offer payload now carries `overridden`, plus `priority` and
-- `overrides_others` so the flag is auditable rather than a bare boolean. The
-- loop already iterates `priority DESC`, so a single running variable is the
-- whole implementation — no second definition of the rule, and no extra
-- `compute_incentive_amount` call.
--
-- `overridden` is computed with the *current* eligible count
-- (`v_current_reward`), which is the same input the engine uses for today, so a
-- rider with zero eligible deliveries does not silently suppress the rules
-- below the override — the engine would not apply the override either.
--
-- SCOPE: one read-only SECURITY DEFINER function. No table, column, RLS policy,
-- grant or route is touched. The Rider App hides flagged offers in
-- `ExtraEarnings.fromJson`, so an older build that ignores the key simply keeps
-- today's behaviour.
--
-- Applied by patching the live `pg_get_functiondef` output (the technique
-- `20261028700000` and `20261107000000` used) rather than retyping the 240-line
-- body: everything not named here is preserved byte-for-byte, and every needle
-- is count-guarded so a future rename fails loudly instead of silently
-- no-op'ing.

DO $$
DECLARE
  v_def text;
  v_needle text;
  v_n int;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_def
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'driver_get_extra_earnings';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'override flag: public.driver_get_extra_earnings not found';
  END IF;

  -- -----------------------------------------------------------------------
  -- 1. Two new locals: the running override priority and this rule's verdict.
  -- -----------------------------------------------------------------------
  v_needle := '  v_company_net numeric;' || chr(10) || 'BEGIN';
  v_n := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'override flag: expected 1 declare tail, found %', v_n;
  END IF;
  v_def := replace(v_def, v_needle,
    '  v_company_net numeric;' || chr(10) ||
    '  v_override_priority integer;' || chr(10) ||
    '  v_overridden boolean;' || chr(10) ||
    'BEGIN');

  -- -----------------------------------------------------------------------
  -- 2. Decide the flag before this rule can itself become the override.
  -- -----------------------------------------------------------------------
  v_needle := '      v_band_start := public._incentive_band_start(v_rule.id, v_today);';
  v_n := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'override flag: expected 1 band-start line, found %', v_n;
  END IF;
  v_def := replace(v_def, v_needle,
    '      -- A higher-priority rule that overrides others and actually pays' || chr(10) ||
    '      -- today takes over the whole day, so every rule below it is dead' || chr(10) ||
    '      -- weight on the Home card. Mirrors the accumulator in' || chr(10) ||
    '      -- compute_incentive_amount (priority > current override, amount > 0).' || chr(10) ||
    '      v_overridden := v_override_priority IS NOT NULL' || chr(10) ||
    '                      AND v_rule.priority < v_override_priority;' || chr(10) ||
    chr(10) ||
    '      v_band_start := public._incentive_band_start(v_rule.id, v_today);');

  -- -----------------------------------------------------------------------
  -- 3. Publish the flag with the rest of the offer.
  -- -----------------------------------------------------------------------
  v_needle := '        ''pending_verification'', (v_target > 0 AND v_progress >= v_target AND v_eligible < v_target),';
  v_n := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'override flag: expected 1 pending_verification key, found %', v_n;
  END IF;
  v_def := replace(v_def, v_needle,
    '        ''pending_verification'', (v_target > 0 AND v_progress >= v_target AND v_eligible < v_target),' || chr(10) ||
    '        ''overridden'', v_overridden,' || chr(10) ||
    '        ''priority'', v_rule.priority,' || chr(10) ||
    '        ''overrides_others'', v_rule.overrides_others,');

  -- -----------------------------------------------------------------------
  -- 4. Record this rule as the override for the rules that follow it.
  -- -----------------------------------------------------------------------
  v_needle := '      ) || v_band_fields);' || chr(10) || '    END LOOP;';
  v_n := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'override flag: expected 1 loop tail, found %', v_n;
  END IF;
  v_def := replace(v_def, v_needle,
    '      ) || v_band_fields);' || chr(10) ||
    chr(10) ||
    '      IF v_rule.overrides_others AND v_current_reward > 0 THEN' || chr(10) ||
    '        v_override_priority := v_rule.priority;' || chr(10) ||
    '      END IF;' || chr(10) ||
    '    END LOOP;');

  EXECUTE v_def;
END;
$$;

-- CREATE OR REPLACE preserves the ACL; re-asserting costs nothing and documents
-- that the function stays driver-callable to authenticated only.
REVOKE ALL ON FUNCTION public.driver_get_extra_earnings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_get_extra_earnings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_get_extra_earnings() TO service_role;
