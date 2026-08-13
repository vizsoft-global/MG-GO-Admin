-- Figma VB/05 Slot & availability (node 4195:10894) configures per-branch booking
-- hours, slot length, capacity, buffer, booking window, per-department desks and
-- blocked dates. Only working_days / opening_time / closing_time existed, so the
-- screen had no schema backing. Additive columns + one new table.
-- No change to the duplicate-booking rule, KPI formulas, or RBAC.

ALTER TABLE public.visit_branches
  ADD COLUMN IF NOT EXISTS working_dows smallint[] NOT NULL DEFAULT ARRAY[]::smallint[],
  ADD COLUMN IF NOT EXISTS lunch_start time,
  ADD COLUMN IF NOT EXISTS lunch_end time,
  ADD COLUMN IF NOT EXISTS slot_length_minutes int NOT NULL DEFAULT 30
    CHECK (slot_length_minutes > 0),
  ADD COLUMN IF NOT EXISTS slot_buffer_minutes int NOT NULL DEFAULT 0
    CHECK (slot_buffer_minutes >= 0),
  ADD COLUMN IF NOT EXISTS default_slot_capacity int NOT NULL DEFAULT 1
    CHECK (default_slot_capacity > 0),
  ADD COLUMN IF NOT EXISTS booking_window_days int NOT NULL DEFAULT 14
    CHECK (booking_window_days > 0);

COMMENT ON COLUMN public.visit_branches.working_dows IS
  'Bookable weekdays (0=Sun). Drives the Slot & availability day toggles and the calendar board.';
COMMENT ON COLUMN public.visit_branches.lunch_start IS
  'Lunch break start; the calendar board renders a break divider instead of slot rows.';

-- Backfill working_dows from the existing human-readable working_days label only
-- for the known Sun-Thu pattern; anything else stays empty for staff to set.
UPDATE public.visit_branches
SET working_dows = ARRAY[0, 1, 2, 3, 4]::smallint[]
WHERE cardinality(working_dows) = 0
  AND working_days IS NOT NULL
  AND replace(lower(working_days), ' ', '') IN ('sun-thu', 'sun–thu', 'sunday-thursday');

-- Desks per department (Figma VB/05 right column steppers)
ALTER TABLE public.visit_departments
  ADD COLUMN IF NOT EXISTS desks_count int NOT NULL DEFAULT 1
    CHECK (desks_count >= 0);

-- Blocked dates (Figma VB/05 "Blocked dates" card)
CREATE TABLE IF NOT EXISTS public.visit_blocked_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.visit_branches(id) ON DELETE CASCADE,
  blocked_date date NOT NULL,
  reason text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS visit_blocked_dates_branch_date_uidx
  ON public.visit_blocked_dates (
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    blocked_date
  );

CREATE INDEX IF NOT EXISTS visit_blocked_dates_date_idx
  ON public.visit_blocked_dates (blocked_date);

COMMENT ON TABLE public.visit_blocked_dates IS
  'Dates a branch does not accept visits. Admin calendar renders the day as blocked; driver_book_visit does not enforce it yet.';

ALTER TABLE public.visit_blocked_dates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_all_visit_blocked_dates ON public.visit_blocked_dates;
CREATE POLICY staff_all_visit_blocked_dates ON public.visit_blocked_dates
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS drivers_read_visit_blocked_dates ON public.visit_blocked_dates;
CREATE POLICY drivers_read_visit_blocked_dates ON public.visit_blocked_dates
  FOR SELECT TO authenticated
  USING (true);
