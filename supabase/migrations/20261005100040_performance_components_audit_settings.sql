-- The component save is audited, and the audit was only half the change.
--
-- admin_update_performance_components already returned before/after for the
-- component weights, but the same call also writes the SLA minutes and the
-- overspeed allowance — and those move every score exactly as much as a weight
-- does. An audit entry that records the weights and silently drops the SLA is
-- worse than none: it reads as a complete record of a save that was not.
--
-- Both snapshots are taken inside the same statement rather than by the caller
-- reading before and after, so a second admin saving concurrently cannot make
-- this entry describe a state that never existed.

CREATE OR REPLACE FUNCTION public.admin_update_performance_components(
  p_components jsonb,
  p_settings jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_item jsonb;
  v_key text;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT (
       public.staff_has_permission('settings.manage')
       OR public.staff_has_permission('attendance.manage')
     ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_before := public._performance_components_snapshot();

  IF p_components IS NOT NULL AND jsonb_typeof(p_components) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_components)
    LOOP
      v_key := v_item->>'key';

      IF NOT EXISTS (
        SELECT 1 FROM public.performance_score_components c WHERE c.key = v_key
      ) THEN
        RAISE EXCEPTION 'unknown_component';
      END IF;

      IF (v_item->>'weight') IS NOT NULL
         AND (v_item->>'weight')::numeric < 0 THEN
        RAISE EXCEPTION 'invalid_weight';
      END IF;

      UPDATE public.performance_score_components c
      SET
        weight = COALESCE((v_item->>'weight')::numeric, c.weight),
        is_active = COALESCE((v_item->>'is_active')::boolean, c.is_active),
        updated_at = now()
      WHERE c.key = v_key;
    END LOOP;
  END IF;

  IF p_settings IS NOT NULL THEN
    IF (p_settings->>'delivery_ontime_minutes') IS NOT NULL
       AND (p_settings->>'delivery_ontime_minutes')::integer <= 0 THEN
      RAISE EXCEPTION 'invalid_sla_minutes';
    END IF;

    UPDATE public.app_settings s
    SET
      delivery_ontime_minutes = COALESCE(
        (p_settings->>'delivery_ontime_minutes')::integer,
        s.delivery_ontime_minutes
      ),
      performance_speed_allowance_per_day = GREATEST(
        COALESCE(
          (p_settings->>'speed_allowance_per_day')::numeric,
          s.performance_speed_allowance_per_day
        ),
        0
      ),
      performance_conduct_allowance_per_day = GREATEST(
        COALESCE(
          (p_settings->>'conduct_allowance_per_day')::numeric,
          s.performance_conduct_allowance_per_day
        ),
        0
      )
    WHERE s.id = 1;
  END IF;

  v_after := public._performance_components_snapshot();

  RETURN jsonb_build_object('before', v_before, 'after', v_after);
END;
$$;

-- Declared after the function that calls it only for readability; plpgsql
-- resolves the reference at execution time, so ordering here is free.
CREATE OR REPLACE FUNCTION public._performance_components_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'components', COALESCE(
      (
        SELECT jsonb_object_agg(
          c.key,
          jsonb_build_object('weight', c.weight, 'is_active', c.is_active)
        )
        FROM public.performance_score_components c
      ),
      '{}'::jsonb
    ),
    'settings', COALESCE(
      (
        SELECT jsonb_build_object(
          'delivery_ontime_minutes', s.delivery_ontime_minutes,
          'speed_allowance_per_day', s.performance_speed_allowance_per_day,
          'conduct_allowance_per_day', s.performance_conduct_allowance_per_day
        )
        FROM public.app_settings s
        WHERE s.id = 1
      ),
      '{}'::jsonb
    )
  );
$$;

-- The snapshot helper is only ever called by the definer above, so it needs no
-- grant of its own. Stating the revoke anyway, because Postgres grants
-- PUBLIC EXECUTE by default and a future direct grant should be deliberate.
REVOKE ALL ON FUNCTION public._performance_components_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._performance_components_snapshot() FROM anon;
REVOKE ALL ON FUNCTION public._performance_components_snapshot() FROM authenticated;

REVOKE ALL ON FUNCTION public.admin_update_performance_components(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_performance_components(jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_update_performance_components(jsonb, jsonb) TO authenticated;
