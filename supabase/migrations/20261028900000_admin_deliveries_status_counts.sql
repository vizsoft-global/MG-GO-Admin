-- Deliveries list KPIs and All-time totals were six parallel COUNT(*)s plus
-- one exact-count list select, all under RLS. That hits statement_timeout
-- (57014) and the page stays on a spinner. One DEFINER scan after the staff
-- gate is enough.

CREATE OR REPLACE FUNCTION public.admin_deliveries_status_counts(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL,
  p_partner_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'total', COUNT(*)::integer,
    'active', COUNT(*) FILTER (WHERE del.status = 'in_transit')::integer,
    'verified', COUNT(*) FILTER (WHERE del.status = 'verified')::integer,
    'pending', COUNT(*) FILTER (WHERE del.status = 'pending')::integer,
    'rejected', COUNT(*) FILTER (WHERE del.status = 'rejected')::integer,
    'cancelled', COUNT(*) FILTER (WHERE del.status = 'cancelled')::integer,
    'under_review', COUNT(*) FILTER (WHERE del.status = 'under_review')::integer,
    'in_progress', COUNT(*) FILTER (
      WHERE del.status IN ('in_transit', 'pending', 'under_review')
    )::integer
  )
  INTO v_out
  FROM public.deliveries del
  WHERE (p_from IS NULL OR del.created_at >= p_from)
    AND (p_to IS NULL OR del.created_at <= p_to)
    AND (p_zone_id IS NULL OR del.zone_id = p_zone_id)
    AND (p_partner_id IS NULL OR del.partner_id = p_partner_id);

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.admin_deliveries_status_counts(timestamptz, timestamptz, uuid, uuid) IS
  'Staff-only delivery status counts. SECURITY DEFINER so All-time KPI/list totals skip per-row RLS.';

REVOKE ALL ON FUNCTION public.admin_deliveries_status_counts(timestamptz, timestamptz, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_deliveries_status_counts(timestamptz, timestamptz, uuid, uuid)
  TO authenticated;
