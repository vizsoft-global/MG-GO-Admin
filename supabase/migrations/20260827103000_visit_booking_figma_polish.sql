-- Visit Booking Figma QA fix pass: additive read-model + catalog metadata only.
-- No changes to KPI formulas, duplicate-booking rule, or RBAC.

-- ---------------------------------------------------------------------------
-- 1. Branch catalog metadata (Figma VB/07-Branches: city, working hours, desks, default flag)
-- ---------------------------------------------------------------------------

ALTER TABLE public.visit_branches
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS working_days text,
  ADD COLUMN IF NOT EXISTS opening_time time,
  ADD COLUMN IF NOT EXISTS closing_time time,
  ADD COLUMN IF NOT EXISTS desks_count int NOT NULL DEFAULT 1 CHECK (desks_count >= 0),
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- Exactly one default branch
CREATE UNIQUE INDEX IF NOT EXISTS visit_branches_single_default_uidx
  ON public.visit_branches ((is_default))
  WHERE is_default = true;

UPDATE public.visit_branches
SET is_default = true, working_days = COALESCE(working_days, 'Sun-Thu'),
    opening_time = COALESCE(opening_time, '09:00'::time),
    closing_time = COALESCE(closing_time, '17:00'::time)
WHERE key = 'central_tower'
  AND NOT EXISTS (SELECT 1 FROM public.visit_branches WHERE is_default = true);

-- ---------------------------------------------------------------------------
-- 2. Department catalog metadata (Figma VB/06: desk/counter, assigned staff, avg handling)
-- ---------------------------------------------------------------------------

ALTER TABLE public.visit_departments
  ADD COLUMN IF NOT EXISTS desk_location text,
  ADD COLUMN IF NOT EXISTS assigned_staff_name text,
  ADD COLUMN IF NOT EXISTS avg_handling_minutes int CHECK (avg_handling_minutes IS NULL OR avg_handling_minutes > 0);

-- ---------------------------------------------------------------------------
-- 3. admin_list_visits: attach driver_phone (Figma VB/01 Rider column)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_visits(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_status text DEFAULT NULL,
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
  v_today date := current_date;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('visits.view') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'kpi', jsonb_build_object(
      'today', (SELECT count(*) FROM public.visit_bookings WHERE scheduled_date = v_today),
      'today_checked_in', (
        SELECT count(*) FROM public.visit_bookings
        WHERE scheduled_date = v_today AND status IN ('checked_in', 'completed')
      ),
      'upcoming', (
        SELECT count(*) FROM public.visit_bookings
        WHERE status = 'confirmed' AND scheduled_date > v_today AND scheduled_date <= v_today + 7
      ),
      'awaiting_checkin', (
        SELECT count(*) FROM public.visit_bookings
        WHERE status = 'confirmed' AND scheduled_date = v_today
      ),
      'no_shows', (
        SELECT count(*) FROM public.visit_bookings
        WHERE status = 'no_show' AND scheduled_date >= v_today - 7
      )
    ),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.scheduled_date DESC, x.created_at DESC)
      FROM (
        SELECT vb.*, p.full_name AS driver_name, p.phone AS driver_phone, d.driver_code,
               vd.label_en AS department_label,
               vs.start_time AS slot_start, vs.end_time AS slot_end,
               vbr.name AS branch_name
        FROM public.visit_bookings vb
        LEFT JOIN public.drivers d ON d.id = vb.driver_id
        LEFT JOIN public.profiles p ON p.id = vb.driver_id
        LEFT JOIN public.visit_departments vd ON vd.key = vb.department_key
        LEFT JOIN public.visit_slots vs ON vs.id = vb.slot_id
        LEFT JOIN public.visit_branches vbr ON vbr.id = vb.branch_id
        WHERE (p_date_from IS NULL OR vb.scheduled_date >= p_date_from)
          AND (p_date_to IS NULL OR vb.scheduled_date <= p_date_to)
          AND (p_status IS NULL OR vb.status::text = p_status)
        ORDER BY vb.scheduled_date DESC, vb.created_at DESC
        LIMIT GREATEST(COALESCE(p_limit, 50), 1)
        OFFSET GREATEST(COALESCE(p_offset, 0), 0)
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_visits(date, date, text, int, int) TO authenticated, service_role;
