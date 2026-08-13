-- RSup/10b-10d ack cards (loan/asset/sick_leave): the driver app's
-- `_AdminResponseCard` already reads structured terms (approved_amount,
-- approved_tenure_months, penalty_amount, approved_by, required_document,
-- requested_by) from the last completed `request_approval_steps.meta` —
-- `admin_decide_request` already threads a `p_meta` argument onto that
-- column, but no caller ever populates it, so the cards render blank.
-- This is the missing, additive write path: a small permission-gated RPC
-- that merges structured terms into the latest completed step's meta
-- without touching `admin_decide_request`'s existing approval flow.

CREATE OR REPLACE FUNCTION public.admin_set_request_decision_meta(
  p_request_id uuid,
  p_meta jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step public.request_approval_steps%ROWTYPE;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT (
    public.staff_has_permission('requests.approve')
    OR public.staff_has_permission('requests.manage')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF p_meta IS NULL OR jsonb_typeof(p_meta) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_meta');
  END IF;

  SELECT * INTO v_step FROM public.request_approval_steps
  WHERE request_id = p_request_id AND status = 'completed'
  ORDER BY decided_at DESC NULLS LAST, step_order DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_completed_step');
  END IF;

  UPDATE public.request_approval_steps
  SET meta = COALESCE(meta, '{}'::jsonb) || p_meta,
      updated_at = now()
  WHERE id = v_step.id;

  UPDATE public.requests
  SET needs_attention = true,
      attention_at = now(),
      attention_reason = 'decision_terms_updated',
      updated_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'step_id', v_step.id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_request_decision_meta(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_request_decision_meta(uuid, jsonb) TO authenticated;
