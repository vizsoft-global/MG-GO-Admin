-- Round 2: open up incentive-rule visibility to drivers and broaden the
-- partner clauses to follow junction-derived partner relationships.
--
-- Background:
-- * `incentive_rules`, `incentive_rule_scopes`, and `incentive_rule_tiers`
--   only had `staff_all_*` policies, so the driver app could not read
--   incentive payouts via the regular Supabase client. The home-dashboard
--   RPC bypasses RLS as SECURITY DEFINER, but any direct query (history
--   view, rule details, share-this-rule deep link) returned an empty set.
-- * `driver_read_delivery_rules` matched partner-scoped rules using only
--   `drivers.partner_id` (legacy primary partner). Drivers connected to
--   multiple partners via `driver_restaurants` could not see partner-
--   scoped rules from their secondary partners.
--
-- This migration adds permissive read policies for active incentives and
-- broadens the delivery-rule partner clause. Admin write paths are
-- unchanged (`staff_all_*` remain authoritative).

-- ---------------------------------------------------------------------------
-- incentive_rules: drivers can read active incentives that match them.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS driver_read_incentive_rules ON public.incentive_rules;
CREATE POLICY driver_read_incentive_rules ON public.incentive_rules
  FOR SELECT
  TO authenticated
  USING (
    status = 'active'::public.rule_status
    AND (now() AT TIME ZONE 'Asia/Kuwait')::date BETWEEN start_date AND end_date
    AND public.incentive_rule_matches_driver(id, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- incentive_rule_scopes: drivers can read scopes attached to a rule they
-- are allowed to see (active + matching them).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS driver_read_incentive_rule_scopes ON public.incentive_rule_scopes;
CREATE POLICY driver_read_incentive_rule_scopes ON public.incentive_rule_scopes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.incentive_rules ir
      WHERE ir.id = incentive_rule_scopes.incentive_rule_id
        AND ir.status = 'active'::public.rule_status
        AND (now() AT TIME ZONE 'Asia/Kuwait')::date BETWEEN ir.start_date AND ir.end_date
        AND public.incentive_rule_matches_driver(ir.id, auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- incentive_rule_tiers: same gating as the parent rule.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS driver_read_incentive_rule_tiers ON public.incentive_rule_tiers;
CREATE POLICY driver_read_incentive_rule_tiers ON public.incentive_rule_tiers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.incentive_rules ir
      WHERE ir.id = incentive_rule_tiers.incentive_rule_id
        AND ir.status = 'active'::public.rule_status
        AND (now() AT TIME ZONE 'Asia/Kuwait')::date BETWEEN ir.start_date AND ir.end_date
        AND public.incentive_rule_matches_driver(ir.id, auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- delivery_rules: broaden partner clause to also follow junction-derived
-- partners so multi-partner drivers see partner-scoped rules from every
-- partner they currently work with.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS driver_read_delivery_rules ON public.delivery_rules;
CREATE POLICY driver_read_delivery_rules ON public.delivery_rules
  FOR SELECT
  TO authenticated
  USING (
    status = 'active'::public.rule_status
    AND (now() AT TIME ZONE 'Asia/Kuwait')::date BETWEEN start_date AND end_date
    AND EXISTS (
      SELECT 1
      FROM public.delivery_rule_scopes s
      JOIN public.drivers dr ON dr.id = auth.uid()
      WHERE s.delivery_rule_id = delivery_rules.id
        AND (
          -- zone-scoped: driver's assigned zone
          (delivery_rules.scope_type = 'zone'::public.rule_scope_type
            AND s.zone_id = dr.zone_id)
          -- partner-scoped: driver's primary partner OR any partner of
          -- their junction-assigned restaurants
          OR (
            delivery_rules.scope_type = 'partner'::public.rule_scope_type
            AND (
              s.partner_id = dr.partner_id
              OR s.partner_id IN (
                SELECT r.partner_id
                FROM public.restaurants r
                JOIN public.driver_restaurants dr2 ON dr2.restaurant_id = r.id
                WHERE dr2.driver_id = auth.uid()
                  AND r.partner_id IS NOT NULL
              )
            )
          )
          -- restaurant-scoped: junction-assigned restaurants
          OR (
            delivery_rules.scope_type = 'restaurant'::public.rule_scope_type
            AND s.restaurant_id IN (
              SELECT dr2.restaurant_id
              FROM public.driver_restaurants dr2
              WHERE dr2.driver_id = auth.uid()
            )
          )
        )
    )
  );

COMMENT ON POLICY driver_read_incentive_rules ON public.incentive_rules IS
  'Drivers can read active incentive rules whose scope matches their assignments.';
COMMENT ON POLICY driver_read_delivery_rules ON public.delivery_rules IS
  'Drivers can read active delivery rules; partner-scoped rules follow legacy drivers.partner_id and any junction-derived partner.';
