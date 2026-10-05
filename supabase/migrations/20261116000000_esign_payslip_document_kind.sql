-- EmployeeDesk V2 — a payslip is its own document kind, not a penalty notice.
--
-- **Why this is a fourth kind rather than a field-driven guess.** The reference
-- draws the Payslip panel (C2) as a *payroll voucher*: a month title, a period,
-- a computed-on date, fixed and actual working days, a rate, and four money rows
-- a reader checks against each other — with a sheet-column marker on each money
-- row (`BASIC`, `NET`, `All`, `Ded`) and a worked example table underneath. A
-- penalty notice states *an offence and its consequence*, which is exactly the
-- two-column Item / Value table `document-preview.tsx` already draws. Both end
-- in a deduction, which is why the 2026-11-15 seed assigned the salary template
-- to `penalty`; but the two documents do not read the same, so a payslip
-- rendered as an Item / Value table folds the arithmetic into one column and
-- loses the only thing the sheet is for.
--
-- The alternative was to leave `document_kind` alone and have the preview switch
-- to the payroll layout whenever a template's field set happened to contain the
-- salary anchors. That was rejected: `document_kind` is an operator-editable
-- control in the builder, and a preview that ignores the control and reads the
-- fields instead puts the screen back in the state this codebase keeps fixing —
-- a control that says one thing above a pane that shows another.
--
-- **The renderer stays kind-agnostic, and that is why this is safe.** Grep
-- `src/features/esign/render/esign-document-html.ts` for `document_kind`: it does
-- not mention it. It prints whatever field values the request stored, so a
-- document already sent keeps printing byte-for-byte what it printed, and the
-- only thing this migration changes is the builder's A4 preview and any future
-- kind-aware renderer. No stored `esign_requests` row is read or written here.
--
-- Idempotent: the constraint is dropped and rebuilt on every run, and the retag
-- is guarded by `document_kind <> 'payslip'` so a second push bumps no version.

-- ---------------------------------------------------------------------------
-- 1. The CHECK admits the fourth kind
-- ---------------------------------------------------------------------------

ALTER TABLE public.esign_templates
  DROP CONSTRAINT IF EXISTS esign_templates_document_kind_check;

ALTER TABLE public.esign_templates
  ADD CONSTRAINT esign_templates_document_kind_check
  CHECK (document_kind IN ('penalty', 'loan', 'payslip', 'general'));

-- ---------------------------------------------------------------------------
-- 2. The salary sheet becomes the payslip it is drawn as
-- ---------------------------------------------------------------------------
--
-- Matched on `name_en` for the same reason `20261115000300` does: the library has
-- no unique constraint on the name, so naming the row is the only stable handle,
-- and a template an operator has renamed is skipped rather than retagged behind
-- their back.

UPDATE public.esign_templates
   SET document_kind = 'payslip',
       version = version + 1,
       updated_at = now()
 WHERE document_kind <> 'payslip'
   AND name_en = 'Salary Deduction Acknowledgement';

-- ---------------------------------------------------------------------------
-- 3. The upsert RPC admits it too, or the builder could not save it back
-- ---------------------------------------------------------------------------
--
-- Re-emitted from the live definition in `20261115000100` (the version that
-- actually serves traffic — it supersedes the copy in `20261115000000`), with
-- one change: the kind allowlist. An unknown kind is still refused rather than
-- coerced, so a typo cannot produce a template whose preview the builder cannot
-- lay out — widening the list is the whole edit. `admin_upsert_esign_template_field`
-- is deliberately not touched: it validates `source_kind` and `section_key` and
-- has never read `document_kind`.

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
  IF v_kind NOT IN ('penalty', 'loan', 'payslip', 'general') THEN
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
