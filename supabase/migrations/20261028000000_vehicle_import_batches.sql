-- Vehicle bulk-import history. Staff undo/redo reads before/after here.
-- The driver app does not read these tables.

CREATE TABLE IF NOT EXISTS public.vehicle_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('applied', 'undone')),
  total_rows integer NOT NULL,
  applied_rows integer NOT NULL,
  failed_rows integer NOT NULL,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz,
  undo_seq integer,
  redoable boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.vehicle_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.vehicle_import_batches(id) ON DELETE CASCADE,
  row_index integer NOT NULL,
  bike_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('create', 'update', 'failed')),
  message text,
  vehicle_id uuid,
  before jsonb,
  after jsonb
);

CREATE INDEX IF NOT EXISTS vehicle_import_rows_batch_idx
  ON public.vehicle_import_rows (batch_id, row_index);

ALTER TABLE public.vehicle_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_import_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicle_import_batches_staff ON public.vehicle_import_batches;
CREATE POLICY vehicle_import_batches_staff
  ON public.vehicle_import_batches FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS vehicle_import_rows_staff ON public.vehicle_import_rows;
CREATE POLICY vehicle_import_rows_staff
  ON public.vehicle_import_rows FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_import_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_import_rows TO authenticated;
