-- Visit detail (Figma 4195:9718) — staff internal notes, note to rider, reschedule.
--
-- Reschedule model: the booking row is updated in place (slot_id + scheduled_date).
-- The rider's booking_code is what reception matches at check-in, so replacing the
-- row with a new code (and linking via rescheduled_from_id) would invalidate the
-- code the rider already holds. rescheduled_from_id therefore stays reserved for a
-- future driver-side cancel-and-rebook flow.

-- ---------------------------------------------------------------------------
-- 1. Staff-authored note shown to the rider (separate from the rider's purpose)
-- ---------------------------------------------------------------------------

ALTER TABLE public.visit_bookings
  ADD COLUMN IF NOT EXISTS note_to_rider text;

COMMENT ON COLUMN public.visit_bookings.note is
  'Purpose of the visit, typed by the rider when booking.';

COMMENT ON COLUMN public.visit_bookings.note_to_rider is
  'Instruction written by staff for the rider (what to bring, where to go).';

-- ---------------------------------------------------------------------------
-- 2. Internal notes (staff only — never exposed to drivers)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.visit_booking_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.visit_bookings(id) ON DELETE CASCADE,
  author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.visit_booking_notes is
  'Admin-panel-only notes on a visit booking. No driver RLS policy by design.';

CREATE INDEX IF NOT EXISTS visit_booking_notes_booking_idx
  ON public.visit_booking_notes (booking_id, created_at DESC);

ALTER TABLE public.visit_booking_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_all_visit_booking_notes ON public.visit_booking_notes;
CREATE POLICY staff_all_visit_booking_notes ON public.visit_booking_notes
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

-- ---------------------------------------------------------------------------
-- 3. Reschedule RPC (Operator) — structured errors, no exceptions thrown
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_reschedule_visit(
  p_booking_id uuid,
  p_new_date date,
  p_new_slot_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.visit_bookings%ROWTYPE;
  v_slot public.visit_slots%ROWTYPE;
  v_booked int;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF NOT public.staff_has_permission('visits.operate') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF p_new_date IS NULL OR p_new_slot_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  SELECT * INTO v_row FROM public.visit_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_row.status <> 'confirmed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_reschedulable');
  END IF;

  SELECT * INTO v_slot FROM public.visit_slots WHERE id = p_new_slot_id FOR UPDATE;
  IF NOT FOUND OR NOT v_slot.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_not_found');
  END IF;

  IF v_slot.department_key IS DISTINCT FROM v_row.department_key THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_department_mismatch');
  END IF;

  IF v_slot.slot_date IS NOT NULL THEN
    IF v_slot.slot_date <> p_new_date THEN
      RETURN jsonb_build_object('ok', false, 'error', 'slot_date_mismatch');
    END IF;
  ELSIF v_slot.day_of_week IS DISTINCT FROM EXTRACT(DOW FROM p_new_date)::int THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_date_mismatch');
  END IF;

  IF v_row.scheduled_date = p_new_date AND v_row.slot_id = p_new_slot_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unchanged');
  END IF;

  SELECT count(*)::int INTO v_booked
  FROM public.visit_bookings
  WHERE slot_id = p_new_slot_id
    AND scheduled_date = p_new_date
    AND id <> p_booking_id
    AND status IN ('confirmed', 'checked_in');

  IF v_booked >= v_slot.capacity THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_full');
  END IF;

  -- Mirrors visit_bookings_active_driver_date_dept_uidx; the unique index below is
  -- still the authority under concurrency.
  IF EXISTS (
    SELECT 1 FROM public.visit_bookings
    WHERE driver_id = v_row.driver_id
      AND scheduled_date = p_new_date
      AND department_key = v_row.department_key
      AND id <> p_booking_id
      AND status IN ('confirmed', 'checked_in')
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'duplicate_department_date',
      'message', 'Rider already has an active booking for this department on that date.'
    );
  END IF;

  BEGIN
    UPDATE public.visit_bookings
    SET slot_id = p_new_slot_id,
        scheduled_date = p_new_date,
        updated_at = now()
    WHERE id = p_booking_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'duplicate_department_date',
      'message', 'Rider already has an active booking for this department on that date.'
    );
  END;

  PERFORM public.notify_driver_transactional(
    v_row.driver_id,
    'Visit rescheduled — ' || v_row.booking_code,
    'Your visit is now on ' || to_char(p_new_date, 'DD Mon YYYY')
      || ' at ' || to_char(v_slot.start_time, 'HH24:MI') || '.',
    'musallam:///profile/support/visits',
    'operations',
    'normal',
    jsonb_build_object(
      'record_type', 'visit',
      'record_id', p_booking_id::text,
      'route', '/profile/support/visits'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'scheduled_date', p_new_date,
    'slot_id', p_new_slot_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reschedule_visit(uuid, date, uuid)
  TO authenticated, service_role;
