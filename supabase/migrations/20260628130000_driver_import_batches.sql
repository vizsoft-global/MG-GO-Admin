-- Audit trail for bulk driver intake imports.

DO $$ BEGIN
  CREATE TYPE public.driver_import_batch_status AS ENUM ('previewed', 'applied', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.driver_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count int NOT NULL DEFAULT 0,
  applied_count int NOT NULL DEFAULT 0,
  skipped_count int NOT NULL DEFAULT 0,
  approved_count int NOT NULL DEFAULT 0,
  status public.driver_import_batch_status NOT NULL DEFAULT 'applied',
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.driver_import_batches IS 'Bulk driver intake import batches from admin panel';

ALTER TABLE public.driver_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_driver_import_batches_all ON public.driver_import_batches;
CREATE POLICY staff_driver_import_batches_all ON public.driver_import_batches
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());
