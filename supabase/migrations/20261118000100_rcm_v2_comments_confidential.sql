-- RCM V2: staff comments (never rider-readable) and confidential complaints.
--
-- A complaint is confidential by default. The list must not print the sender.
-- Opening the detail is the reveal, and that reveal is logged. `admin_get_request`
-- stays the same signature so every existing caller still works.

ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS is_confidential boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.request_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.profiles(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT request_comments_body_present CHECK (btrim(body) <> '')
);

CREATE INDEX IF NOT EXISTS request_comments_request_idx
  ON public.request_comments (request_id, created_at);

ALTER TABLE public.request_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS request_comments_staff_read ON public.request_comments;
CREATE POLICY request_comments_staff_read ON public.request_comments
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

CREATE TABLE IF NOT EXISTS public.request_confidential_views (
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES public.profiles(id),
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, viewer_id)
);

ALTER TABLE public.request_confidential_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS request_confidential_views_staff_read ON public.request_confidential_views;
CREATE POLICY request_confidential_views_staff_read ON public.request_confidential_views
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

CREATE OR REPLACE FUNCTION public.requests_stamp_confidential()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.request_type = 'complaint' THEN
    NEW.is_confidential := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS requests_stamp_confidential ON public.requests;
CREATE TRIGGER requests_stamp_confidential
  BEFORE INSERT ON public.requests
  FOR EACH ROW
  EXECUTE FUNCTION public.requests_stamp_confidential();

UPDATE public.requests
   SET is_confidential = true
 WHERE request_type = 'complaint'
   AND is_confidential = false;

CREATE OR REPLACE FUNCTION public.admin_add_request_comment(
  p_request_id uuid,
  p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_body text := btrim(COALESCE(p_body, ''));
  v_id uuid;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT (
       public.staff_has_permission('requests.view')
       OR public.staff_has_permission('requests.manage')
       OR public.staff_has_permission('requests.approve')
     ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF p_request_id IS NULL OR v_body = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_fields');
  END IF;
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.requests WHERE id = p_request_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  INSERT INTO public.request_comments (request_id, author_id, body)
  VALUES (p_request_id, v_uid, v_body)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.requests%ROWTYPE;
  v_uid uuid := auth.uid();
  v_sender_name text;
  v_sender_code text;
  v_employee_id text;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.view') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  SELECT * INTO v_req FROM public.requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  PERFORM public.admin_clear_request_attention(p_request_id);
  SELECT * INTO v_req FROM public.requests WHERE id = p_request_id;

  IF v_req.is_confidential AND v_uid IS NOT NULL THEN
    INSERT INTO public.request_confidential_views (request_id, viewer_id)
    VALUES (p_request_id, v_uid)
    ON CONFLICT (request_id, viewer_id) DO UPDATE
      SET viewed_at = now();
  END IF;

  SELECT p.full_name, d.driver_code, d.employee_id
    INTO v_sender_name, v_sender_code, v_employee_id
  FROM public.drivers d
  LEFT JOIN public.profiles p ON p.id = d.id
  WHERE d.id = v_req.driver_id;

  RETURN jsonb_build_object(
    'ok', true,
    'request', to_jsonb(v_req),
    'sender', jsonb_build_object(
      'name', v_sender_name,
      'driver_code', v_sender_code,
      'employee_id', v_employee_id
    ),
    'confidential_revealed', v_req.is_confidential,
    'comments', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'body', c.body,
          'author_id', c.author_id,
          'author_name', p.full_name,
          'created_at', c.created_at
        ) ORDER BY c.created_at
      )
      FROM public.request_comments c
      LEFT JOIN public.profiles p ON p.id = c.author_id
      WHERE c.request_id = p_request_id
    ), '[]'::jsonb),
    'forwards', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', f.id,
          'from_user', f.from_user,
          'to_user', f.to_user,
          'note', f.note,
          'created_at', f.created_at
        ) ORDER BY f.created_at
      )
      FROM public.request_forwards f
      WHERE f.request_id = p_request_id
    ), '[]'::jsonb),
    'steps', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'step_order')::int)
      FROM (
        SELECT to_jsonb(s) || jsonb_build_object(
          'allowed_actions',
          COALESCE(
            (SELECT t.allowed_actions FROM public.request_approval_step_templates t
             WHERE t.request_type = v_req.request_type AND t.step_order = s.step_order),
            ARRAY[]::text[]
          )
        ) AS x
        FROM public.request_approval_steps s WHERE s.request_id = p_request_id
      ) rows
    ), '[]'::jsonb),
    'clarifications', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.asked_at)
      FROM public.request_clarifications c WHERE c.request_id = p_request_id
    ), '[]'::jsonb),
    'attachments', COALESCE((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at)
      FROM public.request_attachments a WHERE a.request_id = p_request_id
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_request_comment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_request_comment(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_get_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_request(uuid) TO authenticated, service_role;
