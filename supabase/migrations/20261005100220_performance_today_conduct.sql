-- Today's incidents count today.
--
-- Both readers union the rollup for closed days with a live call to
-- `performance_daily_source` for today. When they were written the source
-- function had no conduct column, so today's half passed a literal
-- `NULL::numeric` in its place. The source returns `conduct_weighted` now, and
-- leaving the placeholder would mean an incident filed this morning does not
-- reach the score until the 02:00 rollup — an operator who records something and
-- then opens the driver's score would see it unchanged and reasonably conclude
-- the module does not work.
--
-- Patched rather than re-transcribed. `admin_list_driver_performance` is ~600
-- lines and this is a one-token change inside it; copying the whole body forward
-- to move one token is how a body acquires an unrelated difference.
--
-- Functions are resolved by name from the catalogue rather than by a signature
-- written here. `admin_list_driver_performance` has eleven parameters that have
-- been reordered twice across this series, so a hand-written signature is a
-- second place for the truth to live and the one most likely to be stale. The
-- block refuses to proceed unless it finds exactly one function of each name
-- carrying exactly one placeholder, so a rename, an overload or an already-
-- patched body stops the migration instead of quietly patching nothing.

DO $$
DECLARE
  v_name text;
  v_oid oid;
  v_count integer;
  v_src text;
  v_hits integer;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'admin_list_driver_performance',
    'admin_driver_performance_daily'
  ]
  LOOP
    SELECT count(*), min(p.oid)
    INTO v_count, v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name;

    IF v_count <> 1 THEN
      RAISE EXCEPTION 'expected exactly one public.% , found %', v_name, v_count;
    END IF;

    v_src := pg_get_functiondef(v_oid);
    v_hits := (length(v_src) - length(replace(v_src, 'NULL::numeric', '')))
              / length('NULL::numeric');

    IF v_hits <> 1 THEN
      RAISE EXCEPTION
        'expected exactly one conduct placeholder in public.%, found %', v_name, v_hits;
    END IF;

    EXECUTE replace(v_src, 'NULL::numeric', 's.conduct_weighted');
  END LOOP;
END $$;
