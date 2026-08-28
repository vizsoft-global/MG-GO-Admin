-- In-depth attendance scoring: the compliance pillar stops being one crude
-- number and becomes a weighted blend of named, admin-configurable components.
--
-- What it replaces, and why it had to go. `v_attendance_daily.compliance_score`
-- is a flat 70 whenever the driver was late, otherwise online_seconds over
-- duty_seconds. That has two defects the client can see from the seat:
--
--   1. Lateness is a cliff. One minute past grace and ninety minutes past grace
--      both score exactly 70, so the number cannot rank the thing it measures.
--   2. Lateness is counted twice — once as the flat 70, and again as a
--      LateCheckIn row in v_attendance_exceptions which admin_list_driver_performance
--      subtracts at exception_penalty per row.
--
-- The components are a table rather than another key in the
-- performance_score_weights jsonb. Two editors of one jsonb is a data-loss path
-- that this repo has already paid for once: the attendance settings editor wrote
-- the whole object and would have silently zeroed `manual`.
--
-- Nothing here changes a score on its own. The scoring rewrite is the next
-- migration; this one only creates the tables it reads.

-- ---------------------------------------------------------------------------
-- Component catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.performance_score_components (
  -- Locked. SQL keys on this, so a rename would silently orphan a component.
  key text PRIMARY KEY,
  label_en text NOT NULL,
  label_ar text NOT NULL,
  -- Weight *within* the conduct blend, not within the overall score. The
  -- overall split stays in app_settings.performance_score_weights.
  weight numeric NOT NULL DEFAULT 1 CHECK (weight >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.performance_score_components IS
  'Weighted components blended into the compliance/conduct pillar of the DPD performance score.';
COMMENT ON COLUMN public.performance_score_components.weight IS
  'Weight within the conduct blend. A component with no measurable data for a driver is dropped and the remaining weights renormalise.';

-- `conduct` is seeded inactive: wrong_actions has no admin surface until Phase 3,
-- so an active component would score every driver against a table nobody can write.
INSERT INTO public.performance_score_components
  (key, label_en, label_ar, weight, sort_order, is_active)
VALUES
  ('punctuality', 'Shift adherence', 'الالتزام بالمناوبة', 1, 1, true),
  ('duty_ratio',  'Duty discipline', 'انضباط الدوام',      1, 2, true),
  ('on_time',     'Within SLA',      'ضمن المدة المحددة',  1, 3, true),
  ('speed',       'Speed discipline','الالتزام بالسرعة',   1, 4, true),
  ('zone',        'Zone discipline', 'الالتزام بالمنطقة',  1, 5, true),
  ('gps',         'GPS availability','توفر نظام التتبع',   1, 6, true),
  ('conduct',     'Conduct',         'السلوك',             1, 7, false)
ON CONFLICT (key) DO UPDATE SET
  label_en = EXCLUDED.label_en,
  label_ar = EXCLUDED.label_ar,
  sort_order = EXCLUDED.sort_order;

-- ---------------------------------------------------------------------------
-- Thresholds
--
-- Allowances are a RATE per worked day, never a window total. That is what makes
-- a driver's score independent of how wide the operator dragged the date filter:
--   allowance(window) = allowance_per_worked_day * worked_days(window)
-- Zero worked days gives a zero allowance, which makes the component null and
-- drops it — no division by zero, and nobody scored on a period they did not work.
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS delivery_ontime_minutes integer NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS performance_speed_allowance_per_day numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS performance_conduct_allowance_per_day numeric NOT NULL DEFAULT 0.25;

COMMENT ON COLUMN public.app_settings.delivery_ontime_minutes IS
  'Minutes from pickup_at to delivered_at within which a delivery counts as inside SLA. There is no customer promised time anywhere in this schema — allocation is external — so this is a duration budget and must never be labelled as a customer promise.';
COMMENT ON COLUMN public.app_settings.performance_speed_allowance_per_day IS
  'Overspeed events per worked day tolerated before the speed component starts falling.';
COMMENT ON COLUMN public.app_settings.performance_conduct_allowance_per_day IS
  'Severity-weighted wrong_actions per worked day tolerated before the conduct component starts falling. Phase 3.';

-- Reporting needs history that a live feed never did. speed, zone and gps are
-- the only components sourced from fleet_events, and fleet_events is pruned —
-- so every day that passes at 30 days is a day the rollup can never reconstruct.
UPDATE public.app_settings
SET fleet_events_retention_days = GREATEST(COALESCE(fleet_events_retention_days, 30), 400)
WHERE id = 1;

-- ---------------------------------------------------------------------------
-- Per-zone / per-partner SLA overrides
--
-- Precedence is zone, then partner, then the global default. Zone wins because
-- it is the geographic fact that actually changes how long a delivery takes; a
-- partner is a commercial relationship that does not.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.delivery_sla_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL CHECK (scope_type IN ('zone', 'partner')),
  scope_id uuid NOT NULL,
  minutes integer NOT NULL CHECK (minutes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (scope_type, scope_id)
);

COMMENT ON TABLE public.delivery_sla_overrides IS
  'Per-zone or per-partner override of app_settings.delivery_ontime_minutes. Zone takes precedence over partner.';

CREATE OR REPLACE FUNCTION public.resolve_delivery_sla_minutes(
  p_zone_id uuid,
  p_partner_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT o.minutes FROM public.delivery_sla_overrides o
      WHERE o.scope_type = 'zone' AND o.scope_id = p_zone_id
    ),
    (
      SELECT o.minutes FROM public.delivery_sla_overrides o
      WHERE o.scope_type = 'partner' AND o.scope_id = p_partner_id
    ),
    (SELECT s.delivery_ontime_minutes FROM public.app_settings s WHERE s.id = 1),
    45
  );
$$;

REVOKE ALL ON FUNCTION public.resolve_delivery_sla_minutes(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_delivery_sla_minutes(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_delivery_sla_minutes(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Daily rollup
--
-- One row per driver per Kuwait day, holding the raw NUMERATORS AND DENOMINATORS
-- of every component — never a score.
--
-- Two reasons that distinction is load-bearing:
--
--   1. The six components do not aggregate the same way. Time-based ones
--      (punctuality, duty_ratio, zone, gps) average their per-day score across
--      worked days, because a shift is the unit of adherence and one 14-hour
--      Saturday must not dominate a month. Count-based ones (on_time, speed,
--      conduct) pool numerator and denominator across the window, or three late
--      deliveries out of five on a quiet day would outvote zero out of forty on
--      a busy one. Both aggregations are derivable from the pair; neither is
--      derivable from a stored score.
--   2. A weight or allowance change re-scores history consistently instead of
--      leaving last month scored under last month's settings.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.driver_performance_daily (
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  log_date date NOT NULL,

  -- Attendance shape of the day. `worked` is the denominator every per-worked-day
  -- allowance scales against.
  worked boolean NOT NULL DEFAULT false,
  on_leave boolean NOT NULL DEFAULT false,
  absent boolean NOT NULL DEFAULT false,

  -- Time-based numerators/denominators. NULL means "not measurable", which is
  -- what makes the drop-and-renormalise rule possible; 0 would mean "measured,
  -- and perfect", which is a different and much stronger claim.
  lost_minutes numeric,        -- minutes_late + minutes_early_out
  scheduled_minutes numeric,
  online_seconds numeric,
  duty_seconds numeric,
  out_of_zone_minutes numeric,
  gps_offline_minutes numeric,

  -- Count-based numerators. Denominators are deliveries_completed for on_time,
  -- and allowance * worked_days for speed and conduct.
  deliveries_completed integer,
  deliveries_within_sla integer,
  overspeed_events integer,
  conduct_weighted numeric,

  -- Which sources actually had data available when this row was written. A day
  -- rebuilt after fleet_events was pruned has no fleet_events entry here, so the
  -- analysis tab can annotate the gap rather than drawing absence as compliance.
  sources_complete text[] NOT NULL DEFAULT ARRAY[]::text[],

  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, log_date)
);

COMMENT ON TABLE public.driver_performance_daily IS
  'Nightly per-driver per-day rollup of raw performance component numerators and denominators. Never stores a weighted score, so a weight change re-scores history consistently.';
COMMENT ON COLUMN public.driver_performance_daily.sources_complete IS
  'Sources that had data when this row was written: attendance, deliveries, fleet_events, wrong_actions. A missing source means the component is unknown for that day, not zero.';

CREATE INDEX IF NOT EXISTS driver_performance_daily_date_idx
  ON public.driver_performance_daily (log_date, driver_id);

-- ---------------------------------------------------------------------------
-- RLS
--
-- Staff read on all three. No INSERT/UPDATE/DELETE policy anywhere: the panel
-- writes through PostgREST under a staff role, so a permissive write policy
-- would make the permission checks inside the RPCs advisory rather than a lock —
-- the same reason driver_performance_ratings has no write policy.
-- ---------------------------------------------------------------------------
ALTER TABLE public.performance_score_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_sla_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_performance_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS performance_score_components_staff_read ON public.performance_score_components;
CREATE POLICY performance_score_components_staff_read
  ON public.performance_score_components FOR SELECT
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS delivery_sla_overrides_staff_read ON public.delivery_sla_overrides;
CREATE POLICY delivery_sla_overrides_staff_read
  ON public.delivery_sla_overrides FOR SELECT
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS driver_performance_daily_staff_read ON public.driver_performance_daily;
CREATE POLICY driver_performance_daily_staff_read
  ON public.driver_performance_daily FOR SELECT
  USING (public.is_admin_panel_user());

-- ---------------------------------------------------------------------------
-- Component configuration RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_performance_components()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
  v_settings jsonb;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT public.staff_has_permission('performance.view') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'key', c.key,
        'label_en', c.label_en,
        'label_ar', c.label_ar,
        'weight', c.weight,
        'sort_order', c.sort_order,
        'is_active', c.is_active
      )
      ORDER BY c.sort_order, c.key
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.performance_score_components c;

  SELECT jsonb_build_object(
    'delivery_ontime_minutes', COALESCE(s.delivery_ontime_minutes, 45),
    'speed_allowance_per_day', COALESCE(s.performance_speed_allowance_per_day, 2),
    'conduct_allowance_per_day', COALESCE(s.performance_conduct_allowance_per_day, 0.25)
  )
  INTO v_settings
  FROM public.app_settings s
  WHERE s.id = 1;

  RETURN jsonb_build_object(
    'components', v_rows,
    'settings', COALESCE(v_settings, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_performance_components() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_performance_components() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_performance_components() TO authenticated;

-- Returns the previous state alongside the new one, so the caller can write a
-- before/after audit entry without a second read that could race the write.
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

  SELECT COALESCE(
    jsonb_object_agg(
      c.key,
      jsonb_build_object('weight', c.weight, 'is_active', c.is_active)
    ),
    '{}'::jsonb
  )
  INTO v_before
  FROM public.performance_score_components c;

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

  SELECT COALESCE(
    jsonb_object_agg(
      c.key,
      jsonb_build_object('weight', c.weight, 'is_active', c.is_active)
    ),
    '{}'::jsonb
  )
  INTO v_after
  FROM public.performance_score_components c;

  RETURN jsonb_build_object('before', v_before, 'after', v_after);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_performance_components(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_performance_components(jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_update_performance_components(jsonb, jsonb) TO authenticated;
