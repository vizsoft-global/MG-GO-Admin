-- Screenshot restriction for sensitive notifications (template default + campaign override/stamp).

ALTER TABLE public.notification_templates
  ADD COLUMN IF NOT EXISTS screenshot_restricted boolean NOT NULL DEFAULT false;

ALTER TABLE public.notification_campaigns
  ADD COLUMN IF NOT EXISTS screenshot_restricted_override boolean NULL,
  ADD COLUMN IF NOT EXISTS screenshot_restricted boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'notification_event_type'
      AND e.enumlabel = 'screenshot_taken'
  ) THEN
    ALTER TYPE public.notification_event_type ADD VALUE 'screenshot_taken';
  END IF;
END;
$$;

COMMENT ON COLUMN public.notification_templates.screenshot_restricted IS
  'Default: notifications created from this template are screenshot-restricted unless campaign overrides.';
COMMENT ON COLUMN public.notification_campaigns.screenshot_restricted_override IS
  'Tri-state: NULL=inherit template, true=force on, false=force off.';
COMMENT ON COLUMN public.notification_campaigns.screenshot_restricted IS
  'Resolved stamp sent to driver app (FCM + inbox). Immutable after send.';

-- Client events: allow screenshot_taken without advancing delivery lifecycle.
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

  IF p_event_type NOT IN (
    'delivered',
    'opened',
    'clicked',
    'failed',
    'token_invalid',
    'screenshot_taken'
  ) THEN
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

  -- Lifecycle updates only for delivery funnel events (not screenshot_taken).
  IF p_event_type IN ('delivered', 'opened', 'clicked', 'failed', 'token_invalid') THEN
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
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_notification_client_event(uuid, uuid, text, timestamptz, jsonb)
  TO authenticated;

-- Driver inbox: include resolved screenshot_restricted stamp.
CREATE OR REPLACE FUNCTION public.driver_list_notifications(
  p_limit integer DEFAULT 50,
  p_before timestamptz DEFAULT NULL,
  p_unread_only boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer;
  v_items jsonb;
  v_unread integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_limit := greatest(1, least(coalesce(p_limit, 50), 100));

  WITH rows AS (
    SELECT
      i.id              AS dispatch_item_id,
      i.campaign_id     AS campaign_id,
      i.delivered_at,
      i.opened_at,
      i.clicked_at,
      i.created_at      AS received_at,
      coalesce(i.resolved_title, c.title) AS title,
      coalesce(i.resolved_body, c.body) AS body,
      c.category::text  AS category,
      c.priority::text  AS priority,
      c.action_type::text AS action_type,
      c.action_params,
      c.media,
      c.payload_version,
      c.screenshot_restricted
    FROM public.notification_dispatch_items i
    INNER JOIN public.notification_campaigns c ON c.id = i.campaign_id
    WHERE i.driver_id = v_uid
      AND (p_before IS NULL OR i.created_at < p_before)
      AND (NOT p_unread_only OR i.opened_at IS NULL)
    ORDER BY i.created_at DESC
    LIMIT v_limit
  )
  SELECT coalesce(jsonb_agg(to_jsonb(rows.*)), '[]'::jsonb)
  INTO v_items
  FROM rows;

  SELECT count(*)::int
  INTO v_unread
  FROM public.notification_dispatch_items i
  WHERE i.driver_id = v_uid
    AND i.opened_at IS NULL;

  RETURN jsonb_build_object(
    'items', v_items,
    'unread_count', v_unread
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_list_notifications(integer, timestamptz, boolean) TO authenticated;
