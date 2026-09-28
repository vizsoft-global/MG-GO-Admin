-- Drivers bulk import writes Number of OFFs onto the current Kuwait month.
-- admin_set_driver_off_structure accepts payroll CRUD or drivers write ticks.
-- Do not widen admin_bulk_set (Payroll sheet stays payroll-gated).
-- Do not re-apply 20261028700000 / 20261030100000 / 20261030300000 / 20261030400000.

CREATE OR REPLACE FUNCTION public.drivers_can_set_off_structure()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_super_admin_user()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.access_kind = 'manager'
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.admin_role_permissions arp ON arp.role_id = p.admin_role_id
      WHERE p.id = auth.uid()
        AND arp.permission_slug IN (
          'drivers.manage', 'drivers.create', 'drivers.edit'
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.admin_user_permissions up
      WHERE up.user_id = auth.uid()
        AND up.permission_slug IN (
          'drivers.manage', 'drivers.create', 'drivers.edit'
        )
    );
$$;

REVOKE ALL ON FUNCTION public.drivers_can_set_off_structure() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.drivers_can_set_off_structure() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_driver_off_structure(
  p_driver_id uuid,
  p_month date,
  p_off_days integer
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
  v_name text;
  v_prev integer;
BEGIN
  IF NOT public.is_admin_panel_user()
    OR NOT (
      public.payroll_can_manage()
      OR public.drivers_can_set_off_structure()
    )
  THEN
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

  SELECT COALESCE(NULLIF(btrim(pr.full_name), ''), d.driver_code)
  INTO v_name
  FROM public.drivers d
  LEFT JOIN public.profiles pr ON pr.id = d.id
  WHERE d.id = p_driver_id AND d.archived_at IS NULL;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'driver_not_found';
  END IF;

  SELECT o.off_days INTO v_prev
  FROM public.driver_off_structure o
  WHERE o.driver_id = p_driver_id AND o.period_month = v_month;

  -- NULL clears the override and returns the driver to the 2-day fallback.
  IF p_off_days IS NULL THEN
    DELETE FROM public.driver_off_structure
    WHERE driver_id = p_driver_id AND period_month = v_month;

    RETURN jsonb_build_object(
      'ok', true,
      'cleared', true,
      'driver_id', p_driver_id,
      'driver_name', v_name,
      'month', to_char(v_month, 'YYYY-MM'),
      'previous_off_days', v_prev
    );
  END IF;

  IF p_off_days < 0 THEN
    RAISE EXCEPTION 'invalid_off_days';
  END IF;
  IF p_off_days > v_days THEN
    RAISE EXCEPTION 'off_days_exceeds_month';
  END IF;

  INSERT INTO public.driver_off_structure
    (driver_id, period_month, off_days, source, updated_by, updated_at)
  VALUES (p_driver_id, v_month, p_off_days, 'manual', auth.uid(), now())
  ON CONFLICT (driver_id, period_month) DO UPDATE SET
    off_days = EXCLUDED.off_days,
    source = 'manual',
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'cleared', false,
    'driver_id', p_driver_id,
    'driver_name', v_name,
    'month', to_char(v_month, 'YYYY-MM'),
    'off_days', p_off_days,
    'previous_off_days', v_prev
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_driver_off_structure(uuid, date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_driver_off_structure(uuid, date, integer) TO authenticated;
