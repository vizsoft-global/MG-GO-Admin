-- Restaurant and zone Daily DPD cards, one per active target.
--
-- `daily_dpd` stays the single object older builds already read. This adds
-- `daily_dpd_targets` (kind restaurant | zone only) and `rider_setup` on
-- `driver_get_extra_earnings`. A company scheme does not become a DPD card;
-- it stays on `company_scheme`.
--
-- A restaurant card exists only when that assigned restaurant has its own
-- restaurant-scoped `delivery_rules.dpd_target`. A zone card exists only when
-- the rider's `drivers.zone_id` has a zone-scoped target. The zone fallback
-- inside `_restaurant_daily_dpd_target` is not reused here, because that
-- would label a zone target with a restaurant name.
--
-- Counts follow the existing day: verified for `completed_today`, and
-- in_transit / pending / under_review / verified for `progress_today`.
-- Cancelled and rejected are outside both sets. The day is
-- `COALESCE(shift_date, Asia/Kuwait date)`.
--
-- The return object is patched from the live function body so later
-- offer-flag edits are not retyped. Not applied in this change.

CREATE OR REPLACE FUNCTION public._driver_daily_dpd_targets(
  p_driver_id uuid,
  p_on_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone_id uuid;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_cards jsonb := '[]'::jsonb;
  v_row record;
  v_completed int;
  v_progress int;
  v_zone_name text;
  v_zone_target int;
BEGIN
  IF p_driver_id IS NULL OR p_on_date IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  v_day_start := (p_on_date::timestamp AT TIME ZONE 'Asia/Kuwait');
  v_day_end := ((p_on_date + 1)::timestamp AT TIME ZONE 'Asia/Kuwait');

  SELECT d.zone_id INTO v_zone_id
  FROM public.drivers d
  WHERE d.id = p_driver_id;

  FOR v_row IN
    WITH assigned AS (
      SELECT drs.restaurant_id
      FROM public.driver_restaurants drs
      WHERE drs.driver_id = p_driver_id
      UNION
      SELECT d.restaurant_id
      FROM public.drivers d
      WHERE d.id = p_driver_id
        AND d.restaurant_id IS NOT NULL
    )
    SELECT a.restaurant_id, r.name, ceil(rule.dpd_target)::int AS target
    FROM assigned a
    JOIN public.restaurants r ON r.id = a.restaurant_id
    JOIN LATERAL (
      SELECT dr.dpd_target
      FROM (
        SELECT dr.dpd_target, dr.priority, dr.created_at
        FROM public.delivery_rules dr
        JOIN public.delivery_rule_scopes s ON s.delivery_rule_id = dr.id
        WHERE s.restaurant_id = a.restaurant_id
          AND dr.status = 'active'
          AND dr.scope_type = 'restaurant'
          AND dr.dpd_target > 0
          AND (dr.dpd_period IS NULL OR dr.dpd_period = 'daily')
          AND p_on_date BETWEEN dr.start_date AND dr.end_date
        UNION ALL
        SELECT dr.dpd_target, dr.priority, dr.created_at
        FROM public.delivery_rules dr
        WHERE dr.restaurant_id = a.restaurant_id
          AND dr.status = 'active'
          AND dr.scope_type = 'restaurant'
          AND dr.dpd_target > 0
          AND (dr.dpd_period IS NULL OR dr.dpd_period = 'daily')
          AND p_on_date BETWEEN dr.start_date AND dr.end_date
      ) dr
      ORDER BY dr.priority DESC, dr.created_at ASC
      LIMIT 1
    ) rule ON true
    ORDER BY r.name
  LOOP
    SELECT count(*)::int INTO v_completed
    FROM public.deliveries d
    WHERE d.driver_id = p_driver_id
      AND d.restaurant_id = v_row.restaurant_id
      AND d.status = 'verified'
      AND (
        d.shift_date = p_on_date
        OR (
          d.shift_date IS NULL
          AND d.delivered_at >= v_day_start
          AND d.delivered_at < v_day_end
        )
      );

    SELECT count(*)::int INTO v_progress
    FROM public.deliveries d
    WHERE d.driver_id = p_driver_id
      AND d.restaurant_id = v_row.restaurant_id
      AND d.status IN ('in_transit', 'pending', 'under_review', 'verified')
      AND (
        d.shift_date = p_on_date
        OR (
          d.shift_date IS NULL
          AND (
            (d.delivered_at >= v_day_start AND d.delivered_at < v_day_end)
            OR (
              d.delivered_at IS NULL
              AND d.pickup_at >= v_day_start
              AND d.pickup_at < v_day_end
            )
          )
        )
      );

    v_cards := v_cards || jsonb_build_array(jsonb_build_object(
      'kind', 'restaurant',
      'name', v_row.name,
      'target', v_row.target,
      'completed_today', COALESCE(v_completed, 0),
      'progress_today', COALESCE(v_progress, 0)
    ));
  END LOOP;

  IF v_zone_id IS NOT NULL THEN
    SELECT z.name, ceil(rule.dpd_target)::int
    INTO v_zone_name, v_zone_target
    FROM public.zones z
    JOIN LATERAL (
      SELECT dr.dpd_target
      FROM (
        SELECT dr.dpd_target, dr.priority, dr.created_at
        FROM public.delivery_rules dr
        JOIN public.delivery_rule_scopes s ON s.delivery_rule_id = dr.id
        WHERE s.zone_id = z.id
          AND dr.status = 'active'
          AND dr.scope_type = 'zone'
          AND dr.dpd_target > 0
          AND (dr.dpd_period IS NULL OR dr.dpd_period = 'daily')
          AND p_on_date BETWEEN dr.start_date AND dr.end_date
        UNION ALL
        SELECT dr.dpd_target, dr.priority, dr.created_at
        FROM public.delivery_rules dr
        WHERE dr.zone_id = z.id
          AND dr.status = 'active'
          AND dr.scope_type = 'zone'
          AND dr.dpd_target > 0
          AND (dr.dpd_period IS NULL OR dr.dpd_period = 'daily')
          AND p_on_date BETWEEN dr.start_date AND dr.end_date
      ) dr
      ORDER BY dr.priority DESC, dr.created_at ASC
      LIMIT 1
    ) rule ON true
    WHERE z.id = v_zone_id;

    IF v_zone_target IS NOT NULL AND v_zone_target > 0 THEN
      SELECT count(*)::int INTO v_completed
      FROM public.deliveries d
      LEFT JOIN public.restaurants r ON r.id = d.restaurant_id
      WHERE d.driver_id = p_driver_id
        AND COALESCE(d.zone_id, r.zone_id) = v_zone_id
        AND d.status = 'verified'
        AND (
          d.shift_date = p_on_date
          OR (
            d.shift_date IS NULL
            AND d.delivered_at >= v_day_start
            AND d.delivered_at < v_day_end
          )
        );

      SELECT count(*)::int INTO v_progress
      FROM public.deliveries d
      LEFT JOIN public.restaurants r ON r.id = d.restaurant_id
      WHERE d.driver_id = p_driver_id
        AND COALESCE(d.zone_id, r.zone_id) = v_zone_id
        AND d.status IN ('in_transit', 'pending', 'under_review', 'verified')
        AND (
          d.shift_date = p_on_date
          OR (
            d.shift_date IS NULL
            AND (
              (d.delivered_at >= v_day_start AND d.delivered_at < v_day_end)
              OR (
                d.delivered_at IS NULL
                AND d.pickup_at >= v_day_start
                AND d.pickup_at < v_day_end
              )
            )
          )
        );

      v_cards := v_cards || jsonb_build_array(jsonb_build_object(
        'kind', 'zone',
        'name', v_zone_name,
        'target', v_zone_target,
        'completed_today', COALESCE(v_completed, 0),
        'progress_today', COALESCE(v_progress, 0)
      ));
    END IF;
  END IF;

  RETURN v_cards;
END;
$$;

CREATE OR REPLACE FUNCTION public._driver_incentive_rider_setup(p_driver_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'project_key', d.project_key,
    'rider_category', d.rider_category::text,
    'company_name', NULLIF(btrim(sc.name), '')
  )
  FROM public.drivers d
  LEFT JOIN public.source_companies sc ON sc.key = d.source_company
  WHERE d.id = p_driver_id;
$$;

REVOKE ALL ON FUNCTION public._driver_daily_dpd_targets(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._driver_incentive_rider_setup(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._driver_daily_dpd_targets(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public._driver_incentive_rider_setup(uuid) TO service_role;

DO $$
DECLARE
  v_def text;
  v_needle text;
  v_n int;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_def
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'driver_get_extra_earnings';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'daily dpd targets: public.driver_get_extra_earnings not found';
  END IF;

  v_needle := '    ''daily_dpd'', public._driver_daily_dpd_state(v_driver_id, v_today),';
  v_n := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'daily dpd targets: expected 1 daily_dpd return line, found %', v_n;
  END IF;

  v_def := replace(
    v_def,
    v_needle,
    '    ''daily_dpd'', public._driver_daily_dpd_state(v_driver_id, v_today),' || chr(10) ||
    '    ''daily_dpd_targets'', public._driver_daily_dpd_targets(v_driver_id, v_today),' || chr(10) ||
    '    ''rider_setup'', public._driver_incentive_rider_setup(v_driver_id),'
  );

  EXECUTE v_def;
END;
$$;

REVOKE ALL ON FUNCTION public.driver_get_extra_earnings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_get_extra_earnings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_get_extra_earnings() TO service_role;
