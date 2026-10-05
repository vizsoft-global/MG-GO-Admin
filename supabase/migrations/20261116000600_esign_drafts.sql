-- EmployeeDesk V2 — drafts (F11).
--
-- A bulk send is a file, a template, a language, a due date, a title and an
-- operator's afternoon. Today the only place that state can live is the browser
-- tab, so a reload, a session timeout or a mis-click loses the mapping work and
-- the operator re-does it from the spreadsheet. Worse, the state that is hardest
-- to recreate is exactly the part that is *not* in the file: which template, and
-- the per-row corrections made after the preview.
--
-- So a draft is stored as two halves and never as a rendered document:
-- the send header (`template_id` at the version it was chosen, language, title,
-- due date, description) and the payload (`field_values` for a single send,
-- `rows` for a bulk one). Nothing is rendered, nothing is uploaded and no
-- `SIG-####` is allocated while a draft is a draft — a draft that reserved codes
-- would burn the sequence on work that never gets sent, and `esign_requests`
-- would start showing requests the rider has no notification for.
--
-- The rows column is capped in the RPC rather than by a CHECK. A `jsonb` size
-- CHECK would be evaluated on every read-modify-write and would report the
-- failure as a constraint name; the guard belongs where it can return the
-- operator a sentence they can act on, and 2,000 rows is already an order of
-- magnitude past the 500-row send cap.

CREATE TABLE IF NOT EXISTS public.esign_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- `single` = the send screen, `bulk` = the Excel screen. Kept on the row so
  -- the drafts list can say which screen will reopen it without inspecting the
  -- payload, and so a bulk draft cannot be resumed into the single-send action
  -- and silently drop its rows.
  kind text NOT NULL DEFAULT 'single',
  template_id uuid REFERENCES public.esign_templates(id) ON DELETE SET NULL,
  -- The template version the draft was authored against. A template edited
  -- between the draft and the send changes the field set, and a resume that
  -- silently picked up the new version would send a document the operator never
  -- previewed; the resume path compares this and asks.
  template_version int,
  language text NOT NULL DEFAULT 'en',
  title text,
  due_at date,
  description text,
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_filename text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT esign_drafts_kind_check CHECK (kind IN ('single', 'bulk'))
);

CREATE INDEX IF NOT EXISTS esign_drafts_updated_idx
  ON public.esign_drafts (updated_at DESC);

ALTER TABLE public.esign_drafts ENABLE ROW LEVEL SECURITY;

-- Drafts are ordinary staff-owned working state: every panel user who can send a
-- document can save one, and a draft is not a document, so there is nothing here
-- to gate behind a second permission. The RPCs still re-check `requests.manage`
-- because a policy alone does not stop a direct PostgREST write.
DROP POLICY IF EXISTS esign_drafts_staff_all ON public.esign_drafts;
CREATE POLICY esign_drafts_staff_all
  ON public.esign_drafts
  FOR ALL
  TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.esign_drafts TO authenticated;

-- ---------------------------------------------------------------------------
-- Save (create or update)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_save_esign_draft(p_draft jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := NULLIF(p_draft->>'id', '')::uuid;
  v_kind text := CASE
    WHEN COALESCE(p_draft->>'kind', 'single') = 'bulk' THEN 'bulk'
    ELSE 'single'
  END;
  v_rows jsonb := COALESCE(p_draft->'rows', '[]'::jsonb);
  v_row_count int;
  v_size int;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF jsonb_typeof(v_rows) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rows_not_array');
  END IF;
  v_row_count := jsonb_array_length(v_rows);
  IF v_row_count > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_many_rows', 'limit', 2000);
  END IF;

  -- Measured, not estimated. `pg_column_size` is the on-disk size of the value
  -- this row would carry, which is the number the limit is actually about; a
  -- character count of `::text` would over-report escapes and quotes and refuse
  -- payloads that fit fine.
  v_size := pg_column_size(v_rows) + pg_column_size(COALESCE(p_draft->'field_values', '{}'::jsonb));
  IF v_size > 1048576 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'draft_too_large', 'bytes', v_size);
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.esign_drafts (
      kind, template_id, template_version, language, title, due_at, description,
      field_values, rows, source_filename, created_by
    ) VALUES (
      v_kind,
      NULLIF(p_draft->>'template_id', '')::uuid,
      NULLIF(p_draft->>'template_version', '')::int,
      COALESCE(NULLIF(p_draft->>'language', ''), 'en'),
      NULLIF(btrim(COALESCE(p_draft->>'title', '')), ''),
      NULLIF(p_draft->>'due_at', '')::date,
      NULLIF(btrim(COALESCE(p_draft->>'description', '')), ''),
      COALESCE(p_draft->'field_values', '{}'::jsonb),
      v_rows,
      NULLIF(btrim(COALESCE(p_draft->>'source_filename', '')), ''),
      v_uid
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.esign_drafts
       SET kind = v_kind,
           template_id = NULLIF(p_draft->>'template_id', '')::uuid,
           template_version = NULLIF(p_draft->>'template_version', '')::int,
           language = COALESCE(NULLIF(p_draft->>'language', ''), language),
           title = NULLIF(btrim(COALESCE(p_draft->>'title', '')), ''),
           due_at = NULLIF(p_draft->>'due_at', '')::date,
           description = NULLIF(btrim(COALESCE(p_draft->>'description', '')), ''),
           field_values = COALESCE(p_draft->'field_values', '{}'::jsonb),
           rows = v_rows,
           source_filename = NULLIF(btrim(COALESCE(p_draft->>'source_filename', '')), ''),
           updated_at = now()
     WHERE id = v_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'rows', v_row_count);
END;
$$;

-- ---------------------------------------------------------------------------
-- List / get / delete
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_esign_drafts(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    -- The payload is deliberately not returned here: a list of twenty bulk
    -- drafts would ship twenty spreadsheets to draw twenty one-line cards. The
    -- row counts (which is what the card says) are computed instead.
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.updated_at DESC)
      FROM (
        SELECT
          r.id, r.kind, r.template_id, r.template_version, r.language, r.title,
          r.due_at, r.description, r.source_filename, r.created_by,
          r.created_at, r.updated_at,
          t.name_en AS template_name,
          jsonb_array_length(r.rows) AS row_count,
          r.created_by AS created_by_id,
          p.full_name AS created_by_name
        FROM public.esign_drafts r
        LEFT JOIN public.esign_templates t ON t.id = r.template_id
        LEFT JOIN public.profiles p ON p.id = r.created_by
        ORDER BY r.updated_at DESC
        LIMIT GREATEST(LEAST(COALESCE(p_limit, 50), 200), 1)
      ) d
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_esign_draft(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft public.esign_drafts%ROWTYPE;
  v_name text;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  SELECT * INTO v_draft FROM public.esign_drafts WHERE id = p_id;
  IF v_draft.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT name_en INTO v_name FROM public.esign_templates WHERE id = v_draft.template_id;

  RETURN jsonb_build_object(
    'ok', true,
    'draft', to_jsonb(v_draft) || jsonb_build_object('template_name', v_name)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_esign_draft(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  DELETE FROM public.esign_drafts WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_esign_draft(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_esign_draft(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_list_esign_drafts(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_esign_drafts(int) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_get_esign_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_esign_draft(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_delete_esign_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_esign_draft(uuid) TO authenticated, service_role;
