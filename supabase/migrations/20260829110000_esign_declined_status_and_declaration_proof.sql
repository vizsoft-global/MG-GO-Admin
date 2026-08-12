-- Two E-Sign correctness fixes found in the driver-app QA pass (plan §11A, D7 + D8).
--
-- D7 — a rider's decline was indistinguishable from an admin cancellation.
-- `driver_decline_esignature` wrote `cancelled`, even though `esign_request_status`
-- gained a dedicated `declined` value. The admin panel has always filtered and
-- counted on `declined` (esign-sent-shell.tsx, esign-signatures-shell.tsx,
-- types.ts), so its Declined tab and KPI could only ever read 0 while every real
-- decline hid in a status that is meant for admin-side cancellation.
--
-- D8 — the legal declaration was a client-side gate only. The rider ticked it,
-- the app refused to submit without it, and then nothing about that acceptance
-- reached the server. A signature is a legal artefact; if we cannot show what
-- the signer agreed to, the declaration might as well not exist. The server now
-- refuses to record a signature unless the submission carries the acceptance,
-- and stamps its own timestamp so the device cannot backdate it.
--
-- Both are breaking for the driver app: the decline path must stop treating
-- `cancelled` as "declined", and the submit path must send the acceptance.
-- Ship this with the matching driver build (see docs/DRIVER_APP_HANDOFF.md §E-Sign).

CREATE OR REPLACE FUNCTION public.driver_decline_esignature(
  p_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.esign_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_req FROM public.esign_requests
  WHERE id = p_id AND driver_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  UPDATE public.esign_requests
  SET status = 'declined',
      signer_meta = COALESCE(signer_meta, '{}'::jsonb) || jsonb_build_object(
        'declined_at', now(),
        'declined_reason', NULLIF(trim(COALESCE(p_reason, '')), '')
      ),
      updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'status', 'declined');
END;
$$;

REVOKE ALL ON FUNCTION public.driver_decline_esignature(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_decline_esignature(uuid, text) TO authenticated;

-- Any decline recorded before this migration. `cancelled` has no other writer —
-- no admin action sets it — so every existing row in that status is a rider
-- decline, identifiable by the `declined_at` the old function stamped.
UPDATE public.esign_requests
SET status = 'declined', updated_at = now()
WHERE status = 'cancelled'
  AND signer_meta ? 'declined_at';

-- Signature capture keeps its existing signature so no overload is created and
-- released clients keep resolving the same function; the declaration travels in
-- `p_signer_meta`, which the app already sends.
CREATE OR REPLACE FUNCTION public.driver_submit_esignature(
  p_id uuid,
  p_signature_storage_key text,
  p_signer_display_name text DEFAULT NULL,
  p_signer_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.esign_requests%ROWTYPE;
  v_meta jsonb := COALESCE(p_signer_meta, '{}'::jsonb);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_signature_storage_key IS NULL OR trim(p_signature_storage_key) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'signature_required');
  END IF;
  -- The acceptance itself can only ever come from the device; what the server
  -- guarantees is that a signature is never stored without it, and that the
  -- moment of acceptance is server time.
  IF COALESCE((v_meta->>'declaration_accepted')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'declaration_required');
  END IF;

  SELECT * INTO v_req FROM public.esign_requests
  WHERE id = p_id AND driver_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  UPDATE public.esign_requests
  SET status = 'signed',
      signed_at = now(),
      signature_storage_key = trim(p_signature_storage_key),
      signer_display_name = NULLIF(trim(COALESCE(p_signer_display_name, '')), ''),
      signer_meta = v_meta || jsonb_build_object(
        'declaration_accepted', true,
        'declaration_accepted_at', now()
      ),
      updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'status', 'signed');
END;
$$;

REVOKE ALL ON FUNCTION public.driver_submit_esignature(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_submit_esignature(uuid, text, text, jsonb) TO authenticated;
