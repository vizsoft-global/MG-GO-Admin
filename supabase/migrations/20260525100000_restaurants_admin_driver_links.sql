-- Restaurants admin permissions + driver ↔ restaurant assignments

INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('restaurants.view', 'View restaurants', 'restaurants'),
  ('restaurants.manage', 'Manage restaurants', 'restaurants')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
CROSS JOIN public.admin_permissions p
WHERE r.slug = 'super_admin'
  AND p.slug IN ('restaurants.view', 'restaurants.manage')
ON CONFLICT DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
CROSS JOIN public.admin_permissions p
WHERE r.slug = 'administrator'
  AND p.slug IN ('restaurants.view', 'restaurants.manage')
ON CONFLICT DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
CROSS JOIN public.admin_permissions p
WHERE r.slug = 'operator'
  AND p.slug = 'restaurants.view'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.driver_intake_restaurants (
  intake_id uuid NOT NULL REFERENCES public.driver_intakes (id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (intake_id, restaurant_id)
);

COMMENT ON TABLE public.driver_intake_restaurants IS 'Restaurants assigned to a driver intake (pre-app link)';

CREATE TABLE IF NOT EXISTS public.driver_restaurants (
  driver_id uuid NOT NULL REFERENCES public.drivers (id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, restaurant_id)
);

COMMENT ON TABLE public.driver_restaurants IS 'Restaurants assigned to a linked driver';

CREATE INDEX IF NOT EXISTS driver_intake_restaurants_restaurant_id_idx
  ON public.driver_intake_restaurants (restaurant_id);

CREATE INDEX IF NOT EXISTS driver_restaurants_restaurant_id_idx
  ON public.driver_restaurants (restaurant_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'driver_intake_restaurants'
      AND policyname = 'staff_all_driver_intake_restaurants'
  ) THEN
    CREATE POLICY staff_all_driver_intake_restaurants ON public.driver_intake_restaurants
      FOR ALL TO authenticated
      USING (public.is_admin_panel_user())
      WITH CHECK (public.is_admin_panel_user());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'driver_restaurants'
      AND policyname = 'staff_all_driver_restaurants'
  ) THEN
    CREATE POLICY staff_all_driver_restaurants ON public.driver_restaurants
      FOR ALL TO authenticated
      USING (public.is_admin_panel_user())
      WITH CHECK (public.is_admin_panel_user());
  END IF;
END $$;

ALTER TABLE public.driver_intake_restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_restaurants ENABLE ROW LEVEL SECURITY;

-- Copy intake restaurant assignments when the driver app links by phone
CREATE OR REPLACE FUNCTION public.mark_driver_intake_linked(
  p_phone text,
  p_profile_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count int;
BEGIN
  UPDATE public.driver_intakes
  SET
    linked = true,
    linked_profile_id = p_profile_id,
    status = 'linked',
    updated_at = now()
  WHERE phone = p_phone
    AND linked = false;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count > 0 THEN
    INSERT INTO public.driver_restaurants (driver_id, restaurant_id)
    SELECT p_profile_id, dir.restaurant_id
    FROM public.driver_intake_restaurants dir
    JOIN public.driver_intakes di ON di.id = dir.intake_id
    WHERE di.phone = p_phone
      AND di.linked_profile_id = p_profile_id
    ON CONFLICT (driver_id, restaurant_id) DO NOTHING;
  END IF;

  RETURN updated_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_driver_intake_linked(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_driver_intake_linked(text, uuid) TO service_role;
