-- RCM V2: Forward to a colleague, and Escalate as its own staff action.
--
-- Forward is not a decide. It keeps the current step open and points it at
-- one staff user, so "Forwarded to me" is a real queue rather than a note
-- nobody can filter. `requests.assigned_to` already exists; the step also
-- gets `assigned_user_id` so a later step cannot inherit a stale assignee.
--
-- Escalate writes an audit row + attention flag. It does not decide the
-- request. Closed rows are refused.

ALTER TABLE public.request_approval_steps
  ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES public.profiles(id);

CREATE TABLE IF NOT EXISTS public.request_forwards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  step_id uuid REFERENCES public.request_approval_steps(id) ON DELETE SET NULL,
  from_user uuid NOT NULL REFERENCES public.profiles(id),
  to_user uuid NOT NULL REFERENCES public.profiles(id),
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT request_forwards_note_present CHECK (btrim(note) <> ''),
  CONSTRAINT request_forwards_not_self CHECK (from_user <> to_user)
);

CREATE INDEX IF NOT EXISTS request_forwards_to_user_idx
  ON public.request_forwards (to_user, created_at DESC);
CREATE INDEX IF NOT EXISTS request_forwards_request_idx
  ON public.request_forwards (request_id, created_at DESC);

ALTER TABLE public.request_forwards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS request_forwards_staff_read ON public.request_forwards;
CREATE POLICY request_forwards_staff_read ON public.request_forwards
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

CREATE OR REPLACE FUNCTION public.admin_forward_request(
  p_request_id uuid,
  p_to_user uuid,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.requests%ROWTYPE;
  v_step public.request_approval_steps%ROWTYPE;
  v_note text := btrim(COALESCE(p_note, ''));
  v_to_name text;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT (
       public.staff_has_permission('requests.approve')
       OR public.staff_has_permission('requests.manage')
     ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF p_request_id IS NULL OR p_to_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_fields');
  END IF;
  IF v_note = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'note_required');
  END IF;
  IF v_uid IS NOT NULL AND p_to_user = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forward_to_self');
  END IF;

  SELECT * INTO v_req FROM public.requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_req.status IN ('approved', 'rejected', 'solved', 'responded', 'closed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_closed');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_to_user
      AND p.role = 'staff'
      AND p.approval_status = 'approved'
      AND p.admin_role_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_staff');
  END IF;

  SELECT NULLIF(btrim(COALESCE(p.full_name, '')), '') INTO v_to_name
  FROM public.profiles p WHERE p.id = p_to_user;

  SELECT * INTO v_step
  FROM public.request_approval_steps
  WHERE request_id = p_request_id
    AND step_order = v_req.current_step_order;

  INSERT INTO public.request_forwards (
    request_id, step_id, from_user, to_user, note
  ) VALUES (
    p_request_id, v_step.id, COALESCE(v_uid, p_to_user), p_to_user, v_note
  );

  UPDATE public.requests
     SET assigned_to = p_to_user,
         needs_attention = true,
         attention_at = now(),
         attention_reason = 'forwarded',
         updated_at = now()
   WHERE id = p_request_id;

  IF v_step.id IS NOT NULL THEN
    UPDATE public.request_approval_steps
       SET assigned_user_id = p_to_user,
           updated_at = now()
     WHERE id = v_step.id;
  END IF;

  INSERT INTO public.admin_activity_logs (
    admin_user_id, action, entity_type, entity_id, route_name, context
  ) VALUES (
    v_uid, 'update', 'requests', p_request_id, 'requests.forward',
    jsonb_build_object(
      'to_user', p_to_user,
      'to_name', v_to_name,
      'note', v_note
    )
  );

  RETURN jsonb_build_object('ok', true, 'to_user', p_to_user, 'to_name', v_to_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_escalate_request(
  p_request_id uuid,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.requests%ROWTYPE;
  v_note text := btrim(COALESCE(p_note, ''));
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT (
       public.staff_has_permission('requests.approve')
       OR public.staff_has_permission('requests.manage')
     ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_fields');
  END IF;
  IF v_note = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'note_required');
  END IF;

  SELECT * INTO v_req FROM public.requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_req.status IN ('approved', 'rejected', 'solved', 'responded', 'closed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_closed');
  END IF;

  UPDATE public.requests
     SET needs_attention = true,
         attention_at = now(),
         attention_reason = 'escalated',
         payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
           'escalated_at', now(),
           'escalated_by', v_uid,
           'escalated_note', v_note
         ),
         updated_at = now()
   WHERE id = p_request_id;

  INSERT INTO public.admin_activity_logs (
    admin_user_id, action, entity_type, entity_id, route_name, context
  ) VALUES (
    v_uid, 'update', 'requests', p_request_id, 'requests.escalate',
    jsonb_build_object('note', v_note)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_forward_request(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_forward_request(uuid, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_escalate_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_escalate_request(uuid, text) TO authenticated, service_role;
