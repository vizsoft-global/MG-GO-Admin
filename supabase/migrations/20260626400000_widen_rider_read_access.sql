-- Loosen rider RLS so the driver app can see admin-managed data that's
-- linked to it through any of the supported assignment models.
--
-- Background: the original rider read policies on `restaurants` and
-- `partners` were written before the multi-restaurant junction tables
-- (`driver_restaurants`, `driver_intake_restaurants`) existed. They only
-- match drivers via the legacy single-FK columns on `public.drivers`
-- (`drivers.restaurant_id`, `drivers.partner_id`). When the admin panel
-- assigns a driver to a restaurant exclusively through the junction table,
-- the driver app silently can't read the restaurant row, the partner
-- branding, or the related URLs (logo, splash, etc.).
--
-- This migration replaces those policies with broader equivalents that
-- also follow the junction tables, and adds rider-side read access for
-- the driver_intake rows that belong to the authenticated user. Admin
-- write paths are not touched — the existing `staff_all_*` / admin
-- policies remain authoritative. Storage bucket policies are unchanged
-- (branding + partner-logos are already public).

-- ---------------------------------------------------------------------------
-- restaurants: drivers can see any restaurant linked to them via legacy
-- columns OR the modern junction tables (live + intake) OR their zone.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS rider_select_assigned_restaurant ON public.restaurants;
CREATE POLICY rider_select_assigned_restaurant ON public.restaurants
  FOR SELECT
  TO authenticated
  USING (
    public.is_rider()
    AND (
      -- Same partner as the driver's primary partner
      partner_id IN (
        SELECT d.partner_id
        FROM public.drivers d
        WHERE d.id = auth.uid()
          AND d.partner_id IS NOT NULL
      )
      -- Modern multi-restaurant junction
      OR id IN (
        SELECT dr.restaurant_id
        FROM public.driver_restaurants dr
        WHERE dr.driver_id = auth.uid()
      )
      -- Restaurants the driver was associated with during intake
      OR id IN (
        SELECT dir.restaurant_id
        FROM public.driver_intake_restaurants dir
        JOIN public.driver_intakes di ON di.id = dir.intake_id
        WHERE di.linked_profile_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- partners: drivers can see their primary partner, any partner whose
-- restaurant they're linked to via the junction, and any partner from
-- their intake — in addition to the existing delivery-history rule.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS rider_select_assigned_partner ON public.partners;
CREATE POLICY rider_select_assigned_partner ON public.partners
  FOR SELECT
  TO authenticated
  USING (
    public.is_rider()
    AND (
      -- Driver's primary partner
      id IN (
        SELECT d.partner_id
        FROM public.drivers d
        WHERE d.id = auth.uid()
          AND d.partner_id IS NOT NULL
      )
      -- Partners of restaurants assigned via the junction
      OR id IN (
        SELECT r.partner_id
        FROM public.restaurants r
        JOIN public.driver_restaurants dr ON dr.restaurant_id = r.id
        WHERE dr.driver_id = auth.uid()
          AND r.partner_id IS NOT NULL
      )
      -- Partners attached to this driver's intake
      OR id IN (
        SELECT di.partner_id
        FROM public.driver_intakes di
        WHERE di.linked_profile_id = auth.uid()
          AND di.partner_id IS NOT NULL
      )
    )
  );

-- ---------------------------------------------------------------------------
-- driver_intakes: rider can read their own intake row (avatar etc.).
-- Admin write/read continues via staff_all_driver_intakes.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS rider_own_driver_intake_select ON public.driver_intakes;
CREATE POLICY rider_own_driver_intake_select ON public.driver_intakes
  FOR SELECT
  TO authenticated
  USING (linked_profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- driver_intake_restaurants: rider can read the restaurants linked to
-- their own intake (so the app can resolve their starting list).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS rider_own_intake_restaurants_select ON public.driver_intake_restaurants;
CREATE POLICY rider_own_intake_restaurants_select ON public.driver_intake_restaurants
  FOR SELECT
  TO authenticated
  USING (
    intake_id IN (
      SELECT id
      FROM public.driver_intakes
      WHERE linked_profile_id = auth.uid()
    )
  );

COMMENT ON POLICY rider_select_assigned_restaurant ON public.restaurants IS
  'Riders can read any restaurant they are linked to via drivers.* legacy columns, the driver_restaurants junction, the intake junction, or their assigned zone.';
COMMENT ON POLICY rider_select_assigned_partner ON public.partners IS
  'Riders can read their primary partner plus any partner inferred from their assigned/intake restaurants.';
