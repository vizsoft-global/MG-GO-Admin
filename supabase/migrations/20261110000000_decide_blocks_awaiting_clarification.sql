-- QA #11 — a request waiting on the rider could still be approved.
--
-- `admin_decide_request` guards only `rescheduled` (`awaiting_driver_reschedule`).
-- A request in `needs_clarification` has a question out with the rider, and the
-- panel still rendered the full decide row — Approve / Solve / Reschedule all
-- sent a decision for a step the rider had not answered. The client gate is
-- fixed in the same change (`isAwaitingDriverClarification`), but the panel
-- writes through PostgREST and bulk approve bypasses the detail page entirely,
-- so the lock has to exist here too.
--
-- Only `reject` and a further `clarify` are allowed while the rider owes an
-- answer: an operator must still be able to close the request out, and asking a
-- sharper question is a legitimate correction. Everything that advances the
-- request (approve / solve / reschedule / send_response / request_documents /
-- attach_*) is refused with `awaiting_driver_clarification`.
--
-- The replacement is applied by patching the live definition rather than by
-- restating the ~370-line body: restating it would be a second copy that can
-- drift from the deployed function, and the `DO` block fails loudly if the
-- anchor it expects is not there. Everything outside the anchor is byte-identical.

DO $$
DECLARE
  v_def text;
  v_patched text;
  v_anchor text := $anchor$
  IF v_req.status = 'rescheduled' AND v_action <> 'clarify' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'awaiting_driver_reschedule');
  END IF;
$anchor$;
  v_replacement text := $replacement$
  IF v_req.status = 'rescheduled' AND v_action <> 'clarify' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'awaiting_driver_reschedule');
  END IF;

  -- The rider has an open question from this step. Nothing may advance the
  -- request until they answer it; only reject and a further clarify are allowed.
  IF v_req.status = 'needs_clarification'
     AND v_action NOT IN ('clarify', 'reject') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'awaiting_driver_clarification');
  END IF;
$replacement$;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'admin_decide_request';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'admin_decide_request not found';
  END IF;

  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION
      'admin_decide_request: reschedule guard anchor not found — the body moved, patch it explicitly';
  END IF;

  v_patched := replace(v_def, v_anchor, v_replacement);

  IF v_patched = v_def THEN
    RAISE EXCEPTION 'admin_decide_request: patch produced no change';
  END IF;

  EXECUTE v_patched;
END;
$$;

COMMENT ON FUNCTION public.admin_decide_request(uuid, text, text, jsonb) IS
  'Staff decision on a request step. Refuses to advance a request while the rider owes a reschedule reply (`awaiting_driver_reschedule`) or a clarification answer (`awaiting_driver_clarification`); only reject/clarify are accepted in those states.';
