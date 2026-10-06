-- Incoming document upload. Creates a `document` request with
-- payload.source = 'admin_incoming'. Approval steps start only when
-- p_start_route is true — a logged document is not the same decision as
-- putting it on a route.

CREATE OR REPLACE FUNCTION public.admin_upload_incoming_document(
  p_driver_id uuid,
  p_category text,
  p_subject text,
  p_received_on date,
  p_attachments jsonb DEFAULT '[]'::jsonb,
  p_start_route boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor_name text;
  v_payload jsonb;
  v_id uuid;
  v_code text;
  v_att jsonb;
  v_subject text := btrim(COALESCE(p_subject, ''));
  v_category text := btrim(COALESCE(p_category, ''));
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF p_driver_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_required');
  END IF;
  IF v_subject = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'subject_required');
  END IF;
  IF v_category = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'category_required');
  END IF;
  IF p_attachments IS NULL
     OR jsonb_typeof(p_attachments) <> 'array'
     OR jsonb_array_length(p_attachments) < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'attachment_required');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = p_driver_id AND d.archived_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_driver');
  END IF;

  SELECT NULLIF(btrim(COALESCE(p.full_name, '')), '') INTO v_actor_name
  FROM public.profiles p WHERE p.id = v_uid;

  v_payload := jsonb_build_object(
    'source', 'admin_incoming',
    'category', v_category,
    'subject', v_subject,
    'received_on', p_received_on,
    'created_on_behalf', true,
    'created_on_behalf_by', v_uid,
    'created_on_behalf_by_name', COALESCE(v_actor_name, 'Admin'),
    'created_on_behalf_at', now()
  );

  v_code := public.allocate_request_code('document');

  INSERT INTO public.requests (
    request_code, driver_id, request_type, status, payload,
    details, needs_attention, attention_at, attention_reason
  ) VALUES (
    v_code, p_driver_id, 'document', 'submitted', v_payload,
    v_subject, true, now(), 'incoming_document'
  )
  RETURNING id INTO v_id;

  IF COALESCE(p_start_route, false) THEN
    PERFORM public.rcm_materialize_approval_steps(v_id);
  END IF;

  FOR v_att IN SELECT * FROM jsonb_array_elements(p_attachments)
  LOOP
    INSERT INTO public.request_attachments (
      request_id, storage_key, file_name, content_type, byte_size, uploaded_by,
      title, kind, captured_at, source
    ) VALUES (
      v_id,
      v_att ->> 'storage_key',
      v_att ->> 'file_name',
      v_att ->> 'content_type',
      NULLIF(v_att ->> 'byte_size', '')::bigint,
      v_uid,
      NULLIF(btrim(COALESCE(v_att ->> 'title', '')), ''),
      NULLIF(btrim(COALESCE(v_att ->> 'kind', '')), ''),
      NULLIF(v_att ->> 'captured_at', '')::timestamptz,
      COALESCE(NULLIF(btrim(COALESCE(v_att ->> 'source', '')), ''), 'admin_upload')
    );
  END LOOP;

  INSERT INTO public.admin_activity_logs (
    admin_user_id, action, entity_type, entity_id, route_name, context
  ) VALUES (
    v_uid, 'create', 'requests', v_id, 'requests.incoming_upload',
    jsonb_build_object(
      'category', v_category,
      'start_route', COALESCE(p_start_route, false)
    )
  );

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'request_code', v_code);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upload_incoming_document(uuid, text, text, date, jsonb, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upload_incoming_document(uuid, text, text, date, jsonb, boolean)
  TO authenticated, service_role;
