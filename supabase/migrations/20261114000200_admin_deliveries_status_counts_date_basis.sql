-- Deliveries list / KPI / Assistant counts were bounded on `deliveries.created_at`,
-- so an order that a rider completed at 06:57 AM on Sep 30 was counted into the
-- Sep 30 window only because the row happened to be *created* that day, and an
-- order picked up at 23:40 on Sep 30 and delivered at 00:10 on Oct 1 counted into
-- Oct 1 while the client's daily sheet (and the Orders Report) puts it in the
-- Sep 30 operational day. The single source of truth for "was this order
-- completed in this window" is `deliveries.delivered_at`, and this migration
-- teaches both count RPCs to bound on it when the caller asks.
--
-- `p_date_basis` defaults to 'created', so every existing caller (`fetchDeliveriesKpis`
-- with no args, the Assistant tool with only statuses) keeps the exact numbers it
-- had before. `'delivered'` is sent only when a from/to window is present, and in
-- that mode the rows with `delivered_at IS NULL` (pending / in transit / cancelled)
-- are excluded on purpose -- that is what "strict completed-only" means, and it is
-- why those tabs read empty for a past operational day.
--
-- DROP + CREATE rather than CREATE OR REPLACE: adding a defaulted parameter creates
-- a second overload, and a bare `admin_deliveries_status_counts(...)` call would
-- then be ambiguous. The grants are re-stated because only CREATE OR REPLACE
-- preserves the ACL; a fresh CREATE inherits PUBLIC EXECUTE.

-- PostgREST emits `ORDER BY delivered_at DESC NULLS LAST` for the list, and a btree
-- declared plain `DESC` is NULLS FIRST, so the planner refuses the match -- the same
-- trap `20261102000700` fixed for `created_at`. One index serves both the list's
-- range + order and the counts RPC's range scan.
CREATE INDEX IF NOT EXISTS deliveries_delivered_at_id_idx
  ON public.deliveries (delivered_at DESC NULLS LAST, id DESC NULLS LAST);

DROP FUNCTION IF EXISTS public.admin_deliveries_status_counts(timestamptz, timestamptz, uuid, uuid);

CREATE FUNCTION public.admin_deliveries_status_counts(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL,
  p_partner_id uuid DEFAULT NULL,
  p_date_basis text DEFAULT 'created'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_out jsonb;
  v_delivered boolean := COALESCE(p_date_basis, 'created') = 'delivered';
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Two static statements rather than one with a CASE on the bound column:
  -- a parameterised column leaves the planner free to choose a generic plan and
  -- lose the index, whereas each branch below names its column literally so the
  -- range and the ordering both resolve against the matching btree.
  IF v_delivered THEN
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
    WHERE del.delivered_at IS NOT NULL
      AND (p_from IS NULL OR del.delivered_at >= p_from)
      AND (p_to IS NULL OR del.delivered_at <= p_to)
      AND (p_zone_id IS NULL OR del.zone_id = p_zone_id)
      AND (p_partner_id IS NULL OR del.partner_id = p_partner_id);
  ELSE
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
  END IF;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.admin_deliveries_status_counts(timestamptz, timestamptz, uuid, uuid, text) IS
  'Staff-only delivery status counts. SECURITY DEFINER so All-time KPI/list totals skip per-row RLS. p_date_basis=delivered bounds on delivered_at and excludes not-yet-completed rows; default created keeps legacy behaviour.';

REVOKE ALL ON FUNCTION public.admin_deliveries_status_counts(timestamptz, timestamptz, uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_deliveries_status_counts(timestamptz, timestamptz, uuid, uuid, text)
  TO authenticated;

-- Same treatment for the Assistant's filtered count, so "how many deliveries last
-- week" and the list's `Showing X of Y` cannot disagree about the window.
DROP FUNCTION IF EXISTS public.admin_deliveries_counts_by_filters(timestamptz, timestamptz, uuid, uuid, uuid, uuid);

CREATE FUNCTION public.admin_deliveries_counts_by_filters(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL,
  p_partner_id uuid DEFAULT NULL,
  p_driver_id uuid DEFAULT NULL,
  p_restaurant_id uuid DEFAULT NULL,
  p_date_basis text DEFAULT 'created'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_out jsonb;
  v_delivered boolean := COALESCE(p_date_basis, 'created') = 'delivered';
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF v_delivered THEN
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
    WHERE del.delivered_at IS NOT NULL
      AND (p_from IS NULL OR del.delivered_at >= p_from)
      AND (p_to IS NULL OR del.delivered_at <= p_to)
      AND (p_zone_id IS NULL OR del.zone_id = p_zone_id)
      AND (p_partner_id IS NULL OR del.partner_id = p_partner_id)
      AND (p_driver_id IS NULL OR del.driver_id = p_driver_id)
      AND (p_restaurant_id IS NULL OR del.restaurant_id = p_restaurant_id);
  ELSE
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
  END IF;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.admin_deliveries_counts_by_filters(timestamptz, timestamptz, uuid, uuid, uuid, uuid, text) IS
  'Staff-only delivery status counts for the filtered window incl. driver/restaurant. SECURITY DEFINER so the seven per-status counts share one scan instead of seven RLS-wrapped COUNT(*)s.';

REVOKE ALL ON FUNCTION public.admin_deliveries_counts_by_filters(timestamptz, timestamptz, uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_deliveries_counts_by_filters(timestamptz, timestamptz, uuid, uuid, uuid, uuid, text)
  TO authenticated;
