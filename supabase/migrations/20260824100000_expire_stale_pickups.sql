-- Stale pickup auto-cancel
--
-- Background
-- ----------
-- Order creation is two-stage: `driver_create_pickup` inserts an `in_transit`
-- row, then `driver_complete_delivery` closes it. `driver_create_pickup` raises
-- `active_pickup_exists` while any `in_transit` row is open, so a pickup that
-- never completes (network drop, GPS timeout, proof upload failure) blocks the
-- driver from logging any further order. Drivers on older app builds have no
-- in-app screen for an in-progress order, so they cannot clear it themselves --
-- one driver sat blocked for a week before this was noticed.
--
-- Rule: cancel pickups still `in_transit` after `pickup_auto_cancel_hours`
-- (default 6, i.e. far longer than any real delivery) so the driver frees up
-- automatically. Cancelled rows are excluded from earnings and from the
-- per-restaurant/day duplicate check, so the driver may re-enter the same
-- order id afterwards.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS pickup_auto_cancel_hours integer NOT NULL DEFAULT 6;

COMMENT ON COLUMN public.app_settings.pickup_auto_cancel_hours IS
  'Hours after pickup_at before an unfinished in_transit delivery is auto-cancelled so the driver can log new orders.';

CREATE OR REPLACE FUNCTION public.admin_expire_stale_pickups()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hours integer;
  v_cutoff timestamptz;
  v_count integer := 0;
BEGIN
  SELECT COALESCE(pickup_auto_cancel_hours, 6)
  INTO v_hours
  FROM public.app_settings
  WHERE id = 1;

  v_hours := GREATEST(COALESCE(v_hours, 6), 1);
  v_cutoff := now() - make_interval(hours => v_hours);

  WITH expired AS (
    UPDATE public.deliveries
    SET status = 'cancelled'::public.delivery_status,
        cancelled_at = now(),
        cancel_reason = COALESCE(
          cancel_reason,
          'Auto-cancelled: pickup not completed within ' || v_hours || 'h'
        )
    WHERE status = 'in_transit'::public.delivery_status
      AND COALESCE(pickup_at, created_at) <= v_cutoff
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM expired;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_expire_stale_pickups() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_expire_stale_pickups() TO service_role;
