-- Sender templates + bulk e-sign. Not pushed until Approve, deploy.

INSERT INTO public.esign_categories (key, label_en, description, icon_key, screenshot_restricted, sort_order)
VALUES
  ('loan_agreement', 'Loan Agreement', 'Loan acknowledgement and repayment terms', 'L', true, 80),
  ('asset_handover', 'Asset Handover', 'Asset issue / handover acknowledgements', 'H', true, 90)
ON CONFLICT (key) DO UPDATE SET
  label_en = EXCLUDED.label_en,
  description = EXCLUDED.description,
  screenshot_restricted = EXCLUDED.screenshot_restricted,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.esign_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_key text NOT NULL REFERENCES public.esign_categories(key),
  name_en text NOT NULL,
  name_ar text,
  header_en text NOT NULL DEFAULT '',
  header_ar text NOT NULL DEFAULT '',
  body_en text NOT NULL DEFAULT '',
  body_ar text NOT NULL DEFAULT '',
  declaration_en text NOT NULL DEFAULT '',
  declaration_ar text NOT NULL DEFAULT '',
  default_language text NOT NULL DEFAULT 'en'
    CHECK (default_language IN ('en', 'ar')),
  is_active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS esign_templates_category_idx
  ON public.esign_templates (category_key, is_active);

CREATE TABLE IF NOT EXISTS public.esign_template_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.esign_templates(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  label_en text NOT NULL,
  label_ar text,
  field_type text NOT NULL DEFAULT 'text'
    CHECK (field_type IN ('text', 'textarea', 'number', 'date', 'select')),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_required boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, field_key),
  CONSTRAINT esign_template_fields_key_format
    CHECK (field_key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT esign_template_fields_not_employee
    CHECK (field_key NOT IN (
      'company_name', 'employee_name', 'employee_id',
      'driver_code', 'zone', 'project', 'nationality'
    ))
);

CREATE SEQUENCE IF NOT EXISTS public.esign_batch_code_seq START 1000;

CREATE OR REPLACE FUNCTION public.allocate_esign_batch_code()
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'BAT-' || lpad(nextval('public.esign_batch_code_seq')::text, 4, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS public.esign_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_code text NOT NULL UNIQUE DEFAULT public.allocate_esign_batch_code(),
  template_id uuid NOT NULL REFERENCES public.esign_templates(id),
  template_version int NOT NULL,
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ar')),
  title text NOT NULL,
  due_at date,
  source_filename text,
  total_count int NOT NULL DEFAULT 0,
  created_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'partial')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.esign_batch_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.esign_batches(id) ON DELETE CASCADE,
  row_index int NOT NULL CHECK (row_index >= 0),
  driver_id uuid REFERENCES public.drivers(id),
  employee_id text,
  description text,
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'created', 'failed')),
  error text,
  esign_request_id uuid REFERENCES public.esign_requests(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, row_index)
);

CREATE INDEX IF NOT EXISTS esign_batch_rows_claim_idx
  ON public.esign_batch_rows (batch_id, status, row_index);

ALTER TABLE public.esign_requests
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.esign_templates(id),
  ADD COLUMN IF NOT EXISTS template_version int,
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.esign_batches(id),
  ADD COLUMN IF NOT EXISTS batch_row int,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS employee_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS esign_requests_batch_row_uidx
  ON public.esign_requests (batch_id, batch_row)
  WHERE batch_id IS NOT NULL AND batch_row IS NOT NULL;

ALTER TABLE public.esign_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esign_template_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esign_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esign_batch_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_all_esign_templates ON public.esign_templates;
CREATE POLICY staff_all_esign_templates ON public.esign_templates
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS staff_all_esign_template_fields ON public.esign_template_fields;
CREATE POLICY staff_all_esign_template_fields ON public.esign_template_fields
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS staff_all_esign_batches ON public.esign_batches;
CREATE POLICY staff_all_esign_batches ON public.esign_batches
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS staff_all_esign_batch_rows ON public.esign_batch_rows;
CREATE POLICY staff_all_esign_batch_rows ON public.esign_batch_rows
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

CREATE OR REPLACE FUNCTION public.esign_employee_snapshot(p_driver_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'company_name', COALESCE(
      NULLIF(btrim(d.source_company), ''),
      NULLIF(btrim(s.app_name), ''),
      'DPD'
    ),
    'employee_name', COALESCE(NULLIF(btrim(p.full_name), ''), d.driver_code, ''),
    'employee_id', COALESCE(d.employee_id, ''),
    'driver_code', COALESCE(d.driver_code, ''),
    'zone', z.name,
    'project', d.project_key,
    'nationality', d.nationality
  )
  FROM public.drivers d
  LEFT JOIN public.profiles p ON p.id = d.id
  LEFT JOIN public.zones z ON z.id = d.zone_id
  CROSS JOIN LATERAL (
    SELECT app_name FROM public.app_settings LIMIT 1
  ) s
  WHERE d.id = p_driver_id;
$$;

CREATE OR REPLACE FUNCTION public.admin_esign_resolve_employees(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_ord int := 0;
  v_emp text;
  v_hits int;
  v_driver public.drivers%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin_panel_user()
     OR NOT public.staff_has_permission('requests.view') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  FOR v_elem IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    v_ord := v_ord + 1;
    v_emp := NULLIF(btrim(COALESCE(v_elem->>'employee_id', '')), '');
    IF v_emp IS NULL THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'row_index', v_ord - 1,
        'employee_id', '',
        'ok', false,
        'status', 'invalid'
      ));
      CONTINUE;
    END IF;

    SELECT count(*) INTO v_hits
    FROM public.drivers d
    WHERE d.employee_id = v_emp;

    IF v_hits = 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'row_index', v_ord - 1,
        'employee_id', v_emp,
        'ok', false,
        'status', 'unknown_id'
      ));
      CONTINUE;
    END IF;
    IF v_hits > 1 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'row_index', v_ord - 1,
        'employee_id', v_emp,
        'ok', false,
        'status', 'ambiguous'
      ));
      CONTINUE;
    END IF;

    SELECT * INTO v_driver FROM public.drivers d WHERE d.employee_id = v_emp;
    IF v_driver.archived_at IS NOT NULL THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'row_index', v_ord - 1,
        'employee_id', v_emp,
        'ok', false,
        'status', 'archived'
      ));
      CONTINUE;
    END IF;
    IF v_driver.is_blocked THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'row_index', v_ord - 1,
        'employee_id', v_emp,
        'ok', false,
        'status', 'blocked'
      ));
      CONTINUE;
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'row_index', v_ord - 1,
      'employee_id', v_emp,
      'ok', true,
      'status', 'ok',
      'driver_id', v_driver.id,
      'snapshot', public.esign_employee_snapshot(v_driver.id)
    ));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'rows', v_out);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_esign_template(p_template jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_version int;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF NULLIF(btrim(COALESCE(p_template->>'name_en', '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_template->>'category_key', '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.esign_categories c
    WHERE c.key = p_template->>'category_key' AND c.is_active
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_category');
  END IF;

  v_id := NULLIF(p_template->>'id', '')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO public.esign_templates (
      category_key, name_en, name_ar, header_en, header_ar, body_en, body_ar,
      declaration_en, declaration_ar, default_language, is_active, created_by
    ) VALUES (
      p_template->>'category_key',
      btrim(p_template->>'name_en'),
      NULLIF(btrim(COALESCE(p_template->>'name_ar', '')), ''),
      COALESCE(p_template->>'header_en', ''),
      COALESCE(p_template->>'header_ar', ''),
      COALESCE(p_template->>'body_en', ''),
      COALESCE(p_template->>'body_ar', ''),
      COALESCE(p_template->>'declaration_en', ''),
      COALESCE(p_template->>'declaration_ar', ''),
      COALESCE(NULLIF(p_template->>'default_language', ''), 'en'),
      COALESCE((p_template->>'is_active')::boolean, true),
      v_uid
    )
    RETURNING id, version INTO v_id, v_version;
  ELSE
    UPDATE public.esign_templates SET
      category_key = p_template->>'category_key',
      name_en = btrim(p_template->>'name_en'),
      name_ar = NULLIF(btrim(COALESCE(p_template->>'name_ar', '')), ''),
      header_en = COALESCE(p_template->>'header_en', header_en),
      header_ar = COALESCE(p_template->>'header_ar', header_ar),
      body_en = COALESCE(p_template->>'body_en', body_en),
      body_ar = COALESCE(p_template->>'body_ar', body_ar),
      declaration_en = COALESCE(p_template->>'declaration_en', declaration_en),
      declaration_ar = COALESCE(p_template->>'declaration_ar', declaration_ar),
      default_language = COALESCE(NULLIF(p_template->>'default_language', ''), default_language),
      is_active = COALESCE((p_template->>'is_active')::boolean, is_active),
      version = version + 1,
      updated_at = now()
    WHERE id = v_id
    RETURNING id, version INTO v_id, v_version;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'version', v_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_esign_template_field(p_field jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF p_field->>'template_id' IS NULL OR NULLIF(btrim(COALESCE(p_field->>'field_key', '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_field->>'label_en', '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  INSERT INTO public.esign_template_fields (
    template_id, field_key, label_en, label_ar, field_type, options, is_required, sort_order
  ) VALUES (
    (p_field->>'template_id')::uuid,
    btrim(p_field->>'field_key'),
    btrim(p_field->>'label_en'),
    NULLIF(btrim(COALESCE(p_field->>'label_ar', '')), ''),
    COALESCE(NULLIF(p_field->>'field_type', ''), 'text'),
    COALESCE(p_field->'options', '[]'::jsonb),
    COALESCE((p_field->>'is_required')::boolean, false),
    COALESCE((p_field->>'sort_order')::int, 0)
  )
  ON CONFLICT (template_id, field_key) DO UPDATE SET
    label_en = EXCLUDED.label_en,
    label_ar = EXCLUDED.label_ar,
    field_type = EXCLUDED.field_type,
    options = EXCLUDED.options,
    is_required = EXCLUDED.is_required,
    sort_order = EXCLUDED.sort_order,
    updated_at = now()
  RETURNING id INTO v_id;

  UPDATE public.esign_templates SET version = version + 1, updated_at = now()
  WHERE id = (p_field->>'template_id')::uuid;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_esign_batch(p_batch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_code text;
  v_tpl public.esign_templates%ROWTYPE;
  v_row jsonb;
  v_idx int := 0;
  v_total int := 0;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  SELECT * INTO v_tpl FROM public.esign_templates
  WHERE id = (p_batch->>'template_id')::uuid AND is_active;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_template');
  END IF;

  INSERT INTO public.esign_batches (
    template_id, template_version, language, title, due_at, source_filename, created_by
  ) VALUES (
    v_tpl.id,
    v_tpl.version,
    COALESCE(NULLIF(p_batch->>'language', ''), v_tpl.default_language, 'en'),
    COALESCE(NULLIF(btrim(p_batch->>'title'), ''), v_tpl.name_en),
    NULLIF(p_batch->>'due_at', '')::date,
    NULLIF(p_batch->>'source_filename', ''),
    v_uid
  )
  RETURNING id, batch_code INTO v_id, v_code;

  FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_batch->'rows', '[]'::jsonb))
  LOOP
    INSERT INTO public.esign_batch_rows (
      batch_id, row_index, driver_id, employee_id, description, field_values
    ) VALUES (
      v_id,
      v_idx,
      NULLIF(v_row->>'driver_id', '')::uuid,
      NULLIF(btrim(COALESCE(v_row->>'employee_id', '')), ''),
      NULLIF(v_row->>'description', ''),
      COALESCE(v_row->'field_values', '{}'::jsonb)
    );
    v_idx := v_idx + 1;
    v_total := v_total + 1;
  END LOOP;

  UPDATE public.esign_batches SET total_count = v_total, updated_at = now() WHERE id = v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'batch_code', v_code, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_claim_esign_batch_rows(p_batch_id uuid, p_limit int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  WITH claimed AS (
    SELECT r.id
    FROM public.esign_batch_rows r
    WHERE r.batch_id = p_batch_id AND r.status = 'pending'
    ORDER BY r.row_index
    LIMIT GREATEST(LEAST(COALESCE(p_limit, 25), 50), 1)
    FOR UPDATE OF r SKIP LOCKED
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.row_index), '[]'::jsonb)
    INTO v_rows
  FROM public.esign_batch_rows x
  JOIN claimed c ON c.id = x.id;

  UPDATE public.esign_batches
  SET status = 'processing', updated_at = now()
  WHERE id = p_batch_id AND status IN ('queued', 'processing', 'partial');

  RETURN jsonb_build_object('ok', true, 'rows', v_rows);
END;
$$;

DROP FUNCTION IF EXISTS public.admin_create_esign_request(uuid, text, text, date, text, boolean);

CREATE OR REPLACE FUNCTION public.admin_create_esign_request(
  p_driver_id uuid,
  p_title text,
  p_category_key text DEFAULT NULL,
  p_due_at date DEFAULT NULL,
  p_document_storage_key text DEFAULT NULL,
  p_screenshot_restricted boolean DEFAULT NULL,
  p_template_id uuid DEFAULT NULL,
  p_batch_id uuid DEFAULT NULL,
  p_batch_row int DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_field_values jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cat public.esign_categories%ROWTYPE;
  v_tpl public.esign_templates%ROWTYPE;
  v_restricted boolean;
  v_id uuid;
  v_code text;
  v_field record;
  v_values jsonb := COALESCE(p_field_values, '{}'::jsonb);
  v_snapshot jsonb;
  v_existing public.esign_requests%ROWTYPE;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF p_driver_id IS NULL OR p_title IS NULL OR trim(p_title) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  IF p_batch_id IS NOT NULL AND p_batch_row IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.esign_requests
    WHERE batch_id = p_batch_id AND batch_row = p_batch_row;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true, 'id', v_existing.id, 'request_code', v_existing.request_code, 'idempotent', true
      );
    END IF;
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

  IF p_template_id IS NOT NULL THEN
    SELECT * INTO v_tpl FROM public.esign_templates WHERE id = p_template_id AND is_active;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_template');
    END IF;
    IF v_tpl.category_key IS DISTINCT FROM p_category_key THEN
      RETURN jsonb_build_object('ok', false, 'error', 'template_category_mismatch');
    END IF;
    FOR v_field IN
      SELECT * FROM public.esign_template_fields
      WHERE template_id = v_tpl.id AND is_required
    LOOP
      IF NULLIF(btrim(COALESCE(v_values ->> v_field.field_key, '')), '') IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'field_required', 'field', v_field.field_key);
      END IF;
    END LOOP;
  END IF;

  v_restricted := COALESCE(p_screenshot_restricted, v_cat.screenshot_restricted);
  v_snapshot := COALESCE(public.esign_employee_snapshot(p_driver_id), '{}'::jsonb);

  INSERT INTO public.esign_requests (
    title, category_key, driver_id, document_storage_key, due_at,
    screenshot_restricted, sent_by,
    template_id, template_version, batch_id, batch_row,
    description, field_values, employee_snapshot
  ) VALUES (
    trim(p_title), p_category_key, p_driver_id, p_document_storage_key, p_due_at,
    v_restricted, v_uid,
    p_template_id, CASE WHEN p_template_id IS NULL THEN NULL ELSE v_tpl.version END,
    p_batch_id, p_batch_row,
    NULLIF(btrim(COALESCE(p_description, '')), ''),
    v_values,
    v_snapshot
  )
  RETURNING id, request_code INTO v_id, v_code;

  IF p_batch_id IS NOT NULL AND p_batch_row IS NOT NULL THEN
    UPDATE public.esign_batch_rows
    SET status = 'created', esign_request_id = v_id, error = NULL, updated_at = now()
    WHERE batch_id = p_batch_id AND row_index = p_batch_row;
    UPDATE public.esign_batches
    SET created_count = created_count + 1, updated_at = now()
    WHERE id = p_batch_id;
  END IF;

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
      AND v_req.signed_document_error IS NULL,
    'template_name', (
      SELECT t.name_en FROM public.esign_templates t WHERE t.id = v_req.template_id
    ),
    'template_name_ar', (
      SELECT t.name_ar FROM public.esign_templates t WHERE t.id = v_req.template_id
    ),
    'field_values_labeled', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'key', f.field_key,
        'label_en', f.label_en,
        'label_ar', f.label_ar,
        'value', v_req.field_values ->> f.field_key
      ) ORDER BY f.sort_order)
      FROM public.esign_template_fields f
      WHERE f.template_id = v_req.template_id
    ), '[]'::jsonb)
  )
  INTO v_row;

  RETURN jsonb_build_object('ok', true, 'request', v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.esign_employee_snapshot(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_esign_resolve_employees(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_esign_template(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_esign_template_field(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_esign_batch(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_claim_esign_batch_rows(uuid, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_esign_request(uuid, text, text, date, text, boolean, uuid, uuid, int, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_get_esign_request(uuid) TO authenticated, service_role;
