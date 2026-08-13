-- E-Sign lifecycle timestamps as real columns.
--
-- `declined_at` and `declaration_accepted_at` were only ever written into the
-- `signer_meta` jsonb, so neither could be filtered, sorted or reported on, and
-- `viewed_at` was never recorded at all -- the Figma detail timeline has a
-- "Viewed" step that the Admin panel had to render as permanently unavailable.
--
-- `sent_at` is separated from `created_at` so the timeline reads honestly and a
-- future draft state has somewhere to land. Today the only inserter
-- (`admin_create_esign_request`) sends immediately, so the two are equal.

ALTER TABLE public.esign_requests
  ADD COLUMN IF NOT EXISTS sent_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS viewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS declaration_accepted_at timestamptz;

UPDATE public.esign_requests
SET sent_at = created_at
WHERE sent_at <> created_at;

UPDATE public.esign_requests
SET viewed_at = (signer_meta ->> 'viewed_at')::timestamptz
WHERE viewed_at IS NULL
  AND NULLIF(signer_meta ->> 'viewed_at', '') IS NOT NULL;

UPDATE public.esign_requests
SET declined_at = (signer_meta ->> 'declined_at')::timestamptz
WHERE declined_at IS NULL
  AND NULLIF(signer_meta ->> 'declined_at', '') IS NOT NULL;

-- A row that is already declined but carries no stamp still needs one, or the
-- Admin timeline shows a declined request with no moment of decline.
UPDATE public.esign_requests
SET declined_at = updated_at
WHERE declined_at IS NULL
  AND status = 'declined';

UPDATE public.esign_requests
SET declaration_accepted_at = (signer_meta ->> 'declaration_accepted_at')::timestamptz
WHERE declaration_accepted_at IS NULL
  AND NULLIF(signer_meta ->> 'declaration_accepted_at', '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_esign_requests_viewed_at
  ON public.esign_requests (viewed_at)
  WHERE viewed_at IS NOT NULL;

-- Rider opened the document. First open wins: a later re-open must not overwrite
-- the moment the rider was first shown what they are being asked to sign.
CREATE OR REPLACE FUNCTION public.driver_mark_esign_viewed(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_viewed timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  UPDATE public.esign_requests
  SET viewed_at = COALESCE(viewed_at, now()),
      updated_at = CASE WHEN viewed_at IS NULL THEN now() ELSE updated_at END
  WHERE id = p_id
    AND driver_id = v_uid
  RETURNING viewed_at INTO v_viewed;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'viewed_at', v_viewed);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.driver_mark_esign_viewed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_mark_esign_viewed(uuid) TO authenticated;

-- Decline now writes the column. `declined_reason` stays in `signer_meta`: it is
-- rider-authored evidence, not a lifecycle fact.
CREATE OR REPLACE FUNCTION public.driver_decline_esignature(p_id uuid, p_reason text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      declined_at = now(),
      -- Declining is also a view; a rider cannot refuse a document sight unseen.
      viewed_at = COALESCE(viewed_at, now()),
      signer_meta = COALESCE(signer_meta, '{}'::jsonb) || jsonb_build_object(
        'declined_reason', NULLIF(trim(COALESCE(p_reason, '')), '')
      ),
      updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'status', 'declined');
END;
$function$;

-- Submit writes `declaration_accepted_at` as a column. `signer_meta` keeps the
-- device-supplied evidence (the flag, the wording shown, its locale).
CREATE OR REPLACE FUNCTION public.driver_submit_esignature(
  p_id uuid,
  p_signature_storage_key text,
  p_signer_display_name text DEFAULT NULL::text,
  p_signer_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      declaration_accepted_at = now(),
      -- Signing is also a view, for a request whose open was never recorded
      -- (older app builds, or a deep link straight into capture).
      viewed_at = COALESCE(viewed_at, now()),
      signature_storage_key = trim(p_signature_storage_key),
      signer_display_name = NULLIF(trim(COALESCE(p_signer_display_name, '')), ''),
      signer_meta = v_meta || jsonb_build_object('declaration_accepted', true),
      updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'status', 'signed');
END;
$function$;
