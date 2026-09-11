-- Fleet section: vehicle extras, project_key, daily fuel fills, titled
-- attachments, asset assignment extras, fuel_refund (RFR-), fuel.view.
--
-- Live conflict (kept, not silently "fixed"):
--   vehicles.project_type remains group|rent.
--   Prototype Car Type is a NEW column vehicles.car_type (company|rent|maintenance).
--   group → company, rent → rent. vehicle_status.maintenance is unchanged.

-- ---------------------------------------------------------------------------
-- vehicles
-- ---------------------------------------------------------------------------

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS chassis_no text,
  ADD COLUMN IF NOT EXISTS model_year integer,
  ADD COLUMN IF NOT EXISTS location_text text,
  ADD COLUMN IF NOT EXISTS condition text,
  ADD COLUMN IF NOT EXISTS car_type text,
  ADD COLUMN IF NOT EXISTS fuel_type text,
  ADD COLUMN IF NOT EXISTS fuel_company text,
  ADD COLUMN IF NOT EXISTS chip_no text,
  ADD COLUMN IF NOT EXISTS fuel_monthly_limit_kwd numeric,
  ADD COLUMN IF NOT EXISTS owner_partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replaces_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replacement_started_at timestamptz;

ALTER TABLE public.vehicles
  DROP CONSTRAINT IF EXISTS vehicles_chassis_no_blank,
  DROP CONSTRAINT IF EXISTS vehicles_model_year_range,
  DROP CONSTRAINT IF EXISTS vehicles_condition_check,
  DROP CONSTRAINT IF EXISTS vehicles_car_type_check,
  DROP CONSTRAINT IF EXISTS vehicles_fuel_type_check,
  DROP CONSTRAINT IF EXISTS vehicles_fuel_company_check,
  DROP CONSTRAINT IF EXISTS vehicles_fuel_monthly_limit_check,
  DROP CONSTRAINT IF EXISTS vehicles_location_text_blank,
  DROP CONSTRAINT IF EXISTS vehicles_chip_no_blank;

ALTER TABLE public.vehicles
  ADD CONSTRAINT vehicles_chassis_no_blank
    CHECK (chassis_no IS NULL OR btrim(chassis_no) <> ''),
  ADD CONSTRAINT vehicles_model_year_range
    CHECK (model_year IS NULL OR (model_year >= 1990 AND model_year <= 2100)),
  ADD CONSTRAINT vehicles_condition_check
    CHECK (condition IS NULL OR condition IN ('running', 'repair_required', 'accident', 'standby')),
  ADD CONSTRAINT vehicles_car_type_check
    CHECK (car_type IS NULL OR car_type IN ('company', 'rent', 'maintenance')),
  ADD CONSTRAINT vehicles_fuel_type_check
    CHECK (fuel_type IS NULL OR fuel_type IN ('chip', 'card')),
  ADD CONSTRAINT vehicles_fuel_company_check
    CHECK (fuel_company IS NULL OR fuel_company IN ('mus', 'unp', 'rscd')),
  ADD CONSTRAINT vehicles_fuel_monthly_limit_check
    CHECK (fuel_monthly_limit_kwd IS NULL OR fuel_monthly_limit_kwd >= 0),
  ADD CONSTRAINT vehicles_location_text_blank
    CHECK (location_text IS NULL OR btrim(location_text) <> ''),
  ADD CONSTRAINT vehicles_chip_no_blank
    CHECK (chip_no IS NULL OR btrim(chip_no) <> '');

UPDATE public.vehicles
SET
  car_type = CASE project_type
    WHEN 'group' THEN 'company'
    WHEN 'rent' THEN 'rent'
    ELSE car_type
  END,
  fuel_monthly_limit_kwd = COALESCE(
    fuel_monthly_limit_kwd,
    CASE WHEN vehicle_type_key = 'car' THEN 60 ELSE 30 END
  )
WHERE car_type IS NULL OR fuel_monthly_limit_kwd IS NULL;

CREATE INDEX IF NOT EXISTS vehicles_car_type_idx ON public.vehicles (car_type);
CREATE INDEX IF NOT EXISTS vehicles_owner_partner_idx ON public.vehicles (owner_partner_id);
CREATE INDEX IF NOT EXISTS vehicles_replaces_idx ON public.vehicles (replaces_vehicle_id);

-- ---------------------------------------------------------------------------
-- drivers + intakes: project_key + accommodation
-- ---------------------------------------------------------------------------

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS project_key text,
  ADD COLUMN IF NOT EXISTS accommodation text;

ALTER TABLE public.driver_intakes
  ADD COLUMN IF NOT EXISTS project_key text,
  ADD COLUMN IF NOT EXISTS accommodation text;

ALTER TABLE public.drivers
  DROP CONSTRAINT IF EXISTS drivers_project_key_check,
  DROP CONSTRAINT IF EXISTS drivers_accommodation_blank;
ALTER TABLE public.driver_intakes
  DROP CONSTRAINT IF EXISTS driver_intakes_project_key_check,
  DROP CONSTRAINT IF EXISTS driver_intakes_accommodation_blank;

ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_project_key_check
    CHECK (project_key IS NULL OR project_key IN ('keeta', 'americana')),
  ADD CONSTRAINT drivers_accommodation_blank
    CHECK (accommodation IS NULL OR btrim(accommodation) <> '');

ALTER TABLE public.driver_intakes
  ADD CONSTRAINT driver_intakes_project_key_check
    CHECK (project_key IS NULL OR project_key IN ('keeta', 'americana')),
  ADD CONSTRAINT driver_intakes_accommodation_blank
    CHECK (accommodation IS NULL OR btrim(accommodation) <> '');

UPDATE public.drivers
SET project_key = CASE lower(btrim(client_name))
  WHEN 'keeta' THEN 'keeta'
  WHEN 'kita' THEN 'keeta'
  WHEN 'americana' THEN 'americana'
  ELSE project_key
END
WHERE project_key IS NULL AND client_name IS NOT NULL AND btrim(client_name) <> '';

UPDATE public.driver_intakes
SET project_key = CASE lower(btrim(client_name))
  WHEN 'keeta' THEN 'keeta'
  WHEN 'kita' THEN 'keeta'
  WHEN 'americana' THEN 'americana'
  ELSE project_key
END
WHERE project_key IS NULL AND client_name IS NOT NULL AND btrim(client_name) <> '';

CREATE INDEX IF NOT EXISTS drivers_project_key_idx
  ON public.drivers (project_key)
  WHERE project_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- request_attachments metadata (create/fill only; clarify stays keys-only)
-- ---------------------------------------------------------------------------

ALTER TABLE public.request_attachments
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE public.request_attachments
  DROP CONSTRAINT IF EXISTS request_attachments_source_check,
  DROP CONSTRAINT IF EXISTS request_attachments_title_blank,
  DROP CONSTRAINT IF EXISTS request_attachments_kind_blank;

ALTER TABLE public.request_attachments
  ADD CONSTRAINT request_attachments_source_check
    CHECK (source IS NULL OR source IN ('mobile_camera', 'admin_upload')),
  ADD CONSTRAINT request_attachments_title_blank
    CHECK (title IS NULL OR btrim(title) <> ''),
  ADD CONSTRAINT request_attachments_kind_blank
    CHECK (kind IS NULL OR btrim(kind) <> '');

-- ---------------------------------------------------------------------------
-- fuel_fills
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fuel_fills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  filled_at timestamptz NOT NULL DEFAULT now(),
  litres numeric NOT NULL CHECK (litres > 0),
  cost_kwd numeric NOT NULL CHECK (cost_kwd >= 0),
  station_name text NOT NULL CHECK (btrim(station_name) <> ''),
  lat numeric NOT NULL CHECK (lat >= -90 AND lat <= 90),
  lng numeric NOT NULL CHECK (lng >= -180 AND lng <= 180),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fuel_fills_filled_at_idx ON public.fuel_fills (filled_at DESC);
CREATE INDEX IF NOT EXISTS fuel_fills_driver_filled_idx ON public.fuel_fills (driver_id, filled_at DESC);
CREATE INDEX IF NOT EXISTS fuel_fills_vehicle_idx ON public.fuel_fills (vehicle_id);

CREATE TABLE IF NOT EXISTS public.fuel_fill_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fill_id uuid NOT NULL REFERENCES public.fuel_fills(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('fuel_receipt', 'fuel_pump', 'odometer')),
  title text NOT NULL CHECK (btrim(title) <> ''),
  file_name text,
  storage_key text NOT NULL,
  captured_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'mobile_camera'
    CHECK (source = 'mobile_camera'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fill_id, kind)
);

CREATE INDEX IF NOT EXISTS fuel_fill_attachments_fill_idx
  ON public.fuel_fill_attachments (fill_id);

ALTER TABLE public.fuel_fills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_fill_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fuel_fills_staff_select ON public.fuel_fills;
CREATE POLICY fuel_fills_staff_select
  ON public.fuel_fills FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS fuel_fill_attachments_staff_select ON public.fuel_fill_attachments;
CREATE POLICY fuel_fill_attachments_staff_select
  ON public.fuel_fill_attachments FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

GRANT SELECT ON public.fuel_fills TO authenticated;
GRANT SELECT ON public.fuel_fill_attachments TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'fuel-fills',
  'fuel-fills',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS fuel_fills_staff_all ON storage.objects;
CREATE POLICY fuel_fills_staff_all ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'fuel-fills' AND public.is_admin_panel_user())
  WITH CHECK (bucket_id = 'fuel-fills' AND public.is_admin_panel_user());

DROP POLICY IF EXISTS fuel_fills_driver_own ON storage.objects;
CREATE POLICY fuel_fills_driver_own ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'fuel-fills'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'fuel-fills'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- asset assignments extras + 4 attachment kinds
-- ---------------------------------------------------------------------------

ALTER TABLE public.asset_assignments
  ADD COLUMN IF NOT EXISTS asset_code text,
  ADD COLUMN IF NOT EXISTS received_at_place text,
  ADD COLUMN IF NOT EXISTS received_by_name text,
  ADD COLUMN IF NOT EXISTS returned_by_name text,
  ADD COLUMN IF NOT EXISTS return_reason text;

-- assigned_at / returned_at already exist. Do not add received_at.

CREATE TABLE IF NOT EXISTS public.asset_assignment_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.asset_assignments(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'handover_form', 'handover_photo', 'receive_form', 'receive_photo'
  )),
  title text,
  file_name text,
  storage_key text NOT NULL,
  captured_at timestamptz,
  source text CHECK (source IS NULL OR source IN ('mobile_camera', 'admin_upload')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS asset_assignment_attachments_assignment_idx
  ON public.asset_assignment_attachments (assignment_id);

ALTER TABLE public.asset_assignment_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_all_asset_assignment_attachments
  ON public.asset_assignment_attachments;
CREATE POLICY staff_all_asset_assignment_attachments
  ON public.asset_assignment_attachments FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_assignment_attachments TO authenticated;

INSERT INTO public.asset_catalog (name, code, icon_key, total_quantity, reorder_level, is_active)
VALUES
  ('Vest', 'vest', 'Shirt', 0, 5, true),
  ('Fuel chip', 'fuel_chip', 'CreditCard', 0, 5, true),
  ('Phone holder', 'phone_holder', 'Smartphone', 0, 5, true),
  ('Charger', 'charger', 'BatteryCharging', 0, 5, true)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- fuel.view
-- ---------------------------------------------------------------------------

INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('fuel.view', 'View fuel log', 'fleet')
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT rp.role_id, 'fuel.view'
FROM public.admin_role_permissions rp
WHERE rp.permission_slug = 'vehicles.view'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- fuel_refund type + RFR- codes + fuel-like workflow
-- ---------------------------------------------------------------------------

SELECT set_config('rcm.allow_system_edit', 'on', true);

CREATE SEQUENCE IF NOT EXISTS public.fuel_refund_code_seq START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION public.allocate_request_code(p_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_num bigint;
BEGIN
  IF p_type = 'fuel_refund' THEN
    v_num := nextval('public.fuel_refund_code_seq');
    RETURN 'RFR-' || lpad(v_num::text, 4, '0');
  END IF;
  v_num := nextval('public.request_code_seq');
  RETURN 'RCM-' || lpad(v_num::text, 4, '0');
END;
$function$;

REVOKE ALL ON FUNCTION public.allocate_request_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_request_code(text) TO authenticated;

INSERT INTO public.request_type_definitions (
  key, label_en, label_ar, icon_key, is_system, sort_order,
  terminal_status_on_approve, requires_driver_ack_on_approve,
  date_range_required, min_attachments, attachments_error_code
) VALUES (
  'fuel_refund', 'Fuel Refund', 'استرداد الوقود', 'receipt_long',
  true, 9, 'approved', false, false, 4, 'fuel_refund_attachments_required'
)
ON CONFLICT (key) DO UPDATE SET
  label_en = EXCLUDED.label_en,
  label_ar = EXCLUDED.label_ar,
  min_attachments = EXCLUDED.min_attachments,
  attachments_error_code = EXCLUDED.attachments_error_code,
  is_active = true;

INSERT INTO public.request_field_definitions (
  type_key, field_key, label_en, label_ar, kind, target,
  is_required, is_server_required, sort_order, options
)
SELECT v.type_key, v.field_key, v.label_en, v.label_ar, v.kind, v.target,
       v.is_required, v.is_server_required, v.sort_order, '[]'::jsonb
FROM (
  VALUES
    ('fuel_refund', 'amount_kwd', 'Amount (KWD)', 'المبلغ (د.ك)', 'number', 'amount_kwd', true, true, 1),
    ('fuel_refund', 'reason', 'Reason', 'السبب', 'textarea', 'payload', true, true, 2),
    ('fuel_refund', 'attachment', 'Attachments', 'المرفقات', 'file', 'attachments', true, false, 3)
) AS v(type_key, field_key, label_en, label_ar, kind, target, is_required, is_server_required, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.request_field_definitions f
  WHERE f.type_key = v.type_key AND f.field_key = v.field_key
);

INSERT INTO public.request_approval_step_templates (
  request_type, step_order, step_name, role_key, is_system_auto, allowed_actions
)
SELECT v.request_type, v.step_order, v.step_name, v.role_key, v.is_system_auto, v.allowed_actions
FROM (
  VALUES
    ('fuel_refund', 1, 'Submitted', 'system', true, ARRAY[]::text[]),
    ('fuel_refund', 2, 'Manager verified', 'manager', false, ARRAY['approve', 'reject']::text[]),
    ('fuel_refund', 3, 'Under review — Accounts', 'accounts', false, ARRAY['approve', 'reject']::text[]),
    ('fuel_refund', 4, 'Payout', 'accounts', false, ARRAY['approve', 'reject']::text[])
) AS v(request_type, step_order, step_name, role_key, is_system_auto, allowed_actions)
WHERE NOT EXISTS (
  SELECT 1 FROM public.request_approval_step_templates t
  WHERE t.request_type = v.request_type AND t.step_order = v.step_order
);

DO $$
BEGIN
  PERFORM set_config('rcm.allow_system_edit', 'on', true);
  INSERT INTO public.request_field_definitions (
    type_key, field_key, label_en, label_ar, kind, target,
    is_required, is_server_required, sort_order, options
  )
  SELECT v.type_key, v.field_key, v.label_en, v.label_ar, v.kind, v.target,
         false, false, v.sort_order, '[]'::jsonb
  FROM (
    VALUES
      ('asset', 'handover_by', 'Handover by', 'تم التسليم بواسطة', 'text', 'payload', 9),
      ('asset', 'handover_at', 'Handover at', 'تاريخ التسليم', 'date', 'payload', 10)
  ) AS v(type_key, field_key, label_en, label_ar, kind, target, sort_order)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.request_field_definitions f
    WHERE f.type_key = v.type_key AND f.field_key = v.field_key
  );
END $$;

CREATE OR REPLACE FUNCTION public.requests_require_fuel_transfer_on_approve()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.request_type IN ('fuel', 'fuel_refund')
     AND NEW.status = 'approved'
     AND NEW.fuel_transfer_type IS NULL THEN
    RAISE EXCEPTION 'fuel_transfer_type_required'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_fuel_transfer_type(
  p_request_id uuid,
  p_transfer_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req public.requests%ROWTYPE;
  v_value text := NULLIF(trim(lower(COALESCE(p_transfer_type, ''))), '');
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT (
    public.staff_has_permission('requests.approve')
    OR public.staff_has_permission('requests.manage')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF v_value IS NOT NULL AND v_value NOT IN ('cash', 'salary') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_transfer_type');
  END IF;

  SELECT * INTO v_req FROM public.requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_req.request_type NOT IN ('fuel', 'fuel_refund') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_fuel_request');
  END IF;

  IF v_req.status = 'closed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_closed');
  END IF;

  UPDATE public.requests
  SET fuel_transfer_type = v_value,
      updated_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'fuel_transfer_type', v_value);
END;
$function$;

-- ---------------------------------------------------------------------------
-- driver_create_request — titled attachments + RFR- prefix
-- ---------------------------------------------------------------------------

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

  v_code := public.allocate_request_code(p_type);

  INSERT INTO public.requests (
    request_code, driver_id, request_type, status, payload,
    amount_kwd, start_date, end_date, details, severity,
    needs_attention, attention_at, attention_reason
  ) VALUES (
    v_code, v_uid, p_type, 'submitted', COALESCE(p_payload, '{}'::jsonb),
    p_amount_kwd, p_start_date, p_end_date, p_details, p_severity,
    true, now(), 'new_request'
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

  v_code := public.allocate_request_code(p_type);

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

-- ---------------------------------------------------------------------------
-- admin_approve_driver copies project_key + accommodation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_approve_driver(
  p_intake_id uuid,
  p_user_id uuid,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_intake public.driver_intakes%ROWTYPE;
  v_passcode text;
  v_avatar text;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF p_user_id IS NULL OR p_intake_id IS NULL OR p_email IS NULL OR trim(p_email) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_fields');
  END IF;

  SELECT * INTO v_intake
  FROM public.driver_intakes
  WHERE id = p_intake_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'intake_not_found');
  END IF;

  IF v_intake.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'intake_archived');
  END IF;

  IF v_intake.linked = true OR v_intake.linked_profile_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'intake_already_linked');
  END IF;

  IF v_intake.full_name IS NULL OR trim(v_intake.full_name) = ''
     OR v_intake.employee_id IS NULL OR trim(v_intake.employee_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_fields');
  END IF;

  IF NOT public.intake_has_ops_assignment(p_intake_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_missing_assignment');
  END IF;

  IF v_intake.phone IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.phone = v_intake.phone AND p.id <> p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'phone_exists');
  END IF;

  IF v_intake.civil_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.civil_id = v_intake.civil_id AND d.id <> p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'civil_id_exists');
  END IF;

  IF EXISTS (SELECT 1 FROM public.drivers WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'intake_already_linked');
  END IF;

  v_avatar := NULLIF(btrim(COALESCE(v_intake.avatar_url, '')), '');

  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    phone,
    role,
    locale,
    approval_status,
    avatar_url
  )
  VALUES (
    p_user_id,
    lower(trim(p_email)),
    v_intake.full_name,
    v_intake.phone,
    'rider'::public.app_role,
    'en',
    'approved'::public.admin_approval_status,
    v_avatar
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    role = 'rider'::public.app_role,
    approval_status = 'approved'::public.admin_approval_status,
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
    updated_at = now();

  INSERT INTO public.drivers (
    id,
    driver_code,
    partner_id,
    zone_id,
    vehicle_id,
    civil_id,
    employee_id,
    nationality,
    rider_category,
    client_id,
    client_name,
    project_key,
    accommodation,
    custom_fields,
    status,
    is_on_duty,
    avatar_object_key,
    avatar_updated_at
  )
  VALUES (
    p_user_id,
    v_intake.driver_code,
    v_intake.partner_id,
    v_intake.zone_id,
    v_intake.vehicle_id,
    v_intake.civil_id,
    v_intake.employee_id,
    v_intake.nationality,
    v_intake.rider_category,
    v_intake.client_id,
    v_intake.client_name,
    v_intake.project_key,
    v_intake.accommodation,
    COALESCE(v_intake.custom_fields, '{}'::jsonb),
    'pending'::public.driver_status,
    false,
    v_avatar,
    CASE WHEN v_avatar IS NOT NULL THEN now() ELSE NULL END
  );

  INSERT INTO public.driver_restaurants (driver_id, restaurant_id)
  SELECT p_user_id, dir.restaurant_id
  FROM public.driver_intake_restaurants dir
  WHERE dir.intake_id = p_intake_id
  ON CONFLICT DO NOTHING;

  PERFORM public.sync_intake_asset_assignments_to_driver(p_intake_id, p_user_id);

  UPDATE public.drivers
  SET status = 'active'::public.driver_status, updated_at = now()
  WHERE id = p_user_id;

  SELECT app_passcode INTO v_passcode
  FROM public.drivers
  WHERE id = p_user_id;

  UPDATE public.driver_intakes
  SET
    linked = true,
    linked_profile_id = p_user_id,
    workflow_status = 'approved'::public.driver_workflow_status,
    status = 'linked'::public.driver_intake_status,
    updated_at = now()
  WHERE id = p_intake_id;

  UPDATE public.document_tracking
  SET driver_id = p_user_id, updated_at = now()
  WHERE intake_id = p_intake_id;

  UPDATE public.driver_documents dd
  SET
    expires_at = dt.expires_at,
    updated_at = now()
  FROM public.document_tracking dt
  WHERE dt.driver_id = p_user_id
    AND dt.doc_type = dd.doc_type
    AND dt.track_expiry = true
    AND dt.expires_at IS NOT NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'driver_id', p_user_id,
    'driver_code', v_intake.driver_code,
    'app_passcode', v_passcode
  );
EXCEPTION
  WHEN unique_violation THEN
    IF SQLERRM LIKE '%employee_id%' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'employee_id_exists');
    END IF;
    IF SQLERRM LIKE '%civil_id%' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'civil_id_exists');
    END IF;
    IF SQLERRM LIKE '%phone%' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'phone_exists');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'save_failed');
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_list_requests — add project_key + employee_id on each row
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_requests(
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_status text DEFAULT NULL::text,
  p_type text DEFAULT NULL::text,
  p_search text DEFAULT NULL::text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_department_key text DEFAULT NULL::text,
  p_zone_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_from timestamptz := p_date_from;
  v_to timestamptz := p_date_to;
  v_total bigint;
  v_pending bigint;
  v_overdue bigint;
  v_avg_seconds numeric;
  v_prev_from timestamptz;
  v_prev_to timestamptz;
  v_prev_total bigint;
  v_prev_pending bigint;
  v_prev_overdue bigint;
  v_prev_avg numeric;
  v_filtered_total bigint;
  v_status_counts jsonb;
  v_open constant text[] := ARRAY[
    'pending', 'submitted', 'in_review', 'needs_clarification', 'rescheduled'
  ];
  v_terminal constant text[] := ARRAY[
    'approved', 'rejected', 'solved', 'responded', 'closed'
  ];
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.view') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF v_from IS NOT NULL AND v_to IS NOT NULL THEN
    v_prev_from := (v_from - interval '1 month');
    v_prev_to := (v_to - interval '1 month');
  END IF;

  SELECT count(*) INTO v_total
  FROM public.requests r
  WHERE (v_from IS NULL OR r.created_at >= v_from)
    AND (v_to IS NULL OR r.created_at < v_to);

  SELECT count(*) INTO v_pending
  FROM public.requests r
  WHERE (v_from IS NULL OR r.created_at >= v_from)
    AND (v_to IS NULL OR r.created_at < v_to)
    AND r.status::text = ANY (v_open);

  SELECT count(*) INTO v_overdue
  FROM public.requests r
  WHERE (v_from IS NULL OR r.created_at >= v_from)
    AND (v_to IS NULL OR r.created_at < v_to)
    AND r.completed_at IS NULL
    AND NOT (r.status::text = ANY (v_terminal))
    AND r.created_at < (now() - interval '15 days');

  SELECT avg(EXTRACT(EPOCH FROM (r.completed_at - r.created_at))) INTO v_avg_seconds
  FROM public.requests r
  WHERE r.completed_at IS NOT NULL
    AND (v_from IS NULL OR r.created_at >= v_from)
    AND (v_to IS NULL OR r.created_at < v_to);

  IF v_prev_from IS NOT NULL THEN
    SELECT count(*) INTO v_prev_total FROM public.requests r
    WHERE r.created_at >= v_prev_from AND r.created_at < v_prev_to;
    SELECT count(*) INTO v_prev_pending FROM public.requests r
    WHERE r.created_at >= v_prev_from AND r.created_at < v_prev_to
      AND r.status::text = ANY (v_open);
    SELECT count(*) INTO v_prev_overdue FROM public.requests r
    WHERE r.created_at >= v_prev_from AND r.created_at < v_prev_to
      AND r.completed_at IS NULL
      AND NOT (r.status::text = ANY (v_terminal))
      AND r.created_at < (now() - interval '15 days');
    SELECT avg(EXTRACT(EPOCH FROM (r.completed_at - r.created_at))) INTO v_prev_avg
    FROM public.requests r
    WHERE r.completed_at IS NOT NULL
      AND r.created_at >= v_prev_from AND r.created_at < v_prev_to;
  END IF;

  WITH base AS (
    SELECT r.id, r.status::text AS status_text
    FROM public.requests r
    LEFT JOIN public.drivers d ON d.id = r.driver_id
    LEFT JOIN public.profiles p ON p.id = r.driver_id
    LEFT JOIN public.request_approval_steps cur
      ON cur.request_id = r.id AND cur.step_order = r.current_step_order
    WHERE (v_from IS NULL OR r.created_at >= v_from)
      AND (v_to IS NULL OR r.created_at < v_to)
      AND (p_type IS NULL OR r.request_type::text = p_type)
      AND (p_zone_id IS NULL OR d.zone_id = p_zone_id)
      AND (p_department_key IS NULL OR cur.role_key = p_department_key)
      AND (
        p_search IS NULL OR p_search = ''
        OR r.request_code ILIKE '%' || p_search || '%'
        OR p.full_name ILIKE '%' || p_search || '%'
        OR d.driver_code ILIKE '%' || p_search || '%'
      )
  ),
  counts AS (
    SELECT status_text, count(*) AS cnt FROM base GROUP BY status_text
  )
  SELECT
    (SELECT count(*) FROM base WHERE p_status IS NULL OR base.status_text = p_status),
    (SELECT COALESCE(jsonb_object_agg(counts.status_text, counts.cnt), '{}'::jsonb) FROM counts)
  INTO v_filtered_total, v_status_counts;

  RETURN jsonb_build_object(
    'ok', true,
    'kpi', jsonb_build_object(
      'total', v_total,
      'pending', v_pending,
      'overdue', v_overdue,
      'avg_resolution_seconds', v_avg_seconds,
      'prev_total', v_prev_total,
      'prev_pending', v_prev_pending,
      'prev_overdue', v_prev_overdue,
      'prev_avg_resolution_seconds', v_prev_avg
    ),
    'filtered_total', COALESCE(v_filtered_total, 0),
    'status_counts', COALESCE(v_status_counts, '{}'::jsonb),
    'department_options', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', o.role_key, 'label', o.label) ORDER BY o.label)
      FROM (
        SELECT DISTINCT t.role_key,
               COALESCE(dep.label_en, initcap(replace(t.role_key, '_', ' '))) AS label
        FROM public.request_approval_step_templates t
        LEFT JOIN public.request_departments dep ON dep.key = t.role_key AND dep.is_active
        WHERE t.role_key IS NOT NULL
          AND t.role_key NOT IN ('system')
          AND NOT t.is_system_auto
      ) o
    ), '[]'::jsonb),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
      FROM (
        SELECT r.id, r.request_code, r.request_type, r.status, r.current_step_label,
               r.current_step_order, r.driver_id, r.amount_kwd, r.needs_attention,
               r.attention_at, r.created_at, r.severity, r.sla_due_at,
               COALESCE((r.payload->>'awaiting_driver_ack')::boolean, false) AS awaiting_driver_ack,
               p.full_name AS driver_name, d.driver_code, d.employee_id, d.project_key,
               z.name AS driver_zone,
               cur.role_key AS department_key,
               COALESCE(dep.label_en, initcap(replace(cur.role_key, '_', ' '))) AS department_label
        FROM public.requests r
        LEFT JOIN public.drivers d ON d.id = r.driver_id
        LEFT JOIN public.profiles p ON p.id = r.driver_id
        LEFT JOIN public.zones z ON z.id = d.zone_id
        LEFT JOIN public.request_approval_steps cur
          ON cur.request_id = r.id AND cur.step_order = r.current_step_order
        LEFT JOIN public.request_departments dep
          ON dep.key = cur.role_key AND dep.is_active
        WHERE (v_from IS NULL OR r.created_at >= v_from)
          AND (v_to IS NULL OR r.created_at < v_to)
          AND (p_status IS NULL OR r.status::text = p_status)
          AND (p_type IS NULL OR r.request_type::text = p_type)
          AND (p_zone_id IS NULL OR d.zone_id = p_zone_id)
          AND (p_department_key IS NULL OR cur.role_key = p_department_key)
          AND (
            p_search IS NULL OR p_search = ''
            OR r.request_code ILIKE '%' || p_search || '%'
            OR p.full_name ILIKE '%' || p_search || '%'
            OR d.driver_code ILIKE '%' || p_search || '%'
          )
        ORDER BY r.created_at DESC
        LIMIT GREATEST(COALESCE(p_limit, 50), 1)
        OFFSET GREATEST(COALESCE(p_offset, 0), 0)
      ) x
    ), '[]'::jsonb)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- driver_get_assigned_vehicle
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.driver_get_assigned_vehicle()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'vehicle_id', v.id,
    'plate', v.reg_number,
    'kind', v.vehicle_type_key,
    'fuel_type', v.fuel_type,
    'chip_no', v.chip_no,
    'fuel_monthly_limit_kwd', v.fuel_monthly_limit_kwd,
    'model', NULLIF(btrim(concat_ws(' ', v.make, v.model)), '')
  )
  INTO v_row
  FROM public.drivers d
  JOIN public.vehicles v ON v.id = d.vehicle_id
  WHERE d.id = v_uid
    AND d.archived_at IS NULL;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.driver_get_assigned_vehicle() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_get_assigned_vehicle() TO authenticated;

-- ---------------------------------------------------------------------------
-- driver_report_fuel_fill
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.driver_report_fuel_fill(
  p_litres numeric,
  p_cost_kwd numeric,
  p_station_name text,
  p_lat numeric,
  p_lng numeric,
  p_attachments jsonb,
  p_filled_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_driver public.drivers%ROWTYPE;
  v_fill_id uuid;
  v_att jsonb;
  v_kinds text[];
  v_required text[] := ARRAY['fuel_receipt', 'fuel_pump', 'odometer'];
  v_missing text;
  v_kind text;
  v_title text;
  v_key text;
  v_captured timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_driver
  FROM public.drivers
  WHERE id = v_uid AND archived_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_driver');
  END IF;

  IF NOT v_driver.is_on_duty THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_off_duty');
  END IF;

  IF v_driver.vehicle_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'vehicle_not_assigned');
  END IF;

  IF p_litres IS NULL OR p_litres <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'litres_required');
  END IF;

  IF p_cost_kwd IS NULL OR p_cost_kwd < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cost_required');
  END IF;

  IF p_station_name IS NULL OR btrim(p_station_name) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'station_required');
  END IF;

  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'location_required');
  END IF;

  IF p_attachments IS NULL OR jsonb_typeof(p_attachments) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'attachment_required');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT NULLIF(btrim(elem ->> 'kind'), '')), ARRAY[]::text[])
    INTO v_kinds
  FROM jsonb_array_elements(p_attachments) elem;

  SELECT k INTO v_missing
  FROM unnest(v_required) k
  WHERE NOT (k = ANY (v_kinds))
  LIMIT 1;

  IF v_missing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'attachment_required', 'missing_kind', v_missing);
  END IF;

  INSERT INTO public.fuel_fills (
    driver_id, vehicle_id, filled_at, litres, cost_kwd, station_name, lat, lng
  ) VALUES (
    v_uid, v_driver.vehicle_id, COALESCE(p_filled_at, now()),
    p_litres, p_cost_kwd, btrim(p_station_name), p_lat, p_lng
  )
  RETURNING id INTO v_fill_id;

  FOR v_att IN SELECT * FROM jsonb_array_elements(p_attachments)
  LOOP
    v_kind := NULLIF(btrim(COALESCE(v_att ->> 'kind', '')), '');
    IF v_kind IS NULL OR NOT (v_kind = ANY (v_required)) THEN
      CONTINUE;
    END IF;
    v_key := NULLIF(btrim(COALESCE(v_att ->> 'storage_key', '')), '');
    v_captured := NULLIF(v_att ->> 'captured_at', '')::timestamptz;
    IF v_key IS NULL OR v_captured IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'attachment_required', 'missing_kind', v_kind);
    END IF;
    v_title := COALESCE(
      NULLIF(btrim(COALESCE(v_att ->> 'title', '')), ''),
      CASE v_kind
        WHEN 'fuel_receipt' THEN 'Fuel receipt'
        WHEN 'fuel_pump' THEN 'Fuel pump'
        WHEN 'odometer' THEN 'Odometer reading'
        ELSE v_kind
      END
    );
    INSERT INTO public.fuel_fill_attachments (
      fill_id, kind, title, file_name, storage_key, captured_at, source
    ) VALUES (
      v_fill_id,
      v_kind,
      v_title,
      v_att ->> 'file_name',
      v_key,
      v_captured,
      'mobile_camera'
    )
    ON CONFLICT (fill_id, kind) DO UPDATE SET
      title = EXCLUDED.title,
      file_name = EXCLUDED.file_name,
      storage_key = EXCLUDED.storage_key,
      captured_at = EXCLUDED.captured_at;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'id', v_fill_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.driver_report_fuel_fill(numeric, numeric, text, numeric, numeric, jsonb, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_report_fuel_fill(numeric, numeric, text, numeric, numeric, jsonb, timestamptz)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- admin fuel fill list / detail
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_fuel_fills(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_project_key text DEFAULT NULL,
  p_vehicle_type_key text DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_from timestamptz;
  v_to timestamptz;
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('fuel.view') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF p_from IS NOT NULL THEN
    v_from := (p_from::timestamp AT TIME ZONE 'Asia/Kuwait');
  END IF;
  IF p_to IS NOT NULL THEN
    v_to := ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait');
  END IF;

  SELECT count(*) INTO v_total
  FROM public.fuel_fills f
  JOIN public.drivers d ON d.id = f.driver_id
  JOIN public.vehicles v ON v.id = f.vehicle_id
  LEFT JOIN public.profiles p ON p.id = d.id
  WHERE (v_from IS NULL OR f.filled_at >= v_from)
    AND (v_to IS NULL OR f.filled_at < v_to)
    AND (p_project_key IS NULL OR d.project_key = p_project_key)
    AND (p_vehicle_type_key IS NULL OR v.vehicle_type_key = p_vehicle_type_key)
    AND (
      p_search IS NULL OR btrim(p_search) = ''
      OR p.full_name ILIKE '%' || p_search || '%'
      OR d.driver_code ILIKE '%' || p_search || '%'
      OR d.employee_id ILIKE '%' || p_search || '%'
      OR v.reg_number ILIKE '%' || p_search || '%'
    );

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.filled_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      f.id,
      f.filled_at,
      f.litres,
      f.cost_kwd,
      f.station_name,
      f.lat,
      f.lng,
      f.driver_id,
      p.full_name AS driver_name,
      d.driver_code,
      d.employee_id,
      d.project_key,
      f.vehicle_id,
      v.reg_number AS plate,
      v.vehicle_type_key AS kind,
      v.fuel_type,
      v.chip_no,
      v.fuel_monthly_limit_kwd,
      CASE
        WHEN v.fuel_monthly_limit_kwd IS NULL OR v.fuel_monthly_limit_kwd = 0 THEN NULL
        ELSE round((f.cost_kwd / v.fuel_monthly_limit_kwd) * 100, 1)
      END AS utilisation_pct,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'kind', a.kind,
          'title', a.title,
          'file_name', a.file_name,
          'storage_key', a.storage_key,
          'captured_at', a.captured_at,
          'source', a.source
        ) ORDER BY a.kind)
        FROM public.fuel_fill_attachments a
        WHERE a.fill_id = f.id
      ), '[]'::jsonb) AS attachments
    FROM public.fuel_fills f
    JOIN public.drivers d ON d.id = f.driver_id
    JOIN public.vehicles v ON v.id = f.vehicle_id
    LEFT JOIN public.profiles p ON p.id = d.id
    WHERE (v_from IS NULL OR f.filled_at >= v_from)
      AND (v_to IS NULL OR f.filled_at < v_to)
      AND (p_project_key IS NULL OR d.project_key = p_project_key)
      AND (p_vehicle_type_key IS NULL OR v.vehicle_type_key = p_vehicle_type_key)
      AND (
        p_search IS NULL OR btrim(p_search) = ''
        OR p.full_name ILIKE '%' || p_search || '%'
        OR d.driver_code ILIKE '%' || p_search || '%'
        OR d.employee_id ILIKE '%' || p_search || '%'
        OR v.reg_number ILIKE '%' || p_search || '%'
      )
    ORDER BY f.filled_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 200), 1)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ) x;

  RETURN jsonb_build_object('ok', true, 'total', COALESCE(v_total, 0), 'rows', v_rows);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_fuel_fill(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row jsonb;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('fuel.view') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  SELECT to_jsonb(x) INTO v_row
  FROM (
    SELECT
      f.id,
      f.filled_at,
      f.litres,
      f.cost_kwd,
      f.station_name,
      f.lat,
      f.lng,
      f.driver_id,
      p.full_name AS driver_name,
      d.driver_code,
      d.employee_id,
      d.project_key,
      d.accommodation,
      f.vehicle_id,
      v.reg_number AS plate,
      v.vehicle_type_key AS kind,
      v.model,
      v.make,
      v.fuel_type,
      v.chip_no,
      v.fuel_monthly_limit_kwd,
      CASE
        WHEN v.fuel_monthly_limit_kwd IS NULL OR v.fuel_monthly_limit_kwd = 0 THEN NULL
        ELSE round((f.cost_kwd / v.fuel_monthly_limit_kwd) * 100, 1)
      END AS utilisation_pct,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'kind', a.kind,
          'title', a.title,
          'file_name', a.file_name,
          'storage_key', a.storage_key,
          'captured_at', a.captured_at,
          'source', a.source
        ) ORDER BY a.kind)
        FROM public.fuel_fill_attachments a
        WHERE a.fill_id = f.id
      ), '[]'::jsonb) AS attachments
    FROM public.fuel_fills f
    JOIN public.drivers d ON d.id = f.driver_id
    JOIN public.vehicles v ON v.id = f.vehicle_id
    LEFT JOIN public.profiles p ON p.id = d.id
    WHERE f.id = p_id
  ) x;

  IF v_row IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'row', v_row);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_fuel_fills(date, date, text, text, text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_fuel_fills(date, date, text, text, text, integer, integer)
  TO authenticated;

REVOKE ALL ON FUNCTION public.admin_get_fuel_fill(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_fuel_fill(uuid) TO authenticated;
