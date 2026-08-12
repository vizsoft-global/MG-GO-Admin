-- Figma "Transfer type (on approval)" on the fuel drawer (4149:27167).
--
-- The column landed in 20260831100100 but nothing could write it. This is the approver-facing
-- write path. It is deliberately NOT a parameter on admin_decide_request: the payout method is
-- a standing instruction on the request that Accounts may correct after the fact, exactly like
-- the loan/asset decision terms, which are editable post-decision via
-- admin_set_request_decision_meta. Folding it into the decide call would have made it settable
-- only at the instant of approval.
--
-- Unlike the decision terms it does NOT raise the attention badge: nothing about it is sent to
-- the rider, so there is nothing for the rider to acknowledge.

CREATE OR REPLACE FUNCTION public.admin_set_fuel_transfer_type(
  p_request_id uuid,
  p_transfer_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.requests%ROWTYPE;
  v_value text := NULLIF(trim(lower(COALESCE(p_transfer_type, ''))), '');
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT (
    public.staff_has_permission('requests.approve')
    OR public.staff_has_permission('requests.manage')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  -- NULL is a legal value: it clears a choice made in error.
  IF v_value IS NOT NULL AND v_value NOT IN ('cash', 'salary') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_transfer_type');
  END IF;

  SELECT * INTO v_req FROM public.requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_req.request_type <> 'fuel' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_fuel_request');
  END IF;

  -- A closed request is archived. Rejected is left writable on purpose: a rejection can be
  -- reversed by a later request, and a stale payout method on a rejected row is worse than none.
  IF v_req.status = 'closed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_closed');
  END IF;

  UPDATE public.requests
  SET fuel_transfer_type = v_value,
      updated_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'fuel_transfer_type', v_value);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_fuel_transfer_type(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_fuel_transfer_type(uuid, text) TO authenticated;
