-- EmployeeDesk V2 — reminders get a server-enforced cooldown and a real reader (F8).
--
-- `admin_remind_esign_requests` (`20261115000000`) already bumps
-- `reminder_count` / `last_reminded_at` and logs the operation, but it does two
-- things wrong for a feature that will be on a button in front of an operator:
--
-- 1. It never enforced the window it was recording. The ledger existed and
--    nothing read it, so "Remind all" pressed twice sent twice — and the second
--    message is the one riders complain about. A disabled button is not a lock;
--    the cooldown has to be a `WHERE` clause.
-- 2. It never notified anyone. The counter moved, the rider learned nothing, and
--    the only observable effect of a reminder was that the number went up on the
--    screen that had just sent it. A reminder whose delivery is invisible is
--    worse than no reminder, because the operator stops chasing a rider who was
--    never told.
--
-- Delivery reuses `notify_driver_transactional` with the same
-- `record_type: esign` payload `admin_create_esign_request` already sends — so
-- the installed app's `notification_router.dart` deep-links it to the signature
-- screen and invalidates `esignRequestsProvider` with no app change and no Play
-- release. That is the whole reason the reminder is a notification rather than a
-- new message channel.
--
-- The cooldown is a setting rather than a constant because "we chase a document
-- once a day" is a policy that differs per client, and because it is the one
-- number an operator can be handed a complaint about.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS esign_reminder_cooldown_hours int NOT NULL DEFAULT 24;

COMMENT ON COLUMN public.app_settings.esign_reminder_cooldown_hours IS
  'Minimum hours between reminders to the same signer. 0 disables the cooldown.';

-- ---------------------------------------------------------------------------
-- Read the state, so the button and the badge agree with the lock
-- ---------------------------------------------------------------------------
--
-- The panel gets `hours_left` and `can_remind` per id from the same predicate the
-- send uses. Computing the countdown in TypeScript instead would drift from the
-- server the moment the setting changed, and a button that offers an action the
-- server refuses is the exact "the button does nothing" bug this table was added
-- to prevent.

CREATE OR REPLACE FUNCTION public.admin_esign_reminder_state(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cooldown int;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.view') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  SELECT COALESCE(esign_reminder_cooldown_hours, 24) INTO v_cooldown
  FROM public.app_settings LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'cooldown_hours', COALESCE(v_cooldown, 24),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.request_code)
      FROM (
        SELECT
          e.id,
          e.request_code,
          e.status::text AS status,
          e.viewed_at,
          e.last_reminded_at,
          COALESCE(e.reminder_count, 0) AS reminder_count,
          -- `GREATEST(..., 0)` so a clock skew or a reminder recorded with a
          -- future timestamp reports "ready" instead of a negative wait the UI
          -- would render as a countdown that never ends.
          GREATEST(
            CEIL(
              EXTRACT(EPOCH FROM (
                e.last_reminded_at
                + make_interval(hours => COALESCE(v_cooldown, 24))
                - now()
              )) / 3600.0
            ),
            0
          )::int AS hours_left
        FROM public.esign_requests e
        WHERE e.id = ANY (COALESCE(p_ids, ARRAY[]::uuid[]))
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Send, with the window enforced
-- ---------------------------------------------------------------------------
--
-- `CREATE OR REPLACE` rather than a new signature: same argument, same return
-- shape, so nothing that already calls it changes. `sent` keeps its meaning and
-- the two skip buckets are reported beside it rather than replacing it — an
-- operator asked for N reminders and deserves to know how many of the N went
-- out, not just that the call succeeded.

CREATE OR REPLACE FUNCTION public.admin_remind_esign_requests(p_ids uuid[])
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

    -- Reminding a finished document is noise. `pending` is the only status where
    -- the reminder has a reader who still has to act, and the client's
    -- `ESIGN_REMINDABLE_STAGES` is the same set derived from the same input.
    IF v_row.status <> 'pending' THEN
      v_stage := v_stage + 1;
      CONTINUE;
    END IF;

    -- The lock. `v_cooldown = 0` means the setting was set to disable the
    -- window, so the predicate is skipped rather than dividing by it.
    IF v_cooldown > 0
       AND v_row.last_reminded_at IS NOT NULL
       AND v_row.last_reminded_at + make_interval(hours => v_cooldown) > now() THEN
      v_cooldown_skipped := v_cooldown_skipped + 1;
      CONTINUE;
    END IF;

    -- Bump the ledger **before** notifying, and count only what was written.
    -- `notify_driver_transactional` is a real send with a real failure mode, and
    -- a reminder counted as sent while the push failed would suppress the next
    -- attempt for a full day over a message nobody received.
    UPDATE public.esign_requests
       SET reminder_count = COALESCE(reminder_count, 0) + 1,
           last_reminded_at = now(),
           updated_at = now()
     WHERE id = v_id;

    v_title := COALESCE(NULLIF(btrim(v_row.title), ''), v_row.request_code);

    PERFORM public.notify_driver_transactional(
      v_row.driver_id,
      'Reminder — document to sign',
      v_title,
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

  -- `action` is the enum public.admin_activity_action, which has no 'remind'
  -- member; adding one would need its own migration because a value added with
  -- ALTER TYPE cannot be referenced in the same transaction. The reminder is a
  -- state update on the request, so it is filed as 'update' with the operation
  -- named in route_name and the counts in context.
  INSERT INTO public.admin_activity_logs (
    admin_user_id, action, entity_type, entity_id, route_name, context
  ) VALUES (
    v_uid, 'update', 'esign_requests', NULL, 'esign.remind',
    jsonb_build_object(
      'request_ids', to_jsonb(p_ids),
      'sent', v_sent,
      'skipped_stage', v_stage,
      'skipped_cooldown', v_cooldown_skipped,
      'cooldown_hours', v_cooldown
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

REVOKE ALL ON FUNCTION public.admin_esign_reminder_state(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_esign_reminder_state(uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_remind_esign_requests(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remind_esign_requests(uuid[]) TO authenticated, service_role;
