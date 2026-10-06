-- Org-wide payroll identity headings (label + per-view hide). Combined and
-- Attendance & Orders share one label; visibility is per view. Day columns
-- are never stored here. Linked project eoksxkdssptgyqyywdju only.

CREATE TABLE IF NOT EXISTS public.payroll_column_config (
  column_key text PRIMARY KEY,
  label text,
  hidden_views text[] NOT NULL DEFAULT '{}'::text[],
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  CONSTRAINT payroll_column_config_key_check CHECK (
    column_key = ANY (ARRAY[
      'amId',
      'mgId',
      'name',
      'zone',
      'zoneCategory',
      'partner',
      'vehicleKind',
      'finalOrders',
      'actualHours'
    ]::text[])
  ),
  CONSTRAINT payroll_column_config_label_check CHECK (label IS NULL OR btrim(label) <> ''),
  CONSTRAINT payroll_column_config_views_check CHECK (
    hidden_views <@ ARRAY['combined', 'ao']::text[]
  )
);

COMMENT ON TABLE public.payroll_column_config IS
  'Org-wide payroll identity heading labels and per-view visibility (combined | ao).';

ALTER TABLE public.payroll_column_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_column_config_staff_read ON public.payroll_column_config;
CREATE POLICY payroll_column_config_staff_read ON public.payroll_column_config
  FOR SELECT TO authenticated USING (public.is_admin_panel_user());

REVOKE ALL ON public.payroll_column_config FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.payroll_column_config FROM authenticated;
GRANT SELECT ON public.payroll_column_config TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_payroll_column_config()
RETURNS TABLE (
  column_key text,
  label text,
  hidden_views text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.column_key, c.label, c.hidden_views
  FROM public.payroll_column_config c
  ORDER BY c.column_key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_payroll_column_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_payroll_column_config() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_payroll_column_config(
  p_column_key text,
  p_label text DEFAULT NULL,
  p_hidden_views text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_label text := NULLIF(btrim(COALESCE(p_label, '')), '');
  v_hidden text[] := COALESCE(p_hidden_views, '{}'::text[]);
  v_row public.payroll_column_config;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.payroll_can_manage() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_column_key IS NULL OR p_column_key NOT IN (
    'amId', 'mgId', 'name', 'zone', 'zoneCategory', 'partner',
    'vehicleKind', 'finalOrders', 'actualHours'
  ) THEN
    RAISE EXCEPTION 'invalid_column' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_hidden) AS v(view)
    WHERE v.view NOT IN ('combined', 'ao')
  ) THEN
    RAISE EXCEPTION 'invalid_view' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.payroll_column_config AS c (
    column_key, label, hidden_views, updated_at, updated_by
  ) VALUES (
    p_column_key, v_label, v_hidden, now(), auth.uid()
  )
  ON CONFLICT (column_key) DO UPDATE SET
    label = EXCLUDED.label,
    hidden_views = EXCLUDED.hidden_views,
    updated_at = now(),
    updated_by = auth.uid()
  RETURNING c.* INTO v_row;

  IF v_row.label IS NULL AND COALESCE(array_length(v_row.hidden_views, 1), 0) = 0 THEN
    DELETE FROM public.payroll_column_config WHERE column_key = p_column_key;
    RETURN jsonb_build_object(
      'columnKey', p_column_key,
      'label', NULL,
      'hiddenViews', '[]'::jsonb
    );
  END IF;

  RETURN jsonb_build_object(
    'columnKey', v_row.column_key,
    'label', v_row.label,
    'hiddenViews', to_jsonb(v_row.hidden_views)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_payroll_column_config(text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_payroll_column_config(text, text, text[]) TO authenticated, service_role;
