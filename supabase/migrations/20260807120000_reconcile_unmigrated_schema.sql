-- Reconcile schema objects that were applied manually to the development
-- (testing) database during un-migrated development. These were never captured
-- as migrations, so the production database (built cleanly from migrations) was
-- missing them. The local codebase / generated types are the source of truth.
--
-- Idempotent and safe to run on BOTH environments:
--   * additive columns use ADD COLUMN IF NOT EXISTS
--   * constraints use DROP ... IF EXISTS then ADD
--   * the notifications rebuild is guarded so it only runs where the table is
--     still in the old broadcast/campaign shape (i.e. lacks user_id).

-- 1. Restaurant code sequence + generator -----------------------------------
CREATE SEQUENCE IF NOT EXISTS public.restaurant_code_seq;

CREATE OR REPLACE FUNCTION public.next_restaurant_code()
RETURNS text
LANGUAGE sql
AS $function$
  SELECT 'RST-' || lpad(nextval('public.restaurant_code_seq')::text, 4, '0');
$function$;

-- 2. companies --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS companies_select_authenticated ON public.companies;
CREATE POLICY companies_select_authenticated ON public.companies
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS companies_staff_write ON public.companies;
CREATE POLICY companies_staff_write ON public.companies
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

-- 3. zones.company_id -------------------------------------------------------
ALTER TABLE public.zones ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.zones DROP CONSTRAINT IF EXISTS zones_company_id_fkey;
ALTER TABLE public.zones ADD CONSTRAINT zones_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

-- 4. profiles.company_id / zone_id ------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS zone_id uuid;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_company_id_fkey;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES public.companies(id);
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_zone_id_fkey;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_zone_id_fkey
  FOREIGN KEY (zone_id) REFERENCES public.zones(id);

-- 5. vehicles.created_by ----------------------------------------------------
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_created_by_fkey;
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id);

-- 6. partners contact fields ------------------------------------------------
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS contact_phone_1 text;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS contact_phone_2 text;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS contact_role text;

-- 7. restaurants ------------------------------------------------------------
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS map_link text;
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS zone_id uuid;
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS restaurant_code text;

ALTER TABLE public.restaurants ALTER COLUMN restaurant_code SET DEFAULT public.next_restaurant_code();
UPDATE public.restaurants SET restaurant_code = public.next_restaurant_code() WHERE restaurant_code IS NULL;
ALTER TABLE public.restaurants ALTER COLUMN restaurant_code SET NOT NULL;

ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_created_by_fkey;
ALTER TABLE public.restaurants ADD CONSTRAINT restaurants_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_zone_id_fkey;
ALTER TABLE public.restaurants ADD CONSTRAINT restaurants_zone_id_fkey
  FOREIGN KEY (zone_id) REFERENCES public.zones(id) ON DELETE RESTRICT;

ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_restaurant_code_unique;
ALTER TABLE public.restaurants ADD CONSTRAINT restaurants_restaurant_code_unique UNIQUE (restaurant_code);
ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_partner_code_unique;
ALTER TABLE public.restaurants ADD CONSTRAINT restaurants_partner_code_unique UNIQUE (partner_id, restaurant_code);
ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_partner_zone_name_unique;
ALTER TABLE public.restaurants ADD CONSTRAINT restaurants_partner_zone_name_unique UNIQUE (partner_id, zone_id, name);

CREATE INDEX IF NOT EXISTS restaurants_partner_zone_idx ON public.restaurants (partner_id, zone_id);
CREATE INDEX IF NOT EXISTS restaurants_status_idx ON public.restaurants (status);
CREATE INDEX IF NOT EXISTS restaurants_zone_id_idx ON public.restaurants (zone_id);

-- 8. drivers.restaurant_id --------------------------------------------------
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS restaurant_id uuid;
ALTER TABLE public.drivers DROP CONSTRAINT IF EXISTS drivers_restaurant_id_fkey;
ALTER TABLE public.drivers ADD CONSTRAINT drivers_restaurant_id_fkey
  FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE SET NULL;

-- 9. driver_intakes.otp_code / restaurant_id --------------------------------
ALTER TABLE public.driver_intakes ADD COLUMN IF NOT EXISTS otp_code text;
ALTER TABLE public.driver_intakes ADD COLUMN IF NOT EXISTS restaurant_id uuid;
ALTER TABLE public.driver_intakes DROP CONSTRAINT IF EXISTS driver_intakes_restaurant_id_fkey;
ALTER TABLE public.driver_intakes ADD CONSTRAINT driver_intakes_restaurant_id_fkey
  FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE SET NULL;

-- 10. notifications: rebuild to the per-user inbox shape (source of truth) ---
-- Only runs where the table is still in the old broadcast/campaign shape.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'user_id'
  ) THEN
    DROP TABLE IF EXISTS public.notifications CASCADE;

    CREATE TABLE public.notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      title text NOT NULL,
      body text,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX notifications_user_idx ON public.notifications (user_id, created_at DESC);

    ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

    CREATE POLICY notif_insert_staff ON public.notifications
      FOR INSERT TO authenticated WITH CHECK (public.is_staff());
    CREATE POLICY notif_select ON public.notifications
      FOR SELECT TO authenticated USING ((user_id = auth.uid()) OR public.is_staff());
    CREATE POLICY notif_update_own ON public.notifications
      FOR UPDATE TO authenticated USING (user_id = auth.uid());
    CREATE POLICY staff_all_notifications ON public.notifications
      FOR ALL TO authenticated USING (public.is_admin_panel_user()) WITH CHECK (public.is_admin_panel_user());
  END IF;
END $$;
