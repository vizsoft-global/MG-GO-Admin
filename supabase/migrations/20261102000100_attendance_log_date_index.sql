-- `attendance_logs` carried only its primary key and the unique
-- `(driver_id, log_date)`, and the unique index cannot serve the list: the
-- attendance page filters a date RANGE and orders by `log_date DESC`, and
-- `driver_id` leads that index, so the range predicate is unindexable.
--
-- EXPLAIN (ANALYZE, BUFFERS) on 12,702 rows / 3 MB confirmed the cost:
--
--   Sort  (actual time=8.142..9.198 rows=11343)
--     Sort Method: quicksort  Memory: 1439kB
--     ->  Seq Scan on attendance_logs  (rows=11343)
--           Filter: (log_date >= ... AND log_date <= ...)
--   Execution Time: 10.063 ms
--
-- The table gains roughly 2,700 rows a month, so both the seq scan and the
-- 1.4 MB sort grow with it while an index does not. Same reasoning as
-- `deliveries_created_at_id_idx`: the module's hottest statement re-reads the
-- whole table to return one window.

CREATE INDEX IF NOT EXISTS attendance_logs_log_date_idx
  ON public.attendance_logs USING btree (log_date DESC);

COMMENT ON INDEX public.attendance_logs_log_date_idx IS
  'Serves the attendance list date-range filter with ORDER BY log_date DESC; replaces a Seq Scan + Sort over the whole table.';
