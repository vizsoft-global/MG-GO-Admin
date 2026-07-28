-- Driver app version tracking + admin adoption analytics for sideload releases.

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS current_app_platform text,
  ADD COLUMN IF NOT EXISTS current_app_channel text,
  ADD COLUMN IF NOT EXISTS current_app_version_name text,
  ADD COLUMN IF NOT EXISTS current_app_version_code integer,
  ADD COLUMN IF NOT EXISTS app_version_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS drivers_current_version_code_idx
  ON public.drivers (current_app_platform, current_app_channel, current_app_version_code);

CREATE TABLE IF NOT EXISTS public.driver_app_version_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  platform text NOT NULL,
  channel text,
  version_name text,
  version_code integer NOT NULL CHECK (version_code > 0),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_app_version_history_driver_idx
  ON public.driver_app_version_history (driver_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS driver_app_version_history_version_idx
  ON public.driver_app_version_history (platform, channel, version_code, changed_at DESC);

COMMENT ON TABLE public.driver_app_version_history IS
  'Append-only log when a driver reports a new app version_code.';

ALTER TABLE public.driver_app_version_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_app_version_history_admin_select ON public.driver_app_version_history;
CREATE POLICY driver_app_version_history_admin_select ON public.driver_app_version_history
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

CREATE OR REPLACE FUNCTION public.driver_record_app_version(
  p_platform text DEFAULT 'android',
  p_channel text DEFAULT 'production',
  p_version_name text DEFAULT NULL,
  p_version_code integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid := auth.uid();
  v_prev_code integer;
BEGIN
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_rider() THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;

  IF p_platform IS DISTINCT FROM 'android' THEN
    RAISE EXCEPTION 'unsupported_platform';
  END IF;

  IF p_channel NOT IN ('production', 'beta', 'internal') THEN
    RAISE EXCEPTION 'invalid_channel';
  END IF;

  IF p_version_code IS NULL OR p_version_code <= 0 THEN
    RETURN;
  END IF;

  SELECT d.current_app_version_code
  INTO v_prev_code
  FROM public.drivers d
  WHERE d.id = v_driver_id;

  UPDATE public.drivers
  SET
    current_app_platform = p_platform,
    current_app_channel = p_channel,
    current_app_version_name = NULLIF(btrim(p_version_name), ''),
    current_app_version_code = p_version_code,
    app_version_seen_at = now(),
    updated_at = now()
  WHERE id = v_driver_id;

  IF v_prev_code IS DISTINCT FROM p_version_code THEN
    INSERT INTO public.driver_app_version_history (
      driver_id,
      platform,
      channel,
      version_name,
      version_code
    )
    VALUES (
      v_driver_id,
      p_platform,
      p_channel,
      NULLIF(btrim(p_version_name), ''),
      p_version_code
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_app_release_adoption(
  p_platform text DEFAULT 'android',
  p_channel text DEFAULT 'production'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer;
  v_items jsonb := '[]'::jsonb;
  v_active_code integer;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_platform IS DISTINCT FROM 'android' THEN
    RAISE EXCEPTION 'unsupported_platform';
  END IF;

  IF p_channel NOT IN ('production', 'beta', 'internal') THEN
    RAISE EXCEPTION 'invalid_channel';
  END IF;

  SELECT r.version_code
  INTO v_active_code
  FROM public.app_releases r
  WHERE r.platform = p_platform
    AND r.channel = p_channel
    AND r.is_active = true
  LIMIT 1;

  SELECT COUNT(*)::integer
  INTO v_total
  FROM public.drivers d
  WHERE d.archived_at IS NULL;

  WITH version_counts AS (
    SELECT
      d.current_app_version_code AS version_code,
      MAX(d.current_app_version_name) AS version_name,
      COUNT(*)::integer AS driver_count
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND d.current_app_platform = p_platform
      AND d.current_app_channel = p_channel
      AND d.current_app_version_code IS NOT NULL
    GROUP BY d.current_app_version_code
  ),
  known AS (
    SELECT
      vc.version_code,
      COALESCE(
        (SELECT r.version_name FROM public.app_releases r
         WHERE r.platform = p_platform AND r.channel = p_channel
           AND r.version_code = vc.version_code
         ORDER BY r.released_at DESC LIMIT 1),
        vc.version_name,
        vc.version_code::text
      ) AS version_name,
      vc.driver_count,
      CASE WHEN v_total > 0
        THEN round((vc.driver_count::numeric / v_total::numeric) * 100, 1)
        ELSE 0
      END AS percent,
      (vc.version_code = v_active_code) AS is_active,
      EXISTS (
        SELECT 1 FROM public.app_releases r
        WHERE r.platform = p_platform
          AND r.channel = p_channel
          AND r.version_code = vc.version_code
      ) AS is_known_release
    FROM version_counts vc
  ),
  unknown AS (
    SELECT
      NULL::integer AS version_code,
      'unknown'::text AS version_name,
      COUNT(*)::integer AS driver_count,
      CASE WHEN v_total > 0
        THEN round((COUNT(*)::numeric / v_total::numeric) * 100, 1)
        ELSE 0
      END AS percent,
      false AS is_active,
      false AS is_known_release
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND (
        d.current_app_version_code IS NULL
        OR d.current_app_platform IS DISTINCT FROM p_platform
        OR d.current_app_channel IS DISTINCT FROM p_channel
      )
    HAVING COUNT(*) > 0
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'version_code', row.version_code,
        'version_name', row.version_name,
        'driver_count', row.driver_count,
        'percent', row.percent,
        'is_active', row.is_active,
        'is_known_release', row.is_known_release
      )
      ORDER BY row.version_code DESC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM (
    SELECT * FROM known
    UNION ALL
    SELECT * FROM unknown
  ) row;

  RETURN jsonb_build_object(
    'total_drivers', v_total,
    'active_version_code', v_active_code,
    'items', v_items
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_app_release_drivers(
  p_platform text DEFAULT 'android',
  p_channel text DEFAULT 'production',
  p_version_code integer DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_search text := NULLIF(btrim(p_search), '');
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_platform IS DISTINCT FROM 'android' THEN
    RAISE EXCEPTION 'unsupported_platform';
  END IF;

  IF p_channel NOT IN ('production', 'beta', 'internal') THEN
    RAISE EXCEPTION 'invalid_channel';
  END IF;

  p_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  p_offset := GREATEST(COALESCE(p_offset, 0), 0);

  WITH filtered AS (
    SELECT
      d.id AS driver_id,
      d.driver_code,
      p.full_name,
      (
        SELECT di.phone
        FROM public.driver_intakes di
        WHERE di.linked_profile_id = d.id
        ORDER BY di.created_at DESC
        LIMIT 1
      ) AS phone,
      pt.name AS partner_name,
      d.current_app_version_name AS version_name,
      d.current_app_version_code AS version_code,
      d.app_version_seen_at
    FROM public.drivers d
    INNER JOIN public.profiles p ON p.id = d.id
    LEFT JOIN public.partners pt ON pt.id = d.partner_id
    WHERE d.archived_at IS NULL
      AND (
        (p_version_code IS NULL AND (
          d.current_app_version_code IS NULL
          OR d.current_app_platform IS DISTINCT FROM p_platform
          OR d.current_app_channel IS DISTINCT FROM p_channel
        ))
        OR (
          p_version_code IS NOT NULL
          AND d.current_app_platform = p_platform
          AND d.current_app_channel = p_channel
          AND d.current_app_version_code = p_version_code
        )
      )
      AND (
        v_search IS NULL
        OR d.driver_code ILIKE '%' || v_search || '%'
        OR p.full_name ILIKE '%' || v_search || '%'
        OR EXISTS (
          SELECT 1 FROM public.driver_intakes di
          WHERE di.linked_profile_id = d.id
            AND di.phone ILIKE '%' || v_search || '%'
        )
      )
  ),
  totals AS (
    SELECT COUNT(*)::integer AS total FROM filtered
  ),
  paged AS (
    SELECT *
    FROM filtered
    ORDER BY app_version_seen_at DESC NULLS LAST, driver_code ASC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    (SELECT total FROM totals),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'driver_id', pg.driver_id,
            'driver_code', pg.driver_code,
            'full_name', pg.full_name,
            'phone', pg.phone,
            'partner_name', pg.partner_name,
            'version_name', pg.version_name,
            'version_code', pg.version_code,
            'app_version_seen_at', pg.app_version_seen_at
          )
          ORDER BY pg.app_version_seen_at DESC NULLS LAST, pg.driver_code ASC
        )
        FROM paged pg
      ),
      '[]'::jsonb
    )
  INTO v_total, v_items;

  RETURN jsonb_build_object(
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset,
    'items', v_items
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_record_app_version(text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_app_release_adoption(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_app_release_drivers(text, text, integer, text, integer, integer) TO authenticated;
