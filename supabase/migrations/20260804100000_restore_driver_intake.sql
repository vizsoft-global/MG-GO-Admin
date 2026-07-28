-- Allow admins to unarchive a driver intake and its linked driver profile.

CREATE OR REPLACE FUNCTION public.restore_driver_intake(p_intake_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intake public.driver_intakes%ROWTYPE;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_intake
  FROM public.driver_intakes
  WHERE id = p_intake_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'intake_not_found');
  END IF;

  IF v_intake.archived_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'intake_not_archived');
  END IF;

  UPDATE public.driver_intakes
  SET
    archived_at = NULL,
    status = CASE
      WHEN v_intake.linked = true OR v_intake.linked_profile_id IS NOT NULL THEN
        'linked'::public.driver_intake_status
      ELSE
        'awaiting_app_link'::public.driver_intake_status
    END,
    updated_at = now()
  WHERE id = p_intake_id;

  IF v_intake.linked_profile_id IS NOT NULL THEN
    UPDATE public.drivers
    SET archived_at = NULL, updated_at = now()
    WHERE id = v_intake.linked_profile_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.restore_driver_intake(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_driver_intake(uuid) TO authenticated;

COMMENT ON FUNCTION public.restore_driver_intake(uuid) IS
  'Staff-only: clear archived_at on intake and linked driver so the account reappears in active lists and can sign in when active.';
