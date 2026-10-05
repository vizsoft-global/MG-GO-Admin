-- Re-apply the two EmployeeDesk V2 template upsert bodies under a fresh version.
--
-- `20261115000000` had already been applied when the field-guard rules were
-- settled, and the Supabase CLI treats a re-pushed *version* as up to date, so
-- editing that file cannot change what production serves. The columns,
-- constraints, backfill, reminder RPC and permission seeds all landed on the
-- first push and are correct; only the two plpgsql bodies differ, and this file
-- is the ledger entry that actually applies them.
--
-- The rules being settled, stated once:
--   * `fixed` needs at least one option, because the options list is the only
--     place a fixed value is stored and "fixed" with nothing fixed would print
--     an empty line on a signed document.
--   * `signature` cannot be a `select`, because no field type captures a stroke
--     and a picker is not the thing a person signs.
-- Both mirror `isFieldPairRenderable()` in src/features/esign/template-source.ts,
-- so the builder's inline warning and the server's refusal are the same rule.

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
  IF v_source = 'fixed' AND COALESCE(jsonb_array_length(p_field->'options'), 0) < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'fixed_requires_value');
  END IF;
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
