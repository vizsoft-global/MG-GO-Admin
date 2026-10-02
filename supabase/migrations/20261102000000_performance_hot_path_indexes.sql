-- The deliveries list is the panel's hottest statement: 312,214 calls with a
-- mean of 4,114 ms in pg_stat_statements against a 176,798-row / 101 MB table.
-- EXPLAIN showed why — there was no index on created_at at all, so
-- `ORDER BY created_at DESC, id DESC LIMIT 50` degraded to a Parallel Seq Scan
-- followed by a Sort over every row.
--
-- The seq scan is not only a read cost. `deliveries` carries eight RLS policies
-- that each call is_admin_panel_user() per row, so scanning 176,798 rows also
-- evaluated the policy ~1.4M times. With an index the planner reads 50 rows and
-- evaluates the policy 50 times, which is where the seconds actually went.
--
-- `deliveries.status` had no index either, so every status-filtered page and
-- every KPI bucket counted by filtering a full scan.
--
-- driver_sessions held only a primary key: 4.08M sequential scans and 77
-- billion tuples read, purely to answer "is this driver online".

CREATE INDEX IF NOT EXISTS deliveries_created_at_id_idx
  ON public.deliveries USING btree (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS deliveries_status_created_at_idx
  ON public.deliveries USING btree (status, created_at DESC);

CREATE INDEX IF NOT EXISTS driver_sessions_driver_online_idx
  ON public.driver_sessions USING btree (driver_id, is_online);

COMMENT ON INDEX public.deliveries_created_at_id_idx IS
  'Serves the deliveries list ORDER BY created_at DESC, id DESC so the LIMIT is satisfied from the index and RLS is evaluated 50 times, not 176k.';

COMMENT ON INDEX public.deliveries_status_created_at_idx IS
  'Status-filtered delivery pages and per-status KPI buckets.';

COMMENT ON INDEX public.driver_sessions_driver_online_idx IS
  'Duty/online lookups by driver; replaces 4.08M sequential scans.';
