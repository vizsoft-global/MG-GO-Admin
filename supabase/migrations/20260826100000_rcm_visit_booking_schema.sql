-- RCM (Request & Complaint) + Visit Booking — Phase 1 schema
-- Gated (empty until client confirms): loan_tenure_options seed, complaint_categories seed
-- Leave approval seed: Submitted → Reporting Manager → HR → Payroll (drawer authoritative)

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

ALTER TYPE public.request_type ADD VALUE IF NOT EXISTS 'sick_leave';
ALTER TYPE public.request_type ADD VALUE IF NOT EXISTS 'salary_justification';
ALTER TYPE public.request_type ADD VALUE IF NOT EXISTS 'asset';

ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'draft';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'submitted';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'in_review';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'needs_clarification';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'solved';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'overdue';

DO $$ BEGIN
  CREATE TYPE public.request_step_status AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'rejected',
    'skipped'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.request_access_level AS ENUM ('view_only', 'approver');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.visit_booking_status AS ENUM (
    'confirmed',
    'checked_in',
    'completed',
    'no_show',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2. Code sequences (RCM-#### / VIS-#####)
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.request_code_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS public.visit_booking_code_seq START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION public.allocate_request_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_num bigint;
BEGIN
  v_num := nextval('public.request_code_seq');
  RETURN 'RCM-' || lpad(v_num::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_visit_booking_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_num bigint;
BEGIN
  v_num := nextval('public.visit_booking_code_seq');
  RETURN 'VIS-' || lpad(v_num::text, 5, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_request_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_visit_booking_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_request_code() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.allocate_visit_booking_code() TO authenticated, service_role;

-- Align sequences past any existing numeric suffix on legacy codes
DO $$
DECLARE
  v_max bigint;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(request_code, '\D', '', 'g'), '')::bigint), 0)
  INTO v_max
  FROM public.requests
  WHERE request_code ~ '\d';
  IF v_max > 0 THEN
    PERFORM setval('public.request_code_seq', v_max, true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Extend requests
-- ---------------------------------------------------------------------------

ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS current_step_label text,
  ADD COLUMN IF NOT EXISTS current_step_order int,
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS needs_attention boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attention_at timestamptz,
  ADD COLUMN IF NOT EXISTS attention_cleared_at timestamptz,
  ADD COLUMN IF NOT EXISTS attention_reason text,
  ADD COLUMN IF NOT EXISTS severity public.severity_level;

COMMENT ON COLUMN public.requests.payload IS
  'Type-specific Figma field matrix (leave_type, tenure_months, category, etc.).';
COMMENT ON COLUMN public.requests.needs_attention IS
  'Admin list accent badge; cleared when staff opens the request. No admin push.';

CREATE INDEX IF NOT EXISTS requests_driver_id_created_at_idx
  ON public.requests (driver_id, created_at DESC);

CREATE INDEX IF NOT EXISTS requests_status_created_at_idx
  ON public.requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS requests_needs_attention_idx
  ON public.requests (needs_attention)
  WHERE needs_attention = true;

CREATE INDEX IF NOT EXISTS requests_type_status_idx
  ON public.requests (request_type, status);

-- ---------------------------------------------------------------------------
-- 4. Attachments + clarifications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.request_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  file_name text,
  content_type text,
  byte_size bigint,
  uploaded_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS request_attachments_request_id_idx
  ON public.request_attachments (request_id);

CREATE TABLE IF NOT EXISTS public.request_clarifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  step_order int,
  asked_by uuid REFERENCES public.profiles(id),
  asked_at timestamptz NOT NULL DEFAULT now(),
  question text NOT NULL,
  answered_at timestamptz,
  answer text,
  answer_attachment_keys text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS request_clarifications_request_id_idx
  ON public.request_clarifications (request_id, asked_at DESC);

-- ---------------------------------------------------------------------------
-- 5. Approval step templates + runtime steps
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.request_approval_step_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type public.request_type NOT NULL,
  step_order int NOT NULL,
  step_name text NOT NULL,
  role_key text NOT NULL,
  is_system_auto boolean NOT NULL DEFAULT false,
  allowed_actions text[] NOT NULL DEFAULT ARRAY['approve', 'reject']::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_type, step_order)
);

CREATE TABLE IF NOT EXISTS public.request_approval_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  step_order int NOT NULL,
  step_name text NOT NULL,
  role_key text NOT NULL,
  status public.request_step_status NOT NULL DEFAULT 'pending',
  decided_by uuid REFERENCES public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, step_order)
);

CREATE INDEX IF NOT EXISTS request_approval_steps_request_id_idx
  ON public.request_approval_steps (request_id, step_order);

-- Staff per-type View-only / Approver grants (Figma Roles)
CREATE TABLE IF NOT EXISTS public.request_staff_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  request_type public.request_type NOT NULL,
  access_level public.request_access_level NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, request_type)
);

-- Approval template seeds that reference newly added enum values run in
-- 20260826100100_rcm_approval_template_seeds.sql (separate txn after ADD VALUE).

-- ---------------------------------------------------------------------------
-- 6. Gated config tables (schema only — NO seed values)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.loan_tenure_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  months int NOT NULL UNIQUE CHECK (months > 0),
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.loan_tenure_options IS
  'REQUIRES CONFIRMATION — do not seed tenure months until client provides the list.';

CREATE TABLE IF NOT EXISTS public.complaint_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label_en text NOT NULL,
  label_ar text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.complaint_categories IS
  'REQUIRES CONFIRMATION — do not seed categories until client provides the list. Admin CRUD UI may insert later.';

-- ---------------------------------------------------------------------------
-- 7. Visit Booking: branches, departments, slots, bookings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.visit_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  address text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.visit_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label_en text NOT NULL,
  label_ar text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed User App RSup/12 departments (confirmed Figma list)
INSERT INTO public.visit_departments (key, label_en, sort_order) VALUES
  ('hr_services', 'HR Services', 10),
  ('legal', 'Legal', 20),
  ('operations_services', 'Operations Services', 30),
  ('exit_process', 'Exit Process', 40),
  ('documents_signatures', 'Documents Signatures', 50),
  ('training', 'Training', 60),
  ('meeting_request', 'Meeting Request', 70),
  ('other', 'Other', 80),
  -- Admin / My Visits alternate labels (catalog map)
  ('human_resources', 'Human resources', 90),
  ('payments_earnings', 'Payments & earnings', 100),
  ('assets_equipment', 'Assets & equipment', 110)
ON CONFLICT (key) DO UPDATE SET
  label_en = EXCLUDED.label_en,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- Default branch shown in User App (Central Tower) — no user branch picker
INSERT INTO public.visit_branches (key, name, sort_order) VALUES
  ('central_tower', 'Central Tower', 10)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.visit_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.visit_branches(id) ON DELETE SET NULL,
  department_key text REFERENCES public.visit_departments(key),
  slot_date date,
  day_of_week int CHECK (day_of_week IS NULL OR day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  capacity int NOT NULL DEFAULT 1 CHECK (capacity > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visit_slots_time_check CHECK (end_time > start_time),
  CONSTRAINT visit_slots_date_or_dow CHECK (slot_date IS NOT NULL OR day_of_week IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS visit_slots_date_dept_idx
  ON public.visit_slots (slot_date, department_key)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.visit_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_code text NOT NULL UNIQUE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  department_key text NOT NULL REFERENCES public.visit_departments(key),
  branch_id uuid REFERENCES public.visit_branches(id),
  slot_id uuid NOT NULL REFERENCES public.visit_slots(id),
  scheduled_date date NOT NULL,
  note text,
  status public.visit_booking_status NOT NULL DEFAULT 'confirmed',
  checked_in_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  rescheduled_from_id uuid REFERENCES public.visit_bookings(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visit_bookings_driver_date_idx
  ON public.visit_bookings (driver_id, scheduled_date DESC);

CREATE INDEX IF NOT EXISTS visit_bookings_status_date_idx
  ON public.visit_bookings (status, scheduled_date);

CREATE INDEX IF NOT EXISTS visit_bookings_slot_id_idx
  ON public.visit_bookings (slot_id)
  WHERE status IN ('confirmed', 'checked_in');

-- Same driver + same date + same dept blocked for active bookings (CLIENT CONFIRMED)
CREATE UNIQUE INDEX IF NOT EXISTS visit_bookings_active_driver_date_dept_uidx
  ON public.visit_bookings (driver_id, scheduled_date, department_key)
  WHERE status IN ('confirmed', 'checked_in');

-- ---------------------------------------------------------------------------
-- 8. Storage bucket (request attachments)
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'request-attachments',
  'request-attachments',
  false,
  10485760,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.request_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_clarifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_approval_step_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_approval_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_staff_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_tenure_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_bookings ENABLE ROW LEVEL SECURITY;

-- Staff: full access on new RCM/visit tables
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'request_attachments',
    'request_clarifications',
    'request_approval_step_templates',
    'request_approval_steps',
    'request_staff_access',
    'loan_tenure_options',
    'complaint_categories',
    'visit_branches',
    'visit_departments',
    'visit_slots',
    'visit_bookings'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS staff_all_%s ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY staff_all_%s ON public.%I FOR ALL TO authenticated USING (public.is_admin_panel_user()) WITH CHECK (public.is_admin_panel_user())',
      t, t
    );
  END LOOP;
END $$;

-- Drivers: own requests (select/insert); updates via RPC later
DROP POLICY IF EXISTS drivers_select_own_requests ON public.requests;
CREATE POLICY drivers_select_own_requests ON public.requests
  FOR SELECT TO authenticated
  USING (public.is_current_driver(driver_id));

DROP POLICY IF EXISTS drivers_insert_own_requests ON public.requests;
CREATE POLICY drivers_insert_own_requests ON public.requests
  FOR INSERT TO authenticated
  WITH CHECK (public.is_current_driver(driver_id));

DROP POLICY IF EXISTS drivers_select_own_request_attachments ON public.request_attachments;
CREATE POLICY drivers_select_own_request_attachments ON public.request_attachments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.requests r
      WHERE r.id = request_id AND public.is_current_driver(r.driver_id)
    )
  );

DROP POLICY IF EXISTS drivers_select_own_request_steps ON public.request_approval_steps;
CREATE POLICY drivers_select_own_request_steps ON public.request_approval_steps
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.requests r
      WHERE r.id = request_id AND public.is_current_driver(r.driver_id)
    )
  );

DROP POLICY IF EXISTS drivers_select_own_clarifications ON public.request_clarifications;
CREATE POLICY drivers_select_own_clarifications ON public.request_clarifications
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.requests r
      WHERE r.id = request_id AND public.is_current_driver(r.driver_id)
    )
  );

-- Drivers: read active tenure options / complaint categories / visit catalog
DROP POLICY IF EXISTS drivers_read_loan_tenure_options ON public.loan_tenure_options;
CREATE POLICY drivers_read_loan_tenure_options ON public.loan_tenure_options
  FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS drivers_read_complaint_categories ON public.complaint_categories;
CREATE POLICY drivers_read_complaint_categories ON public.complaint_categories
  FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS drivers_read_visit_departments ON public.visit_departments;
CREATE POLICY drivers_read_visit_departments ON public.visit_departments
  FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS drivers_read_visit_branches ON public.visit_branches;
CREATE POLICY drivers_read_visit_branches ON public.visit_branches
  FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS drivers_read_visit_slots ON public.visit_slots;
CREATE POLICY drivers_read_visit_slots ON public.visit_slots
  FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS drivers_select_own_visit_bookings ON public.visit_bookings;
CREATE POLICY drivers_select_own_visit_bookings ON public.visit_bookings
  FOR SELECT TO authenticated
  USING (public.is_current_driver(driver_id));

DROP POLICY IF EXISTS drivers_insert_own_visit_bookings ON public.visit_bookings;
CREATE POLICY drivers_insert_own_visit_bookings ON public.visit_bookings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_current_driver(driver_id));

-- Storage: staff all; drivers own folder prefix {driver_id}/
DROP POLICY IF EXISTS request_attachments_staff_all ON storage.objects;
CREATE POLICY request_attachments_staff_all ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'request-attachments'
    AND public.is_admin_panel_user()
  )
  WITH CHECK (
    bucket_id = 'request-attachments'
    AND public.is_admin_panel_user()
  );

DROP POLICY IF EXISTS request_attachments_driver_own ON storage.objects;
CREATE POLICY request_attachments_driver_own ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'request-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'request-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 10. Permissions (RCM + Visit Head Office / Operator)
-- ---------------------------------------------------------------------------

INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('requests.view', 'View requests', 'requests'),
  ('requests.manage', 'Manage requests', 'requests'),
  ('requests.approve', 'Approve / decide requests (Approver)', 'requests'),
  ('visits.view', 'View visit bookings (Head Office)', 'visits'),
  ('visits.manage_catalog', 'Manage visit slots, branches, departments (Head Office)', 'visits'),
  ('visits.operate', 'Check-in / reschedule / cancel / change visit status (Operator)', 'visits')
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category;

-- Super admin + administrator: full RCM + visit Head Office + operate
INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
CROSS JOIN (
  VALUES
    ('requests.view'),
    ('requests.manage'),
    ('requests.approve'),
    ('visits.view'),
    ('visits.manage_catalog'),
    ('visits.operate')
) AS p(slug)
WHERE r.slug IN ('super_admin', 'administrator')
ON CONFLICT DO NOTHING;

-- Operator role: visit operate + view visits (not catalog); RCM view if exists
INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
CROSS JOIN (
  VALUES
    ('requests.view'),
    ('visits.view'),
    ('visits.operate')
) AS p(slug)
WHERE r.slug = 'operator'
ON CONFLICT DO NOTHING;
