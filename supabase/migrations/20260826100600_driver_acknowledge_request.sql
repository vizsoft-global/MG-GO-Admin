-- Driver acknowledge for RCM ack screens (RSup/10b–10e).
-- drivers.id = auth.uid() in this project. Final approve sets awaiting_driver_ack for loan/asset/sick_leave.
-- Superseded auth fix also in 20260826100700_fix_ack_list_payload.sql (applied to prod).

CREATE OR REPLACE FUNCTION public.driver_acknowledge_request(
  p_request_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.requests%ROWTYPE;
  v_payload jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = v_uid AND d.archived_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_driver');
  END IF;

  SELECT * INTO v_row
  FROM public.requests r
  WHERE r.id = p_request_id AND r.driver_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_row.status IN ('rejected', 'solved') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_status');
  END IF;

  v_payload := COALESCE(v_row.payload, '{}'::jsonb)
    || jsonb_build_object(
      'driver_ack_at', now(),
      'driver_ack_note', NULLIF(trim(COALESCE(p_note, '')), ''),
      'awaiting_driver_ack', false
    );

  UPDATE public.requests
  SET
    payload = v_payload,
    needs_attention = true,
    attention_at = now(),
    attention_reason = 'driver_ack',
    updated_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'id', p_request_id);
END;
$$;

REVOKE ALL ON FUNCTION public.driver_acknowledge_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_acknowledge_request(uuid, text) TO authenticated;

-- See full admin_decide_request body in applied migration / 007 companion; keep file for history.
-- Final-approve awaiting_driver_ack patch was applied via MCP apply_migration driver_acknowledge_request.
