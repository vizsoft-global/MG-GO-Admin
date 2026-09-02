-- RCM QA 2026-09-02:
-- Ack uploads must become request_attachments rows, not a raw path in the rider note.

DROP FUNCTION IF EXISTS public.driver_acknowledge_request(uuid, text);

CREATE OR REPLACE FUNCTION public.driver_acknowledge_request(
  p_request_id uuid,
  p_note text DEFAULT NULL::text,
  p_attachment_keys text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.requests%ROWTYPE;
  v_payload jsonb;
  v_key text;
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

  IF v_row.status IN ('rejected', 'solved', 'responded', 'closed') THEN
    PERFORM public.log_driver_operation(
      v_uid, 'request', 'request.acknowledge', 'rpc', 'driver_acknowledge_request',
      false, 'wrong_status', 'request', p_request_id,
      jsonb_build_object('request_code', v_row.request_code, 'status', v_row.status::text)
    );
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
    acknowledged_at = now(),
    needs_attention = true,
    attention_at = now(),
    attention_reason = 'driver_ack',
    updated_at = now()
  WHERE id = p_request_id;

  IF p_attachment_keys IS NOT NULL THEN
    FOREACH v_key IN ARRAY p_attachment_keys
    LOOP
      IF NULLIF(trim(v_key), '') IS NULL THEN
        CONTINUE;
      END IF;
      INSERT INTO public.request_attachments (
        request_id, storage_key, file_name, content_type, uploaded_by
      ) VALUES (
        p_request_id,
        trim(v_key),
        regexp_replace(trim(v_key), '^.*/', ''),
        'image/jpeg',
        v_uid
      );
    END LOOP;
  END IF;

  PERFORM public.log_driver_operation(
    v_uid, 'request', 'request.acknowledge', 'rpc', 'driver_acknowledge_request',
    true, NULL, 'request', p_request_id,
    jsonb_build_object(
      'request_code', v_row.request_code,
      'request_type', v_row.request_type,
      'has_note', NULLIF(trim(COALESCE(p_note, '')), '') IS NOT NULL,
      'attachment_count', COALESCE(array_length(p_attachment_keys, 1), 0)
    )
  );

  RETURN jsonb_build_object('ok', true, 'id', p_request_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.driver_acknowledge_request(uuid, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_acknowledge_request(uuid, text, text[]) TO authenticated;
