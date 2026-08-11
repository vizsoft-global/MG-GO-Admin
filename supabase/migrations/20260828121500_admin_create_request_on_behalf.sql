-- Admin-raised requests (RCM "+ New request").
--
-- Riders normally submit through `driver_create_request`, which derives the driver from the JWT.
-- Office staff also take requests by phone, so this mirrors that function exactly — same gated
-- config checks, same required-field checks, same `allocate_request_code`, same
-- `rcm_materialize_approval_steps` seeding — and only differs in who it is created for and by:
-- the driver is passed in and the payload records the acting staff member.

CREATE OR REPLACE FUNCTION public.admin_create_request(
  p_driver_id uuid,
  p_type public.request_type,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_attachments jsonb DEFAULT '[]'::jsonb,
  p_amount_kwd numeric DEFAULT NULL::numeric,
  p_start_date date DEFAULT NULL::date,
  p_end_date date DEFAULT NULL::date,
  p_details text DEFAULT NULL::text,
  p_severity public.severity_level DEFAULT NULL::public.severity_level
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor_name text;
  v_payload jsonb;
  v_id uuid;
  v_code text;
  v_att jsonb;
  v_tenure int;
  v_cat text;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF p_driver_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_required');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = p_driver_id AND d.archived_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_driver');
  END IF;

  -- Gated: loan tenure must exist in config (empty table blocks loan submit)
  IF p_type = 'loan' THEN
    v_tenure := NULLIF((p_payload ->> 'tenure_months'), '')::int;
    IF v_tenure IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'tenure_required');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.loan_tenure_options WHERE months = v_tenure AND is_active) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'tenure_options_not_configured');
    END IF;
  END IF;

  -- Gated: complaint category must exist (empty table blocks)
  IF p_type = 'complaint' THEN
    v_cat := nullif(trim(p_payload ->> 'category'), '');
    IF v_cat IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'category_required');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.complaint_categories c
      WHERE c.is_active AND (c.key = v_cat OR c.label_en = v_cat)
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'complaint_categories_not_configured');
    END IF;
  END IF;

  -- Minimal required-field checks (Figma matrices)
  IF p_type IN ('leave', 'sick_leave') THEN
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_date_range');
    END IF;
  END IF;

  IF p_type = 'sick_leave' AND jsonb_array_length(COALESCE(p_attachments, '[]'::jsonb)) < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'medical_documents_required');
  END IF;

  SELECT NULLIF(trim(COALESCE(p.full_name, '')), '') INTO v_actor_name
  FROM public.profiles p
  WHERE p.id = v_uid;

  -- Audit trail + driver app both need to tell a phoned-in request apart from a self-service one.
  v_payload := COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object(
    'created_on_behalf', true,
    'created_on_behalf_by', v_uid,
    'created_on_behalf_by_name', COALESCE(v_actor_name, 'Admin'),
    'created_on_behalf_at', now()
  );

  v_code := public.allocate_request_code();

  INSERT INTO public.requests (
    request_code, driver_id, request_type, status, payload,
    amount_kwd, start_date, end_date, details, severity,
    needs_attention, attention_at, attention_reason
  ) VALUES (
    v_code, p_driver_id, p_type, 'submitted', v_payload,
    p_amount_kwd, p_start_date, p_end_date, p_details, p_severity,
    true, now(), 'new_request'
  )
  RETURNING id INTO v_id;

  PERFORM public.rcm_materialize_approval_steps(v_id);

  IF p_attachments IS NOT NULL AND jsonb_typeof(p_attachments) = 'array' THEN
    FOR v_att IN SELECT * FROM jsonb_array_elements(p_attachments)
    LOOP
      INSERT INTO public.request_attachments (
        request_id, storage_key, file_name, content_type, byte_size, uploaded_by
      ) VALUES (
        v_id,
        v_att ->> 'storage_key',
        v_att ->> 'file_name',
        v_att ->> 'content_type',
        NULLIF(v_att ->> 'byte_size', '')::bigint,
        v_uid
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'request_code', v_code);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_create_request(uuid, public.request_type, jsonb, jsonb, numeric, date, date, text, public.severity_level) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_request(uuid, public.request_type, jsonb, jsonb, numeric, date, date, text, public.severity_level) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_create_request(uuid, public.request_type, jsonb, jsonb, numeric, date, date, text, public.severity_level)
IS 'Staff create a request on behalf of a rider (RCM + New request). Mirrors driver_create_request; stamps payload.created_on_behalf_by.';
