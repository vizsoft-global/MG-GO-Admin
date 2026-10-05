-- EmployeeDesk V2 — template field provenance + document kind + reminder ledger.
--
-- The V2 template builder has to render each field row with a *source badge*
-- ("From the system", "You enter", "Fixed", "Signed by a person") and has to
-- split the A4 preview into an Employee Information grid and a document body.
-- Neither fact could be derived from the existing columns: `field_type` says how
-- a value is captured, never where it comes from, and a system-filled field is
-- frequently a `text` field. So provenance becomes stored data rather than a
-- convention held in the UI — otherwise the builder and the rendered PDF would
-- be free to disagree about which fields a human actually fills.
--
-- Everything here is additive. `source_kind` defaults to 'entry' and
-- `section_key` defaults to 'document', which is exactly how every existing
-- template behaves today (a free-text field the operator fills in), so no
-- existing template, request or PDF changes on deploy.

-- ---------------------------------------------------------------------------
-- 1. Provenance, section and data source on template fields
-- ---------------------------------------------------------------------------

ALTER TABLE public.esign_template_fields
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'entry',
  ADD COLUMN IF NOT EXISTS section_key text NOT NULL DEFAULT 'document',
  ADD COLUMN IF NOT EXISTS options_source text;

-- Drop-then-add so the migration is re-runnable and a widened list is a single
-- edit rather than three ALTERs.
ALTER TABLE public.esign_template_fields
  DROP CONSTRAINT IF EXISTS esign_template_fields_source_kind_check;
ALTER TABLE public.esign_template_fields
  ADD CONSTRAINT esign_template_fields_source_kind_check
  CHECK (source_kind IN ('system', 'entry', 'fixed', 'signature'));

ALTER TABLE public.esign_template_fields
  DROP CONSTRAINT IF EXISTS esign_template_fields_section_key_check;
ALTER TABLE public.esign_template_fields
  ADD CONSTRAINT esign_template_fields_section_key_check
  CHECK (section_key IN ('employee', 'document'));

-- A signature row is a value signed off by a person; the two signature *blocks*
-- in the document footer are skeleton-rendered, not field rows. Nothing to
-- backfill here — `entry` is correct for every existing free-text row.

-- ---------------------------------------------------------------------------
-- 2. Document kind + draft flag on the template
-- ---------------------------------------------------------------------------

ALTER TABLE public.esign_templates
  ADD COLUMN IF NOT EXISTS document_kind text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT false;

ALTER TABLE public.esign_templates
  DROP CONSTRAINT IF EXISTS esign_templates_document_kind_check;
ALTER TABLE public.esign_templates
  ADD CONSTRAINT esign_templates_document_kind_check
  CHECK (document_kind IN ('penalty', 'loan', 'general'));

-- ---------------------------------------------------------------------------
-- 3. Reminder ledger on the request (drives the reminder cooldown UI)
-- ---------------------------------------------------------------------------

ALTER TABLE public.esign_requests
  ADD COLUMN IF NOT EXISTS reminder_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminded_at timestamptz;

-- ---------------------------------------------------------------------------
-- 4. Upsert RPCs carry the new keys
-- ---------------------------------------------------------------------------

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
  v_kind text;
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

  -- An unknown kind is refused rather than coerced, so a typo cannot silently
  -- produce a template whose preview the builder cannot lay out.
  v_kind := COALESCE(NULLIF(btrim(COALESCE(p_template->>'document_kind', '')), ''), 'general');
  IF v_kind NOT IN ('penalty', 'loan', 'general') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_document_kind');
  END IF;

  v_id := NULLIF(p_template->>'id', '')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO public.esign_templates (
      category_key, name_en, name_ar, header_en, header_ar, body_en, body_ar,
      declaration_en, declaration_ar, default_language, is_active,
      document_kind, is_draft, created_by
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
      v_kind,
      COALESCE((p_template->>'is_draft')::boolean, false),
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
      document_kind = v_kind,
      is_draft = COALESCE((p_template->>'is_draft')::boolean, is_draft),
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
  v_type text;
  v_source text;
  v_section text;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF p_field->>'template_id' IS NULL OR NULLIF(btrim(COALESCE(p_field->>'field_key', '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_field->>'label_en', '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  v_type := COALESCE(NULLIF(p_field->>'field_type', ''), 'text');
  v_source := COALESCE(NULLIF(btrim(COALESCE(p_field->>'source_kind', '')), ''), 'entry');
  v_section := COALESCE(NULLIF(btrim(COALESCE(p_field->>'section_key', '')), ''), 'document');

  IF v_source NOT IN ('system', 'entry', 'fixed', 'signature') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_source_kind');
  END IF;
  IF v_section NOT IN ('employee', 'document') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_section_key');
  END IF;
  -- "Fixed" means the value is baked into the document, and the options list is
  -- the only place a fixed value is stored. Fixed with nothing fixed would
  -- render an empty line on a signed document.
  IF v_source = 'fixed' AND COALESCE(jsonb_array_length(p_field->'options'), 0) < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'fixed_requires_value');
  END IF;
  -- There is no field type that captures a stroke, so a picker cannot be the
  -- thing a person signs. Mirrors isFieldPairRenderable() in the builder.
  IF v_source = 'signature' AND v_type = 'select' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'signature_not_dropdown');
  END IF;

  INSERT INTO public.esign_template_fields (
    template_id, field_key, label_en, label_ar, field_type, options, is_required,
    sort_order, source_kind, section_key, options_source
  ) VALUES (
    (p_field->>'template_id')::uuid,
    btrim(p_field->>'field_key'),
    btrim(p_field->>'label_en'),
    NULLIF(btrim(COALESCE(p_field->>'label_ar', '')), ''),
    v_type,
    COALESCE(p_field->'options', '[]'::jsonb),
    COALESCE((p_field->>'is_required')::boolean, false),
    COALESCE((p_field->>'sort_order')::int, 0),
    v_source,
    v_section,
    NULLIF(btrim(COALESCE(p_field->>'options_source', '')), '')
  )
  ON CONFLICT (template_id, field_key) DO UPDATE SET
    label_en = EXCLUDED.label_en,
    label_ar = EXCLUDED.label_ar,
    field_type = EXCLUDED.field_type,
    options = EXCLUDED.options,
    is_required = EXCLUDED.is_required,
    sort_order = EXCLUDED.sort_order,
    source_kind = EXCLUDED.source_kind,
    section_key = EXCLUDED.section_key,
    options_source = EXCLUDED.options_source,
    updated_at = now()
  RETURNING id INTO v_id;

  UPDATE public.esign_templates SET version = version + 1, updated_at = now()
  WHERE id = (p_field->>'template_id')::uuid;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Reminder send — bumps the ledger so the UI can enforce a cooldown
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_remind_esign_requests(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sent int := 0;
  v_id uuid;
  v_row public.esign_requests%ROWTYPE;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_ids');
  END IF;

  FOREACH v_id IN ARRAY p_ids LOOP
    SELECT * INTO v_row FROM public.esign_requests WHERE id = v_id;
    CONTINUE WHEN v_row.id IS NULL;
    -- Reminding a finished document is noise. `pending` and `in_progress` are the
    -- only states where the reminder has a reader who still has to act.
    CONTINUE WHEN v_row.status NOT IN ('pending', 'in_progress');

    UPDATE public.esign_requests
       SET reminder_count = COALESCE(reminder_count, 0) + 1,
           last_reminded_at = now(),
           updated_at = now()
     WHERE id = v_id;

    v_sent := v_sent + 1;
  END LOOP;

  -- `action` is the enum public.admin_activity_action, which has no 'remind'
  -- member; adding one would need its own migration because a value added with
  -- ALTER TYPE cannot be referenced in the same transaction. The reminder is a
  -- state update on the request, so it is filed as 'update' with the operation
  -- named in route_name and the ids counted in context.
  INSERT INTO public.admin_activity_logs (
    admin_user_id, action, entity_type, entity_id, route_name, context
  ) VALUES (
    v_uid, 'update', 'esign_requests', NULL, 'esign.remind',
    jsonb_build_object('request_ids', to_jsonb(p_ids), 'sent', v_sent)
  );

  RETURN jsonb_build_object('ok', true, 'sent', v_sent);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants — CREATE OR REPLACE preserves the ACL of the two upserts, but the
--    new reminder function needs one, and Postgres grants PUBLIC EXECUTE by
--    default, which in this schema means riders too.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.admin_remind_esign_requests(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remind_esign_requests(uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. EmployeeDesk permissions
-- ---------------------------------------------------------------------------

INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('employeedesk.view',   'View EmployeeDesk (HR & e-signature hub)', 'employeedesk'),
  ('employeedesk.manage', 'Manage EmployeeDesk templates, batches and documents', 'employeedesk')
ON CONFLICT (slug) DO NOTHING;

-- Granted to roles that already run the request & e-signature module, because
-- EmployeeDesk is the destination of that work rather than a new gate.
INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, 'employeedesk.view'
  FROM public.admin_roles r
 WHERE EXISTS (
   SELECT 1 FROM public.admin_role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_slug IN ('requests.view', 'visits.view')
 )
ON CONFLICT (role_id, permission_slug) DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, 'employeedesk.manage'
  FROM public.admin_roles r
 WHERE EXISTS (
   SELECT 1 FROM public.admin_role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_slug = 'requests.manage'
 )
ON CONFLICT (role_id, permission_slug) DO NOTHING;
