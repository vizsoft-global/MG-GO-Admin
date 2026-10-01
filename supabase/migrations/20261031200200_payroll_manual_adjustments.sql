-- MGGO Payroll SOP v4.0 — manual adjustments.
--
-- SOP section 7: a manual adjustment outranks every rule, and "every manual
-- adjustment is kept" with its reason. So this table is append-only: the latest
-- row per (driver, day) wins and nothing is ever overwritten or deleted, which
-- is what makes the change log real history rather than a last-edited stamp.
--
-- A row with `adjusted_status = 'auto'` is a revert: it resolves the day back
-- to whatever Operations and the client rules say, without deleting the
-- adjustments that came before it.
--
-- Additive only.

CREATE TABLE IF NOT EXISTS public.payroll_manual_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers (id) ON DELETE CASCADE,
  work_date date NOT NULL,
  period_month date NOT NULL,
  /** The status the day resolved to when the operator made the change. */
  original_status text,
  /** 'auto' reverts the day back to the rules. */
  adjusted_status text NOT NULL,
  adjusted_hours numeric(5, 2),
  reason text NOT NULL,
  adjusted_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  adjusted_by_name text,
  adjusted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_manual_adjustments_month_check CHECK (period_month = date_trunc('month', work_date)::date),
  CONSTRAINT payroll_manual_adjustments_reason_check CHECK (btrim(reason) <> '' AND char_length(reason) <= 500),
  CONSTRAINT payroll_manual_adjustments_status_check CHECK (
    adjusted_status IN (
      'auto', '12', '3h', 'half', 'actual', 'off', 'abs', 'abs_lh', 'abs_lo',
      'sick', 'accident', 'vehicle', 'custom'
    )
  ),
  CONSTRAINT payroll_manual_adjustments_hours_check CHECK (
    adjusted_hours IS NULL OR (adjusted_hours >= 0 AND adjusted_hours <= 24)
  ),
  CONSTRAINT payroll_manual_adjustments_custom_hours_check CHECK (
    adjusted_status <> 'custom' OR adjusted_hours IS NOT NULL
  )
);

COMMENT ON TABLE public.payroll_manual_adjustments IS
  'Append-only payroll day adjustments. The latest row per driver and day wins; adjusted_status = auto reverts the day to the rules.';

CREATE INDEX IF NOT EXISTS payroll_manual_adjustments_lookup_idx
  ON public.payroll_manual_adjustments (driver_id, work_date DESC, adjusted_at DESC);

CREATE INDEX IF NOT EXISTS payroll_manual_adjustments_month_idx
  ON public.payroll_manual_adjustments (period_month);

ALTER TABLE public.payroll_manual_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_manual_adjustments_staff_read ON public.payroll_manual_adjustments;
CREATE POLICY payroll_manual_adjustments_staff_read ON public.payroll_manual_adjustments
  FOR SELECT TO authenticated USING (public.is_admin_panel_user());

REVOKE ALL ON public.payroll_manual_adjustments FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.payroll_manual_adjustments FROM authenticated;
GRANT SELECT ON public.payroll_manual_adjustments TO authenticated;

-- 1. apply ---------------------------------------------------------------

-- One write for a whole selection. Refuses a blank reason and a batch above
-- the cap rather than trimming either, because a silently shortened or
-- unexplained adjustment is worse than a refused one.
CREATE OR REPLACE FUNCTION public.admin_apply_payroll_adjustments(
  p_cells jsonb,
  p_reason text,
  p_driver_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_cells jsonb := COALESCE(p_cells, '[]'::jsonb);
  v_count integer;
  v_actor text;
  v_min date;
  v_max date;
  v_cur date := date_trunc('month', (timezone('Asia/Kuwait', now()))::date)::date;
  v_today date := (timezone('Asia/Kuwait', now()))::date;
  v_cell jsonb;
  v_driver uuid;
  v_date date;
  v_status text;
  v_hours numeric;
  v_original text;
  v_applied integer := 0;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.payroll_can_manage() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF v_reason = '' OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(v_cells) <> 'array' THEN
    RAISE EXCEPTION 'invalid_cells' USING ERRCODE = 'P0001';
  END IF;
  v_count := jsonb_array_length(v_cells);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'no_cells' USING ERRCODE = 'P0001';
  END IF;
  -- 62 days is the longest range the Payroll window can show, so the cap is the
  -- largest honest selection rather than an arbitrary number.
  IF v_count > 4000 THEN
    RAISE EXCEPTION 'too_many_cells' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'Unknown')
    INTO v_actor
  FROM public.profiles p WHERE p.id = auth.uid();

  v_min := (v_cur - INTERVAL '2 months')::date;
  v_max := v_cur;

  FOR v_cell IN SELECT * FROM jsonb_array_elements(v_cells) LOOP
    BEGIN
      v_driver := (v_cell ->> 'driverId')::uuid;
      v_date := (v_cell ->> 'date')::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_cell' USING ERRCODE = 'P0001';
    END;

    v_status := lower(btrim(COALESCE(v_cell ->> 'status', '')));
    IF v_status NOT IN (
      'auto', '12', '3h', 'half', 'actual', 'off', 'abs', 'abs_lh', 'abs_lo',
      'sick', 'accident', 'vehicle', 'custom'
    ) THEN
      RAISE EXCEPTION 'invalid_adjustment_status:%', v_status USING ERRCODE = 'P0001';
    END IF;

    v_hours := NULLIF(v_cell ->> 'hours', '')::numeric;
    IF v_status = 'custom' THEN
      IF v_hours IS NULL OR v_hours < 0 OR v_hours > 24 THEN
        RAISE EXCEPTION 'invalid_custom_hours' USING ERRCODE = 'P0001';
      END IF;
    ELSIF v_hours IS NOT NULL AND (v_hours < 0 OR v_hours > 24) THEN
      RAISE EXCEPTION 'invalid_hours' USING ERRCODE = 'P0001';
    END IF;

    v_original := NULLIF(btrim(COALESCE(v_cell ->> 'originalStatus', '')), '');

    IF v_date < v_min OR v_date > v_max OR v_date > v_today THEN
      RAISE EXCEPTION 'date_out_of_range' USING ERRCODE = 'P0001';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = v_driver AND d.archived_at IS NULL
    ) THEN
      RAISE EXCEPTION 'unknown_driver' USING ERRCODE = 'P0001';
    END IF;

    -- The panel passes the roster it is showing, so a stale tab cannot reach a
    -- rider the operator cannot currently see.
    IF p_driver_ids IS NOT NULL AND cardinality(p_driver_ids) > 0
      AND NOT (v_driver = ANY (p_driver_ids)) THEN
      RAISE EXCEPTION 'cell_out_of_scope' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.payroll_manual_adjustments (
      driver_id, work_date, period_month, original_status, adjusted_status,
      adjusted_hours, reason, adjusted_by, adjusted_by_name
    ) VALUES (
      v_driver, v_date, date_trunc('month', v_date)::date, v_original, v_status,
      CASE WHEN v_status = 'custom' THEN v_hours ELSE NULL END,
      v_reason, auth.uid(), v_actor
    );

    v_applied := v_applied + 1;
  END LOOP;

  PERFORM public.payroll_log_rule_change(
    NULL, NULL, 'adjustment', 'apply', NULL,
    jsonb_build_object('cells', v_applied, 'reason', v_reason, 'actor', v_actor)
  );

  RETURN jsonb_build_object('applied', v_applied, 'reason', v_reason, 'by', v_actor);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_apply_payroll_adjustments(jsonb, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_apply_payroll_adjustments(jsonb, text, uuid[]) TO authenticated, service_role;

-- 2. audit read ----------------------------------------------------------

-- The read-only record list behind the change log: who changed which day to
-- what, when, and why.
CREATE OR REPLACE FUNCTION public.admin_payroll_adjustment_audit(
  p_from date,
  p_to date,
  p_driver_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'driverId', a.driver_id,
      'driverName', COALESCE(NULLIF(btrim(p.full_name), ''), '—'),
      'mgId', COALESCE(NULLIF(btrim(d.employee_id), ''), NULLIF(btrim(d.driver_code), ''), '—'),
      'workDate', to_char(a.work_date, 'YYYY-MM-DD'),
      'originalStatus', a.original_status,
      'adjustedStatus', a.adjusted_status,
      'adjustedHours', a.adjusted_hours,
      'reason', a.reason,
      'actorName', COALESCE(a.adjusted_by_name, '—'),
      'adjustedAt', to_char(a.adjusted_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD HH24:MI')
    )
    ORDER BY a.adjusted_at DESC
  ), '[]'::jsonb)
  FROM public.payroll_manual_adjustments a
  LEFT JOIN public.drivers d ON d.id = a.driver_id
  LEFT JOIN public.profiles p ON p.id = a.driver_id
  WHERE (p_from IS NULL OR a.work_date >= p_from)
    AND (p_to IS NULL OR a.work_date <= p_to)
    AND (p_driver_id IS NULL OR a.driver_id = p_driver_id)
    AND public.is_admin_panel_user();
$$;

REVOKE ALL ON FUNCTION public.admin_payroll_adjustment_audit(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payroll_adjustment_audit(date, date, uuid) TO authenticated, service_role;
