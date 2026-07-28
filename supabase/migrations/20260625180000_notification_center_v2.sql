-- Notification Center v2: campaigns, targeting, dispatch, automations, FCM tokens

DO $$ BEGIN
  CREATE TYPE public.notification_campaign_status AS ENUM (
    'draft',
    'pending_approval',
    'scheduled',
    'queued',
    'processing',
    'sent',
    'delivered',
    'opened',
    'clicked',
    'failed',
    'cancelled',
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_category AS ENUM (
    'incentive',
    'reminder',
    'compliance',
    'attendance',
    'salary',
    'emergency',
    'announcement',
    'operations',
    'system_alert'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_priority AS ENUM ('low', 'normal', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_action_type AS ENUM (
    'open_screen',
    'open_module',
    'open_record',
    'open_workflow',
    'open_url',
    'custom_payload',
    'silent_update_trigger'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_dispatch_item_status AS ENUM (
    'pending',
    'processing',
    'sent',
    'delivered',
    'opened',
    'clicked',
    'failed',
    'skipped'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_event_type AS ENUM (
    'queued',
    'sent',
    'delivered',
    'opened',
    'clicked',
    'failed',
    'cancelled',
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_automation_status AS ENUM ('draft', 'active', 'paused', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_automation_trigger AS ENUM (
    'inactivity',
    'attendance_approved',
    'salary_processed',
    'document_expiry',
    'low_performance',
    'incentive_unlocked',
    'shift_reminder',
    'missed_submission',
    'schedule'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.notification_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  category public.notification_category NOT NULL DEFAULT 'announcement',
  priority public.notification_priority NOT NULL DEFAULT 'normal',
  title_template text NOT NULL,
  body_template text NOT NULL,
  variable_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  action_type public.notification_action_type NOT NULL DEFAULT 'open_screen',
  action_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_version int NOT NULL DEFAULT 1,
  is_archived boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  category public.notification_category NOT NULL DEFAULT 'announcement',
  priority public.notification_priority NOT NULL DEFAULT 'normal',
  status public.notification_campaign_status NOT NULL DEFAULT 'draft',
  template_id uuid REFERENCES public.notification_templates(id) ON DELETE SET NULL,
  target_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  exclusion_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_type public.notification_action_type NOT NULL DEFAULT 'open_screen',
  action_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_version int NOT NULL DEFAULT 1,
  media jsonb NOT NULL DEFAULT '[]'::jsonb,
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  schedule_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  timezone text NOT NULL DEFAULT 'Asia/Kuwait',
  scheduled_for timestamptz,
  expires_at timestamptz,
  quiet_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  send_limit int,
  requires_approval boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  submitted_for_approval_at timestamptz,
  sent_at timestamptz,
  cancelled_at timestamptz,
  estimated_audience_count int NOT NULL DEFAULT 0,
  recipient_count int NOT NULL DEFAULT 0,
  delivered_count int NOT NULL DEFAULT 0,
  opened_count int NOT NULL DEFAULT 0,
  clicked_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  cloned_from_id uuid REFERENCES public.notification_campaigns(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_audience_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.notification_campaigns(id) ON DELETE CASCADE,
  target_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  exclusion_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  recipient_ids uuid[] NOT NULL DEFAULT '{}',
  recipient_count int NOT NULL DEFAULT 0,
  compiled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL DEFAULT 'android',
  provider text NOT NULL DEFAULT 'fcm',
  device_id text,
  app_version text,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (token)
);

CREATE TABLE IF NOT EXISTS public.notification_dispatch_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.notification_campaigns(id) ON DELETE CASCADE,
  snapshot_id uuid REFERENCES public.notification_audience_snapshots(id) ON DELETE SET NULL,
  status public.notification_campaign_status NOT NULL DEFAULT 'queued',
  provider text NOT NULL DEFAULT 'fcm',
  idempotency_key text NOT NULL,
  scheduled_for timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  total_count int NOT NULL DEFAULT 0,
  sent_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.notification_dispatch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.notification_dispatch_runs(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.notification_campaigns(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  push_token_id uuid REFERENCES public.driver_push_tokens(id) ON DELETE SET NULL,
  status public.notification_dispatch_item_status NOT NULL DEFAULT 'pending',
  provider_message_id text,
  error_code text,
  error_message text,
  retry_count int NOT NULL DEFAULT 0,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, driver_id)
);

CREATE TABLE IF NOT EXISTS public.notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES public.notification_campaigns(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.notification_dispatch_runs(id) ON DELETE CASCADE,
  dispatch_item_id uuid REFERENCES public.notification_dispatch_items(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  event_type public.notification_event_type NOT NULL,
  provider text NOT NULL DEFAULT 'fcm',
  provider_event_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  status public.notification_automation_status NOT NULL DEFAULT 'draft',
  trigger_type public.notification_automation_trigger NOT NULL,
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  condition_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  exclusion_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  template_id uuid REFERENCES public.notification_templates(id) ON DELETE SET NULL,
  title_template text,
  body_template text,
  category public.notification_category NOT NULL DEFAULT 'reminder',
  priority public.notification_priority NOT NULL DEFAULT 'normal',
  action_type public.notification_action_type NOT NULL DEFAULT 'open_screen',
  action_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  throttle_minutes int NOT NULL DEFAULT 60,
  cooldown_minutes int NOT NULL DEFAULT 1440,
  max_retries int NOT NULL DEFAULT 3,
  failure_threshold int NOT NULL DEFAULT 5,
  consecutive_failures int NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES public.notification_automations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running',
  matched_count int NOT NULL DEFAULT 0,
  sent_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  campaign_id uuid REFERENCES public.notification_campaigns(id) ON DELETE SET NULL,
  error_summary text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_dedup_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedup_key text NOT NULL UNIQUE,
  campaign_id uuid REFERENCES public.notification_campaigns(id) ON DELETE SET NULL,
  automation_id uuid REFERENCES public.notification_automations(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_campaigns_status ON public.notification_campaigns (status);
CREATE INDEX IF NOT EXISTS idx_notification_campaigns_scheduled_for ON public.notification_campaigns (scheduled_for);
CREATE INDEX IF NOT EXISTS idx_notification_campaigns_created_at ON public.notification_campaigns (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_dispatch_runs_campaign ON public.notification_dispatch_runs (campaign_id);
CREATE INDEX IF NOT EXISTS idx_notification_dispatch_items_run ON public.notification_dispatch_items (run_id);
CREATE INDEX IF NOT EXISTS idx_notification_dispatch_items_driver ON public.notification_dispatch_items (driver_id);
CREATE INDEX IF NOT EXISTS idx_notification_events_campaign ON public.notification_events (campaign_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_push_tokens_driver ON public.driver_push_tokens (driver_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_notification_automations_status ON public.notification_automations (status, next_run_at);

-- Audience estimation: active drivers matching target_spec JSON
CREATE OR REPLACE FUNCTION public.estimate_notification_audience(p_target_spec jsonb, p_exclusion_spec jsonb DEFAULT '{}'::jsonb)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text := coalesce(p_target_spec->>'mode', 'all');
  v_count int := 0;
BEGIN
  IF v_mode = 'all' THEN
    SELECT count(*)::int INTO v_count
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND d.status IN ('active', 'onboarding', 'suspended');
  ELSIF v_mode = 'zone' THEN
    SELECT count(*)::int INTO v_count
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND d.zone_id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'zone_ids', '[]'::jsonb))::uuid
      );
  ELSIF v_mode = 'partner' THEN
    SELECT count(*)::int INTO v_count
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND d.partner_id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'partner_ids', '[]'::jsonb))::uuid
      );
  ELSIF v_mode = 'status' THEN
    SELECT count(*)::int INTO v_count
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND d.status::text = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'statuses', '[]'::jsonb))
      );
  ELSIF v_mode = 'custom' THEN
    SELECT count(*)::int INTO v_count
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND d.id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'driver_ids', '[]'::jsonb))::uuid
      );
  ELSE
    SELECT count(*)::int INTO v_count
    FROM public.drivers d
    WHERE d.archived_at IS NULL;
  END IF;

  IF coalesce(jsonb_array_length(p_exclusion_spec->'driver_ids'), 0) > 0 THEN
    v_count := greatest(
      0,
      v_count - (
        SELECT count(*)::int
        FROM public.drivers d
        WHERE d.id = ANY (
          SELECT jsonb_array_elements_text(p_exclusion_spec->'driver_ids')::uuid
        )
      )
    );
  END IF;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.compile_notification_audience(
  p_campaign_id uuid,
  p_target_spec jsonb,
  p_exclusion_spec jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot_id uuid;
  v_mode text := coalesce(p_target_spec->>'mode', 'all');
  v_ids uuid[];
BEGIN
  IF v_mode = 'all' THEN
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND d.status IN ('active', 'onboarding', 'suspended');
  ELSIF v_mode = 'zone' THEN
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND d.zone_id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'zone_ids', '[]'::jsonb))::uuid
      );
  ELSIF v_mode = 'partner' THEN
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND d.partner_id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'partner_ids', '[]'::jsonb))::uuid
      );
  ELSIF v_mode = 'status' THEN
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND d.status::text = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'statuses', '[]'::jsonb))
      );
  ELSIF v_mode = 'custom' THEN
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND d.id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'driver_ids', '[]'::jsonb))::uuid
      );
  ELSE
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL;
  END IF;

  v_ids := coalesce(v_ids, '{}');

  IF coalesce(jsonb_array_length(p_exclusion_spec->'driver_ids'), 0) > 0 THEN
    v_ids := array(
      SELECT unnest(v_ids)
      EXCEPT
      SELECT jsonb_array_elements_text(p_exclusion_spec->'driver_ids')::uuid
    );
  END IF;

  INSERT INTO public.notification_audience_snapshots (
    campaign_id,
    target_spec,
    exclusion_spec,
    recipient_ids,
    recipient_count
  ) VALUES (
    p_campaign_id,
    p_target_spec,
    p_exclusion_spec,
    v_ids,
    coalesce(array_length(v_ids, 1), 0)
  )
  RETURNING id INTO v_snapshot_id;

  UPDATE public.notification_campaigns
  SET estimated_audience_count = coalesce(array_length(v_ids, 1), 0),
      updated_at = now()
  WHERE id = p_campaign_id;

  RETURN v_snapshot_id;
END;
$$;

ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_audience_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_dispatch_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_dispatch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_dedup_keys ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'notification_templates',
    'notification_campaigns',
    'notification_audience_snapshots',
    'notification_dispatch_runs',
    'notification_dispatch_items',
    'notification_events',
    'notification_automations',
    'notification_automation_runs',
    'notification_dedup_keys'
  ] LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I;
       CREATE POLICY %I ON public.%I FOR ALL USING (public.is_admin_panel_user()) WITH CHECK (public.is_admin_panel_user());',
      t || '_admin_all',
      t,
      t || '_admin_all',
      t
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS driver_push_tokens_admin_all ON public.driver_push_tokens;
CREATE POLICY driver_push_tokens_admin_all ON public.driver_push_tokens
  FOR ALL USING (public.is_admin_panel_user()) WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS driver_push_tokens_rider_own ON public.driver_push_tokens;
CREATE POLICY driver_push_tokens_rider_own ON public.driver_push_tokens
  FOR ALL USING (auth.uid() = driver_id) WITH CHECK (auth.uid() = driver_id);

-- New permissions
INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('notifications.approve', 'Approve notifications', 'notifications'),
  ('notifications.send', 'Send notifications', 'notifications'),
  ('notifications.export', 'Export notification reports', 'notifications')
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
CROSS JOIN public.admin_permissions p
WHERE r.slug = 'super_admin'
  AND p.slug IN ('notifications.approve', 'notifications.send', 'notifications.export')
ON CONFLICT DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
JOIN public.admin_permissions p ON p.slug IN ('notifications.manage', 'notifications.send', 'notifications.export')
WHERE r.slug = 'administrator'
ON CONFLICT DO NOTHING;
