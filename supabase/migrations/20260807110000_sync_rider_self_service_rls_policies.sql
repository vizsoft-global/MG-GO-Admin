-- Reconcile rider self-service RLS policies that existed on the original
-- (testing) project but were never captured in migrations, so the production
-- project (built from a clean `db push`) was missing them.
--
-- These cover the driver/rider mobile app (read/write own driver, sessions,
-- deliveries) and authenticated read + staff write on zones. They do not affect
-- the admin panel. Definitions match the testing project byte-for-byte.
--
-- NOTE: testing also has `companies_*` and per-user `notif_*` policies that are
-- intentionally NOT included here because their underlying schema differs on
-- production (the `companies` table is absent and `notifications` has a
-- different, broadcast-style shape with no `user_id`). Those require a schema
-- reconciliation before the matching policies can be applied.
--
-- Idempotent: safe to re-run.

-- drivers (rider self-service) ---------------------------------------------
DROP POLICY IF EXISTS rider_select_own_driver ON public.drivers;
CREATE POLICY rider_select_own_driver ON public.drivers
  FOR SELECT TO authenticated
  USING ((id = auth.uid()) AND public.is_rider());

DROP POLICY IF EXISTS rider_update_own_driver ON public.drivers;
CREATE POLICY rider_update_own_driver ON public.drivers
  FOR UPDATE TO authenticated
  USING ((id = auth.uid()) AND public.is_rider())
  WITH CHECK (id = auth.uid());

-- driver_sessions (rider self-service) -------------------------------------
DROP POLICY IF EXISTS rider_insert_own_sessions ON public.driver_sessions;
CREATE POLICY rider_insert_own_sessions ON public.driver_sessions
  FOR INSERT TO authenticated
  WITH CHECK ((driver_id = auth.uid()) AND public.is_rider());

DROP POLICY IF EXISTS rider_select_own_sessions ON public.driver_sessions;
CREATE POLICY rider_select_own_sessions ON public.driver_sessions
  FOR SELECT TO authenticated
  USING ((driver_id = auth.uid()) AND public.is_rider());

DROP POLICY IF EXISTS rider_update_own_sessions ON public.driver_sessions;
CREATE POLICY rider_update_own_sessions ON public.driver_sessions
  FOR UPDATE TO authenticated
  USING ((driver_id = auth.uid()) AND public.is_rider())
  WITH CHECK (driver_id = auth.uid());

-- deliveries (rider self-service) ------------------------------------------
DROP POLICY IF EXISTS rider_select_own_deliveries ON public.deliveries;
CREATE POLICY rider_select_own_deliveries ON public.deliveries
  FOR SELECT TO authenticated
  USING ((driver_id = auth.uid()) AND public.is_rider());

DROP POLICY IF EXISTS rider_insert_own_deliveries ON public.deliveries;
CREATE POLICY rider_insert_own_deliveries ON public.deliveries
  FOR INSERT TO authenticated
  WITH CHECK (
    (driver_id = auth.uid())
    AND public.is_rider()
    AND (NOT (partner_id IS DISTINCT FROM (SELECT d.partner_id FROM public.drivers d WHERE d.id = auth.uid())))
    AND (NOT (zone_id IS DISTINCT FROM (SELECT d.zone_id FROM public.drivers d WHERE d.id = auth.uid())))
  );

-- zones --------------------------------------------------------------------
DROP POLICY IF EXISTS zones_select_authenticated ON public.zones;
CREATE POLICY zones_select_authenticated ON public.zones
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS zones_staff_write ON public.zones;
CREATE POLICY zones_staff_write ON public.zones
  FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());
