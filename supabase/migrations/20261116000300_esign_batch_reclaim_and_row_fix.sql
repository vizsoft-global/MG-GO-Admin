-- EmployeeDesk V2 — row validation / inline fix (F3) and retry failed chunks (F10).
--
-- Two gaps sharing one table. `esign_batch_rows` carries the per-row outcome of
-- a bulk send, but a failed row could not be read again at all: the only reader,
-- `admin_claim_esign_batch_rows`, filtered `status = 'pending'`, so a row that
-- failed once was excluded from every subsequent claim and the operator's only
-- recourse was to re-upload the whole sheet — which is how a two-row typo turns
-- into 240 duplicate documents.
--
-- Three functions, deliberately in one file, because they are one lifecycle:
-- claim (retry) → repair (fix / remove) → recount.
--
-- `admin_claim_esign_batch_rows` gains `p_mode` with a **DEFAULT** rather than a
-- second overload. PostgREST resolves an RPC by name and argument *names*, and a
-- 2-argument call against a 2-argument function plus a 3-argument function with
-- a default is ambiguous — it answers "function is not unique" and both calls
-- break, including the one already in production. So the signature is replaced,
-- not added to. A replaced signature means DROP + CREATE (CREATE OR REPLACE
-- cannot change the argument list), and a DROP discards the ACL, which is why
-- the REVOKE/GRANT block is re-applied at the bottom of this file.

-- ---------------------------------------------------------------------------
-- 1. Recount — one place that knows what a batch's counters mean
-- ---------------------------------------------------------------------------
--
-- `created_count` / `failed_count` were only ever incremented by the client as
-- it walked its chunks, so they were a log of what the sender did rather than a
-- statement about the rows. That is the same number right up until a row is
-- edited or removed, at which point the log and the rows disagree and the batch
-- header prints a figure no row supports. Deriving them from the rows makes the
-- header true by construction.

CREATE OR REPLACE FUNCTION public._esign_batch_recount(p_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_created int;
  v_failed int;
  v_status text;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE status = 'created'),
         count(*) FILTER (WHERE status = 'failed')
    INTO v_total, v_created, v_failed
  FROM public.esign_batch_rows
  WHERE batch_id = p_batch_id;

  -- `queued` is reserved for a batch nobody has claimed yet; anything with rows
  -- still outstanding is `processing`, and once nothing is pending the batch is
  -- `completed` when every row was sent and `partial` when any was not. Read off
  -- the rows rather than carried from the previous status, so a batch whose last
  -- failure was just repaired stops calling itself partial.
  v_status := CASE
    WHEN v_total = 0 THEN 'queued'
    WHEN EXISTS (
      SELECT 1 FROM public.esign_batch_rows
      WHERE batch_id = p_batch_id AND status = 'pending'
    ) THEN 'processing'
    WHEN v_failed > 0 THEN 'partial'
    ELSE 'completed'
  END;

  UPDATE public.esign_batches
     SET total_count = v_total,
         created_count = v_created,
         failed_count = v_failed,
         status = v_status,
         updated_at = now()
   WHERE id = p_batch_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Claim — pending, failed, or both
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_claim_esign_batch_rows(uuid, int);

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
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  -- Refused rather than defaulted: a typo that silently falls back to `pending`
  -- would look like "Retry failed" ran and simply found nothing, which is the
  -- outcome the operator is least able to tell from success.
  IF v_mode NOT IN ('pending', 'failed', 'all') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_mode');
  END IF;

  -- A claimed row is moved back to `pending` and its error cleared in the same
  -- statement that selects it. Clearing is the point: the retry is the current
  -- attempt, and a row carrying last attempt's message while it is in flight
  -- prints a failure that has not happened yet. It also makes the claim
  -- self-healing — an interrupted worker leaves rows in the state the normal
  -- driver picks up, rather than stranded in `failed`.
  -- One statement, so the rows the caller receives are exactly the rows this
  -- call locked and moved. A select-then-update pair would need the same
  -- predicate written twice and would hand back a set the next concurrent claim
  -- could already have taken.
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

-- ---------------------------------------------------------------------------
-- 3. Repair a row — change the employee id, or remove the row
-- ---------------------------------------------------------------------------
--
-- Both refuse a row that has already produced a document. `created` means a
-- `SIG-####` exists, has been pushed to a rider, and may already be signed; an
-- "edit" there would not change a document, it would detach the row from one —
-- the batch would show a name it never sent to and the request would sit in the
-- rider's inbox under a row that no longer mentions them. The operator's real
-- intent on a sent row is a new send, which is what the send screen is for.

CREATE OR REPLACE FUNCTION public.admin_update_esign_batch_row(
  p_row_id uuid,
  p_employee_id text,
  p_field_values jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.esign_batch_rows%ROWTYPE;
  v_emp text := NULLIF(btrim(COALESCE(p_employee_id, '')), '');
  v_resolved jsonb;
  v_first jsonb;
  v_status text;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  SELECT * INTO v_row FROM public.esign_batch_rows WHERE id = p_row_id;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_row.status = 'created' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_sent');
  END IF;
  IF v_emp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'employee_id_required');
  END IF;

  -- The same resolver the upload preview uses, called with one row. Reusing it
  -- rather than re-deriving the match here is the whole point: a second
  -- implementation would drift, and the operator would see `ok` in the preview
  -- and `unknown_id` at send time for the same id.
  v_resolved := public.admin_esign_resolve_employees(
    jsonb_build_array(jsonb_build_object('employee_id', v_emp))
  );
  IF COALESCE((v_resolved->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', COALESCE(v_resolved->>'error', 'resolve_failed'));
  END IF;
  v_first := v_resolved->'rows'->0;
  v_status := COALESCE(v_first->>'status', 'unknown_id');

  UPDATE public.esign_batch_rows
     SET employee_id = v_emp,
         driver_id = NULLIF(v_first->>'driver_id', '')::uuid,
         field_values = COALESCE(p_field_values, field_values),
         -- An unresolvable id is stored as `failed` with its code, not as a
         -- pending row with a note: `failed` is what the sender's chunk driver
         -- and the batch counter already understand, so a row fixed to a bad id
         -- behaves exactly like one that failed to send, including the Retry
         -- path and the partial status.
         status = CASE WHEN v_status = 'ok' THEN 'pending' ELSE 'failed' END,
         error = CASE WHEN v_status = 'ok' THEN NULL ELSE v_status END,
         updated_at = now()
   WHERE id = p_row_id;

  PERFORM public._esign_batch_recount(v_row.batch_id);

  RETURN jsonb_build_object('ok', true, 'status', v_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remove_esign_batch_row(p_row_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.esign_batch_rows%ROWTYPE;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  SELECT * INTO v_row FROM public.esign_batch_rows WHERE id = p_row_id;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_row.status = 'created' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_sent');
  END IF;

  DELETE FROM public.esign_batch_rows WHERE id = p_row_id;
  PERFORM public._esign_batch_recount(v_row.batch_id);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
--
-- Re-applied because the DROP above discarded the claim function's ACL and
-- because the three new functions would otherwise carry Postgres' default
-- PUBLIC EXECUTE — which in this schema means every rider.

REVOKE ALL ON FUNCTION public._esign_batch_recount(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_claim_esign_batch_rows(uuid, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_claim_esign_batch_rows(uuid, int, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_update_esign_batch_row(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_esign_batch_row(uuid, text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_remove_esign_batch_row(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_esign_batch_row(uuid) TO authenticated, service_role;
