-- Fix audience RPCs: driver_status enum is (active, pending, suspended) — not onboarding.

CREATE OR REPLACE FUNCTION public.estimate_notification_audience(
  p_target_spec jsonb,
  p_exclusion_spec jsonb DEFAULT '{}'::jsonb
)
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
      AND NOT d.is_blocked
      AND d.status IN (
        'active'::public.driver_status,
        'pending'::public.driver_status,
        'suspended'::public.driver_status
      );
  ELSIF v_mode = 'zone' THEN
    SELECT count(*)::int INTO v_count
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.zone_id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'zone_ids', '[]'::jsonb))::uuid
      );
  ELSIF v_mode = 'partner' THEN
    SELECT count(*)::int INTO v_count
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.partner_id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'partner_ids', '[]'::jsonb))::uuid
      );
  ELSIF v_mode = 'status' THEN
    SELECT count(*)::int INTO v_count
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.status::text = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'statuses', '[]'::jsonb))
      );
  ELSIF v_mode = 'custom' THEN
    SELECT count(*)::int INTO v_count
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'driver_ids', '[]'::jsonb))::uuid
      );
  ELSE
    SELECT count(*)::int INTO v_count
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked;
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
      AND NOT d.is_blocked
      AND d.status IN (
        'active'::public.driver_status,
        'pending'::public.driver_status,
        'suspended'::public.driver_status
      );
  ELSIF v_mode = 'zone' THEN
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.zone_id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'zone_ids', '[]'::jsonb))::uuid
      );
  ELSIF v_mode = 'partner' THEN
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.partner_id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'partner_ids', '[]'::jsonb))::uuid
      );
  ELSIF v_mode = 'status' THEN
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.status::text = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'statuses', '[]'::jsonb))
      );
  ELSIF v_mode = 'custom' THEN
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'driver_ids', '[]'::jsonb))::uuid
      );
  ELSE
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked;
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

GRANT EXECUTE ON FUNCTION public.estimate_notification_audience(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compile_notification_audience(uuid, jsonb, jsonb) TO authenticated;
