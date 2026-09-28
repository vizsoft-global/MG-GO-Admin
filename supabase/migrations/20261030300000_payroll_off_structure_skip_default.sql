-- Skip materializing the implicit Off Structure default (2 OFF days).
-- A missing driver_off_structure row already means OFF=2. Bulk must only
-- write real overrides (e.g. OFF=3). Changing an override back to 2 deletes
-- the row instead of storing the default.
--
-- Applied on eoksxkdssptgyqyywdju via MCP apply_migration (ledger repaired to this version).
-- Do not blanket-push. Do not touch 20261028700000 or 20261030100000.

CREATE OR REPLACE FUNCTION public.admin_bulk_set_driver_off_structure(
  p_month date,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_month date;
  v_cur_month date;
  v_days integer;
  v_count integer;
  v_verdicts jsonb;
  v_upserted integer := 0;
  v_cleared integer := 0;
  v_applied integer := 0;
  v_default_off integer := 2;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.payroll_can_manage() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_cur_month := date_trunc('month', (timezone('Asia/Kuwait', now()))::date)::date;
  v_month := date_trunc('month', p_month)::date;
  IF v_month IS NULL THEN
    RAISE EXCEPTION 'invalid_month';
  END IF;
  IF v_month < (v_cur_month - INTERVAL '2 months')::date OR v_month > v_cur_month THEN
    RAISE EXCEPTION 'month_out_of_range';
  END IF;
  v_days := ((v_month + INTERVAL '1 month')::date - v_month);

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'invalid_rows';
  END IF;

  v_count := jsonb_array_length(p_rows);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'no_rows';
  END IF;
  IF v_count > 2000 THEN
    RAISE EXCEPTION 'too_many_rows';
  END IF;

  WITH input AS (
    SELECT
      (e.ord - 1)::int AS idx,
      btrim(COALESCE(e.value->>'driver_key', e.value->>'employee_id', '')) AS driver_key,
      e.value->>'off_days' AS off_days_raw
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS e(value, ord)
  ),
  parsed AS (
    SELECT
      i.idx,
      i.driver_key,
      CASE
        WHEN i.off_days_raw ~ '^[[:space:]]*[0-9]+[[:space:]]*$' THEN (btrim(i.off_days_raw))::int
        ELSE NULL
      END AS off_days
    FROM input i
  ),
  matched AS (
    SELECT
      p.idx,
      p.driver_key,
      p.off_days,
      (
        SELECT COUNT(*)
        FROM public.drivers d
        WHERE d.archived_at IS NULL
          AND (
            upper(btrim(COALESCE(d.employee_id, ''))) = upper(p.driver_key)
            OR upper(btrim(COALESCE(d.driver_code, ''))) = upper(p.driver_key)
          )
      )::int AS match_count,
      (
        SELECT d.id
        FROM public.drivers d
        WHERE d.archived_at IS NULL
          AND (
            upper(btrim(COALESCE(d.employee_id, ''))) = upper(p.driver_key)
            OR upper(btrim(COALESCE(d.driver_code, ''))) = upper(p.driver_key)
          )
        ORDER BY d.created_at
        LIMIT 1
      ) AS driver_id
    FROM parsed p
  ),
  dup AS (
    SELECT upper(driver_key) AS key
    FROM matched
    WHERE driver_key <> ''
    GROUP BY upper(driver_key)
    HAVING COUNT(*) > 1
  ),
  verdict AS (
    SELECT
      m.idx,
      m.driver_key,
      m.off_days,
      m.driver_id,
      prev.off_days AS previous_off_days,
      CASE
        WHEN m.driver_key = '' THEN 'missing_id'
        WHEN EXISTS (SELECT 1 FROM dup WHERE dup.key = upper(m.driver_key)) THEN 'duplicate'
        WHEN m.off_days IS NULL THEN 'invalid_off_days'
        WHEN m.off_days < 0 THEN 'invalid_off_days'
        WHEN m.off_days > v_days THEN 'off_days_exceeds_month'
        WHEN m.match_count = 0 THEN 'unknown_id'
        WHEN m.match_count > 1 THEN 'ambiguous_id'
        WHEN m.off_days = COALESCE(prev.off_days, v_default_off) THEN 'no_change'
        ELSE 'applied'
      END AS verdict
    FROM matched m
    LEFT JOIN public.driver_off_structure prev
      ON prev.driver_id = m.driver_id AND prev.period_month = v_month
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'index', v.idx,
      'driverKey', v.driver_key,
      'offDays', v.off_days,
      'previousOffDays', v.previous_off_days,
      'verdict', v.verdict,
      'driverId', CASE WHEN v.verdict IN ('applied', 'no_change') THEN v.driver_id ELSE NULL END,
      'driverName', CASE
        WHEN v.verdict IN ('applied', 'no_change') THEN (
          SELECT COALESCE(NULLIF(btrim(pr.full_name), ''), d.driver_code)
          FROM public.drivers d
          LEFT JOIN public.profiles pr ON pr.id = d.id
          WHERE d.id = v.driver_id
        )
        ELSE NULL
      END
    )
    ORDER BY v.idx
  ), '[]'::jsonb)
  INTO v_verdicts
  FROM verdict v;

  -- Overrides that are not the implicit default.
  INSERT INTO public.driver_off_structure
    (driver_id, period_month, off_days, source, updated_by, updated_at)
  SELECT (r->>'driverId')::uuid, v_month, (r->>'offDays')::int, 'bulk_upload', auth.uid(), now()
  FROM jsonb_array_elements(v_verdicts) AS r
  WHERE r->>'verdict' = 'applied'
    AND (r->>'offDays')::int <> v_default_off
  ON CONFLICT (driver_id, period_month) DO UPDATE SET
    off_days = EXCLUDED.off_days,
    source = 'bulk_upload',
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  -- Changing an override back to the default un-materializes the row.
  DELETE FROM public.driver_off_structure d
  USING jsonb_array_elements(v_verdicts) AS r
  WHERE r->>'verdict' = 'applied'
    AND (r->>'offDays')::int = v_default_off
    AND d.driver_id = (r->>'driverId')::uuid
    AND d.period_month = v_month;

  GET DIAGNOSTICS v_cleared = ROW_COUNT;
  v_applied := v_upserted + v_cleared;

  RETURN jsonb_build_object(
    'ok', true,
    'month', to_char(v_month, 'YYYY-MM'),
    'monthDays', v_days,
    'applied', v_applied,
    'skipped', v_count - v_applied,
    'rows', v_verdicts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_bulk_set_driver_off_structure(date, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_bulk_set_driver_off_structure(date, jsonb) TO authenticated;
