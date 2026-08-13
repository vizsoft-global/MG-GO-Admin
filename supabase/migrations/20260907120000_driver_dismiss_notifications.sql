-- Rider inbox can hide notifications without deleting dispatch rows (admin
-- analytics / engagement stay intact). Soft-dismiss via dismissed_at.

ALTER TABLE public.notification_dispatch_items
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

COMMENT ON COLUMN public.notification_dispatch_items.dismissed_at IS
  'Set when the rider clears the row from their inbox. NULL = still visible.';

CREATE INDEX IF NOT EXISTS notification_dispatch_items_driver_inbox_idx
  ON public.notification_dispatch_items (driver_id, created_at DESC)
  WHERE dismissed_at IS NULL;

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
      AND i.dismissed_at IS NULL
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
    AND i.dismissed_at IS NULL
    AND i.opened_at IS NULL;

  RETURN jsonb_build_object(
    'items', v_items,
    'unread_count', v_unread
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_notifications_unread_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.notification_dispatch_items i
  WHERE i.driver_id = auth.uid()
    AND i.dismissed_at IS NULL
    AND i.opened_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.driver_dismiss_notifications(
  p_dispatch_item_ids uuid[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_updated integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE public.notification_dispatch_items i
  SET
    dismissed_at = v_now,
    updated_at = v_now
  WHERE i.driver_id = v_uid
    AND i.dismissed_at IS NULL
    AND (p_dispatch_item_ids IS NULL OR i.id = ANY (p_dispatch_item_ids));

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.driver_dismiss_notifications(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_dismiss_notifications(uuid[]) TO authenticated;
