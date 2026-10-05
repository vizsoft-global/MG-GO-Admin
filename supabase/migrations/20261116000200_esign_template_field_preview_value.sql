-- EmployeeDesk V2 — a template field can carry its own preview value.
--
-- **The problem this closes.** `EsignDocumentPreview` paints a live A4 document
-- beside the builder, and until now the only way to see it filled was to type a
-- sample into the field inspector — which lived in React state, so it was gone on
-- the next page load. Every preview therefore opened as a column of em-dashes, and
-- panel C2 of the reference is the opposite of that: it is a *filled* payslip, so
-- an author compares a populated document against a blank one and cannot tell
-- whether the addresses, dates and money rows line up. The preview exists to
-- answer "does this fit an A4 sheet and read like the reference", and a blank
-- sheet cannot answer it.
--
-- **Why this is a column and not code.** A hard-coded sample table inside the
-- preview component would put template content in the renderer, and the next
-- template (or the next tenant's wording) would need a code change to preview.
-- `preview_value` is content exactly like `label_en`: it belongs to the field,
-- the operator can edit it, and it prints nowhere but the preview. It is **not**
-- a default for the rider's form — `driver_get_esign_request` and the PDF
-- renderer read the request's stored `field_values`, never this column — so a
-- sample can never reach a signed document.
--
-- **Scope of the seed.** Only the rows the reference prints a value for are
-- filled, and the values are copied from panel C2 literally
-- (`docs/EMPLOYEEDESK_V2_UI_REFERENCE.md` §5): `August 2026`, `01/08/2026`,
-- `31/08/2026`, `01/09/2026`, `26`, `15.000`, `0.000`, `260.000`, `245.000`,
-- `100`, `26 days`. `Actual Working Days`, `Gross salary` and `Deduction reason`
-- are deliberately left NULL because the reference does not show them filled, and
-- inventing a plausible number for a payslip the operator will hold against a real
-- one is worse than leaving the honest blank.

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------

ALTER TABLE public.esign_template_fields
  ADD COLUMN IF NOT EXISTS preview_value text;

COMMENT ON COLUMN public.esign_template_fields.preview_value IS
  'Sample shown in the builder''s live preview only. Never reaches a sent document or the rider''s form.';

-- ---------------------------------------------------------------------------
-- 2. The RPC, so the builder can save it
--
-- `CREATE OR REPLACE` and not a DROP: a DROP would take the function's ACL with
-- it and re-open the `PUBLIC EXECUTE` default this schema has been careful to
-- close. The staff gate, the validation order and the version bump are all
-- carried over unchanged; the only additions are the column in the INSERT list
-- and its `EXCLUDED` counterpart in the conflict branch.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_upsert_esign_template_field(p_field jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    sort_order, source_kind, section_key, options_source, preview_value
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
    NULLIF(btrim(COALESCE(p_field->>'options_source', '')), ''),
    NULLIF(btrim(COALESCE(p_field->>'preview_value', '')), '')
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
    preview_value = EXCLUDED.preview_value,
    updated_at = now()
  RETURNING id INTO v_id;

  UPDATE public.esign_templates SET version = version + 1, updated_at = now()
  WHERE id = (p_field->>'template_id')::uuid;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. The reference's own example, on the reference's own template
--
-- Idempotent by (template_id, field_key), and written only where the row exists
-- so a template an operator has since deleted rows from is not given them back.
-- ---------------------------------------------------------------------------

UPDATE public.esign_template_fields f
   SET preview_value = v.preview_value,
       updated_at = now()
  FROM public.esign_templates t,
       (VALUES
         ('slip_month', 'August 2026'),
         ('period_from', '01/08/2026'),
         ('period_to', '31/08/2026'),
         ('computed_on', '01/09/2026'),
         ('fixed_working_days', '26'),
         ('deduction_amount_kwd', '15.000'),
         ('basic_salary_kwd', '260.000'),
         ('extra_input_kwd', '0.000'),
         ('net_salary_kwd', '245.000'),
         ('rate_kwd', '100'),
         ('amount', '26 days')
       ) AS v(field_key, preview_value)
 WHERE t.id = f.template_id
   AND t.name_en = 'Salary Deduction Acknowledgement'
   AND f.field_key = v.field_key
   AND f.preview_value IS DISTINCT FROM v.preview_value;
