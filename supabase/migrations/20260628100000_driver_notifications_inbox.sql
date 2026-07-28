-- Rider-facing notification inbox: list and "mark as opened" RPCs.
--
-- Drivers cannot read `notification_dispatch_items` / `notification_campaigns`
-- directly (admin-only RLS), so expose a SECURITY DEFINER function that
-- returns the rows scoped to the calling rider (`auth.uid()`).

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
      c.title,
      c.body,
      c.category::text  AS category,
      c.priority::text  AS priority,
      c.action_type::text AS action_type,
      c.action_params,
      c.media,
      c.payload_version
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

-- Convenience: unread count only (cheap; called frequently).
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
    AND i.opened_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.driver_notifications_unread_count() TO authenticated;

-- Bulk mark-as-read for the driver's own dispatch items.
CREATE OR REPLACE FUNCTION public.driver_mark_notifications_read(
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

  WITH updated AS (
    UPDATE public.notification_dispatch_items i
    SET
      opened_at = COALESCE(i.opened_at, v_now),
      status = CASE
        WHEN i.opened_at IS NULL THEN 'opened'::public.notification_dispatch_item_status
        ELSE i.status
      END,
      updated_at = v_now
    WHERE i.driver_id = v_uid
      AND i.opened_at IS NULL
      AND (p_dispatch_item_ids IS NULL OR i.id = ANY (p_dispatch_item_ids))
    RETURNING i.id, i.campaign_id
  ),
  events_inserted AS (
    INSERT INTO public.notification_events (
      campaign_id,
      dispatch_item_id,
      driver_id,
      event_type,
      provider,
      occurred_at,
      metadata
    )
    SELECT
      u.campaign_id,
      u.id,
      v_uid,
      'opened'::public.notification_event_type,
      'fcm',
      v_now,
      jsonb_build_object('source', 'inbox')
    FROM updated u
    RETURNING 1
  )
  SELECT count(*) INTO v_updated FROM updated;

  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_mark_notifications_read(uuid[]) TO authenticated;
