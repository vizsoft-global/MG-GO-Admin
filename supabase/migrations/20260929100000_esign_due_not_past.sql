-- Reject a past due date on a new signature request (Asia/Kuwait calendar day).

CREATE OR REPLACE FUNCTION public.admin_create_esign_request(
  p_driver_id uuid,
  p_title text,
  p_category_key text DEFAULT NULL,
  p_due_at date DEFAULT NULL,
  p_document_storage_key text DEFAULT NULL,
  p_screenshot_restricted boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cat public.esign_categories%ROWTYPE;
  v_restricted boolean;
  v_id uuid;
  v_code text;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF p_driver_id IS NULL OR p_title IS NULL OR trim(p_title) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;
  IF p_due_at IS NOT NULL AND p_due_at < (timezone('Asia/Kuwait', now()))::date THEN
    RETURN jsonb_build_object('ok', false, 'error', 'due_in_past');
  END IF;

  IF p_category_key IS NOT NULL THEN
    SELECT * INTO v_cat FROM public.esign_categories WHERE key = p_category_key AND is_active;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_category');
    END IF;
    v_restricted := COALESCE(p_screenshot_restricted, v_cat.screenshot_restricted);
  ELSE
    SELECT esign_screenshot_default INTO v_restricted FROM public.app_settings WHERE id = 1;
    v_restricted := COALESCE(p_screenshot_restricted, v_restricted, true);
  END IF;

  INSERT INTO public.esign_requests (
    title, category_key, driver_id, document_storage_key, due_at,
    screenshot_restricted, sent_by
  ) VALUES (
    trim(p_title), p_category_key, p_driver_id, p_document_storage_key, p_due_at,
    v_restricted, v_uid
  )
  RETURNING id, request_code INTO v_id, v_code;

  PERFORM public.notify_driver_transactional(
    p_driver_id,
    'Document to sign — ' || v_code,
    trim(p_title),
    'musallam:///profile/support/sign/' || v_id::text,
    'operations',
    'high',
    jsonb_build_object('record_type', 'esign', 'record_id', v_id::text, 'route', '/profile/support/sign/' || v_id::text)
  );

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'request_code', v_code);
END;
$$;
