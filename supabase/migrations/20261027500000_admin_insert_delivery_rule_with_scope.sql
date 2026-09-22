-- Bulk DPD create: insert delivery_rules + one delivery_rule_scopes row
-- in a single function (one transaction). Priority is locked to the form
-- defaults (restaurant 30, zone 10) — not a client argument — so a staff
-- RPC call cannot outrank a manual rule via an invented priority.
-- Create is only used when that restaurant/zone has zero rules.

CREATE OR REPLACE FUNCTION public.admin_insert_delivery_rule_with_scope(
  p_name text,
  p_scope_type text,
  p_scope_id uuid,
  p_dpd_target numeric,
  p_dpd_period text
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
  v_start date := (timezone('Asia/Kuwait', now()))::date;
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
    DATE '2099-12-31',
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

REVOKE ALL ON FUNCTION public.admin_insert_delivery_rule_with_scope(text, text, uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_insert_delivery_rule_with_scope(text, text, uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_insert_delivery_rule_with_scope(text, text, uuid, numeric, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_insert_delivery_rule_with_scope(text, text, uuid, numeric, text) IS
  'Staff-only (is_admin_panel_user + earnings.manage / super admin via staff_has_permission). Inserts one active delivery rule and its single scope in one transaction. Priority locked: restaurant 30, zone 10.';
