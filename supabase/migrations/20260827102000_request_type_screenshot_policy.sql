-- Per-request-type screenshot restriction policy (Figma "14-Screenshot settings").
-- Mirrors esign_categories.screenshot_restricted so the admin screenshot settings
-- screen can show one combined "Request types" + "E-Signature categories" view.
-- Only the request types that carry sensitive documents get a row (matches Figma).

CREATE TABLE IF NOT EXISTS public.request_type_screenshot_policy (
  request_type public.request_type PRIMARY KEY,
  screenshot_restricted boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.request_type_screenshot_policy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_all_request_type_screenshot_policy ON public.request_type_screenshot_policy;
CREATE POLICY staff_all_request_type_screenshot_policy ON public.request_type_screenshot_policy
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

INSERT INTO public.request_type_screenshot_policy (request_type, screenshot_restricted)
VALUES
  ('complaint', true),
  ('salary_justification', true),
  ('sick_leave', true),
  ('loan', false),
  ('asset', false),
  ('document', false)
ON CONFLICT (request_type) DO NOTHING;
