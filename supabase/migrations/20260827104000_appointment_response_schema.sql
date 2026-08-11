-- Flutter Figma QA fix pass, RSup/28-29 (Appointment Inbox / Added):
-- `appointment_status` only had scheduled/completed/cancelled and there was
-- no driver-response state, so Accept/Reject/Propose in the driver app had
-- nothing real to write to. Additive schema only — no existing rows/behavior
-- change (default stays 'scheduled' until the next migration flips new
-- admin-created rows to the two-step 'pending' flow).

DO $$ BEGIN
  ALTER TYPE public.appointment_status ADD VALUE IF NOT EXISTS 'pending';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.appointment_status ADD VALUE IF NOT EXISTS 'accepted';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.appointment_status ADD VALUE IF NOT EXISTS 'rejected';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.appointment_status ADD VALUE IF NOT EXISTS 'reschedule_requested';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS proposed_for timestamptz,
  ADD COLUMN IF NOT EXISTS driver_response_note text,
  ADD COLUMN IF NOT EXISTS responded_at timestamptz;
