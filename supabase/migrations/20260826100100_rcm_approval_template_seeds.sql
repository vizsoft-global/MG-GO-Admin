-- Seed approval templates from §4 matrix (Leave = drawer chain).
-- Separate migration so new request_type enum values are usable after commit.

INSERT INTO public.request_approval_step_templates (
  request_type, step_order, step_name, role_key, is_system_auto, allowed_actions
) VALUES
  -- Loan / Advance
  ('loan', 1, 'Submitted', 'system', true, ARRAY[]::text[]),
  ('loan', 2, 'HR verified', 'hr', false, ARRAY['approve', 'reject']),
  ('loan', 3, 'Pending — Accounts', 'accounts', false, ARRAY['approve', 'reject']),
  ('loan', 4, 'Managers approval', 'managers', false, ARRAY['approve', 'reject']),
  -- Leave (CLIENT CONFIRMED)
  ('leave', 1, 'Submitted', 'system', true, ARRAY[]::text[]),
  ('leave', 2, 'Reporting Manager', 'reporting_manager', false, ARRAY['approve', 'reject', 'reschedule']),
  ('leave', 3, 'HR', 'hr', false, ARRAY['approve', 'reject', 'reschedule']),
  ('leave', 4, 'Payroll', 'payroll', false, ARRAY['approve', 'reject']),
  -- Sick & accident
  ('sick_leave', 1, 'Submitted', 'system', true, ARRAY[]::text[]),
  ('sick_leave', 2, 'Verified by HR', 'hr', false, ARRAY['approve', 'reject']),
  ('sick_leave', 3, 'Pending — HR review', 'hr', false, ARRAY['request_documents', 'reject']),
  ('sick_leave', 4, 'Documents received', 'hr', false, ARRAY['approve', 'reject']),
  -- Asset
  ('asset', 1, 'Submitted', 'system', true, ARRAY[]::text[]),
  ('asset', 2, 'Manager approved', 'manager', false, ARRAY['approve', 'reject']),
  ('asset', 3, 'Pending — Ops & Fleet', 'ops_fleet', false, ARRAY['approve', 'reject']),
  ('asset', 4, 'Accounts (cost)', 'accounts', false, ARRAY['approve', 'reject']),
  -- Fuel
  ('fuel', 1, 'Submitted', 'system', true, ARRAY[]::text[]),
  ('fuel', 2, 'Manager verified', 'manager', false, ARRAY['approve', 'reject']),
  ('fuel', 3, 'Under review — Accounts', 'accounts', false, ARRAY['approve', 'reject']),
  ('fuel', 4, 'Payout', 'accounts', false, ARRAY['approve', 'reject']),
  -- Document
  ('document', 1, 'Submitted', 'system', true, ARRAY[]::text[]),
  ('document', 2, 'Verified by HR', 'hr', false, ARRAY['approve', 'reject']),
  ('document', 3, 'Pending — Admin to issue', 'admin', false, ARRAY['attach_send', 'reject']),
  ('document', 4, 'Document issued', 'admin', false, ARRAY['approve']),
  -- Complaint
  ('complaint', 1, 'Submitted', 'system', true, ARRAY[]::text[]),
  ('complaint', 2, 'Routed to Accounts', 'accounts', false, ARRAY['approve', 'reject']),
  ('complaint', 3, 'Under review — Accounts', 'accounts', false, ARRAY['send_response', 'escalate']),
  ('complaint', 4, 'Resolution', 'accounts', false, ARRAY['approve', 'reject']),
  -- Salary justification
  ('salary_justification', 1, 'Submitted', 'system', true, ARRAY[]::text[]),
  ('salary_justification', 2, 'Routed to Accounts', 'accounts', false, ARRAY['approve', 'reject']),
  ('salary_justification', 3, 'Under review — Accounts', 'accounts', false, ARRAY['send_response', 'attach_breakdown']),
  ('salary_justification', 4, 'Resolution', 'accounts', false, ARRAY['approve', 'reject'])
ON CONFLICT (request_type, step_order) DO UPDATE SET
  step_name = EXCLUDED.step_name,
  role_key = EXCLUDED.role_key,
  is_system_auto = EXCLUDED.is_system_auto,
  allowed_actions = EXCLUDED.allowed_actions,
  updated_at = now();
