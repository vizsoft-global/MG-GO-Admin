-- A7: persist note_to_rider through a dedicated RPC and write a NEW inbox
-- row whose body + action_params carry the note. Existing visit bookings
-- and existing notification rows are untouched — this function is additive
-- and never rewrites admin_update_visit_status / admin_reschedule_visit.
-- Clearing the note (empty string) only nulls the column; no notify.

CREATE OR REPLACE FUNCTION public.admin_set_visit_note_to_rider(
  p_booking_id uuid,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.visit_bookings%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_notify jsonb;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT public.staff_has_permission('visits.operate') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  SELECT * INTO v_row
  FROM public.visit_bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  UPDATE public.visit_bookings
  SET
    note_to_rider = v_note,
    updated_at = now()
  WHERE id = p_booking_id;

  IF v_note IS NULL OR v_note IS NOT DISTINCT FROM COALESCE(v_row.note_to_rider, '') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'notified', false,
      'driver_id', v_row.driver_id,
      'booking_code', v_row.booking_code
    );
  END IF;

  v_notify := public.notify_driver_transactional(
    v_row.driver_id,
    'Visit note — ' || v_row.booking_code,
    v_note,
    'musallam:///profile/support/visits',
    'operations',
    'normal',
    jsonb_build_object(
      'record_type', 'visit',
      'record_id', p_booking_id::text,
      'route', '/profile/support/visits',
      'booking_code', v_row.booking_code,
      'note_to_rider', v_note
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'notified', true,
    'driver_id', v_row.driver_id,
    'booking_code', v_row.booking_code,
    'campaign_id', v_notify ->> 'campaign_id',
    'dispatch_item_id', v_notify ->> 'dispatch_item_id'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_visit_note_to_rider(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_visit_note_to_rider(uuid, text) TO authenticated, service_role;
