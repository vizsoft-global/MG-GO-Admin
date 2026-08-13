-- Blocking a driver left driver_sessions.is_online = true, so after unblock +
-- login the home Online toggle was on while is_on_duty was false (Clock In).
-- Clock out the open session and attendance log the same way admin checkout
-- does, but keep last-known GPS so Live Tracking can still show Offline.

CREATE OR REPLACE FUNCTION public.set_driver_blocked(
  p_driver_id uuid,
  p_blocked boolean,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text;
  v_now timestamptz := now();
  v_open_session_id uuid;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_driver_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_not_found');
  END IF;

  IF p_blocked THEN
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    IF v_reason IS NULL OR length(v_reason) < 3 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'missing_block_reason');
    END IF;

    UPDATE public.drivers
    SET
      is_blocked = true,
      blocked_reason = v_reason,
      blocked_at = v_now,
      blocked_by = auth.uid(),
      is_on_duty = false,
      updated_at = v_now
    WHERE id = p_driver_id;

    SELECT ds.id
    INTO v_open_session_id
    FROM public.driver_sessions ds
    WHERE ds.driver_id = p_driver_id
      AND ds.is_online = true
    ORDER BY ds.created_at DESC
    LIMIT 1;

    IF v_open_session_id IS NOT NULL THEN
      UPDATE public.driver_sessions
      SET is_online = false,
          went_offline_at = COALESCE(went_offline_at, v_now),
          updated_at = v_now
      WHERE id = v_open_session_id;
    END IF;

    UPDATE public.attendance_logs
    SET check_out_at = v_now,
        check_out_reason = 'admin',
        updated_at = v_now
    WHERE id = (
      SELECT al.id
      FROM public.attendance_logs al
      WHERE al.driver_id = p_driver_id
        AND al.check_in_at IS NOT NULL
        AND al.check_out_at IS NULL
      ORDER BY al.check_in_at DESC
      LIMIT 1
    );
  ELSE
    UPDATE public.drivers
    SET
      is_blocked = false,
      blocked_reason = NULL,
      blocked_at = NULL,
      blocked_by = NULL,
      updated_at = v_now
    WHERE id = p_driver_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON FUNCTION public.set_driver_blocked(uuid, boolean, text) IS
  'Admin block/unblock. Blocking clocks the driver out (session + attendance) so login does not resume a leftover Online session.';
