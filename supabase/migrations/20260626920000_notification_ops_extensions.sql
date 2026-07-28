-- Notification Center ops: remote config, daily analytics rollup, mobile event ingestion

CREATE TABLE IF NOT EXISTS public.notification_remote_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  global_enabled boolean NOT NULL DEFAULT true,
  emergency_gate_enabled boolean NOT NULL DEFAULT true,
  category_throttles jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.notification_remote_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.notification_analytics_daily (
  metric_date date NOT NULL,
  campaign_id uuid NOT NULL REFERENCES public.notification_campaigns(id) ON DELETE CASCADE,
  sent_count int NOT NULL DEFAULT 0,
  delivered_count int NOT NULL DEFAULT 0,
  opened_count int NOT NULL DEFAULT 0,
  clicked_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_date, campaign_id)
);

CREATE OR REPLACE FUNCTION public.record_notification_client_event(
  p_campaign_id uuid,
  p_dispatch_item_id uuid,
  p_event_type text,
  p_event_at timestamptz DEFAULT now(),
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
  v_run_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_event_type NOT IN ('delivered', 'opened', 'clicked', 'failed', 'token_invalid') THEN
    RAISE EXCEPTION 'invalid_event_type';
  END IF;

  SELECT driver_id, run_id
  INTO v_driver_id, v_run_id
  FROM public.notification_dispatch_items
  WHERE id = p_dispatch_item_id
    AND campaign_id = p_campaign_id;

  IF v_driver_id IS NULL OR v_driver_id <> auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  INSERT INTO public.notification_events (
    campaign_id,
    run_id,
    dispatch_item_id,
    driver_id,
    event_type,
    metadata,
    occurred_at
  ) VALUES (
    p_campaign_id,
    v_run_id,
    p_dispatch_item_id,
    v_driver_id,
    p_event_type::public.notification_event_type,
    p_metadata,
    p_event_at
  );

  UPDATE public.notification_dispatch_items
  SET
    delivered_at = CASE WHEN p_event_type = 'delivered' THEN p_event_at ELSE delivered_at END,
    opened_at = CASE WHEN p_event_type = 'opened' THEN p_event_at ELSE opened_at END,
    clicked_at = CASE WHEN p_event_type = 'clicked' THEN p_event_at ELSE clicked_at END,
    status = CASE
      WHEN p_event_type = 'clicked' THEN 'clicked'::public.notification_dispatch_item_status
      WHEN p_event_type = 'opened' THEN 'opened'::public.notification_dispatch_item_status
      WHEN p_event_type = 'delivered' THEN 'delivered'::public.notification_dispatch_item_status
      ELSE status
    END,
    updated_at = now()
  WHERE id = p_dispatch_item_id;

  UPDATE public.notification_campaigns c
  SET
    delivered_count = (
      SELECT count(*) FROM public.notification_dispatch_items i
      WHERE i.campaign_id = c.id AND i.delivered_at IS NOT NULL
    ),
    opened_count = (
      SELECT count(*) FROM public.notification_dispatch_items i
      WHERE i.campaign_id = c.id AND i.opened_at IS NOT NULL
    ),
    clicked_count = (
      SELECT count(*) FROM public.notification_dispatch_items i
      WHERE i.campaign_id = c.id AND i.clicked_at IS NOT NULL
    ),
    status = CASE
      WHEN p_event_type = 'clicked' THEN 'clicked'::public.notification_campaign_status
      WHEN p_event_type = 'opened' THEN 'opened'::public.notification_campaign_status
      WHEN p_event_type = 'delivered' THEN 'delivered'::public.notification_campaign_status
      ELSE c.status
    END,
    updated_at = now()
  WHERE c.id = p_campaign_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_notification_client_event(uuid, uuid, text, timestamptz, jsonb)
  TO authenticated;

ALTER TABLE public.notification_remote_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_analytics_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_remote_config_admin_all ON public.notification_remote_config;
CREATE POLICY notification_remote_config_admin_all ON public.notification_remote_config
  FOR ALL USING (public.is_admin_panel_user()) WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS notification_analytics_daily_admin_all ON public.notification_analytics_daily;
CREATE POLICY notification_analytics_daily_admin_all ON public.notification_analytics_daily
  FOR ALL USING (public.is_admin_panel_user()) WITH CHECK (public.is_admin_panel_user());
