-- RSup/25 Sign Viewer: Decline action. The Flutter e-sign viewer already
-- calls `driver_decline_esignature` and its `EsignRequestDetail` model
-- already expects decline to set status='cancelled' and stash
-- `declined_at`/`declined_reason` inside the existing `signer_meta` jsonb
-- bag — but the RPC itself never existed in any prior migration, so the
-- button threw at runtime. Additive fix only, matches that existing
-- Flutter-side contract (mirrors `driver_submit_esignature`).
-- Applied directly to eoksxkdssptgyqyywdju via MCP; file kept here for history.

CREATE OR REPLACE FUNCTION public.driver_decline_esignature(
  p_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  SET status = 'cancelled',
      signer_meta = COALESCE(signer_meta, '{}'::jsonb) || jsonb_build_object(
        'declined_at', now(),
        'declined_reason', NULLIF(trim(COALESCE(p_reason, '')), '')
      ),
      updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'status', 'cancelled');
END;
$$;

REVOKE ALL ON FUNCTION public.driver_decline_esignature(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_decline_esignature(uuid, text) TO authenticated;
