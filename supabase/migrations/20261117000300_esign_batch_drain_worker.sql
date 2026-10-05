-- EmployeeDesk V2 — a closed browser tab cannot orphan a batch (F5).
--
-- The bulk sender is a client-driven loop: the screen claims 25 rows, renders a
-- PDF per row in a headless Chromium, creates the request, and repeats. That is
-- fine while the tab is open and catastrophic the moment it is not — an operator
-- who closes the laptop at row 180 leaves the batch `processing` with 60 rows
-- `pending` and **nothing in the system that will ever pick them up**. The rows
-- are not lost (a re-opened batch detail resumes them), but nobody is told, and
-- `processing` reads as "in progress" for as long as it sits there.
--
-- This file is the server-side drain: a cron route that finds batches a live tab
-- has stopped working, and finishes them.
--
-- ## Why a session flag rather than copying the functions
--
-- A cron runs with the service-role key, which has no `auth.uid()`, so every
-- RPC the sender uses refuses it at the `is_admin_panel_user()` gate. The
-- tempting fixes are both worse than this one: copying the four functions into
-- worker variants duplicates ~200 lines of payout-adjacent SQL that would drift
-- on the next change, and relaxing `is_admin_panel_user()` to also accept the
-- service role would widen the gate on **every** admin RPC in the schema.
--
-- So the functions stay single-source and gain one clause: they accept a caller
-- that has set `esign.worker_mode`. That flag can only be set by the
-- `esign_worker_*` wrappers below, and those are granted to `service_role`
-- alone. A rider or staff session cannot reach `set_config` through PostgREST —
-- it is a `pg_catalog` builtin, and PostgREST only exposes functions in the
-- exposed schema — so the only way into worker mode is a service-role call that
-- a trusted route makes. The actor is carried the same way, so a document the
-- cron creates still records who authored the batch instead of a null sender.
--
-- ## Claiming, not racing
--
-- Every function here is idempotent and the claim is guarded by
-- `FOR UPDATE SKIP LOCKED`, so a cron pass and an open tab working the same
-- batch cannot take the same row twice. `esign_batch_worker_minutes` is what
-- keeps the cron from stepping on a tab that is merely slow: only a batch whose
-- `updated_at` is older than the window is considered abandoned.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS esign_batch_worker_minutes int NOT NULL DEFAULT 10;

COMMENT ON COLUMN public.app_settings.esign_batch_worker_minutes IS
  'Minutes a batch must be idle before the drain cron may resume it. 0 disables the idle check.';

-- ---------------------------------------------------------------------------
-- 1. The worker flag
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._esign_worker_mode()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(current_setting('esign.worker_mode', true), '') = 'on';
$$;

CREATE OR REPLACE FUNCTION public._esign_worker_actor()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT NULLIF(current_setting('esign.worker_actor', true), '')::uuid;
$$;

-- ---------------------------------------------------------------------------
-- 2. The three gated functions the sender uses, now worker-aware
-- ---------------------------------------------------------------------------
--
-- Each is a `CREATE OR REPLACE` with exactly one changed expression in the gate
-- (and, for the create, the actor resolution). The bodies are otherwise
-- byte-identical to the versions they replace, so an operator using the screen
-- sees no change at all.

CREATE OR REPLACE FUNCTION public.admin_esign_resolve_employees(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_ord int := 0;
  v_emp text;
  v_hits int;
  v_driver public.drivers%ROWTYPE;
BEGIN
  IF NOT (
    public._esign_worker_mode()
    OR (v_uid IS NOT NULL
        AND public.is_admin_panel_user()
        AND public.staff_has_permission('requests.view'))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  FOR v_elem IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    v_ord := v_ord + 1;
    v_emp := NULLIF(btrim(COALESCE(v_elem->>'employee_id', '')), '');
    IF v_emp IS NULL THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'row_index', v_ord - 1,
        'employee_id', '',
        'ok', false,
        'status', 'invalid'
      ));
      CONTINUE;
    END IF;

    SELECT count(*) INTO v_hits
    FROM public.drivers d
    WHERE d.employee_id = v_emp;

    IF v_hits = 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'row_index', v_ord - 1,
        'employee_id', v_emp,
        'ok', false,
        'status', 'unknown_id'
      ));
      CONTINUE;
    END IF;
    IF v_hits > 1 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'row_index', v_ord - 1,
        'employee_id', v_emp,
        'ok', false,
        'status', 'ambiguous'
      ));
      CONTINUE;
    END IF;

    SELECT * INTO v_driver FROM public.drivers d WHERE d.employee_id = v_emp;
    IF v_driver.archived_at IS NOT NULL THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'row_index', v_ord - 1,
        'employee_id', v_emp,
        'ok', false,
        'status', 'archived'
      ));
      CONTINUE;
    END IF;
    IF v_driver.is_blocked THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'row_index', v_ord - 1,
        'employee_id', v_emp,
        'ok', false,
        'status', 'blocked'
      ));
      CONTINUE;
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'row_index', v_ord - 1,
      'employee_id', v_emp,
      'ok', true,
      'status', 'ok',
      'driver_id', v_driver.id,
      'snapshot', public.esign_employee_snapshot(v_driver.id)
    ));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'rows', v_out);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_claim_esign_batch_rows(
  p_batch_id uuid,
  p_limit int DEFAULT 25,
  p_mode text DEFAULT 'pending'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text := lower(btrim(COALESCE(p_mode, 'pending')));
  v_rows jsonb;
BEGIN
  IF NOT (
    public._esign_worker_mode()
    OR (public.is_admin_panel_user() AND public.staff_has_permission('requests.manage'))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF v_mode NOT IN ('pending', 'failed', 'all') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_mode');
  END IF;

  WITH claimed AS (
    SELECT r.id
    FROM public.esign_batch_rows r
    WHERE r.batch_id = p_batch_id
      AND (
        (v_mode = 'pending' AND r.status = 'pending')
        OR (v_mode = 'failed' AND r.status = 'failed')
        OR v_mode = 'all'
      )
    ORDER BY r.row_index
    LIMIT GREATEST(LEAST(COALESCE(p_limit, 25), 50), 1)
    FOR UPDATE OF r SKIP LOCKED
  ),
  moved AS (
    UPDATE public.esign_batch_rows x
       SET status = 'pending',
           error = NULL,
           updated_at = now()
      FROM claimed c
     WHERE x.id = c.id
    RETURNING x.*
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.row_index), '[]'::jsonb)
    INTO v_rows
  FROM moved m;

  PERFORM public._esign_batch_recount(p_batch_id);

  RETURN jsonb_build_object('ok', true, 'rows', v_rows, 'mode', v_mode);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_esign_request(
  p_driver_id uuid,
  p_title text,
  p_category_key text DEFAULT NULL,
  p_due_at date DEFAULT NULL,
  p_document_storage_key text DEFAULT NULL,
  p_screenshot_restricted boolean DEFAULT NULL,
  p_template_id uuid DEFAULT NULL,
  p_batch_id uuid DEFAULT NULL,
  p_batch_row int DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_field_values jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- The one line the worker needs: `auth.uid()` is null for a service-role
  -- call, so provenance is read from the session flag the worker wrapper set.
  v_uid uuid := COALESCE(auth.uid(), public._esign_worker_actor());
  v_cat public.esign_categories%ROWTYPE;
  v_tpl public.esign_templates%ROWTYPE;
  v_restricted boolean;
  v_id uuid;
  v_code text;
  v_field record;
  v_values jsonb := COALESCE(p_field_values, '{}'::jsonb);
  v_snapshot jsonb;
  v_existing public.esign_requests%ROWTYPE;
BEGIN
  IF NOT (
    public._esign_worker_mode()
    OR (public.is_admin_panel_user() AND public.staff_has_permission('requests.manage'))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF p_driver_id IS NULL OR p_title IS NULL OR trim(p_title) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  IF p_batch_id IS NOT NULL AND p_batch_row IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.esign_requests
    WHERE batch_id = p_batch_id AND batch_row = p_batch_row;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true, 'id', v_existing.id, 'request_code', v_existing.request_code, 'idempotent', true
      );
    END IF;
  END IF;

  IF p_category_key IS NULL OR trim(p_category_key) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'category_required');
  END IF;
  IF p_due_at IS NOT NULL AND p_due_at < (timezone('Asia/Kuwait', now()))::date THEN
    RETURN jsonb_build_object('ok', false, 'error', 'due_in_past');
  END IF;

  SELECT * INTO v_cat FROM public.esign_categories WHERE key = p_category_key AND is_active;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_category');
  END IF;

  IF p_template_id IS NOT NULL THEN
    SELECT * INTO v_tpl FROM public.esign_templates WHERE id = p_template_id AND is_active;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_template');
    END IF;
    IF v_tpl.category_key IS DISTINCT FROM p_category_key THEN
      RETURN jsonb_build_object('ok', false, 'error', 'template_category_mismatch');
    END IF;
    FOR v_field IN
      SELECT * FROM public.esign_template_fields
      WHERE template_id = v_tpl.id AND is_required
    LOOP
      IF NULLIF(btrim(COALESCE(v_values ->> v_field.field_key, '')), '') IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'field_required', 'field', v_field.field_key);
      END IF;
    END LOOP;
  END IF;

  v_restricted := COALESCE(p_screenshot_restricted, v_cat.screenshot_restricted);
  v_snapshot := COALESCE(public.esign_employee_snapshot(p_driver_id), '{}'::jsonb);

  INSERT INTO public.esign_requests (
    title, category_key, driver_id, document_storage_key, due_at,
    screenshot_restricted, sent_by,
    template_id, template_version, batch_id, batch_row,
    description, field_values, employee_snapshot
  ) VALUES (
    trim(p_title), p_category_key, p_driver_id, p_document_storage_key, p_due_at,
    v_restricted, v_uid,
    p_template_id, CASE WHEN p_template_id IS NULL THEN NULL ELSE v_tpl.version END,
    p_batch_id, p_batch_row,
    NULLIF(btrim(COALESCE(p_description, '')), ''),
    v_values,
    v_snapshot
  )
  RETURNING id, request_code INTO v_id, v_code;

  IF p_batch_id IS NOT NULL AND p_batch_row IS NOT NULL THEN
    UPDATE public.esign_batch_rows
    SET status = 'created', esign_request_id = v_id, error = NULL, updated_at = now()
    WHERE batch_id = p_batch_id AND row_index = p_batch_row;
    UPDATE public.esign_batches
    SET created_count = created_count + 1, updated_at = now()
    WHERE id = p_batch_id;
  END IF;

  PERFORM public.notify_driver_transactional(
    p_driver_id,
    'Document to sign — ' || v_code,
    trim(p_title),
    'musallam:///profile/support/sign/' || v_id::text,
    'operations',
    'high',
    jsonb_build_object('record_type', 'esign', 'record_id', v_id::text, 'route', '/profile/support/sign/' || v_id::text)
  );

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'request_code', v_code);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. The service-only doors
-- ---------------------------------------------------------------------------

-- What the cron should look at: batches that still have work, that no live tab
-- has touched inside the idle window. Returned oldest-first so a backlog drains
-- in the order it stalled. `p_stale_minutes` overrides the setting, which is
-- what lets a manual drain (an operator pressing the button) pass 0 and skip the
-- idle check entirely.
CREATE OR REPLACE FUNCTION public.esign_worker_drainable_batches(
  p_limit int DEFAULT 20,
  p_stale_minutes int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stale int;
BEGIN
  SELECT COALESCE(p_stale_minutes, COALESCE(s.esign_batch_worker_minutes, 10))
    INTO v_stale
  FROM public.app_settings s
  WHERE s.id = 1;
  v_stale := COALESCE(v_stale, 10);

  RETURN jsonb_build_object(
    'ok', true,
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.updated_at)
      FROM (
        SELECT b.id AS batch_id,
               b.batch_code,
               b.status,
               b.created_by,
               b.updated_at,
               count(r.id) FILTER (WHERE r.status = 'pending') AS pending_count
          FROM public.esign_batches b
          JOIN public.esign_batch_rows r ON r.batch_id = b.id
         WHERE b.status IN ('queued', 'processing')
           AND (v_stale <= 0 OR b.updated_at < now() - make_interval(mins => v_stale))
         GROUP BY b.id, b.batch_code, b.status, b.created_by, b.updated_at
        HAVING count(r.id) FILTER (WHERE r.status = 'pending') > 0
         ORDER BY b.updated_at
         LIMIT GREATEST(LEAST(COALESCE(p_limit, 20), 50), 1)
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.esign_worker_claim_batch_rows(
  p_batch_id uuid,
  p_limit int DEFAULT 25,
  p_mode text DEFAULT 'pending',
  p_actor uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config('esign.worker_mode', 'on', true);
  PERFORM set_config('esign.worker_actor', COALESCE(p_actor::text, ''), true);
  v_result := public.admin_claim_esign_batch_rows(p_batch_id, p_limit, p_mode);
  -- Cleared immediately so the flag cannot outlive the call if the same
  -- connection is reused for another statement in the transaction.
  PERFORM set_config('esign.worker_mode', 'off', true);
  PERFORM set_config('esign.worker_actor', '', true);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.esign_worker_create_request(
  p_driver_id uuid,
  p_title text,
  p_category_key text DEFAULT NULL,
  p_due_at date DEFAULT NULL,
  p_document_storage_key text DEFAULT NULL,
  p_screenshot_restricted boolean DEFAULT NULL,
  p_template_id uuid DEFAULT NULL,
  p_batch_id uuid DEFAULT NULL,
  p_batch_row int DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_field_values jsonb DEFAULT NULL,
  p_actor uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config('esign.worker_mode', 'on', true);
  PERFORM set_config('esign.worker_actor', COALESCE(p_actor::text, ''), true);
  v_result := public.admin_create_esign_request(
    p_driver_id, p_title, p_category_key, p_due_at, p_document_storage_key,
    p_screenshot_restricted, p_template_id, p_batch_id, p_batch_row,
    p_description, p_field_values
  );
  PERFORM set_config('esign.worker_mode', 'off', true);
  PERFORM set_config('esign.worker_actor', '', true);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.esign_worker_resolve_employees(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config('esign.worker_mode', 'on', true);
  v_result := public.admin_esign_resolve_employees(p_rows);
  PERFORM set_config('esign.worker_mode', 'off', true);
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
--
-- The flag helpers are revoked from `authenticated` as well as `anon`: they are
-- reached only from inside the workers and the gate expressions above, and a
-- rider calling `_esign_worker_mode()` directly learns nothing but should not
-- have a handle on it either. The three worker wrappers are service-role only —
-- that restriction is the whole security argument for the bypass.

REVOKE ALL ON FUNCTION public._esign_worker_mode() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._esign_worker_actor() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.esign_worker_drainable_batches(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.esign_worker_drainable_batches(int, int) TO service_role;
REVOKE ALL ON FUNCTION public.esign_worker_claim_batch_rows(uuid, int, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.esign_worker_claim_batch_rows(uuid, int, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.esign_worker_create_request(uuid, text, text, date, text, boolean, uuid, uuid, int, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.esign_worker_create_request(uuid, text, text, date, text, boolean, uuid, uuid, int, text, jsonb, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.esign_worker_resolve_employees(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.esign_worker_resolve_employees(jsonb) TO service_role;
