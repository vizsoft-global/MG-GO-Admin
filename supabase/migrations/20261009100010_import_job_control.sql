-- Persist remaining rows and the journal so an import can hide, pause,
-- resume, or cancel without the operator staying in the dialog.

ALTER TABLE public.driver_import_batches
  ADD COLUMN IF NOT EXISTS remaining_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS remaining_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ready_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS events jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS credentials jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS duplicate_strategy text NOT NULL DEFAULT 'update',
  ADD COLUMN IF NOT EXISTS approve_immediately boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;

ALTER TABLE public.driver_import_batches
  DROP CONSTRAINT IF EXISTS driver_import_batches_duplicate_strategy_chk;

ALTER TABLE public.driver_import_batches
  ADD CONSTRAINT driver_import_batches_duplicate_strategy_chk
  CHECK (duplicate_strategy IN ('skip', 'update'));

COMMENT ON COLUMN public.driver_import_batches.remaining_rows IS
  'Preview rows still to apply. Claimed in chunks so two tabs cannot write the same rider.';

COMMENT ON COLUMN public.driver_import_batches.events IS
  'Import journal. Passcodes never land here.';

CREATE OR REPLACE FUNCTION public.claim_driver_import_chunk(p_id uuid, p_size integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rows jsonb;
  v_claimed jsonb;
  v_rest jsonb;
  v_count integer;
BEGIN
  IF p_id IS NULL OR p_size IS NULL OR p_size < 1 OR p_size > 50 THEN
    RAISE EXCEPTION 'invalid_chunk';
  END IF;

  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT b.remaining_rows
  INTO v_rows
  FROM public.driver_import_batches b
  WHERE b.id = p_id
    AND b.status = 'running'::public.driver_import_batch_status
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
  INTO v_claimed
  FROM (
    SELECT value AS elem, ordinality AS ord
    FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) WITH ORDINALITY
    WHERE ordinality <= p_size
  ) claimed;

  SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
  INTO v_rest
  FROM (
    SELECT value AS elem, ordinality AS ord
    FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) WITH ORDINALITY
    WHERE ordinality > p_size
  ) rest;

  v_count := COALESCE(jsonb_array_length(v_rest), 0);

  UPDATE public.driver_import_batches
  SET
    remaining_rows = v_rest,
    remaining_count = v_count,
    heartbeat_at = now()
  WHERE id = p_id
    AND status = 'running'::public.driver_import_batch_status;

  RETURN v_claimed;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_driver_import_chunk(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_driver_import_chunk(uuid, integer) TO authenticated;
