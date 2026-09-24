-- Undo / redo for order recon uploads. Daily reads the latest applied run.
-- Existing runs stay applied. The driver app does not read this table.

ALTER TABLE public.order_recon_runs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'applied',
  ADD COLUMN IF NOT EXISTS undone_at timestamptz,
  ADD COLUMN IF NOT EXISTS undo_seq integer,
  ADD COLUMN IF NOT EXISTS redoable boolean NOT NULL DEFAULT true;

ALTER TABLE public.order_recon_runs
  DROP CONSTRAINT IF EXISTS order_recon_runs_status_check;

ALTER TABLE public.order_recon_runs
  ADD CONSTRAINT order_recon_runs_status_check
  CHECK (status IN ('applied', 'undone'));

CREATE INDEX IF NOT EXISTS order_recon_runs_applied_created_idx
  ON public.order_recon_runs (created_at DESC)
  WHERE status = 'applied';
