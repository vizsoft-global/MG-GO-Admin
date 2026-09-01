-- Staff changelog for a rider file. Append-only: staff may SELECT, every write
-- goes through the service-role helper. Riders never see this table.

CREATE TABLE IF NOT EXISTS public.driver_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  intake_id uuid NOT NULL REFERENCES public.driver_intakes (id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers (id) ON DELETE SET NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  actor_name text NOT NULL,
  source text NOT NULL,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT driver_change_events_source_chk CHECK (
    source IN (
      'manual_create',
      'bulk_import',
      'edit',
      'approve',
      'archive',
      'restore',
      'status',
      'block',
      'unblock',
      'passcode',
      'document',
      'asset',
      'assignment'
    )
  ),
  CONSTRAINT driver_change_events_changes_arr_chk CHECK (jsonb_typeof(changes) = 'array'),
  CONSTRAINT driver_change_events_context_obj_chk CHECK (jsonb_typeof(context) = 'object')
);

CREATE INDEX IF NOT EXISTS driver_change_events_intake_created_idx
  ON public.driver_change_events (intake_id, created_at DESC);

CREATE INDEX IF NOT EXISTS driver_change_events_driver_created_idx
  ON public.driver_change_events (driver_id, created_at DESC)
  WHERE driver_id IS NOT NULL;

ALTER TABLE public.driver_change_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.driver_change_events FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.driver_change_events TO postgres, service_role;
GRANT SELECT ON public.driver_change_events TO authenticated;

DROP POLICY IF EXISTS driver_change_events_staff_read ON public.driver_change_events;
CREATE POLICY driver_change_events_staff_read ON public.driver_change_events
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());
