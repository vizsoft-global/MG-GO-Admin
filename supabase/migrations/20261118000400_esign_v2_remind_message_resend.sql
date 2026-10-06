-- Remind gains an optional message (DROP — cannot add an argument with
-- CREATE OR REPLACE). Correct-and-resend links the new row via resent_from_id.
-- Batch KPIs are one DEFINER scan so the sent list cannot invent them from a page.

ALTER TABLE public.esign_requests
  ADD COLUMN IF NOT EXISTS resent_from_id uuid REFERENCES public.esign_requests(id);

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'admin_remind_esign_requests'
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END
$$;

CREATE FUNCTION public.admin_remind_esign_requests(
  p_ids uuid[],
  p_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cooldown int;
  v_sent int := 0;
  v_stage int := 0;
  v_cooldown_skipped int := 0;
  v_id uuid;
  v_row public.esign_requests%ROWTYPE;
  v_title text;
  v_body text;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_ids');
  END IF;

  SELECT COALESCE(esign_reminder_cooldown_hours, 24) INTO v_cooldown
  FROM public.app_settings LIMIT 1;
  v_cooldown := COALESCE(v_cooldown, 24);

  FOREACH v_id IN ARRAY p_ids LOOP
    SELECT * INTO v_row FROM public.esign_requests WHERE id = v_id;
    CONTINUE WHEN v_row.id IS NULL;

    IF v_row.status <> 'pending' THEN
      v_stage := v_stage + 1;
      CONTINUE;
    END IF;

    IF v_cooldown > 0
       AND v_row.last_reminded_at IS NOT NULL
       AND v_row.last_reminded_at + make_interval(hours => v_cooldown) > now() THEN
      v_cooldown_skipped := v_cooldown_skipped + 1;
      CONTINUE;
    END IF;

    UPDATE public.esign_requests
       SET reminder_count = COALESCE(reminder_count, 0) + 1,
           last_reminded_at = now(),
           updated_at = now()
     WHERE id = v_id;

    v_title := COALESCE(NULLIF(btrim(v_row.title), ''), v_row.request_code);
    v_body := COALESCE(NULLIF(btrim(p_message), ''), v_title);

    PERFORM public.notify_driver_transactional(
      v_row.driver_id,
      'Reminder — document to sign',
      v_body,
      'musallam:///profile/support/sign/' || v_id::text,
      'operations',
      'high',
      jsonb_build_object(
        'record_type', 'esign',
        'record_id', v_id::text,
        'route', '/profile/support/sign/' || v_id::text,
        'kind', 'esign_reminder'
      )
    );

    v_sent := v_sent + 1;
  END LOOP;

  INSERT INTO public.admin_activity_logs (
    admin_user_id, action, entity_type, entity_id, route_name, context
  ) VALUES (
    v_uid, 'update', 'esign_requests', NULL, 'esign.remind',
    jsonb_build_object(
      'request_ids', to_jsonb(p_ids),
      'sent', v_sent,
      'skipped_stage', v_stage,
      'skipped_cooldown', v_cooldown_skipped,
      'cooldown_hours', v_cooldown,
      'custom_message', NULLIF(btrim(COALESCE(p_message, '')), '') IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'sent', v_sent,
    'skipped_stage', v_stage,
    'skipped_cooldown', v_cooldown_skipped,
    'cooldown_hours', v_cooldown
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_esign_batch_kpis(
  p_from timestamp with time zone DEFAULT NULL,
  p_to timestamp with time zone DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz := COALESCE(p_from, now() - interval '30 days');
  v_to timestamptz := COALESCE(p_to, now());
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.view') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'batches_sent', (
      SELECT count(*) FROM public.esign_batches
      WHERE created_at >= v_from AND created_at < v_to
    ),
    'waiting_signatures', (
      SELECT count(*) FROM public.esign_requests
      WHERE status = 'pending'
    ),
    'fully_signed', (
      SELECT count(*) FROM public.esign_requests
      WHERE status = 'signed'
        AND created_at >= v_from AND created_at < v_to
    ),
    'declined', (
      SELECT count(*) FROM public.esign_requests
      WHERE status = 'declined'
        AND created_at >= v_from AND created_at < v_to
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_link_esign_resend(
  p_id uuid,
  p_from_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from public.esign_requests%ROWTYPE;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF p_id IS NULL OR p_from_id IS NULL OR p_id = p_from_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_resend');
  END IF;
  SELECT * INTO v_from FROM public.esign_requests WHERE id = p_from_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_from.status <> 'declined' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_declined');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.esign_requests WHERE id = p_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  UPDATE public.esign_requests
     SET resent_from_id = p_from_id, updated_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_remind_esign_requests(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remind_esign_requests(uuid[], text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_esign_batch_kpis(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_esign_batch_kpis(timestamptz, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_link_esign_resend(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_link_esign_resend(uuid, uuid) TO authenticated, service_role;
