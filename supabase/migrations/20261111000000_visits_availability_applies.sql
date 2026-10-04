-- Slot & availability was configuration nothing read. Three separate gaps, all
-- reported from the same screen:
--
--   1. Turning a weekday ON produced no slots for it, so the day stayed
--      unbookable and the toggle looked inert. The only generator in the
--      system (`copyVisitWeekdaySlotsToAllBranches`) mirrors the *source
--      branch's existing templates* — it can never introduce a weekday that
--      has no template anywhere yet.
--   2. `driver_list_visit_slots` / `driver_book_visit` ignored working_dows,
--      opening/closing, the booking window and visit_blocked_dates entirely, so
--      the config was decorative and a rider could book a closed day.
--   3. `visit_branches.is_default` had no active check, so a deactivated branch
--      could be the fallback `driver_book_visit` books unassigned slots into.
--
-- The sync only ever ADDS. Deactivating a weekday leaves its slot rows in place
-- and the availability check above refuses them, which keeps the change
-- reversible and stops a sync from reopening a slot an operator closed by hand.

-- ---------------------------------------------------------------------------
-- 1. A deactivated branch can never be the default.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.visit_branch_default_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  -- Normalise instead of raising: closing a branch is a legitimate operation,
  -- and refusing it would force the operator to hunt down and move the default
  -- first. Clearing is the only state where both invariants hold, and it shows
  -- immediately in the branches list.
  IF NEW.is_active IS NOT TRUE THEN
    NEW.is_default := false;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS visit_branches_default_guard ON public.visit_branches;
CREATE TRIGGER visit_branches_default_guard
  BEFORE INSERT OR UPDATE ON public.visit_branches
  FOR EACH ROW EXECUTE FUNCTION public.visit_branch_default_guard();

-- Anything already in the bad state (this is what the panel could create before).
UPDATE public.visit_branches
SET is_default = false, updated_at = now()
WHERE is_default AND NOT is_active;

-- ---------------------------------------------------------------------------
-- 2. One place decides whether a branch accepts visits on a date.
--    NULL means "yes". A NULL branch (a slot with no branch and no department
--    pin) is not restricted — an unconfigured slot is not a closed one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.visit_slot_availability_block(
  p_branch_id uuid,
  p_date date
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN b.is_active IS NOT TRUE THEN 'branch_inactive'
    -- An empty working_dows is "not configured", never "closed every day".
    WHEN cardinality(b.working_dows) > 0
      AND NOT (EXTRACT(DOW FROM p_date)::int = ANY (b.working_dows)) THEN 'branch_closed'
    WHEN EXISTS (
      SELECT 1
      FROM public.visit_blocked_dates bd
      WHERE bd.blocked_date = p_date
        AND (bd.branch_id IS NULL OR bd.branch_id = b.id)
    ) THEN 'date_blocked'
    WHEN p_date > (now() AT TIME ZONE 'Asia/Kuwait')::date + b.booking_window_days
      THEN 'outside_booking_window'
    ELSE NULL
  END
  FROM public.visit_branches b
  WHERE b.id = p_branch_id;
$function$;

-- Internal helper: reachable only from the SECURITY DEFINER RPCs below, which
-- run as the owner. Never exposed through PostgREST.
REVOKE ALL ON FUNCTION public.visit_slot_availability_block(uuid, date) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. Opening a weekday generates its slots from the branch's own busiest day.
--    Split in two: the guard lives on the callable wrapper, the work lives in a
--    helper with no guard so a migration can run it without a session.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._visit_generate_branch_weekday_slots(
  p_branch_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch public.visit_branches%ROWTYPE;
  v_added int := 0;
  v_template_dow int;
BEGIN
  SELECT * INTO v_branch FROM public.visit_branches WHERE id = p_branch_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Unset toggles mean "no opinion": the generator is inert until an operator
  -- says which days the branch opens, so shipping this changes no existing week.
  IF cardinality(v_branch.working_dows) = 0 THEN
    RETURN 0;
  END IF;

  -- The toggle says *which* days the branch opens, never what a day looks like,
  -- so the pattern has to come from the branch itself: its busiest existing day.
  SELECT day_of_week INTO v_template_dow
  FROM (
    SELECT day_of_week, count(*) AS n
    FROM public.visit_slots
    WHERE branch_id = p_branch_id
      AND slot_date IS NULL
      AND is_active
    GROUP BY day_of_week
    ORDER BY n DESC, day_of_week
    LIMIT 1
  ) t;

  IF v_template_dow IS NULL THEN
    -- Nothing to model a day on. The operator has to build one day by hand
    -- first; inventing hours here would be a schedule nobody asked for.
    RETURN 0;
  END IF;

  INSERT INTO public.visit_slots (
    branch_id, department_key, slot_date, day_of_week,
    start_time, end_time, capacity, is_active
  )
  SELECT p_branch_id, t.department_key, NULL, d.dow,
         t.start_time, t.end_time, t.capacity, true
  FROM unnest(v_branch.working_dows) AS d(dow)
  CROSS JOIN LATERAL (
    SELECT s.department_key, s.start_time, s.end_time, s.capacity
    FROM public.visit_slots s
    WHERE s.branch_id = p_branch_id
      AND s.slot_date IS NULL
      AND s.is_active
      AND s.day_of_week = v_template_dow
  ) t
  -- Match on the same key the copy uses, and count a deactivated row as
  -- present: re-adding it would duplicate a slot the operator switched off.
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.visit_slots x
    WHERE x.branch_id = p_branch_id
      AND x.slot_date IS NULL
      AND x.department_key = t.department_key
      AND x.day_of_week = d.dow
      AND x.start_time = t.start_time
      AND x.end_time = t.end_time
  );
  GET DIAGNOSTICS v_added = ROW_COUNT;

  RETURN v_added;
END;
$function$;

REVOKE ALL ON FUNCTION public._visit_generate_branch_weekday_slots(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.admin_sync_branch_slots_to_working_days(
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.visit_branches WHERE id = p_branch_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'branch_not_found');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'added', public._visit_generate_branch_weekday_slots(p_branch_id)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_sync_branch_slots_to_working_days(uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. The rider slot list stops offering a closed day.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_list_visit_slots(
  p_date date,
  p_department_key text
)
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
        -- Availability is per slot-branch, so a department that is served by
        -- two branches keeps whichever of them is actually open that day.
        AND public.visit_slot_availability_block(
          COALESCE(s.branch_id, d.branch_id), p_date
        ) IS NULL
    ), '[]'::jsonb)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Booking refuses the same states, so a slot held on screen cannot be
--    booked after the day was closed or blocked.
-- ---------------------------------------------------------------------------
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
  v_block text;
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
    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'visit.book', 'rpc', 'driver_book_visit',
      false, 'invalid_department', 'visit_booking', NULL,
      jsonb_build_object('department_key', p_department_key, 'date', p_date)
    );
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_department');
  END IF;

  SELECT * INTO v_slot FROM public.visit_slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND OR NOT v_slot.is_active THEN
    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'visit.book', 'rpc', 'driver_book_visit',
      false, 'slot_not_found', 'visit_booking', NULL,
      jsonb_build_object('department_key', p_department_key, 'slot_id', p_slot_id)
    );
    RETURN jsonb_build_object('ok', false, 'error', 'slot_not_found');
  END IF;

  IF v_dept.branch_id IS NOT NULL AND v_dept.branch_id IS DISTINCT FROM v_slot.branch_id THEN
    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'visit.book', 'rpc', 'driver_book_visit',
      false, 'department_not_at_branch', 'visit_booking', NULL,
      jsonb_build_object('department_key', p_department_key, 'slot_id', p_slot_id)
    );
    RETURN jsonb_build_object('ok', false, 'error', 'department_not_at_branch');
  END IF;

  -- The branch's own availability rules. Read from the slot's branch (or the
  -- department's pin, or the branch this booking would fall back to), so the
  -- decided branch is the one whose hours are enforced.
  v_block := public.visit_slot_availability_block(
    COALESCE(
      v_slot.branch_id,
      v_dept.branch_id,
      (SELECT b.id FROM public.visit_branches b
        WHERE b.is_active
        ORDER BY b.is_default DESC, b.sort_order
        LIMIT 1)
    ),
    p_date
  );
  IF v_block IS NOT NULL THEN
    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'visit.book', 'rpc', 'driver_book_visit',
      false, v_block, 'visit_booking', NULL,
      jsonb_build_object('department_key', p_department_key, 'date', p_date)
    );
    RETURN jsonb_build_object(
      'ok', false,
      'error', v_block,
      'message', CASE v_block
        WHEN 'branch_closed' THEN 'This branch is closed on the selected day.'
        WHEN 'date_blocked' THEN 'This branch does not accept visits on the selected date.'
        WHEN 'outside_booking_window' THEN 'This date is outside the branch booking window.'
        WHEN 'branch_inactive' THEN 'This branch is not accepting visits right now.'
        ELSE 'This date is not available for booking.'
      END
    );
  END IF;

  SELECT count(*)::int INTO v_booked
  FROM public.visit_bookings
  WHERE slot_id = p_slot_id
    AND scheduled_date = p_date
    AND status IN ('confirmed', 'checked_in');

  IF v_booked >= v_slot.capacity THEN
    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'visit.book', 'rpc', 'driver_book_visit',
      false, 'slot_full', 'visit_booking', NULL,
      jsonb_build_object(
        'department_key', p_department_key,
        'date', p_date,
        'capacity', v_slot.capacity
      )
    );
    RETURN jsonb_build_object('ok', false, 'error', 'slot_full');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.visit_bookings
    WHERE driver_id = v_uid
      AND scheduled_date = p_date
      AND department_key = p_department_key
      AND status IN ('confirmed', 'checked_in')
  ) THEN
    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'visit.book', 'rpc', 'driver_book_visit',
      false, 'duplicate_department_date', 'visit_booking', NULL,
      jsonb_build_object('department_key', p_department_key, 'date', p_date)
    );
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'duplicate_department_date',
      'message', 'Already booked for this department on this date.'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.visit_bookings b
    JOIN public.visit_slots s ON s.id = b.slot_id
    WHERE b.driver_id = v_uid
      AND b.scheduled_date = p_date
      AND b.status IN ('confirmed', 'checked_in')
      AND s.start_time < v_slot.end_time
      AND s.end_time > v_slot.start_time
  ) THEN
    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'visit.book', 'rpc', 'driver_book_visit',
      false, 'overlapping_visit', 'visit_booking', NULL,
      jsonb_build_object(
        'department_key', p_department_key,
        'date', p_date,
        'slot_id', p_slot_id
      )
    );
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'overlapping_visit',
      'message', 'You already have a visit at this time. Pick another slot.'
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
    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'visit.book', 'rpc', 'driver_book_visit',
      false, 'duplicate_department_date', 'visit_booking', NULL,
      jsonb_build_object(
        'department_key', p_department_key,
        'date', p_date,
        'source', 'unique_index'
      )
    );
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'duplicate_department_date',
      'message', 'Already booked for this department on this date.'
    );
  END;

  PERFORM public.log_driver_operation(
    v_uid, 'visit', 'visit.book', 'rpc', 'driver_book_visit',
    true, NULL, 'visit_booking', v_id,
    jsonb_build_object(
      'booking_code', v_code,
      'department_key', p_department_key,
      'date', p_date
    )
  );

  RETURN jsonb_build_object(
    'ok', true, 'id', v_id, 'booking_code', v_code, 'status', 'confirmed'
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Make the settings that are already saved true. Branches whose working_dows
--    include a weekday with no template at all get that day generated; the
--    call is add-only and idempotent.
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  v_branch record;
BEGIN
  FOR v_branch IN
    SELECT id FROM public.visit_branches
    WHERE is_active AND cardinality(working_dows) > 0
  LOOP
    PERFORM public._visit_generate_branch_weekday_slots(v_branch.id);
  END LOOP;
END;
$backfill$;
