-- Attendance & Orders gained Restaurant + Restaurant ID identity columns.
-- Widen the heading-config allowlist so rename/hide can persist those keys.
-- Linked project eoksxkdssptgyqyywdju only.

ALTER TABLE public.payroll_column_config
  DROP CONSTRAINT IF EXISTS payroll_column_config_key_check;

ALTER TABLE public.payroll_column_config
  ADD CONSTRAINT payroll_column_config_key_check CHECK (
    column_key = ANY (ARRAY[
      'amId',
      'mgId',
      'name',
      'restaurant',
      'restaurantId',
      'zone',
      'zoneCategory',
      'partner',
      'vehicleKind',
      'finalOrders',
      'actualHours'
    ]::text[])
  );

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
    'amId', 'mgId', 'name', 'restaurant', 'restaurantId', 'zone', 'zoneCategory',
    'partner', 'vehicleKind', 'finalOrders', 'actualHours'
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
