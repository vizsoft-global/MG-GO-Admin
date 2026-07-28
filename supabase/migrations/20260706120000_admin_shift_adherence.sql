-- Admin panel: expose shift adherence for staff (wraps _driver_shift_adherence).

CREATE OR REPLACE FUNCTION public.admin_get_shift_adherence(
  p_driver_id uuid,
  p_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_driver_id IS NULL OR p_date IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN public._driver_shift_adherence(p_driver_id, p_date);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_shift_adherence(
  p_from date,
  p_to date,
  p_driver_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  driver_id uuid,
  attendance_date date,
  shift_adherence jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RETURN;
  END IF;

  FOR v_row IN
    SELECT da.driver_id AS drv_id, da.attendance_date AS att_date
    FROM public.driver_attendance da
    WHERE da.attendance_date >= p_from
      AND da.attendance_date <= p_to
      AND (p_driver_ids IS NULL OR da.driver_id = ANY(p_driver_ids))
    UNION
    SELECT al.driver_id AS drv_id, al.log_date AS att_date
    FROM public.attendance_logs al
    WHERE al.log_date >= p_from
      AND al.log_date <= p_to
      AND (p_driver_ids IS NULL OR al.driver_id = ANY(p_driver_ids))
    UNION
    SELECT ds.driver_id AS drv_id, ds.shift_date AS att_date
    FROM public.driver_daily_shifts ds
    WHERE ds.shift_date >= p_from
      AND ds.shift_date <= p_to
      AND (p_driver_ids IS NULL OR ds.driver_id = ANY(p_driver_ids))
  LOOP
    driver_id := v_row.drv_id;
    attendance_date := v_row.att_date;
    shift_adherence := public._driver_shift_adherence(v_row.drv_id, v_row.att_date);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_shift_adherence(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_shift_adherence(date, date, uuid[]) TO authenticated;
