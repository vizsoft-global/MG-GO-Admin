-- Job control for bulk import: running / paused / cancelled sit beside
-- the original previewed / applied / failed terminals.

ALTER TYPE public.driver_import_batch_status ADD VALUE IF NOT EXISTS 'running';
ALTER TYPE public.driver_import_batch_status ADD VALUE IF NOT EXISTS 'paused';
ALTER TYPE public.driver_import_batch_status ADD VALUE IF NOT EXISTS 'cancelled';
