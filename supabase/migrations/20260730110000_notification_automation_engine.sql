-- Notification automation event queue + helpers for trigger execution.

CREATE TABLE IF NOT EXISTS public.notification_automation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type public.notification_automation_trigger NOT NULL,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_automation_events_pending_idx
  ON public.notification_automation_events (created_at)
  WHERE processed_at IS NULL;

ALTER TABLE public.notification_automation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_automation_events_admin ON public.notification_automation_events;
CREATE POLICY notification_automation_events_admin
  ON public.notification_automation_events
  FOR ALL
  TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

CREATE OR REPLACE FUNCTION public.enqueue_notification_automation_event(
  p_trigger_type public.notification_automation_trigger,
  p_driver_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.notification_automation_events (trigger_type, driver_id, payload)
  VALUES (p_trigger_type, p_driver_id, coalesce(p_payload, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_notification_automation_event(public.notification_automation_trigger, uuid, jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.compile_notification_audience_ids(
  p_target_spec jsonb,
  p_exclusion_spec jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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

  IF v_ids IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  IF coalesce(jsonb_array_length(coalesce(p_exclusion_spec->'driver_ids', '[]'::jsonb)), 0) > 0 THEN
    v_ids := array(
      SELECT unnest(v_ids)
      EXCEPT
      SELECT jsonb_array_elements_text(p_exclusion_spec->'driver_ids')::uuid
    );
  END IF;

  RETURN coalesce(v_ids, ARRAY[]::uuid[]);
END;
$$;

GRANT EXECUTE ON FUNCTION public.compile_notification_audience_ids(jsonb, jsonb) TO service_role;
