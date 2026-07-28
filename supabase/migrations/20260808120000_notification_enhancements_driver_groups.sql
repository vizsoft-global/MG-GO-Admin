-- Driver groups + notification enhancements (import mode, engagement tracking, personalized dispatch)

-- ---------------------------------------------------------------------------
-- Driver groups
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.driver_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  icon_key text,
  member_count int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS driver_groups_name_unique_idx ON public.driver_groups (lower(trim(name)));

CREATE TABLE IF NOT EXISTS public.driver_group_members (
  group_id uuid NOT NULL REFERENCES public.driver_groups(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, driver_id)
);

CREATE INDEX IF NOT EXISTS driver_group_members_driver_id_idx ON public.driver_group_members (driver_id);

ALTER TABLE public.driver_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_groups_admin_all ON public.driver_groups;
CREATE POLICY driver_groups_admin_all ON public.driver_groups
  FOR ALL USING (public.is_admin_panel_user()) WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS driver_group_members_admin_all ON public.driver_group_members;
CREATE POLICY driver_group_members_admin_all ON public.driver_group_members
  FOR ALL USING (public.is_admin_panel_user()) WITH CHECK (public.is_admin_panel_user());

CREATE OR REPLACE FUNCTION public.sync_driver_group_member_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.driver_groups
    SET member_count = (
      SELECT count(*)::int FROM public.driver_group_members WHERE group_id = NEW.group_id
    ),
    updated_at = now()
    WHERE id = NEW.group_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.driver_groups
    SET member_count = (
      SELECT count(*)::int FROM public.driver_group_members WHERE group_id = OLD.group_id
    ),
    updated_at = now()
    WHERE id = OLD.group_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS driver_group_members_count_sync ON public.driver_group_members;
CREATE TRIGGER driver_group_members_count_sync
  AFTER INSERT OR DELETE ON public.driver_group_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_driver_group_member_count();

INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('driver_groups.view', 'View driver groups', 'drivers'),
  ('driver_groups.manage', 'Manage driver groups', 'drivers')
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
JOIN public.admin_permissions p ON p.slug IN ('driver_groups.view', 'driver_groups.manage')
WHERE r.slug IN ('super_admin', 'administrator')
ON CONFLICT DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
JOIN public.admin_permissions p ON p.slug = 'driver_groups.view'
WHERE r.slug = 'operator'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Notification campaign + dispatch item extensions
-- ---------------------------------------------------------------------------

ALTER TABLE public.notification_campaigns
  ADD COLUMN IF NOT EXISTS import_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS track_engagement boolean NOT NULL DEFAULT true;

ALTER TABLE public.notification_dispatch_items
  ADD COLUMN IF NOT EXISTS resolved_title text,
  ADD COLUMN IF NOT EXISTS resolved_body text,
  ADD COLUMN IF NOT EXISTS import_row_index int,
  ADD COLUMN IF NOT EXISTS import_vars jsonb;

-- Resolve employee IDs from import_spec rows
CREATE OR REPLACE FUNCTION public.resolve_import_driver_ids(p_import_spec jsonb)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT d.id), ARRAY[]::uuid[])
  FROM jsonb_array_elements(coalesce(p_import_spec->'rows', '[]'::jsonb)) AS row
  JOIN public.drivers d ON d.employee_id = trim(both from row->>'employee_id')
  WHERE trim(both from coalesce(row->>'employee_id', '')) <> ''
    AND d.archived_at IS NULL
    AND NOT d.is_blocked;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_import_driver_ids(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_import_driver_ids(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Audience estimation (group + import modes)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.estimate_notification_audience(
  p_target_spec jsonb,
  p_exclusion_spec jsonb DEFAULT '{}'::jsonb,
  p_import_spec jsonb DEFAULT '{}'::jsonb
)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text := coalesce(p_target_spec->>'mode', 'all');
  v_count int := 0;
  v_ids uuid[];
BEGIN
  IF v_mode = 'all' THEN
    SELECT count(*)::int INTO v_count
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.status IN (
        'active'::public.driver_status,
        'pending'::public.driver_status,
        'suspended'::public.driver_status
      );
  ELSIF v_mode = 'zone' THEN
    SELECT count(*)::int INTO v_count
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.zone_id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'zone_ids', '[]'::jsonb))::uuid
      );
  ELSIF v_mode = 'partner' THEN
    SELECT count(*)::int INTO v_count
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.partner_id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'partner_ids', '[]'::jsonb))::uuid
      );
  ELSIF v_mode = 'status' THEN
    SELECT count(*)::int INTO v_count
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.status::text = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'statuses', '[]'::jsonb))
      );
  ELSIF v_mode = 'custom' THEN
    SELECT count(*)::int INTO v_count
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'driver_ids', '[]'::jsonb))::uuid
      );
  ELSIF v_mode = 'group' THEN
    SELECT count(DISTINCT d.id)::int INTO v_count
    FROM public.driver_group_members dgm
    JOIN public.drivers d ON d.id = dgm.driver_id
    WHERE dgm.group_id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'group_ids', '[]'::jsonb))::uuid
      )
      AND d.archived_at IS NULL
      AND NOT d.is_blocked;
  ELSIF v_mode = 'import' THEN
    v_ids := public.resolve_import_driver_ids(p_import_spec);
    v_count := coalesce(array_length(v_ids, 1), 0);
  ELSE
    SELECT count(*)::int INTO v_count
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked;
  END IF;

  IF coalesce(jsonb_array_length(p_exclusion_spec->'driver_ids'), 0) > 0 THEN
    v_count := greatest(
      0,
      v_count - (
        SELECT count(*)::int
        FROM public.drivers d
        WHERE d.id = ANY (
          SELECT jsonb_array_elements_text(p_exclusion_spec->'driver_ids')::uuid
        )
      )
    );
  END IF;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.compile_notification_audience(
  p_campaign_id uuid,
  p_target_spec jsonb,
  p_exclusion_spec jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot_id uuid;
  v_mode text := coalesce(p_target_spec->>'mode', 'all');
  v_ids uuid[];
  v_import_spec jsonb := '{}'::jsonb;
BEGIN
  IF v_mode = 'import' THEN
    SELECT coalesce(c.import_spec, '{}'::jsonb) INTO v_import_spec
    FROM public.notification_campaigns c
    WHERE c.id = p_campaign_id;
    v_ids := public.resolve_import_driver_ids(v_import_spec);
  ELSIF v_mode = 'all' THEN
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.status IN (
        'active'::public.driver_status,
        'pending'::public.driver_status,
        'suspended'::public.driver_status
      );
  ELSIF v_mode = 'zone' THEN
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.zone_id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'zone_ids', '[]'::jsonb))::uuid
      );
  ELSIF v_mode = 'partner' THEN
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.partner_id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'partner_ids', '[]'::jsonb))::uuid
      );
  ELSIF v_mode = 'status' THEN
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.status::text = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'statuses', '[]'::jsonb))
      );
  ELSIF v_mode = 'custom' THEN
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'driver_ids', '[]'::jsonb))::uuid
      );
  ELSIF v_mode = 'group' THEN
    SELECT array_agg(DISTINCT d.id) INTO v_ids
    FROM public.driver_group_members dgm
    JOIN public.drivers d ON d.id = dgm.driver_id
    WHERE dgm.group_id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'group_ids', '[]'::jsonb))::uuid
      )
      AND d.archived_at IS NULL
      AND NOT d.is_blocked;
  ELSE
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked;
  END IF;

  v_ids := coalesce(v_ids, '{}');

  IF coalesce(jsonb_array_length(p_exclusion_spec->'driver_ids'), 0) > 0 THEN
    v_ids := array(
      SELECT unnest(v_ids)
      EXCEPT
      SELECT jsonb_array_elements_text(p_exclusion_spec->'driver_ids')::uuid
    );
  END IF;

  INSERT INTO public.notification_audience_snapshots (
    campaign_id,
    target_spec,
    exclusion_spec,
    recipient_ids,
    recipient_count
  ) VALUES (
    p_campaign_id,
    p_target_spec,
    p_exclusion_spec,
    v_ids,
    coalesce(array_length(v_ids, 1), 0)
  )
  RETURNING id INTO v_snapshot_id;

  UPDATE public.notification_campaigns
  SET estimated_audience_count = coalesce(array_length(v_ids, 1), 0),
      updated_at = now()
  WHERE id = p_campaign_id;

  RETURN v_snapshot_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.compile_notification_audience_ids(
  p_target_spec jsonb,
  p_exclusion_spec jsonb DEFAULT '{}'::jsonb,
  p_import_spec jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text := coalesce(p_target_spec->>'mode', 'all');
  v_ids uuid[];
BEGIN
  IF v_mode = 'import' THEN
    v_ids := public.resolve_import_driver_ids(p_import_spec);
  ELSIF v_mode = 'all' THEN
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.status IN (
        'active'::public.driver_status,
        'pending'::public.driver_status,
        'suspended'::public.driver_status
      );
  ELSIF v_mode = 'zone' THEN
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.zone_id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'zone_ids', '[]'::jsonb))::uuid
      );
  ELSIF v_mode = 'partner' THEN
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.partner_id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'partner_ids', '[]'::jsonb))::uuid
      );
  ELSIF v_mode = 'status' THEN
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.status::text = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'statuses', '[]'::jsonb))
      );
  ELSIF v_mode = 'custom' THEN
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked
      AND d.id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'driver_ids', '[]'::jsonb))::uuid
      );
  ELSIF v_mode = 'group' THEN
    SELECT array_agg(DISTINCT d.id) INTO v_ids
    FROM public.driver_group_members dgm
    JOIN public.drivers d ON d.id = dgm.driver_id
    WHERE dgm.group_id = ANY (
        SELECT jsonb_array_elements_text(coalesce(p_target_spec->'group_ids', '[]'::jsonb))::uuid
      )
      AND d.archived_at IS NULL
      AND NOT d.is_blocked;
  ELSE
    SELECT array_agg(d.id) INTO v_ids
    FROM public.drivers d
    WHERE d.archived_at IS NULL
      AND NOT d.is_blocked;
  END IF;

  IF v_ids IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  IF coalesce(jsonb_array_length(coalesce(p_exclusion_spec->'driver_ids', '[]'::jsonb)), 0) > 0 THEN
    v_ids := array(
      SELECT unnest(v_ids)
      EXCEPT
      SELECT jsonb_array_elements_text(p_exclusion_spec->'driver_ids')::uuid
    );
  END IF;

  RETURN coalesce(v_ids, ARRAY[]::uuid[]);
END;
$$;

GRANT EXECUTE ON FUNCTION public.estimate_notification_audience(jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compile_notification_audience(uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compile_notification_audience_ids(jsonb, jsonb, jsonb) TO service_role;

-- Driver inbox: prefer per-recipient resolved title/body
CREATE OR REPLACE FUNCTION public.driver_list_notifications(
  p_limit integer DEFAULT 50,
  p_before timestamptz DEFAULT NULL,
  p_unread_only boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer;
  v_items jsonb;
  v_unread integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_limit := greatest(1, least(coalesce(p_limit, 50), 100));

  WITH rows AS (
    SELECT
      i.id              AS dispatch_item_id,
      i.campaign_id     AS campaign_id,
      i.delivered_at,
      i.opened_at,
      i.clicked_at,
      i.created_at      AS received_at,
      coalesce(i.resolved_title, c.title) AS title,
      coalesce(i.resolved_body, c.body) AS body,
      c.category::text  AS category,
      c.priority::text  AS priority,
      c.action_type::text AS action_type,
      c.action_params,
      c.media,
      c.payload_version
    FROM public.notification_dispatch_items i
    INNER JOIN public.notification_campaigns c ON c.id = i.campaign_id
    WHERE i.driver_id = v_uid
      AND (p_before IS NULL OR i.created_at < p_before)
      AND (NOT p_unread_only OR i.opened_at IS NULL)
    ORDER BY i.created_at DESC
    LIMIT v_limit
  )
  SELECT coalesce(jsonb_agg(to_jsonb(rows.*)), '[]'::jsonb)
  INTO v_items
  FROM rows;

  SELECT count(*)::int
  INTO v_unread
  FROM public.notification_dispatch_items i
  WHERE i.driver_id = v_uid
    AND i.opened_at IS NULL;

  RETURN jsonb_build_object(
    'items', v_items,
    'unread_count', v_unread
  );
END;
$$;
