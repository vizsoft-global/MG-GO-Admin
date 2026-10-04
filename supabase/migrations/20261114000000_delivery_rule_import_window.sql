-- Bulk DPD upload gained Start / End columns, so a create has to be able to
-- state the window instead of always taking "today → 2099-12-31".
--
-- Additive with defaults, but NOT an overload: a 5-argument call and a
-- 7-argument call with two defaults are both valid for a five-key payload, and
-- PostgREST would refuse "function is not unique". The 5-argument signature is
-- dropped and replaced, so every existing caller keeps working unchanged.
--
-- A DROP loses the ACL, so the REVOKE/GRANT block below is re-applied verbatim.

DROP FUNCTION IF EXISTS public.admin_insert_delivery_rule_with_scope(
  text, text, uuid, numeric, text
);

CREATE OR REPLACE FUNCTION public.admin_insert_delivery_rule_with_scope(
  p_name text,
  p_scope_type text,
  p_scope_id uuid,
  p_dpd_target numeric,
  p_dpd_period text,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_scope public.rule_scope_type;
  v_period public.incentive_period;
  v_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_priority integer;
  v_start date := COALESCE(p_start_date, (timezone('Asia/Kuwait', now()))::date);
  v_end date := COALESCE(p_end_date, DATE '2099-12-31');
  v_rule_id uuid;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT public.staff_has_permission('earnings.manage') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF v_name IS NULL OR p_scope_id IS NULL THEN
    RAISE EXCEPTION 'missing_fields';
  END IF;

  IF p_scope_type IS DISTINCT FROM 'restaurant'
     AND p_scope_type IS DISTINCT FROM 'zone' THEN
    RAISE EXCEPTION 'invalid_scope';
  END IF;
  v_scope := p_scope_type::public.rule_scope_type;

  IF p_dpd_target IS NULL OR p_dpd_target <= 0 THEN
    RAISE EXCEPTION 'invalid_target';
  END IF;

  IF p_dpd_period IS DISTINCT FROM 'daily'
     AND p_dpd_period IS DISTINCT FROM 'weekly'
     AND p_dpd_period IS DISTINCT FROM 'monthly' THEN
    RAISE EXCEPTION 'invalid_period';
  END IF;
  v_period := p_dpd_period::public.incentive_period;

  IF v_end < v_start THEN
    RAISE EXCEPTION 'invalid_dates';
  END IF;

  IF v_scope = 'restaurant' THEN
    v_priority := 30;
    IF NOT EXISTS (
      SELECT 1 FROM public.restaurants r WHERE r.id = p_scope_id
    ) THEN
      RAISE EXCEPTION 'unknown_scope';
    END IF;
  ELSE
    v_priority := 10;
    IF NOT EXISTS (
      SELECT 1 FROM public.zones z WHERE z.id = p_scope_id
    ) THEN
      RAISE EXCEPTION 'unknown_scope';
    END IF;
  END IF;

  INSERT INTO public.delivery_rules (
    name,
    status,
    scope_type,
    zone_id,
    partner_id,
    restaurant_id,
    start_date,
    end_date,
    priority,
    require_verified,
    dpd_target,
    dpd_period,
    updated_at
  ) VALUES (
    v_name,
    'active',
    v_scope,
    CASE WHEN v_scope = 'zone' THEN p_scope_id ELSE NULL END,
    NULL,
    CASE WHEN v_scope = 'restaurant' THEN p_scope_id ELSE NULL END,
    v_start,
    v_end,
    v_priority,
    true,
    p_dpd_target,
    v_period,
    now()
  )
  RETURNING id INTO v_rule_id;

  INSERT INTO public.delivery_rule_scopes (
    delivery_rule_id,
    zone_id,
    partner_id,
    restaurant_id
  ) VALUES (
    v_rule_id,
    CASE WHEN v_scope = 'zone' THEN p_scope_id ELSE NULL END,
    NULL,
    CASE WHEN v_scope = 'restaurant' THEN p_scope_id ELSE NULL END
  );

  RETURN v_rule_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_insert_delivery_rule_with_scope(text, text, uuid, numeric, text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_insert_delivery_rule_with_scope(text, text, uuid, numeric, text, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_insert_delivery_rule_with_scope(text, text, uuid, numeric, text, date, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_insert_delivery_rule_with_scope(text, text, uuid, numeric, text, date, date) IS
  'Staff-only (is_admin_panel_user + earnings.manage / super admin via staff_has_permission). Inserts one active delivery rule and its single scope in one transaction. Priority locked: restaurant 30, zone 10. p_start_date / p_end_date are optional — NULL start means Kuwait today, NULL end means 2099-12-31, and end before start raises invalid_dates.';
