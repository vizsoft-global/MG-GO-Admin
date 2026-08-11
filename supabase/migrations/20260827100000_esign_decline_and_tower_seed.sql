-- Flutter pin-to-pin Figma QA fixes (plan §11A):
-- 1. RSup/25 Sign Viewer needs a real Decline action. `esign_request_status`
--    already has a `cancelled` state (used nowhere yet) — reuse it instead of
--    inventing a new enum value. Decline reason is stashed in `signer_meta`
--    since there is no dedicated column.
-- 2. RSup/11 Tower Intro shows "Musallam Central Tower" in Figma; the seeded
--    `visit_branches` row was named "Central Tower" — data correction only,
--    no schema change (address/hours/contact remain unset — Flutter renders
--    Figma's static copy for those, documented in code).

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
  WHERE id = p_id AND driver_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  UPDATE public.esign_requests
  SET status = 'cancelled',
      signer_meta = COALESCE(v_req.signer_meta, '{}'::jsonb) || jsonb_build_object(
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

UPDATE public.visit_branches
SET name = 'Musallam Central Tower', updated_at = now()
WHERE key = 'central_tower' AND name = 'Central Tower';
