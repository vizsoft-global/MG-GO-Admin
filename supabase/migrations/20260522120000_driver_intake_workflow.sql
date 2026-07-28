-- Admin workflow status (draft / pending / approved) + app link flag (linked)

DO $$ BEGIN
  CREATE TYPE public.driver_workflow_status AS ENUM ('draft', 'pending', 'approved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.driver_intakes
  ADD COLUMN IF NOT EXISTS workflow_status public.driver_workflow_status NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS linked boolean NOT NULL DEFAULT false;

UPDATE public.driver_intakes
SET linked = (status = 'linked' OR linked_profile_id IS NOT NULL);

UPDATE public.driver_intakes
SET workflow_status = CASE
  WHEN status = 'cancelled' THEN 'draft'::public.driver_workflow_status
  ELSE 'pending'::public.driver_workflow_status
END;

CREATE INDEX IF NOT EXISTS driver_intakes_workflow_status_idx
  ON public.driver_intakes (workflow_status);

CREATE INDEX IF NOT EXISTS driver_intakes_linked_idx
  ON public.driver_intakes (linked);

COMMENT ON COLUMN public.driver_intakes.workflow_status IS
  'Admin-managed lifecycle: draft, pending, approved (independent of mobile app)';
COMMENT ON COLUMN public.driver_intakes.linked IS
  'Set true when the driver app links this intake by phone on first OTP login';

-- Mobile / edge function: set linked = true when phone matches an intake
CREATE OR REPLACE FUNCTION public.mark_driver_intake_linked(
  p_phone text,
  p_profile_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count int;
BEGIN
  UPDATE public.driver_intakes
  SET
    linked = true,
    linked_profile_id = p_profile_id,
    status = 'linked',
    updated_at = now()
  WHERE phone = p_phone
    AND linked = false;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_driver_intake_linked(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_driver_intake_linked(text, uuid) TO service_role;
