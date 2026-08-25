-- Live category screenshot policy for the driver e-sign viewer.
--
-- `esign_requests.screenshot_restricted` is stamped at send time. New
-- categories defaulted to blocked, so a later "Screenshots: Allowed" flip
-- never reached the app — Review Document still showed
-- "Screenshots disabled for this document". List + get now return the live
-- category flag, falling back to the stamped value when the category is gone.

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
        SELECT e.id, e.request_code, e.title, e.status::text AS status,
               e.due_at, e.signed_at,
               COALESCE(c.screenshot_restricted, e.screenshot_restricted)
                 AS screenshot_restricted,
               e.category_key, c.label_en AS category_label,
               e.created_at
        FROM public.esign_requests e
        LEFT JOIN public.esign_categories c ON c.key = e.category_key
        WHERE e.driver_id = v_uid
        ORDER BY CASE WHEN e.status = 'pending' THEN 0 ELSE 1 END, e.created_at DESC
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

  SELECT to_jsonb(v_req) || jsonb_build_object(
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

GRANT EXECUTE ON FUNCTION public.driver_list_esign_requests(int, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_get_esign_request(uuid) TO authenticated, service_role;
