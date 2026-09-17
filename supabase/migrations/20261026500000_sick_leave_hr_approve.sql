-- Sick leave step 3 (Pending — HR review) needs Approve once a medical
-- certificate is already on the request. Live steps have no allowed_actions
-- column — admin_get_request joins templates — so updating the template
-- covers already-pending rows too.

UPDATE public.request_approval_step_templates
SET allowed_actions = ARRAY['approve', 'request_documents', 'reject']::text[]
WHERE request_type = 'sick_leave'
  AND step_order = 3;
