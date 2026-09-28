-- Staff Access blocks for pages added after the Sep 21 Manager/User split.
-- New view slugs + CRUD verbs. Existing Users/roles inherit from the parent
-- they already hold so nobody loses a page. Do not re-apply 287/301/303.

-- 1. catalog --------------------------------------------------------------

INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('live_tracking.view', 'View live tracking', 'drivers'),
  ('fuel.manage', 'Manage fuel log', 'fleet'),
  ('fuel.create', 'Create fuel log records', 'fleet'),
  ('fuel.edit', 'Edit fuel log records', 'fleet'),
  ('fuel.delete', 'Delete fuel log records', 'fleet'),
  ('fuel_requests.view', 'View fuel requests', 'fleet'),
  ('fuel_refunds.view', 'View fuel refunds', 'fleet'),
  ('asset_requests.view', 'View asset requests', 'assets'),
  ('order_recon.view', 'View order reconciliation', 'deliveries'),
  ('order_recon.manage', 'Manage order reconciliation', 'deliveries'),
  ('order_recon.create', 'Create order reconciliation runs', 'deliveries'),
  ('order_recon.edit', 'Edit order reconciliation runs', 'deliveries'),
  ('order_recon.delete', 'Delete order reconciliation runs', 'deliveries'),
  ('payroll.create', 'Create payroll off structure', 'payroll'),
  ('payroll.edit', 'Edit payroll off structure', 'payroll'),
  ('payroll.delete', 'Delete payroll off structure', 'payroll'),
  ('companies.view', 'View companies', 'settings'),
  ('companies.manage', 'Manage companies', 'settings'),
  ('companies.create', 'Create companies', 'settings'),
  ('companies.edit', 'Edit companies', 'settings'),
  ('companies.delete', 'Delete companies', 'settings')
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category;

-- 2. role + user backfill from parent ------------------------------------

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT a.role_id, m.child_slug
FROM public.admin_role_permissions a
JOIN (
  VALUES
    ('drivers.view', 'live_tracking.view'),
    ('fuel.view', 'fuel.manage'),
    ('fuel.view', 'fuel.create'),
    ('fuel.view', 'fuel.edit'),
    ('fuel.view', 'fuel.delete'),
    ('requests.view', 'fuel_requests.view'),
    ('requests.view', 'fuel_refunds.view'),
    ('requests.view', 'asset_requests.view'),
    ('deliveries.view', 'order_recon.view'),
    ('deliveries.manage', 'order_recon.manage'),
    ('deliveries.manage', 'order_recon.create'),
    ('deliveries.manage', 'order_recon.edit'),
    ('deliveries.manage', 'order_recon.delete'),
    ('payroll.view', 'payroll.create'),
    ('payroll.view', 'payroll.edit'),
    ('payroll.view', 'payroll.delete'),
    ('settings.manage', 'companies.view'),
    ('settings.manage', 'companies.manage'),
    ('settings.manage', 'companies.create'),
    ('settings.manage', 'companies.edit'),
    ('settings.manage', 'companies.delete')
) AS m(parent_slug, child_slug) ON m.parent_slug = a.permission_slug
ON CONFLICT DO NOTHING;

INSERT INTO public.admin_user_permissions (user_id, permission_slug)
SELECT u.user_id, m.child_slug
FROM public.admin_user_permissions u
JOIN (
  VALUES
    ('drivers.view', 'live_tracking.view'),
    ('fuel.view', 'fuel.manage'),
    ('fuel.view', 'fuel.create'),
    ('fuel.view', 'fuel.edit'),
    ('fuel.view', 'fuel.delete'),
    ('requests.view', 'fuel_requests.view'),
    ('requests.view', 'fuel_refunds.view'),
    ('requests.view', 'asset_requests.view'),
    ('deliveries.view', 'order_recon.view'),
    ('deliveries.manage', 'order_recon.manage'),
    ('deliveries.manage', 'order_recon.create'),
    ('deliveries.manage', 'order_recon.edit'),
    ('deliveries.manage', 'order_recon.delete'),
    ('payroll.view', 'payroll.create'),
    ('payroll.view', 'payroll.edit'),
    ('payroll.view', 'payroll.delete'),
    ('settings.manage', 'companies.view'),
    ('settings.manage', 'companies.manage'),
    ('settings.manage', 'companies.create'),
    ('settings.manage', 'companies.edit'),
    ('settings.manage', 'companies.delete')
) AS m(parent_slug, child_slug) ON m.parent_slug = u.permission_slug
ON CONFLICT DO NOTHING;

-- 3. payroll write gate: CRUD ticks alias to manage ----------------------

CREATE OR REPLACE FUNCTION public.payroll_can_manage()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_super_admin_user()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.access_kind = 'manager'
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.admin_role_permissions arp ON arp.role_id = p.admin_role_id
      WHERE p.id = auth.uid()
        AND arp.permission_slug IN (
          'payroll.manage', 'payroll.create', 'payroll.edit', 'payroll.delete'
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.admin_user_permissions up
      WHERE up.user_id = auth.uid()
        AND up.permission_slug IN (
          'payroll.manage', 'payroll.create', 'payroll.edit', 'payroll.delete'
        )
    );
$$;

REVOKE ALL ON FUNCTION public.payroll_can_manage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_can_manage() TO authenticated, service_role;

-- 4. companies write: new slugs + settings.manage window -----------------

CREATE OR REPLACE FUNCTION public.companies_can_write()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_super_admin_user()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.access_kind = 'manager'
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.admin_role_permissions arp ON arp.role_id = p.admin_role_id
      WHERE p.id = auth.uid()
        AND arp.permission_slug IN (
          'settings.manage',
          'companies.manage',
          'companies.create',
          'companies.edit',
          'companies.delete'
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.admin_user_permissions up
      WHERE up.user_id = auth.uid()
        AND up.permission_slug IN (
          'settings.manage',
          'companies.manage',
          'companies.create',
          'companies.edit',
          'companies.delete'
        )
    );
$$;

REVOKE ALL ON FUNCTION public.companies_can_write() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.companies_can_write() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_upsert_source_company(
  p_key text,
  p_name text,
  p_client_code text,
  p_is_active boolean,
  p_sort_order integer DEFAULT NULL
)
RETURNS public.source_companies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_code text := nullif(upper(btrim(coalesce(p_client_code, ''))), '');
  v_row public.source_companies;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT public.companies_can_write() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_key !~ '^[a-z0-9_]{1,24}$' THEN
    RAISE EXCEPTION 'invalid_company_key' USING ERRCODE = 'P0001';
  END IF;
  IF v_name = '' OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'invalid_company_name' USING ERRCODE = 'P0001';
  END IF;
  IF v_code IS NOT NULL AND v_code !~ '^[A-Z0-9-]{1,32}$' THEN
    RAISE EXCEPTION 'invalid_client_code' USING ERRCODE = 'P0001';
  END IF;
  IF v_code IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.source_companies c
    WHERE c.client_code = v_code AND c.key <> v_key
  ) THEN
    RAISE EXCEPTION 'client_code_taken' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.source_companies AS c (key, name, client_code, is_active, sort_order)
  VALUES (v_key, v_name, v_code, coalesce(p_is_active, true), coalesce(p_sort_order, 100))
  ON CONFLICT (key) DO UPDATE
    SET name = EXCLUDED.name,
        client_code = EXCLUDED.client_code,
        is_active = EXCLUDED.is_active,
        sort_order = coalesce(p_sort_order, c.sort_order)
  RETURNING c.* INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_source_company(text, text, text, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_source_company(text, text, text, boolean, integer) TO authenticated;
