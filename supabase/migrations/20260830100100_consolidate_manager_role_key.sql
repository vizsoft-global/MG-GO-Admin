-- The loan chain's fourth step was seeded with role_key 'managers' while the asset and fuel
-- chains use 'manager'. admin_list_requests derives its department filter from these role
-- keys, so the plural produced a second, near-identical "Managers" option that split the
-- same team's queue in two. Client confirmed: one key, 'manager'.

UPDATE public.request_approval_step_templates
SET role_key = 'manager', updated_at = now()
WHERE role_key = 'managers';

-- In-flight requests carry a copy of the role key, so they need the same correction or their
-- current step stays invisible under the consolidated department filter.
UPDATE public.request_approval_steps
SET role_key = 'manager', updated_at = now()
WHERE role_key = 'managers';
