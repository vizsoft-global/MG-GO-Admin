-- DPD Control Tower core schema (admin panel + driver app surface)

-- Enums
DO $$ BEGIN
  CREATE TYPE public.driver_status AS ENUM ('active', 'suspended', 'pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.vehicle_status AS ENUM ('active', 'suspended', 'maintenance');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.project_type AS ENUM ('group', 'rent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.delivery_status AS ENUM ('pending', 'verified', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.attendance_status AS ENUM ('present', 'late', 'absent', 'on_leave');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.zone_compliance AS ENUM ('inside', 'outside');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.wrong_action_type AS ENUM ('delay', 'zone_breach', 'hygiene_failed', 'uniform', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.severity_level AS ENUM ('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.wrong_action_source AS ENUM ('system', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.request_type AS ENUM ('loan', 'leave', 'fuel', 'complaint', 'document');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.request_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.document_type AS ENUM ('license', 'civil_id', 'work_permit', 'passport');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.asset_type AS ENUM ('gps', 'sim', 'phone', 'delivery_bag', 'helmet', 'uniform');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.offer_type AS ENUM ('daily', 'weekly', 'monthly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.offer_status AS ENUM ('draft', 'active', 'ended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.hygiene_task_status AS ENUM ('draft', 'active', 'ended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.hygiene_submission_status AS ENUM ('pending', 'completed', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_status AS ENUM ('draft', 'scheduled', 'sent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_click_action AS ENUM (
    'hygiene_task', 'home', 'deliveries', 'vehicle', 'profile', 'custom_link'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.support_ticket_status AS ENUM ('open', 'resolved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.thread_status AS ENUM ('active', 'resolved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.message_sender AS ENUM ('driver', 'staff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.appointment_status AS ENUM ('scheduled', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Partners (Talabat, Door Dash, etc.)
CREATE TABLE IF NOT EXISTS public.partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  logo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Zones
CREATE TABLE IF NOT EXISTS public.zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  polygon jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Drivers (1:1 with profiles where role = rider)
CREATE TABLE IF NOT EXISTS public.drivers (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  driver_code text NOT NULL UNIQUE,
  partner_id uuid REFERENCES public.partners(id),
  zone_id uuid REFERENCES public.zones(id),
  civil_id text,
  status public.driver_status NOT NULL DEFAULT 'pending',
  base_earnings_kwd numeric(10, 3) DEFAULT 0,
  joined_at date,
  is_on_duty boolean NOT NULL DEFAULT false,
  current_lat numeric(10, 7),
  current_lng numeric(10, 7),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  doc_type public.document_type NOT NULL,
  file_url text NOT NULL,
  expires_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  asset public.asset_type NOT NULL,
  issued boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, asset)
);

-- Vehicles
CREATE TABLE IF NOT EXISTS public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bike_id text NOT NULL UNIQUE,
  reg_number text,
  make text,
  model text,
  project_type public.project_type NOT NULL DEFAULT 'group',
  status public.vehicle_status NOT NULL DEFAULT 'active',
  current_driver_id uuid REFERENCES public.drivers(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicles(id);

-- Deliveries
CREATE TABLE IF NOT EXISTS public.deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES public.partners(id),
  zone_id uuid REFERENCES public.zones(id),
  external_order_id text,
  order_proof_url text,
  status public.delivery_status NOT NULL DEFAULT 'pending',
  rejection_reason text,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Attendance
CREATE TABLE IF NOT EXISTS public.attendance_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  log_date date NOT NULL,
  check_in_at timestamptz,
  check_out_at timestamptz,
  status public.attendance_status NOT NULL DEFAULT 'present',
  zone_compliance public.zone_compliance,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, log_date)
);

-- Wrong actions
CREATE TABLE IF NOT EXISTS public.wrong_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  action_type public.wrong_action_type NOT NULL,
  severity public.severity_level NOT NULL DEFAULT 'medium',
  details text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source public.wrong_action_source NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Hygiene
CREATE TABLE IF NOT EXISTS public.hygiene_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  audience_filter jsonb NOT NULL DEFAULT '{}',
  window_start timestamptz,
  window_end timestamptz,
  status public.hygiene_task_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hygiene_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.hygiene_tasks(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  photo_url text,
  status public.hygiene_submission_status NOT NULL DEFAULT 'pending',
  penalty_kwd numeric(10, 3) DEFAULT 0,
  info text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, driver_id)
);

-- Requests (loan, leave, fuel, complaint, document)
CREATE TABLE IF NOT EXISTS public.requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_code text NOT NULL UNIQUE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  request_type public.request_type NOT NULL,
  status public.request_status NOT NULL DEFAULT 'pending',
  amount_kwd numeric(10, 3),
  start_date date,
  end_date date,
  details text,
  attachment_url text,
  decision_reason text,
  decided_by uuid REFERENCES public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.loan_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES public.requests(id) ON DELETE CASCADE,
  total_kwd numeric(10, 3) NOT NULL,
  deduction_kwd numeric(10, 3) NOT NULL,
  months int NOT NULL,
  installment_remaining int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Earnings & offers
CREATE TABLE IF NOT EXISTS public.offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  offer_type public.offer_type NOT NULL,
  zone_id uuid REFERENCES public.zones(id),
  target_deliveries int NOT NULL DEFAULT 0,
  reward_kwd numeric(10, 3) NOT NULL DEFAULT 0,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status public.offer_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_earnings_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  earn_date date NOT NULL,
  deliveries int NOT NULL DEFAULT 0,
  base_kwd numeric(10, 3) NOT NULL DEFAULT 0,
  incentive_kwd numeric(10, 3) NOT NULL DEFAULT 0,
  loan_deduction_kwd numeric(10, 3) NOT NULL DEFAULT 0,
  penalty_kwd numeric(10, 3) NOT NULL DEFAULT 0,
  reimbursement_kwd numeric(10, 3) NOT NULL DEFAULT 0,
  net_kwd numeric(10, 3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, earn_date)
);

-- Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  audience_filter jsonb NOT NULL DEFAULT '{}',
  on_click_action public.notification_click_action NOT NULL DEFAULT 'home',
  link_url text,
  scheduled_for timestamptz,
  sent_at timestamptz,
  status public.notification_status NOT NULL DEFAULT 'draft',
  recipient_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Support
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  category text NOT NULL,
  issue text NOT NULL,
  status public.support_ticket_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  status public.thread_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.support_threads(id) ON DELETE CASCADE,
  sender public.message_sender NOT NULL,
  body text NOT NULL,
  attachment_url text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.appointment_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  slot_name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  capacity int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  slot_id uuid NOT NULL REFERENCES public.appointment_slots(id),
  scheduled_for timestamptz NOT NULL,
  reason text,
  status public.appointment_status NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Driver session (online state)
CREATE TABLE IF NOT EXISTS public.driver_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  is_online boolean NOT NULL DEFAULT false,
  went_online_at timestamptz,
  went_offline_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: staff full access; drivers own rows (enforced per-table in app layer + future policies)
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wrong_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hygiene_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hygiene_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_earnings_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_sessions ENABLE ROW LEVEL SECURITY;

-- Staff policies (admin panel)
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'partners','zones','drivers','driver_documents','driver_assets','vehicles',
    'deliveries','attendance_logs','wrong_actions','hygiene_tasks','hygiene_submissions',
    'requests','loan_terms','offers','driver_earnings_daily','notifications',
    'support_tickets','support_threads','support_messages','appointment_slots',
    'appointments','driver_sessions'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS staff_all_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY staff_all_%I ON public.%I FOR ALL TO authenticated USING (public.is_admin_panel_user()) WITH CHECK (public.is_admin_panel_user())',
      t, t
    );
  END LOOP;
END $$;

-- Driver RLS policies: add per-table when mobile app module ships (see docs/DRIVER_APP_HANDOFF.md)
CREATE OR REPLACE FUNCTION public.is_current_driver(driver_uuid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT driver_uuid = auth.uid();
$$;

-- Seed default partners
INSERT INTO public.partners (name, slug) VALUES
  ('Talabat', 'talabat'),
  ('Door Dash', 'doordash'),
  ('Uber Eats', 'ubereats')
ON CONFLICT (slug) DO NOTHING;
