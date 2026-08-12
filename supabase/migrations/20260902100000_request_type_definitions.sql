-- Request types become data instead of a Postgres enum.
--
-- Today a request type is `public.request_type`, an 8-value enum, and everything
-- that differs per type is hardcoded: which validation gates fire on create,
-- whether approval ends in `approved` or `solved`, and whether the rider has to
-- acknowledge. Adding a ninth type therefore means a migration plus edits in two
-- repos, which is exactly what the client asked to stop doing.
--
-- This migration only introduces the tables and seeds them so that every one of
-- the 8 built-ins is described in data. The enum columns are converted, and the
-- behaviour is actually driven off these rows, in the two migrations that follow.
--
-- The 8 built-ins are seeded as SYSTEM types: their labels, chain, SLA,
-- screenshot policy and active flag stay editable, but their FIELD SET is locked
-- until the driver app ships a generic renderer. An admin editing `leave`'s
-- fields today would immediately break every installed app build, which renders
-- that form from hardcoded Dart -- and a Play Store rollout is not instant.

CREATE TABLE IF NOT EXISTS public.request_type_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label_en text NOT NULL,
  label_ar text,
  -- Material icon name; the driver app maps it for the hub tile.
  icon_key text,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  screenshot_restricted boolean NOT NULL DEFAULT false,

  -- Where the request lands when the final approval step approves it. A
  -- complaint is not "approved", it is "solved".
  terminal_status_on_approve text NOT NULL DEFAULT 'approved',
  -- Whether final approval parks the request on the rider for acknowledgement
  -- (loan terms, asset handover, sick-leave outcome).
  requires_driver_ack_on_approve boolean NOT NULL DEFAULT false,

  -- Start/end dates are mandatory and must be ordered.
  date_range_required boolean NOT NULL DEFAULT false,
  min_attachments int NOT NULL DEFAULT 0,
  -- Error code returned when `min_attachments` is not met, so legacy codes the
  -- driver app already translates survive.
  attachments_error_code text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT request_type_definitions_key_format
    CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT request_type_definitions_terminal_status
    CHECK (terminal_status_on_approve IN ('approved', 'solved')),
  CONSTRAINT request_type_definitions_min_attachments
    CHECK (min_attachments >= 0)
);

COMMENT ON TABLE public.request_type_definitions IS
  'One row per request type. Replaces the request_type enum; is_system rows have a locked field set.';
COMMENT ON COLUMN public.request_type_definitions.is_system IS
  'Built-in type. Field set is locked because installed driver-app builds render it from hardcoded Dart.';

CREATE TABLE IF NOT EXISTS public.request_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_key text NOT NULL
    REFERENCES public.request_type_definitions(key) ON UPDATE CASCADE ON DELETE CASCADE,
  field_key text NOT NULL,
  label_en text NOT NULL,
  label_ar text,
  kind text NOT NULL,

  -- Most fields live in `requests.payload`. A few map onto real columns, which is
  -- how the current app already submits them, so the descriptor has to say which.
  target text NOT NULL DEFAULT 'payload',

  -- `is_required` is what the FORM enforces. `is_server_required` is what the
  -- SERVER rejects without. They differ for the built-ins on purpose: today only
  -- loan tenure and complaint category are gated server-side, and quietly turning
  -- the rest into server gates would start rejecting admin-on-behalf requests
  -- that are legal right now. The builder sets both together for new types.
  is_required boolean NOT NULL DEFAULT false,
  is_server_required boolean NOT NULL DEFAULT false,

  sort_order int NOT NULL DEFAULT 0,
  -- 'static' reads `options`; anything else names a table the options come from.
  options_source text,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Legacy error codes the driver app already has translations for.
  required_error_code text,
  options_error_code text,
  min_value numeric,
  max_value numeric,
  help_en text,
  help_ar text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (type_key, field_key),
  CONSTRAINT request_field_definitions_key_format
    CHECK (field_key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT request_field_definitions_kind
    CHECK (kind IN ('text', 'textarea', 'number', 'date', 'month',
                    'select', 'multiselect', 'checkbox', 'file')),
  CONSTRAINT request_field_definitions_target
    CHECK (target IN ('payload', 'amount_kwd', 'start_date', 'end_date',
                      'details', 'severity', 'attachments')),
  CONSTRAINT request_field_definitions_options_source
    CHECK (options_source IS NULL
           OR options_source IN ('static', 'loan_tenure_options', 'complaint_categories'))
);

COMMENT ON COLUMN public.request_field_definitions.is_required IS
  'Form-level requirement rendered by the client.';
COMMENT ON COLUMN public.request_field_definitions.is_server_required IS
  'Server rejects the request without it. Deliberately narrower than is_required for the built-ins.';
COMMENT ON COLUMN public.request_field_definitions.target IS
  'payload = requests.payload key; anything else = the requests column the value is written to. File fields are governed by request_type_definitions.min_attachments, not by is_server_required.';

CREATE INDEX IF NOT EXISTS idx_request_field_definitions_type
  ON public.request_field_definitions (type_key, sort_order);

ALTER TABLE public.request_type_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_field_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_all_request_type_definitions ON public.request_type_definitions;
CREATE POLICY staff_all_request_type_definitions ON public.request_type_definitions
  FOR ALL USING (public.is_admin_panel_user()) WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS staff_all_request_field_definitions ON public.request_field_definitions;
CREATE POLICY staff_all_request_field_definitions ON public.request_field_definitions
  FOR ALL USING (public.is_admin_panel_user()) WITH CHECK (public.is_admin_panel_user());

-- Riders need to read the catalogue to render the hub and the forms. Only active
-- types, and definitions carry no rider data, so there is nothing to scope.
DROP POLICY IF EXISTS drivers_read_request_type_definitions ON public.request_type_definitions;
CREATE POLICY drivers_read_request_type_definitions ON public.request_type_definitions
  FOR SELECT TO authenticated USING (is_active);

DROP POLICY IF EXISTS drivers_read_request_field_definitions ON public.request_field_definitions;
CREATE POLICY drivers_read_request_field_definitions ON public.request_field_definitions
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.request_type_definitions t
      WHERE t.key = request_field_definitions.type_key AND t.is_active
    )
  );

-- ---------------------------------------------------------------------------
-- Seed the 8 built-ins.
--
-- `sort_order` follows the driver app's hub tile order, because that is the
-- rider-facing sequence the server will drive once the app reads it.
-- `screenshot_restricted` / `is_active` are copied from the live
-- `request_type_screenshot_policy` rather than re-asserted from the original
-- seed, so any toggle an admin has already made is preserved.
-- ---------------------------------------------------------------------------

INSERT INTO public.request_type_definitions (
  key, label_en, label_ar, icon_key, is_system, sort_order,
  terminal_status_on_approve, requires_driver_ack_on_approve,
  date_range_required, min_attachments, attachments_error_code
) VALUES
  ('leave', 'Leave', 'إجازة', 'event_available_outlined', true, 1,
   'approved', false, true, 0, NULL),
  ('sick_leave', 'Sick / Accident', 'مرض / حادث', 'medical_services_outlined', true, 2,
   'approved', true, true, 1, 'medical_documents_required'),
  ('asset', 'Asset', 'أصل', 'inventory_2_outlined', true, 3,
   'approved', true, false, 0, NULL),
  -- Fuel receipts are required by the form but NOT by the server today. Left at 0
  -- deliberately: raising it would start rejecting admin-on-behalf fuel requests,
  -- which are phoned in without a receipt attached.
  ('fuel', 'Fuel', 'وقود', 'local_gas_station_outlined', true, 4,
   'approved', false, false, 0, NULL),
  ('document', 'Document', 'مستند', 'description_outlined', true, 5,
   'approved', false, false, 0, NULL),
  ('complaint', 'Complaint', 'شكوى', 'report_problem_outlined', true, 6,
   'solved', false, false, 0, NULL),
  ('salary_justification', 'Salary justification', 'تبرير الراتب', 'payments_outlined', true, 7,
   'solved', false, false, 0, NULL),
  ('loan', 'Loan / Advance', 'قرض / سلفة', 'account_balance_wallet_outlined', true, 8,
   'approved', true, false, 0, NULL)
ON CONFLICT (key) DO NOTHING;

UPDATE public.request_type_definitions d
SET screenshot_restricted = p.screenshot_restricted,
    is_active = p.is_active
FROM public.request_type_screenshot_policy p
WHERE p.request_type::text = d.key;

-- ---------------------------------------------------------------------------
-- Seed the field sets, mirroring what the driver app renders today.
--
-- `is_server_required` is true for exactly the two fields the server gates on
-- right now (loan tenure, complaint category) and their legacy error codes are
-- carried across verbatim, so nothing the app already translates changes.
-- ---------------------------------------------------------------------------

INSERT INTO public.request_field_definitions (
  type_key, field_key, label_en, kind, target, is_required, is_server_required,
  sort_order, options_source, options, required_error_code, options_error_code, min_value
) VALUES
  -- leave
  ('leave', 'leave_type', 'Leave type', 'select', 'payload', true, false, 1,
   'static', '["Annual","Emergency","Accident","Unpaid Leave"]'::jsonb, NULL, NULL, NULL),
  ('leave', 'start_date', 'From', 'date', 'start_date', true, false, 2, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('leave', 'end_date', 'To', 'date', 'end_date', true, false, 3, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('leave', 'comment', 'Comment', 'text', 'payload', false, false, 4, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('leave', 'justification', 'Justification', 'textarea', 'payload', true, false, 5, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('leave', 'attachment', 'Attachment', 'file', 'attachments', false, false, 6, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('leave', 'declaration_accepted', 'Declaration', 'checkbox', 'payload', true, false, 7, NULL, '[]'::jsonb, NULL, NULL, NULL),

  -- sick_leave
  ('sick_leave', 'leave_subtype', 'Leave subtype', 'select', 'payload', true, false, 1,
   'static', '["Sick leave","Injury","Accident","Other"]'::jsonb, NULL, NULL, NULL),
  ('sick_leave', 'start_date', 'From', 'date', 'start_date', true, false, 2, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('sick_leave', 'end_date', 'To', 'date', 'end_date', true, false, 3, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('sick_leave', 'comment', 'Comment', 'text', 'payload', false, false, 4, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('sick_leave', 'symptoms_details', 'Symptoms', 'textarea', 'payload', true, false, 5, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('sick_leave', 'attachment', 'Medical certificate', 'file', 'attachments', true, false, 6, NULL, '[]'::jsonb, NULL, NULL, NULL),

  -- loan
  ('loan', 'amount_kwd', 'Amount (KWD)', 'number', 'amount_kwd', true, false, 1, NULL, '[]'::jsonb, NULL, NULL, 0),
  ('loan', 'tenure_months', 'Tenure', 'select', 'payload', true, true, 2,
   'loan_tenure_options', '[]'::jsonb, 'tenure_required', 'tenure_options_not_configured', NULL),
  ('loan', 'needed_by', 'Needed by', 'date', 'payload', true, false, 3, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('loan', 'reason', 'Reason', 'textarea', 'payload', true, false, 4, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('loan', 'attachment', 'Supporting document', 'file', 'attachments', false, false, 5, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('loan', 'declaration_accepted', 'Declaration', 'checkbox', 'payload', true, false, 6, NULL, '[]'::jsonb, NULL, NULL, NULL),

  -- asset
  ('asset', 'asset_type', 'Asset type', 'select', 'payload', true, false, 1, 'static',
   '["SIM card","Fuel card","Fuel limit change","Raincoat","Delivery bag","Reflective vest","Winter jacket","Delivery attire","Delivery pants","New bike","Helmet","Delivery box","Fuel chip","Phone","Mobile holder"]'::jsonb,
   NULL, NULL, NULL),
  ('asset', 'size', 'Size', 'select', 'payload', false, false, 2,
   'static', '["S","M","L","XL","XXL"]'::jsonb, NULL, NULL, NULL),
  ('asset', 'quantity', 'Quantity', 'number', 'payload', false, false, 3, NULL, '[]'::jsonb, NULL, NULL, 1),
  ('asset', 'request_mode', 'Request mode', 'select', 'payload', true, false, 4,
   'static', '["Renewal","First Time"]'::jsonb, NULL, NULL, NULL),
  ('asset', 'asset_current_status', 'Current status', 'select', 'payload', true, false, 5,
   'static', '["Lost","Damaged"]'::jsonb, NULL, NULL, NULL),
  ('asset', 'justification', 'Justification', 'textarea', 'payload', true, false, 6, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('asset', 'attachment', 'Photo', 'file', 'attachments', false, false, 7, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('asset', 'declaration_accepted', 'Declaration', 'checkbox', 'payload', true, false, 8, NULL, '[]'::jsonb, NULL, NULL, NULL),

  -- fuel
  ('fuel', 'amount_kwd', 'Amount (KWD)', 'number', 'amount_kwd', true, false, 1, NULL, '[]'::jsonb, NULL, NULL, 0),
  ('fuel', 'period_month', 'Period month', 'month', 'payload', true, false, 2, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('fuel', 'distance_km', 'Distance (km)', 'number', 'payload', false, false, 3, NULL, '[]'::jsonb, NULL, NULL, 0),
  ('fuel', 'attachment', 'Fuel receipts', 'file', 'attachments', true, false, 4, NULL, '[]'::jsonb, NULL, NULL, NULL),

  -- document
  ('document', 'document_type', 'Document type', 'select', 'payload', true, false, 1, 'static',
   '["Civil ID copy","License Copy","Work permit copy","Registration copy","Vehicle document copy","Salary certification"]'::jsonb,
   NULL, NULL, NULL),
  ('document', 'language', 'Language', 'select', 'payload', true, false, 2,
   'static', '["English","Arabic"]'::jsonb, NULL, NULL, NULL),
  ('document', 'delivery_method', 'Delivery method', 'select', 'payload', true, false, 3,
   'static', '["Email","Pickup"]'::jsonb, NULL, NULL, NULL),
  ('document', 'needed_by', 'Needed by', 'date', 'payload', true, false, 4, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('document', 'comment', 'Comment', 'text', 'payload', false, false, 5, NULL, '[]'::jsonb, NULL, NULL, NULL),

  -- complaint
  ('complaint', 'category', 'Category', 'select', 'payload', true, true, 1,
   'complaint_categories', '[]'::jsonb, 'category_required', 'complaint_categories_not_configured', NULL),
  ('complaint', 'severity', 'Severity', 'select', 'severity', true, false, 2,
   'static', '["low","medium","high"]'::jsonb, NULL, NULL, NULL),
  ('complaint', 'subject', 'Subject', 'text', 'payload', true, false, 3, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('complaint', 'description', 'Description', 'textarea', 'details', true, false, 4, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('complaint', 'attachment', 'Attachment', 'file', 'attachments', false, false, 5, NULL, '[]'::jsonb, NULL, NULL, NULL),

  -- salary_justification
  ('salary_justification', 'salary_month', 'Salary month', 'month', 'payload', true, false, 1, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('salary_justification', 'expected_amount', 'Expected amount', 'number', 'payload', true, false, 2, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('salary_justification', 'received_amount', 'Received amount', 'number', 'payload', true, false, 3, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('salary_justification', 'comment', 'Comment', 'text', 'payload', false, false, 4, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('salary_justification', 'justification', 'Justification', 'textarea', 'payload', true, false, 5, NULL, '[]'::jsonb, NULL, NULL, NULL),
  ('salary_justification', 'attachment', 'Payslip', 'file', 'attachments', false, false, 6, NULL, '[]'::jsonb, NULL, NULL, NULL)
ON CONFLICT (type_key, field_key) DO NOTHING;
