-- E-Sign + Appointment inbox (Figma RSup/24–29, Admin ESign/00–04, Screenshot settings)
-- Categories seeded from Figma Signature Categories frame (4345:6334).

DO $$ BEGIN
  CREATE TYPE public.esign_request_status AS ENUM (
    'pending', 'signed', 'expired', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS esign_screenshot_default boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.app_settings.esign_screenshot_default IS
  'Default screenshot policy for new e-sign requests when category does not override.';

CREATE TABLE IF NOT EXISTS public.esign_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label_en text NOT NULL,
  description text,
  icon_key text,
  screenshot_restricted boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.esign_categories (key, label_en, description, icon_key, screenshot_restricted, sort_order) VALUES
  ('accommodation', 'Accommodation Documents & Penalties', 'Housing contracts, deductions', 'A', true, 10),
  ('salary_slips', 'Salary Slips & Penalties', 'Monthly slips, salary deductions', 'S', true, 20),
  ('administrative', 'Administrative Documents & Penalties', 'Memos, official letters', 'Ad', false, 30),
  ('asset_docs', 'Asset Documents & Penalties', 'Handover, damage penalties', 'As', true, 40),
  ('traffic', 'Traffic Documents & Violations', 'Fines, violation acknowledgements', 'T', true, 50),
  ('unexcused_absence', 'Unexcused Absence Penalties', 'Absence penalty notices', 'U', true, 60),
  ('other', 'Other', 'Miscellaneous signature requests', 'O', false, 70)
ON CONFLICT (key) DO UPDATE SET
  label_en = EXCLUDED.label_en,
  description = EXCLUDED.description,
  screenshot_restricted = EXCLUDED.screenshot_restricted,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

CREATE SEQUENCE IF NOT EXISTS public.esign_code_seq START 1400;

CREATE OR REPLACE FUNCTION public.allocate_esign_code()
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'SIG-' || lpad(nextval('public.esign_code_seq')::text, 4, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS public.esign_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_code text NOT NULL UNIQUE DEFAULT public.allocate_esign_code(),
  title text NOT NULL,
  category_key text REFERENCES public.esign_categories(key),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  document_storage_key text,
  status public.esign_request_status NOT NULL DEFAULT 'pending',
  due_at date,
  screenshot_restricted boolean NOT NULL DEFAULT true,
  sent_by uuid REFERENCES public.profiles(id),
  signed_at timestamptz,
  signature_storage_key text,
  signer_display_name text,
  signer_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS esign_requests_driver_status_idx
  ON public.esign_requests (driver_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS esign_requests_status_idx
  ON public.esign_requests (status, created_at DESC);

-- Appointments enrichment for RSup/28–29
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS appointment_code text,
  ADD COLUMN IF NOT EXISTS location_label text DEFAULT 'Central Tower',
  ADD COLUMN IF NOT EXISTS admin_note text;

CREATE SEQUENCE IF NOT EXISTS public.appointment_code_seq START 1000;

CREATE OR REPLACE FUNCTION public.allocate_appointment_code()
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'APT-' || lpad(nextval('public.appointment_code_seq')::text, 4, '0');
END;
$$;

-- Storage
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'esign-documents',
  'esign-documents',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS esign_documents_staff_all ON storage.objects;
CREATE POLICY esign_documents_staff_all ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'esign-documents' AND public.is_admin_panel_user())
  WITH CHECK (bucket_id = 'esign-documents' AND public.is_admin_panel_user());

DROP POLICY IF EXISTS esign_documents_driver_own ON storage.objects;
CREATE POLICY esign_documents_driver_own ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'esign-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'esign-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

ALTER TABLE public.esign_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esign_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_all_esign_categories ON public.esign_categories;
CREATE POLICY staff_all_esign_categories ON public.esign_categories
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS drivers_read_esign_categories ON public.esign_categories;
CREATE POLICY drivers_read_esign_categories ON public.esign_categories
  FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS staff_all_esign_requests ON public.esign_requests;
CREATE POLICY staff_all_esign_requests ON public.esign_requests
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS drivers_read_own_esign_requests ON public.esign_requests;
CREATE POLICY drivers_read_own_esign_requests ON public.esign_requests
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

-- Admin list
CREATE OR REPLACE FUNCTION public.admin_list_esign_requests(
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
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
      FROM (
        SELECT e.*, p.full_name AS driver_name, d.driver_code,
               c.label_en AS category_label
        FROM public.esign_requests e
        LEFT JOIN public.drivers d ON d.id = e.driver_id
        LEFT JOIN public.profiles p ON p.id = e.driver_id
        LEFT JOIN public.esign_categories c ON c.key = e.category_key
        WHERE (p_status IS NULL OR e.status::text = p_status)
        ORDER BY e.created_at DESC
        LIMIT GREATEST(COALESCE(p_limit, 50), 1)
        OFFSET GREATEST(COALESCE(p_offset, 0), 0)
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

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
               e.due_at, e.signed_at, e.screenshot_restricted,
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
  v_row jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT to_jsonb(e) || jsonb_build_object('category_label', c.label_en)
  INTO v_row
  FROM public.esign_requests e
  LEFT JOIN public.esign_categories c ON c.key = e.category_key
  WHERE e.id = p_id AND e.driver_id = v_uid;

  IF v_row IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'request', v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_submit_esignature(
  p_id uuid,
  p_signature_storage_key text,
  p_signer_display_name text DEFAULT NULL,
  p_signer_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.esign_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_signature_storage_key IS NULL OR trim(p_signature_storage_key) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'signature_required');
  END IF;

  SELECT * INTO v_req FROM public.esign_requests
  WHERE id = p_id AND driver_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  UPDATE public.esign_requests
  SET status = 'signed',
      signed_at = now(),
      signature_storage_key = trim(p_signature_storage_key),
      signer_display_name = NULLIF(trim(COALESCE(p_signer_display_name, '')), ''),
      signer_meta = COALESCE(p_signer_meta, '{}'::jsonb),
      updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'status', 'signed');
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_list_appointments(
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
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.scheduled_for DESC)
      FROM (
        SELECT a.id,
               COALESCE(a.appointment_code, a.id::text) AS appointment_code,
               COALESCE(a.title, 'Appointment') AS title,
               a.scheduled_for,
               a.status::text AS status,
               a.reason,
               a.location_label,
               a.admin_note,
               a.created_at
        FROM public.appointments a
        WHERE a.driver_id = v_uid
        ORDER BY a.scheduled_for DESC
        LIMIT GREATEST(COALESCE(p_limit, 50), 1)
        OFFSET GREATEST(COALESCE(p_offset, 0), 0)
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_appointment(
  p_driver_id uuid,
  p_scheduled_for timestamptz,
  p_title text DEFAULT 'Appointment',
  p_reason text DEFAULT NULL,
  p_location_label text DEFAULT 'Central Tower',
  p_slot_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot uuid;
  v_id uuid;
  v_code text;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT (
    public.staff_has_permission('requests.manage')
    OR public.staff_has_permission('support.view')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF p_driver_id IS NULL OR p_scheduled_for IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  v_slot := p_slot_id;
  IF v_slot IS NULL THEN
    SELECT id INTO v_slot FROM public.appointment_slots ORDER BY day_of_week LIMIT 1;
  END IF;
  IF v_slot IS NULL THEN
    INSERT INTO public.appointment_slots (day_of_week, slot_name, start_time, end_time, capacity)
    VALUES (EXTRACT(DOW FROM p_scheduled_for)::int, 'Default', '09:00', '10:00', 20)
    RETURNING id INTO v_slot;
  END IF;

  v_code := public.allocate_appointment_code();
  INSERT INTO public.appointments (
    driver_id, slot_id, scheduled_for, reason, title, appointment_code, location_label, status
  ) VALUES (
    p_driver_id, v_slot, p_scheduled_for, p_reason, COALESCE(NULLIF(trim(p_title), ''), 'Appointment'),
    v_code, COALESCE(p_location_label, 'Central Tower'), 'scheduled'
  )
  RETURNING id INTO v_id;

  PERFORM public.notify_driver_transactional(
    p_driver_id,
    'Appointment confirmed — ' || v_code,
    COALESCE(NULLIF(trim(p_title), ''), 'Appointment') || ' at ' || COALESCE(p_location_label, 'Central Tower'),
    'musallam:///profile/support/appointments',
    'operations',
    'normal',
    jsonb_build_object('record_type', 'appointment', 'record_id', v_id::text, 'route', '/profile/support/appointments')
  );

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'appointment_code', v_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_esign_requests(text, int, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_esign_request(uuid, text, text, date, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_list_esign_requests(int, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_get_esign_request(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_submit_esignature(uuid, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_list_appointments(int, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_appointment(uuid, timestamptz, text, text, text, uuid) TO authenticated, service_role;
