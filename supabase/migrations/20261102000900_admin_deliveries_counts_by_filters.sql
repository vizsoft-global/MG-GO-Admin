-- The Staff Assistant (B) "deliveries counts" tool translated one filtered
-- window into SEVEN parallel `count: exact` PostgREST requests, each of which
-- ran under RLS. RLS is evaluated per scanned row, and `deliveries` carries the
-- driver/rider policies, so a single status count measured on production was
-- 2,796 ms / 567,831 buffers to return one integer (filter
-- `is_admin_panel_user() OR ...`, 183,877 rows removed).
--
-- The seven calls together were ~4M buffer hits for one answer, and the same
-- shape shows up in pg_stat_statements as the 4,058 ms `status = ?` family.
--
-- This is the same fix `20261028900000_admin_deliveries_status_counts.sql`
-- already applies to the list KPIs: one DEFINER scan behind the staff gate.
-- It is a NEW function rather than an edit of `admin_deliveries_status_counts`
-- because that one deliberately takes only from/to/zone/partner, while the
-- assistant's tool also filters on driver and restaurant. Both keep their
-- signatures, so the KPI path is untouched.
--
-- Behaviour is identical: same WHERE semantics (inclusive bounds, NULL = no
-- filter), same seven numbers, counted in one pass instead of seven
-- RLS-wrapped ones.

CREATE OR REPLACE FUNCTION public.admin_deliveries_counts_by_filters(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL,
  p_partner_id uuid DEFAULT NULL,
  p_driver_id uuid DEFAULT NULL,
  p_restaurant_id uuid DEFAULT NULL
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
    'verified', COUNT(*) FILTER (WHERE del.status = 'verified')::integer,
    'pending', COUNT(*) FILTER (WHERE del.status = 'pending')::integer,
    'rejected', COUNT(*) FILTER (WHERE del.status = 'rejected')::integer,
    'cancelled', COUNT(*) FILTER (WHERE del.status = 'cancelled')::integer,
    'in_transit', COUNT(*) FILTER (WHERE del.status = 'in_transit')::integer,
    'under_review', COUNT(*) FILTER (WHERE del.status = 'under_review')::integer
  )
  INTO v_out
  FROM public.deliveries del
  WHERE (p_from IS NULL OR del.created_at >= p_from)
    AND (p_to IS NULL OR del.created_at <= p_to)
    AND (p_zone_id IS NULL OR del.zone_id = p_zone_id)
    AND (p_partner_id IS NULL OR del.partner_id = p_partner_id)
    AND (p_driver_id IS NULL OR del.driver_id = p_driver_id)
    AND (p_restaurant_id IS NULL OR del.restaurant_id = p_restaurant_id);

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.admin_deliveries_counts_by_filters(timestamptz, timestamptz, uuid, uuid, uuid, uuid) IS
  'Staff-only delivery status counts for the filtered window incl. driver/restaurant. SECURITY DEFINER so the seven per-status counts share one scan instead of seven RLS-wrapped COUNT(*)s.';

REVOKE ALL ON FUNCTION public.admin_deliveries_counts_by_filters(timestamptz, timestamptz, uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_deliveries_counts_by_filters(timestamptz, timestamptz, uuid, uuid, uuid, uuid)
  TO authenticated;
