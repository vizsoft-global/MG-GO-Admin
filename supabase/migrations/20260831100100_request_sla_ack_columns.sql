-- Columns behind the Figma elements the client approved: per-step SLA with a defined breach
-- action, who acted on a step and when it started, the acknowledgement stamp, and the fuel
-- payout choice.
--
-- SLA values are deliberately left NULL. A step with no sla_minutes has no deadline, which is
-- today's behaviour; the workflow builder is where real durations get entered, and inventing
-- them here would fabricate a policy nobody agreed to.

-- ---------------------------------------------------------------- requests

ALTER TABLE public.requests
  -- Acknowledgement has been recorded in payload.driver_ack_at since the ack flow shipped.
  -- A real column makes it filterable and reportable.
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  -- Mirrors the current step's deadline so the list can sort and filter on it without a join.
  ADD COLUMN IF NOT EXISTS sla_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_breach_action text,
  -- Figma "Transfer type (on approval)" on the fuel drawer: In cash / With salary. It is an
  -- approver's payout decision, not something the rider fills in.
  ADD COLUMN IF NOT EXISTS fuel_transfer_type text,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
  ALTER TABLE public.requests
    ADD CONSTRAINT requests_fuel_transfer_type_check
    CHECK (fuel_transfer_type IS NULL OR fuel_transfer_type IN ('cash', 'salary'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.requests
    ADD CONSTRAINT requests_sla_breach_action_check
    CHECK (sla_breach_action IS NULL OR sla_breach_action IN ('notify', 'escalate'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

UPDATE public.requests
SET acknowledged_at = (payload ->> 'driver_ack_at')::timestamptz
WHERE acknowledged_at IS NULL
  AND payload ? 'driver_ack_at'
  AND NULLIF(payload ->> 'driver_ack_at', '') IS NOT NULL;

-- Overdue queues sort on this; a partial index keeps it small since most rows have no SLA.
CREATE INDEX IF NOT EXISTS idx_requests_sla_due_at
  ON public.requests (sla_due_at)
  WHERE sla_due_at IS NOT NULL;

-- ---------------------------------------------------------------- templates

ALTER TABLE public.request_approval_step_templates
  ADD COLUMN IF NOT EXISTS sla_minutes int,
  ADD COLUMN IF NOT EXISTS breach_action text;

DO $$
BEGIN
  ALTER TABLE public.request_approval_step_templates
    ADD CONSTRAINT request_step_templates_sla_minutes_check
    CHECK (sla_minutes IS NULL OR sla_minutes > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.request_approval_step_templates
    ADD CONSTRAINT request_step_templates_breach_action_check
    CHECK (breach_action IS NULL OR breach_action IN ('notify', 'escalate'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------- live steps

ALTER TABLE public.request_approval_steps
  -- Figma renders the open step as "Under review - Accounts / Since 06 Jul".
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  -- Figma renders the first step as "Submitted by Vikram S". Storing the name rather than
  -- joining keeps the timeline honest after a staff member is archived or renamed.
  ADD COLUMN IF NOT EXISTS actor_display_name text,
  ADD COLUMN IF NOT EXISTS sla_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS breach_action text,
  ADD COLUMN IF NOT EXISTS sla_breached_at timestamptz;

DO $$
BEGIN
  ALTER TABLE public.request_approval_steps
    ADD CONSTRAINT request_approval_steps_breach_action_check
    CHECK (breach_action IS NULL OR breach_action IN ('notify', 'escalate'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill started_at for existing steps: a step starts when the one before it was decided,
-- and the first step starts when the request was created.
UPDATE public.request_approval_steps s
SET started_at = COALESCE(prev.decided_at, r.created_at)
FROM public.requests r
LEFT JOIN LATERAL (
  SELECT p.decided_at
  FROM public.request_approval_steps p
  WHERE p.request_id = r.id AND p.decided_at IS NOT NULL
  ORDER BY p.step_order DESC
  LIMIT 1
) prev ON true
WHERE s.request_id = r.id
  AND s.started_at IS NULL
  AND s.status <> 'pending';

-- Step 1 is the rider's own submission, auto-completed at materialisation, so its actor is
-- the rider. Later steps carry whoever decided them.
UPDATE public.request_approval_steps s
SET actor_display_name = p.full_name
FROM public.requests r
JOIN public.profiles p ON p.id = r.driver_id
WHERE s.request_id = r.id
  AND s.step_order = 1
  AND s.actor_display_name IS NULL
  AND p.full_name IS NOT NULL;

UPDATE public.request_approval_steps s
SET actor_display_name = p.full_name
FROM public.profiles p
WHERE p.id = s.decided_by
  AND s.actor_display_name IS NULL
  AND p.full_name IS NOT NULL;

-- ---------------------------------------------------------------- settings

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS request_auto_close_days int NOT NULL DEFAULT 30;

DO $$
BEGIN
  ALTER TABLE public.app_settings
    ADD CONSTRAINT app_settings_request_auto_close_days_check
    CHECK (request_auto_close_days > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
