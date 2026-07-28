-- Fix RLS recursion between `delivery_rules` and `delivery_rule_scopes`.
--
-- Background:
--   * `driver_read_delivery_rules` (on delivery_rules) inlines a subquery
--     against `delivery_rule_scopes`.
--   * `driver_read_delivery_rule_scopes` (on delivery_rule_scopes) inlines a
--     subquery against `delivery_rules`.
--   Postgres detects the cycle and aborts with code 42P17 ("infinite
--   recursion detected in policy for relation 'delivery_rule_scopes'") any
--   time these tables are touched -- including admin INSERTs that read the
--   freshly inserted row back through PostgREST's default RETURNING.
--
-- Fix mirrors the pattern already used for incentives: move the cross-table
-- lookup into a SECURITY DEFINER helper so the RLS evaluator does not
-- re-enter the policy on the joined table.
--
-- Admin write paths (`staff_all_*` / `*_admin`) are untouched.

CREATE OR REPLACE FUNCTION public.delivery_rule_matches_driver(
  p_rule_id uuid,
  p_driver_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.delivery_rules dr
    JOIN public.delivery_rule_scopes s ON s.delivery_rule_id = dr.id
    JOIN public.drivers d ON d.id = p_driver_id
    WHERE dr.id = p_rule_id
      AND dr.status = 'active'::public.rule_status
      AND (now() AT TIME ZONE 'Asia/Kuwait')::date
            BETWEEN dr.start_date AND dr.end_date
      AND (
        (dr.scope_type = 'zone'::public.rule_scope_type
          AND s.zone_id = d.zone_id)
        OR (
          dr.scope_type = 'partner'::public.rule_scope_type
          AND (
            s.partner_id = d.partner_id
            OR s.partner_id IN (
              SELECT r.partner_id
              FROM public.restaurants r
              JOIN public.driver_restaurants dr2 ON dr2.restaurant_id = r.id
              WHERE dr2.driver_id = p_driver_id
                AND r.partner_id IS NOT NULL
            )
          )
        )
        OR (
          dr.scope_type = 'restaurant'::public.rule_scope_type
          AND s.restaurant_id IN (
            SELECT dr2.restaurant_id
            FROM public.driver_restaurants dr2
            WHERE dr2.driver_id = p_driver_id
          )
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.delivery_rule_matches_driver(uuid, uuid)
  TO authenticated, service_role;

DROP POLICY IF EXISTS driver_read_delivery_rules ON public.delivery_rules;
CREATE POLICY driver_read_delivery_rules ON public.delivery_rules
  FOR SELECT
  TO authenticated
  USING (public.delivery_rule_matches_driver(id, auth.uid()));

DROP POLICY IF EXISTS driver_read_delivery_rule_scopes ON public.delivery_rule_scopes;
CREATE POLICY driver_read_delivery_rule_scopes ON public.delivery_rule_scopes
  FOR SELECT
  TO authenticated
  USING (
    public.delivery_rule_matches_driver(delivery_rule_id, auth.uid())
  );

COMMENT ON FUNCTION public.delivery_rule_matches_driver(uuid, uuid) IS
  'Returns true if the given delivery rule is currently active and applies '
  'to the given driver via legacy partner_id, junction-derived partners, or '
  'driver_restaurants assignments. SECURITY DEFINER so it can be called from '
  'RLS policies on delivery_rules and delivery_rule_scopes without causing '
  'infinite recursion.';
