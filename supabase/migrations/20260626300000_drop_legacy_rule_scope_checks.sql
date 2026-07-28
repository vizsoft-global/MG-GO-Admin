-- Make rule scope check constraints idempotent fallback.
--
-- The `20260608100000_rule_scope_junctions.sql` migration introduced a
-- per-rule junction table (`delivery_rule_scopes`, `incentive_rule_scopes`)
-- and dropped the legacy single-target CHECK constraints. On databases that
-- never applied that step the inserts from the admin UI fail with a
-- 23514 "check_violation" because the old constraint required the
-- legacy zone_id / partner_id / restaurant_id column to match scope_type.
--
-- This migration is a safe re-run of that drop so future deploys can recover
-- without manual SQL intervention. We keep the new junction tables as the
-- authoritative source of truth; the legacy single-FK columns on the parent
-- tables are now optional.

ALTER TABLE public.delivery_rules
  DROP CONSTRAINT IF EXISTS delivery_rules_scope_check;

ALTER TABLE public.incentive_rules
  DROP CONSTRAINT IF EXISTS incentive_rules_scope_check;
