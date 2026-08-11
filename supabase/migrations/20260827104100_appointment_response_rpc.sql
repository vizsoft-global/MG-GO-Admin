-- RSup/28 Appointment Inbox: real Accept / Reject / Propose-time actions.
-- `admin_create_appointment` now starts requests in 'pending' (driver must
-- respond) instead of immediately 'scheduled'/"confirmed" — matches the
-- Figma flow (RSup/28 request -> RSup/29 confirmed only after Accept).
-- `driver_respond_appointment` is the new driver-scoped write path
-- (drivers.id = auth.uid(), same pattern as driver_acknowledge_request).

CREATE OR REPLACE FUNCTION public.driver_respond_appointment(
  p_id uuid,
  p_action text,
  p_proposed_for timestamptz DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.appointments%ROWTYPE;
  v_action text := lower(trim(p_action));
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_row FROM public.appointments
  WHERE id = p_id AND driver_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_row.status NOT IN ('pending', 'scheduled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  IF v_action = 'accept' THEN
    UPDATE public.appointments
    SET status = 'accepted', responded_at = now(), updated_at = now()
    WHERE id = p_id;

    PERFORM public.notify_driver_transactional(
      v_uid,
      'Appointment confirmed — ' || COALESCE(v_row.appointment_code, ''),
      COALESCE(v_row.title, 'Appointment') || ' at ' || COALESCE(v_row.location_label, 'Central Tower'),
      'musallam:///profile/support/appointments/' || p_id::text || '/confirmed',
      'operations', 'normal',
      jsonb_build_object('record_type', 'appointment', 'record_id', p_id::text)
    );

    RETURN jsonb_build_object('ok', true, 'status', 'accepted');
  END IF;

  IF v_action = 'reject' THEN
    UPDATE public.appointments
    SET status = 'rejected',
        driver_response_note = NULLIF(trim(COALESCE(p_note, '')), ''),
        responded_at = now(), updated_at = now()
    WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', 'rejected');
  END IF;

  IF v_action = 'propose' THEN
    IF p_proposed_for IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'proposed_time_required');
    END IF;
    UPDATE public.appointments
    SET status = 'reschedule_requested',
        proposed_for = p_proposed_for,
        driver_response_note = NULLIF(trim(COALESCE(p_note, '')), ''),
        responded_at = now(), updated_at = now()
    WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', 'reschedule_requested');
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'unknown_action');
END;
$$;

REVOKE ALL ON FUNCTION public.driver_respond_appointment(uuid, text, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_respond_appointment(uuid, text, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.driver_list_appointments(
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.scheduled_for DESC)
      FROM (
        SELECT a.id,
               COALESCE(a.appointment_code, a.id::text) AS appointment_code,
               COALESCE(a.title, 'Appointment') AS title,
               a.scheduled_for,
               a.status::text AS status,
               a.reason,
               a.location_label,
               a.admin_note,
               a.proposed_for,
               a.driver_response_note,
               a.responded_at,
               p.full_name AS requested_by_name,
               r.name AS requested_by_role,
               a.created_at
        FROM public.appointments a
        LEFT JOIN public.profiles p ON p.id = a.created_by
        LEFT JOIN public.admin_roles r ON r.id = p.admin_role_id
        WHERE a.driver_id = v_uid
        ORDER BY a.scheduled_for DESC
        LIMIT GREATEST(COALESCE(p_limit, 50), 1)
        OFFSET GREATEST(COALESCE(p_offset, 0), 0)
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_appointment(
  p_driver_id uuid,
  p_scheduled_for timestamptz,
  p_title text DEFAULT 'Appointment',
  p_reason text DEFAULT NULL,
  p_location_label text DEFAULT 'Central Tower',
  p_slot_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_slot uuid;
  v_id uuid;
  v_code text;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT (
    public.staff_has_permission('requests.manage')
    OR public.staff_has_permission('support.view')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF p_driver_id IS NULL OR p_scheduled_for IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  v_slot := p_slot_id;
  IF v_slot IS NULL THEN
    SELECT id INTO v_slot FROM public.appointment_slots ORDER BY day_of_week LIMIT 1;
  END IF;
  IF v_slot IS NULL THEN
    INSERT INTO public.appointment_slots (day_of_week, slot_name, start_time, end_time, capacity)
    VALUES (EXTRACT(DOW FROM p_scheduled_for)::int, 'Default', '09:00', '10:00', 20)
    RETURNING id INTO v_slot;
  END IF;

  v_code := public.allocate_appointment_code();
  INSERT INTO public.appointments (
    driver_id, slot_id, scheduled_for, reason, title, appointment_code,
    location_label, status, created_by
  ) VALUES (
    p_driver_id, v_slot, p_scheduled_for, p_reason, COALESCE(NULLIF(trim(p_title), ''), 'Appointment'),
    v_code, COALESCE(p_location_label, 'Central Tower'), 'pending', v_uid
  )
  RETURNING id INTO v_id;

  PERFORM public.notify_driver_transactional(
    p_driver_id,
    'Appointment request — ' || v_code,
    COALESCE(NULLIF(trim(p_title), ''), 'Appointment') || ' at ' || COALESCE(p_location_label, 'Central Tower'),
    'musallam:///profile/support/appointments/' || v_id::text,
    'operations',
    'normal',
    jsonb_build_object('record_type', 'appointment', 'record_id', v_id::text, 'route', '/profile/support/appointments/' || v_id::text)
  );

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'appointment_code', v_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_list_appointments(int, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_appointment(uuid, timestamptz, text, text, text, uuid) TO authenticated, service_role;
