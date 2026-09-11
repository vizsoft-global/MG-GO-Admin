-- Snapshot the assigned vehicle onto fuel / fuel_refund / asset requests at create.
-- Same source as driver_get_assigned_vehicle (drivers.vehicle_id). Does not write drivers.vehicle_id.

ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS requests_vehicle_id_idx
  ON public.requests (vehicle_id)
  WHERE vehicle_id IS NOT NULL;

COMMENT ON COLUMN public.requests.vehicle_id IS
  'Assigned vehicle at submit for fuel, fuel_refund, and asset. Copied from drivers.vehicle_id — same join as driver_get_assigned_vehicle.';

CREATE OR REPLACE FUNCTION public.driver_assigned_vehicle_id(p_driver_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT d.vehicle_id
  FROM public.drivers d
  WHERE d.id = p_driver_id
    AND d.archived_at IS NULL;
$function$;

REVOKE ALL ON FUNCTION public.driver_assigned_vehicle_id(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.driver_assigned_vehicle_id(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.driver_create_request(
  p_type text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_attachments jsonb DEFAULT '[]'::jsonb,
  p_amount_kwd numeric DEFAULT NULL::numeric,
  p_start_date date DEFAULT NULL::date,
  p_end_date date DEFAULT NULL::date,
  p_details text DEFAULT NULL::text,
  p_severity severity_level DEFAULT NULL::severity_level
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_code text;
  v_att jsonb;
  v_error text;
  v_kinds text[];
  v_required text[] := ARRAY[
    'rejected_fuel_invoice', 'cash_invoice', 'vehicle_photo', 'odometer'
  ];
  v_missing text;
  v_vehicle_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = v_uid AND d.archived_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_driver');
  END IF;

  v_error := public.rcm_validate_request_input(
    p_type, p_payload, p_attachments, p_amount_kwd, p_start_date, p_end_date, p_details, p_severity);
  IF v_error IS NOT NULL THEN
    PERFORM public.log_driver_operation(
      v_uid, 'request', 'request.create', 'rpc', 'driver_create_request',
      false, v_error, 'request', NULL,
      jsonb_build_object('request_type', p_type)
    );
    RETURN jsonb_build_object('ok', false, 'error', v_error);
  END IF;

  IF p_type = 'fuel_refund' THEN
    SELECT COALESCE(array_agg(DISTINCT NULLIF(btrim(elem ->> 'kind'), '')), ARRAY[]::text[])
      INTO v_kinds
    FROM jsonb_array_elements(COALESCE(p_attachments, '[]'::jsonb)) elem;
    SELECT k INTO v_missing
    FROM unnest(v_required) k
    WHERE NOT (k = ANY (v_kinds))
    LIMIT 1;
    IF v_missing IS NOT NULL THEN
      PERFORM public.log_driver_operation(
        v_uid, 'request', 'request.create', 'rpc', 'driver_create_request',
        false, 'fuel_refund_attachments_required', 'request', NULL,
        jsonb_build_object('request_type', p_type, 'missing_kind', v_missing)
      );
      RETURN jsonb_build_object('ok', false, 'error', 'fuel_refund_attachments_required');
    END IF;
  END IF;

  IF p_type IN ('fuel', 'fuel_refund', 'asset') THEN
    v_vehicle_id := public.driver_assigned_vehicle_id(v_uid);
  END IF;

  v_code := public.allocate_request_code(p_type);

  INSERT INTO public.requests (
    request_code, driver_id, request_type, status, payload,
    amount_kwd, start_date, end_date, details, severity,
    needs_attention, attention_at, attention_reason, vehicle_id
  ) VALUES (
    v_code, v_uid, p_type, 'submitted', COALESCE(p_payload, '{}'::jsonb),
    p_amount_kwd, p_start_date, p_end_date, p_details, p_severity,
    true, now(), 'new_request', v_vehicle_id
  )
  RETURNING id INTO v_id;

  PERFORM public.rcm_materialize_approval_steps(v_id);

  IF p_attachments IS NOT NULL AND jsonb_typeof(p_attachments) = 'array' THEN
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
        NULLIF(btrim(COALESCE(v_att ->> 'source', '')), '')
      );
    END LOOP;
  END IF;

  PERFORM public.log_driver_operation(
    v_uid, 'request', 'request.create', 'rpc', 'driver_create_request',
    true, NULL, 'request', v_id,
    jsonb_build_object(
      'request_code', v_code,
      'request_type', p_type,
      'amount_kwd', p_amount_kwd,
      'vehicle_id', v_vehicle_id,
      'attachment_count', COALESCE(jsonb_array_length(p_attachments), 0)
    )
  );

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'request_code', v_code);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_create_request(
  p_driver_id uuid,
  p_type text,
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
  v_error text;
  v_vehicle_id uuid;
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

  v_error := public.rcm_validate_request_input(
    p_type, p_payload, p_attachments, p_amount_kwd, p_start_date, p_end_date, p_details, p_severity);
  IF v_error IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', v_error);
  END IF;

  SELECT NULLIF(trim(COALESCE(p.full_name, '')), '') INTO v_actor_name
  FROM public.profiles p
  WHERE p.id = v_uid;

  v_payload := COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object(
    'created_on_behalf', true,
    'created_on_behalf_by', v_uid,
    'created_on_behalf_by_name', COALESCE(v_actor_name, 'Admin'),
    'created_on_behalf_at', now()
  );

  IF p_type IN ('fuel', 'fuel_refund', 'asset') THEN
    v_vehicle_id := public.driver_assigned_vehicle_id(p_driver_id);
  END IF;

  v_code := public.allocate_request_code(p_type);

  INSERT INTO public.requests (
    request_code, driver_id, request_type, status, payload,
    amount_kwd, start_date, end_date, details, severity,
    needs_attention, attention_at, attention_reason, vehicle_id
  ) VALUES (
    v_code, p_driver_id, p_type, 'submitted', v_payload,
    p_amount_kwd, p_start_date, p_end_date, p_details, p_severity,
    true, now(), 'new_request', v_vehicle_id
  )
  RETURNING id INTO v_id;

  PERFORM public.rcm_materialize_approval_steps(v_id);

  IF p_attachments IS NOT NULL AND jsonb_typeof(p_attachments) = 'array' THEN
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
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'request_code', v_code);
END;
$function$;

UPDATE public.requests r
SET vehicle_id = d.vehicle_id
FROM public.drivers d
WHERE r.driver_id = d.id
  AND r.vehicle_id IS NULL
  AND d.vehicle_id IS NOT NULL
  AND r.request_type IN ('fuel', 'fuel_refund', 'asset');
