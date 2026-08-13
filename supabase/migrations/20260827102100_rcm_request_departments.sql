-- RCM "08-Departments" (Figma "Departments and staff"): staff directory grouped into
-- request-handling departments (e.g. HR, Accounts, Operations & Fleet), distinct from
-- public.visit_departments (Visit Booking catalog, owned by the visits feature).
-- Departments start empty — admin creates real departments, no invented seed values.

CREATE TABLE IF NOT EXISTS public.request_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label_en text NOT NULL,
  label_ar text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.request_department_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.request_departments(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_title text NOT NULL DEFAULT 'agent' CHECK (role_title IN ('agent', 'manager')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_request_department_members_department
  ON public.request_department_members (department_id);

ALTER TABLE public.request_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_department_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_all_request_departments ON public.request_departments;
CREATE POLICY staff_all_request_departments ON public.request_departments
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS staff_all_request_department_members ON public.request_department_members;
CREATE POLICY staff_all_request_department_members ON public.request_department_members
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());
