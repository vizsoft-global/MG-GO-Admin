-- Admin pre-registration for drivers (linked on mobile OTP signup)

DO $$ BEGIN
  CREATE TYPE public.driver_intake_status AS ENUM ('awaiting_app_link', 'linked', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.driver_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  full_name text NOT NULL,
  civil_id text NOT NULL,
  driver_code text NOT NULL,
  partner_id uuid NOT NULL REFERENCES public.partners(id),
  zone_id uuid NOT NULL REFERENCES public.zones(id),
  vehicle_id uuid REFERENCES public.vehicles(id),
  assets_issued jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.driver_intake_status NOT NULL DEFAULT 'awaiting_app_link',
  linked_profile_id uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_intakes_phone_unique UNIQUE (phone),
  CONSTRAINT driver_intakes_driver_code_unique UNIQUE (driver_code)
);

CREATE INDEX IF NOT EXISTS driver_intakes_phone_idx ON public.driver_intakes (phone);
CREATE INDEX IF NOT EXISTS driver_intakes_status_idx ON public.driver_intakes (status);

COMMENT ON TABLE public.driver_intakes IS 'Admin-created driver records awaiting mobile OTP link';

ALTER TABLE public.driver_intakes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_all_driver_intakes ON public.driver_intakes;
CREATE POLICY staff_all_driver_intakes ON public.driver_intakes
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'driver-intakes',
  'driver-intakes',
  false,
  16777216,
  ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS driver_intakes_staff_read ON storage.objects;
CREATE POLICY driver_intakes_staff_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'driver-intakes' AND public.is_admin_panel_user());

DROP POLICY IF EXISTS driver_intakes_staff_write ON storage.objects;
CREATE POLICY driver_intakes_staff_write ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'driver-intakes' AND public.is_admin_panel_user())
  WITH CHECK (bucket_id = 'driver-intakes' AND public.is_admin_panel_user());
