-- The Period tab showed "No drivers in range" against a fleet that had 47
-- worked this week. The RPC was raising, and the page treated any failed
-- fetch as an empty list.
--
-- `rat` already has one `manual_criteria` jsonb per driver (from
-- `rat_crit_map`). Joining that map before the team GROUP BY means several
-- identical copies of the same object, and the collapse used `MAX()`.
-- Postgres has no `max(jsonb)` — 42883 — so the whole statement died.
-- `ARRAY_AGG(...)[1]` is the same collapse without asking for an order on
-- jsonb. The values are identical, so which copy wins does not matter.

DO $$
DECLARE
  v_oid oid;
  v_src text;
  v_anchor constant text := 'MAX(rcm.manual_criteria)';
  v_fixed constant text := '(ARRAY_AGG(rcm.manual_criteria))[1]';
BEGIN
  SELECT p.oid INTO STRICT v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'admin_list_driver_performance';

  v_src := pg_get_functiondef(v_oid);

  IF position(v_fixed in v_src) > 0 THEN
    RETURN;
  END IF;

  IF (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION
      'expected exactly one % in public.admin_list_driver_performance',
      v_anchor;
  END IF;

  EXECUTE replace(v_src, v_anchor, v_fixed);
END $$;
