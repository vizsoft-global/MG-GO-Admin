-- Vehicle type catalog. Source of truth is vehicles.vehicle_type_key;
-- drivers / intakes hold a fallback copied on approve. Resolution is one
-- COALESCE inside admin_live_fleet_snapshot so V1, V2 and the Worker cannot disagree.

CREATE TABLE IF NOT EXISTS public.vehicle_types (
  key text PRIMARY KEY,
  label_en text NOT NULL,
  label_ar text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);

INSERT INTO public.vehicle_types (key, label_en, label_ar, sort_order, is_active)
VALUES
  ('bike', 'Bike', 'دراجة', 10, true),
  ('car', 'Car', 'سيارة', 20, true)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.vehicle_types IS
  'Locked keys: a map sprite is keyed on them. Labels and order are editable.';

ALTER TABLE public.vehicle_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicle_types_staff_all ON public.vehicle_types;
CREATE POLICY vehicle_types_staff_all ON public.vehicle_types
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS vehicle_type_key text NOT NULL DEFAULT 'bike'
    REFERENCES public.vehicle_types(key);

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS vehicle_type_key text
    REFERENCES public.vehicle_types(key);

ALTER TABLE public.driver_intakes
  ADD COLUMN IF NOT EXISTS vehicle_type_key text
    REFERENCES public.vehicle_types(key);

COMMENT ON COLUMN public.vehicles.vehicle_type_key IS
  'Authoritative type for a assigned vehicle. The map reads this first.';
COMMENT ON COLUMN public.drivers.vehicle_type_key IS
  'Fallback when the driver has no vehicle assigned. Copied from intake on approve.';

CREATE OR REPLACE FUNCTION public._drivers_copy_intake_vehicle_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.vehicle_type_key IS NULL THEN
    SELECT i.vehicle_type_key
    INTO NEW.vehicle_type_key
    FROM public.driver_intakes i
    WHERE i.driver_code = NEW.driver_code
    ORDER BY i.updated_at DESC NULLS LAST
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS drivers_copy_intake_vehicle_type ON public.drivers;
CREATE TRIGGER drivers_copy_intake_vehicle_type
  BEFORE INSERT ON public.drivers
  FOR EACH ROW
  EXECUTE FUNCTION public._drivers_copy_intake_vehicle_type();

CREATE OR REPLACE FUNCTION public.admin_live_fleet_snapshot(
  p_seen_within_minutes integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_day date := (v_now AT TIME ZONE 'Asia/Kuwait')::date;
  v_cutoff timestamptz;
  v_drivers jsonb;
BEGIN
  IF NOT (public._fleet_caller_is_service_role() OR public.is_admin_panel_user()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_cutoff := v_now - make_interval(mins => GREATEST(COALESCE(p_seen_within_minutes, 30), 1));

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.last_seen_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_drivers
  FROM (
    SELECT
      d.id AS driver_id,
      COALESCE(NULLIF(trim(p.full_name), ''), d.driver_code) AS driver_name,
      d.driver_code,
      d.employee_id,
      d.avatar_object_key,
      d.avatar_updated_at,
      p.avatar_url,
      p.phone,
      d.status::text AS account_status,
      d.is_on_duty,
      d.is_blocked,
      d.zone_id,
      z.name AS zone_name,
      z.color AS zone_color,
      d.partner_id,
      pa.name AS partner_name,
      d.restaurant_id,
      r.name AS restaurant_name,
      d.vehicle_id,
      v.reg_number AS vehicle_reg_number,
      v.bike_id AS vehicle_bike_id,
      COALESCE(v.vehicle_type_key, d.vehicle_type_key, 'bike') AS vehicle_type_key,
      dl.latitude,
      dl.longitude,
      dl.speed_mps,
      dl.heading_deg,
      dl.accuracy_meters,
      dl.battery_pct,
      dl.is_mocked,
      dl.tracking_status,
      dl.zone_status,
      dl.out_of_zone_since,
      dl.distance_today_meters,
      open_delivery.id AS active_delivery_id,
      dl.last_seen_at,
      dl.last_report_at,
      EXISTS (
        SELECT 1 FROM public.driver_sessions ds
        WHERE ds.driver_id = d.id AND ds.is_online
      ) AS is_online,
      (
        SELECT al.check_in_at
        FROM public.attendance_logs al
        WHERE al.driver_id = d.id AND al.log_date = v_day
        ORDER BY al.check_in_at DESC NULLS LAST
        LIMIT 1
      ) AS on_duty_since,
      (
        SELECT count(*)
        FROM public.deliveries dv
        WHERE dv.driver_id = d.id
          AND dv.status <> 'cancelled'
          AND (dv.created_at AT TIME ZONE 'Asia/Kuwait')::date = v_day
      ) AS deliveries_today,
      (
        SELECT count(*)
        FROM public.deliveries dv
        WHERE dv.driver_id = d.id
          AND dv.delivered_at IS NOT NULL
          AND (dv.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = v_day
      ) AS deliveries_completed_today,
      sh.shift
    FROM public.drivers d
    JOIN public.profiles p ON p.id = d.id
    LEFT JOIN public.driver_locations dl ON dl.driver_id = d.id
    LEFT JOIN public.zones z ON z.id = d.zone_id
    LEFT JOIN public.partners pa ON pa.id = d.partner_id
    LEFT JOIN public.restaurants r ON r.id = d.restaurant_id
    LEFT JOIN public.vehicles v ON v.id = d.vehicle_id
    LEFT JOIN LATERAL (
      SELECT dv.id
      FROM public.deliveries dv
      WHERE dv.driver_id = d.id
        AND dv.status = 'in_transit'
      ORDER BY dv.pickup_at DESC NULLS LAST, dv.created_at DESC
      LIMIT 1
    ) open_delivery ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'shift_date', s.shift_date,
        'shift_type', s.shift_type,
        'session1_start_at',
          ((s.shift_date + s.session1_start)::timestamp AT TIME ZONE 'Asia/Kuwait'),
        'session1_end_at',
          (((s.shift_date + COALESCE(s.session1_end_day_offset, 0)) + s.session1_end)::timestamp
            AT TIME ZONE 'Asia/Kuwait'),
        'session2_start_at',
          CASE WHEN s.session2_start IS NULL THEN NULL ELSE
            (((s.shift_date + COALESCE(s.session2_start_day_offset, 0)) + s.session2_start)::timestamp
              AT TIME ZONE 'Asia/Kuwait') END,
        'session2_end_at',
          CASE WHEN s.session2_end IS NULL THEN NULL ELSE
            (((s.shift_date + COALESCE(s.session2_end_day_offset, 0)) + s.session2_end)::timestamp
              AT TIME ZONE 'Asia/Kuwait') END,
        'submitted_at', s.submitted_at
      ) AS shift
      FROM public.driver_daily_shifts s
      WHERE s.driver_id = d.id AND s.shift_date = v_day
      LIMIT 1
    ) sh ON true
    WHERE d.archived_at IS NULL
      AND (
        d.is_on_duty
        OR d.is_blocked
        OR dl.last_seen_at >= v_cutoff
        OR open_delivery.id IS NOT NULL
      )
  ) x;

  RETURN jsonb_build_object(
    'generated_at', v_now,
    'kuwait_day', v_day,
    'settings', public._fleet_settings(),
    'drivers', v_drivers
  );
END;
$function$;

COMMENT ON FUNCTION public.admin_live_fleet_snapshot(integer) IS
  'One-shot Live Tracking V2 roster + last position. vehicle_type_key is COALESCE(vehicle, driver, bike).';

GRANT EXECUTE ON FUNCTION public.admin_live_fleet_snapshot(integer) TO authenticated, service_role;
