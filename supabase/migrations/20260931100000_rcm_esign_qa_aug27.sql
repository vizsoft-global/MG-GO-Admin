-- RCM / e-sign QA (27 Aug 2026):
-- 1. Final fuel approve requires Cash / Salary.
-- 2. Pending e-sign rows whose due date is before Kuwait today become Expired.

CREATE OR REPLACE FUNCTION public.requests_require_fuel_transfer_on_approve()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.request_type = 'fuel'
     AND NEW.status = 'approved'
     AND NEW.fuel_transfer_type IS NULL THEN
    RAISE EXCEPTION 'fuel_transfer_type_required'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS requests_require_fuel_transfer_on_approve ON public.requests;
CREATE TRIGGER requests_require_fuel_transfer_on_approve
  BEFORE UPDATE OF status ON public.requests
  FOR EACH ROW
  EXECUTE FUNCTION public.requests_require_fuel_transfer_on_approve();

CREATE OR REPLACE FUNCTION public.admin_expire_esign_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.esign_requests
  SET status = 'expired',
      updated_at = now()
  WHERE status = 'pending'
    AND due_at IS NOT NULL
    AND due_at < (timezone('Asia/Kuwait', now()))::date;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_expire_esign_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_expire_esign_requests() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_esign_requests(
  p_status text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  PERFORM public.admin_expire_esign_requests();

  RETURN jsonb_build_object(
    'ok', true,
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
      FROM (
        SELECT e.*, p.full_name AS driver_name, d.driver_code,
               c.label_en AS category_label,
               CASE
                 WHEN e.status = 'pending'
                      AND e.due_at IS NOT NULL
                      AND e.due_at < (timezone('Asia/Kuwait', now()))::date
                 THEN 'expired'
                 ELSE e.status::text
               END AS display_status
        FROM public.esign_requests e
        LEFT JOIN public.drivers d ON d.id = e.driver_id
        LEFT JOIN public.profiles p ON p.id = e.driver_id
        LEFT JOIN public.esign_categories c ON c.key = e.category_key
        WHERE (
          p_status IS NULL
          OR CASE
               WHEN e.status = 'pending'
                    AND e.due_at IS NOT NULL
                    AND e.due_at < (timezone('Asia/Kuwait', now()))::date
               THEN 'expired'
               ELSE e.status::text
             END = p_status
        )
        ORDER BY e.created_at DESC
        LIMIT GREATEST(COALESCE(p_limit, 50), 1)
        OFFSET GREATEST(COALESCE(p_offset, 0), 0)
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_list_esign_requests(
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
      SELECT jsonb_agg(to_jsonb(x) ORDER BY
        CASE WHEN x.status = 'pending' THEN 0 ELSE 1 END,
        x.created_at DESC)
      FROM (
        SELECT e.id, e.request_code, e.title,
               CASE
                 WHEN e.status = 'pending'
                      AND e.due_at IS NOT NULL
                      AND e.due_at < (timezone('Asia/Kuwait', now()))::date
                 THEN 'expired'
                 ELSE e.status::text
               END AS status,
               e.due_at, e.signed_at,
               COALESCE(c.screenshot_restricted, e.screenshot_restricted)
                 AS screenshot_restricted,
               e.category_key, c.label_en AS category_label,
               e.created_at
        FROM public.esign_requests e
        LEFT JOIN public.esign_categories c ON c.key = e.category_key
        WHERE e.driver_id = v_uid
        ORDER BY CASE
          WHEN e.status = 'pending'
               AND NOT (
                 e.due_at IS NOT NULL
                 AND e.due_at < (timezone('Asia/Kuwait', now()))::date
               )
          THEN 0 ELSE 1 END,
          e.created_at DESC
        LIMIT GREATEST(COALESCE(p_limit, 50), 1)
        OFFSET GREATEST(COALESCE(p_offset, 0), 0)
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_get_esign_request(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.esign_requests%ROWTYPE;
  v_row jsonb;
  v_cat_restricted boolean;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_req FROM public.esign_requests
  WHERE id = p_id AND driver_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT c.screenshot_restricted
    INTO v_cat_restricted
  FROM public.esign_categories c
  WHERE c.key = v_req.category_key;

  v_status := CASE
    WHEN v_req.status = 'pending'
         AND v_req.due_at IS NOT NULL
         AND v_req.due_at < (timezone('Asia/Kuwait', now()))::date
    THEN 'expired'
    ELSE v_req.status::text
  END;

  SELECT to_jsonb(v_req) || jsonb_build_object(
    'status', v_status,
    'category_label', (
      SELECT c.label_en FROM public.esign_categories c WHERE c.key = v_req.category_key
    ),
    'screenshot_restricted', COALESCE(v_cat_restricted, v_req.screenshot_restricted),
    'download_storage_key',
      COALESCE(v_req.signed_document_storage_key, v_req.document_storage_key),
    'signed_document_ready', v_req.signed_document_storage_key IS NOT NULL,
    'signed_document_pending',
      v_req.status = 'signed'
      AND v_req.signed_document_storage_key IS NULL
      AND v_req.signed_document_error IS NULL
  )
  INTO v_row;

  RETURN jsonb_build_object('ok', true, 'request', v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_esign_requests(text, int, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_list_esign_requests(int, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_get_esign_request(uuid) TO authenticated, service_role;

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
  IF p_category_key IS NULL OR trim(p_category_key) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'category_required');
  END IF;
  IF p_due_at IS NOT NULL AND p_due_at < (timezone('Asia/Kuwait', now()))::date THEN
    RETURN jsonb_build_object('ok', false, 'error', 'due_in_past');
  END IF;

  SELECT * INTO v_cat FROM public.esign_categories WHERE key = p_category_key AND is_active;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_category');
  END IF;
  v_restricted := COALESCE(p_screenshot_restricted, v_cat.screenshot_restricted);

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

GRANT EXECUTE ON FUNCTION public.admin_create_esign_request(uuid, text, text, date, text, boolean) TO authenticated, service_role;
