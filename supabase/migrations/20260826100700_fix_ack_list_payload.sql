-- drivers.id = auth.uid() in this schema; include payload on my-requests list.

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
  WHERE r.id = p_request_id
    AND r.driver_id = v_uid
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

CREATE OR REPLACE FUNCTION public.driver_list_my_requests(
  p_status text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC)
      FROM (
        SELECT id, request_code, request_type, status, current_step_label,
               current_step_order, amount_kwd, start_date, end_date,
               created_at, updated_at, completed_at, severity, payload
        FROM public.requests
        WHERE driver_id = v_uid
          AND (p_status IS NULL OR status::text = p_status)
        ORDER BY created_at DESC
        LIMIT GREATEST(COALESCE(p_limit, 50), 1)
        OFFSET GREATEST(COALESCE(p_offset, 0), 0)
      ) r
    ), '[]'::jsonb)
  );
END;
$$;
