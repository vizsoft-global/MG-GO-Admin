-- Attendance module: duty toggle writes attendance_logs, admin corrections, driver read RLS.

ALTER TABLE public.attendance_logs
  ADD COLUMN IF NOT EXISTS admin_note text;

COMMENT ON COLUMN public.attendance_logs.admin_note IS
  'Reason note when an admin creates or corrects this attendance record.';

-- Driver read own attendance rows (writes stay RPC-only).
DROP POLICY IF EXISTS attendance_logs_driver_select ON public.attendance_logs;
CREATE POLICY attendance_logs_driver_select ON public.attendance_logs
  FOR SELECT
  USING (driver_id = auth.uid());

-- Realtime for admin live attendance tab.
ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_logs;

-- ---------------------------------------------------------------------------
-- Extend driver_set_duty_state: duty toggle ON/OFF = check-in/check-out
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_set_duty_state(
  p_is_on_duty boolean,
  p_is_online boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid := auth.uid();
  v_open_session_id uuid;
  v_log_date date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
BEGIN
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE public.drivers
  SET is_on_duty = p_is_on_duty,
      updated_at = now()
  WHERE id = v_driver_id;

  SELECT ds.id
  INTO v_open_session_id
  FROM public.driver_sessions ds
  WHERE ds.driver_id = v_driver_id
    AND ds.is_online = true
  ORDER BY ds.created_at DESC
  LIMIT 1;

  IF p_is_online THEN
    IF v_open_session_id IS NULL THEN
      INSERT INTO public.driver_sessions (driver_id, is_online, went_online_at)
      VALUES (v_driver_id, true, now());
    ELSE
      UPDATE public.driver_sessions
      SET updated_at = now()
      WHERE id = v_open_session_id;
    END IF;

    INSERT INTO public.attendance_logs (driver_id, log_date, check_in_at, status)
    VALUES (v_driver_id, v_log_date, now(), 'present')
    ON CONFLICT (driver_id, log_date) DO UPDATE
      SET check_in_at = COALESCE(attendance_logs.check_in_at, EXCLUDED.check_in_at),
          status = CASE
            WHEN attendance_logs.status = 'on_leave' THEN attendance_logs.status
            ELSE 'present'
          END,
          updated_at = now();
  ELSE
    IF v_open_session_id IS NOT NULL THEN
      UPDATE public.driver_sessions
      SET is_online = false,
          went_offline_at = now(),
          updated_at = now()
      WHERE id = v_open_session_id;
    END IF;

    UPDATE public.attendance_logs
    SET check_out_at = now(),
        updated_at = now()
    WHERE driver_id = v_driver_id
      AND log_date = v_log_date
      AND check_out_at IS NULL;
  END IF;

  RETURN public.driver_get_home_dashboard();
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: admin_correct_attendance — create or update attendance records
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_correct_attendance(
  p_log_id uuid DEFAULT NULL,
  p_driver_id uuid DEFAULT NULL,
  p_log_date date DEFAULT NULL,
  p_check_in_at timestamptz DEFAULT NULL,
  p_check_out_at timestamptz DEFAULT NULL,
  p_status public.attendance_status DEFAULT 'present',
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.attendance_logs%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_note IS NULL OR btrim(p_note) = '' THEN
    RAISE EXCEPTION 'note_required';
  END IF;

  IF p_log_id IS NOT NULL THEN
    SELECT *
    INTO v_row
    FROM public.attendance_logs
    WHERE id = p_log_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'log_not_found';
    END IF;

    IF v_row.log_date > v_today THEN
      RAISE EXCEPTION 'future_date';
    END IF;

    IF p_check_in_at IS NOT NULL AND p_check_out_at IS NOT NULL
       AND p_check_out_at < p_check_in_at THEN
      RAISE EXCEPTION 'invalid_times';
    END IF;

    UPDATE public.attendance_logs
    SET check_in_at = COALESCE(p_check_in_at, check_in_at),
        check_out_at = p_check_out_at,
        status = COALESCE(p_status, status),
        admin_note = btrim(p_note),
        updated_at = now()
    WHERE id = p_log_id
    RETURNING * INTO v_row;
  ELSE
    IF p_driver_id IS NULL OR p_log_date IS NULL THEN
      RAISE EXCEPTION 'missing_fields';
    END IF;

    IF p_log_date > v_today THEN
      RAISE EXCEPTION 'future_date';
    END IF;

    IF p_check_in_at IS NOT NULL AND p_check_out_at IS NOT NULL
       AND p_check_out_at < p_check_in_at THEN
      RAISE EXCEPTION 'invalid_times';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.drivers d WHERE d.id = p_driver_id
    ) THEN
      RAISE EXCEPTION 'driver_not_found';
    END IF;

    INSERT INTO public.attendance_logs (
      driver_id,
      log_date,
      check_in_at,
      check_out_at,
      status,
      admin_note
    )
    VALUES (
      p_driver_id,
      p_log_date,
      p_check_in_at,
      p_check_out_at,
      COALESCE(p_status, 'present'),
      btrim(p_note)
    )
    ON CONFLICT (driver_id, log_date) DO UPDATE
      SET check_in_at = COALESCE(EXCLUDED.check_in_at, attendance_logs.check_in_at),
          check_out_at = EXCLUDED.check_out_at,
          status = EXCLUDED.status,
          admin_note = EXCLUDED.admin_note,
          updated_at = now()
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'driver_id', v_row.driver_id,
    'log_date', v_row.log_date,
    'check_in_at', v_row.check_in_at,
    'check_out_at', v_row.check_out_at,
    'status', v_row.status,
    'zone_compliance', v_row.zone_compliance,
    'admin_note', v_row.admin_note,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_correct_attendance(
  uuid, uuid, date, timestamptz, timestamptz, public.attendance_status, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_correct_attendance(
  uuid, uuid, date, timestamptz, timestamptz, public.attendance_status, text
) TO service_role;

-- Permission: attendance.manage
INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('attendance.manage', 'Manage attendance', 'attendance')
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, 'attendance.manage'
FROM public.admin_roles r
WHERE r.slug IN ('super_admin', 'administrator')
ON CONFLICT DO NOTHING;
