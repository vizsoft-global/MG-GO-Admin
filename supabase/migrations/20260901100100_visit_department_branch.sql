-- Visit departments can be tied to a branch.
--
-- Deliberately additive: `visit_departments.key` stays globally unique because
-- it is the foreign key target for both `visit_slots.department_key` and
-- `visit_bookings.department_key`, and the one-active-booking-per
-- (driver, date, department) index is a locked business rule. `branch_id IS NULL`
-- means the department is offered at every branch, which is how all 11 existing
-- rows behave today.
--
-- If the client later needs the same department at several branches with
-- different desks or staff, the forward path is a
-- (branch_id, department_key) junction table -- not a re-key of these columns.

ALTER TABLE public.visit_departments
  ADD COLUMN IF NOT EXISTS branch_id uuid
    REFERENCES public.visit_branches(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.visit_departments.branch_id IS
  'Branch this department is offered at. NULL = every branch.';

CREATE INDEX IF NOT EXISTS idx_visit_departments_branch_id
  ON public.visit_departments (branch_id)
  WHERE branch_id IS NOT NULL;

-- Slot listing must not offer a slot whose department is pinned to a different
-- branch than the slot itself.
CREATE OR REPLACE FUNCTION public.driver_list_visit_slots(p_date date, p_department_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'slots', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'start_time', s.start_time,
        'end_time', s.end_time,
        'capacity', s.capacity,
        'booked', COALESCE(b.cnt, 0),
        'remaining', GREATEST(s.capacity - COALESCE(b.cnt, 0), 0),
        'full', (COALESCE(b.cnt, 0) >= s.capacity)
      ) ORDER BY s.start_time)
      FROM public.visit_slots s
      JOIN public.visit_departments d
        ON d.key = s.department_key
       AND d.is_active
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS cnt
        FROM public.visit_bookings vb
        WHERE vb.slot_id = s.id
          AND vb.scheduled_date = p_date
          AND vb.status IN ('confirmed', 'checked_in')
      ) b ON true
      WHERE s.is_active
        AND s.department_key = p_department_key
        AND (d.branch_id IS NULL OR d.branch_id = s.branch_id)
        AND (s.slot_date = p_date OR (
          s.slot_date IS NULL
          AND s.day_of_week = EXTRACT(DOW FROM p_date)::int
        ))
    ), '[]'::jsonb)
  );
END;
$function$;

-- Booking gains the same branch consistency check. It also stops resolving the
-- fallback branch by the hardcoded key 'central_tower': that broke silently the
-- moment the branch was renamed, deactivated or joined by a second one.
-- `visit_branches.is_default` already has a unique partial index, so it is the
-- correct anchor.
CREATE OR REPLACE FUNCTION public.driver_book_visit(
  p_department_key text,
  p_date date,
  p_slot_id uuid,
  p_note text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_slot public.visit_slots%ROWTYPE;
  v_dept public.visit_departments%ROWTYPE;
  v_booked int;
  v_code text;
  v_id uuid;
  v_branch uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = v_uid AND archived_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_driver');
  END IF;

  SELECT * INTO v_dept FROM public.visit_departments
  WHERE key = p_department_key AND is_active;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_department');
  END IF;

  SELECT * INTO v_slot FROM public.visit_slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND OR NOT v_slot.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_not_found');
  END IF;

  IF v_dept.branch_id IS NOT NULL AND v_dept.branch_id IS DISTINCT FROM v_slot.branch_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'department_not_at_branch');
  END IF;

  SELECT count(*)::int INTO v_booked
  FROM public.visit_bookings
  WHERE slot_id = p_slot_id
    AND scheduled_date = p_date
    AND status IN ('confirmed', 'checked_in');

  IF v_booked >= v_slot.capacity THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_full');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.visit_bookings
    WHERE driver_id = v_uid
      AND scheduled_date = p_date
      AND department_key = p_department_key
      AND status IN ('confirmed', 'checked_in')
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'duplicate_department_date',
      'message', 'Already booked for this department on this date.'
    );
  END IF;

  SELECT id INTO v_branch FROM public.visit_branches
  WHERE is_active
  ORDER BY is_default DESC, sort_order
  LIMIT 1;

  v_code := public.allocate_visit_booking_code();

  BEGIN
    INSERT INTO public.visit_bookings (
      booking_code, driver_id, department_key, branch_id, slot_id,
      scheduled_date, note, status
    ) VALUES (
      v_code, v_uid, p_department_key,
      COALESCE(v_slot.branch_id, v_dept.branch_id, v_branch),
      p_slot_id, p_date, NULLIF(trim(COALESCE(p_note, '')), ''), 'confirmed'
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'duplicate_department_date',
      'message', 'Already booked for this department on this date.'
    );
  END;

  RETURN jsonb_build_object(
    'ok', true, 'id', v_id, 'booking_code', v_code, 'status', 'confirmed'
  );
END;
$function$;
