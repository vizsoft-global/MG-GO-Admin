-- Bulk delete / Clear all: per-module *.bulk_delete ticks, batched *_all RPCs.
-- Do not grant bulk_delete to existing roles or Users.

INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('drivers.bulk_delete', 'Bulk delete drivers', 'drivers'),
  ('driver_groups.bulk_delete', 'Bulk delete driver groups', 'drivers'),
  ('partners.bulk_delete', 'Bulk delete partners', 'partners'),
  ('restaurants.bulk_delete', 'Bulk delete restaurants', 'restaurants'),
  ('vehicles.bulk_delete', 'Bulk delete vehicles', 'vehicles'),
  ('assets.bulk_delete', 'Bulk delete assets', 'assets'),
  ('deliveries.bulk_delete', 'Bulk delete deliveries', 'deliveries'),
  ('verifications.bulk_delete', 'Bulk delete DPD verifications', 'deliveries'),
  ('zones.bulk_delete', 'Bulk delete zones', 'zones'),
  ('attendance.bulk_delete', 'Bulk delete attendance records', 'attendance'),
  ('requests.bulk_delete', 'Bulk delete requests', 'requests'),
  ('wrong_actions.bulk_delete', 'Bulk delete wrong actions', 'compliance'),
  ('documents.bulk_delete', 'Bulk delete document expiry records', 'compliance'),
  ('earnings.bulk_delete', 'Bulk delete earnings rules', 'earnings'),
  ('notifications.bulk_delete', 'Bulk delete notifications', 'notifications'),
  ('support.bulk_delete', 'Bulk delete support threads', 'support'),
  ('payroll.bulk_delete', 'Bulk delete payroll off structure', 'payroll'),
  ('fuel.bulk_delete', 'Bulk delete fuel log records', 'fleet'),
  ('companies.bulk_delete', 'Bulk delete companies', 'settings'),
  ('order_recon.bulk_delete', 'Bulk delete order reconciliation runs', 'deliveries'),
  ('visits.bulk_delete', 'Bulk delete visit bookings', 'visits'),
  ('esign.bulk_delete', 'Bulk delete e-sign requests', 'requests')
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category;

CREATE OR REPLACE FUNCTION public._admin_purge_require(p_slug text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF public.is_super_admin_user() THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.access_kind = 'manager'
  ) THEN
    RETURN;
  END IF;
  IF p_slug IS NULL OR btrim(p_slug) = '' THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.admin_user_permissions up
    WHERE up.user_id = auth.uid() AND up.permission_slug = p_slug
  ) THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.admin_role_permissions arp ON arp.role_id = p.admin_role_id
    WHERE p.id = auth.uid()
      AND p.access_kind IS NULL
      AND arp.permission_slug = p_slug
  ) THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'not_authorized';
END;
$$;

CREATE OR REPLACE FUNCTION public._admin_purge_slug_for_entity(p_entity text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_entity
    WHEN 'delivery' THEN 'deliveries.bulk_delete'
    WHEN 'deliveries' THEN 'deliveries.bulk_delete'
    WHEN 'driver' THEN 'drivers.bulk_delete'
    WHEN 'intake' THEN 'drivers.bulk_delete'
    WHEN 'drivers' THEN 'drivers.bulk_delete'
    WHEN 'restaurant' THEN 'restaurants.bulk_delete'
    WHEN 'restaurants' THEN 'restaurants.bulk_delete'
    WHEN 'zone' THEN 'zones.bulk_delete'
    WHEN 'zones' THEN 'zones.bulk_delete'
    WHEN 'delivery_rule' THEN 'earnings.bulk_delete'
    WHEN 'delivery_rules' THEN 'earnings.bulk_delete'
    WHEN 'incentive_rule' THEN 'earnings.bulk_delete'
    WHEN 'incentive_rules' THEN 'earnings.bulk_delete'
    WHEN 'asset_catalog' THEN 'assets.bulk_delete'
    WHEN 'assets' THEN 'assets.bulk_delete'
    WHEN 'partners' THEN 'partners.bulk_delete'
    WHEN 'driver_groups' THEN 'driver_groups.bulk_delete'
    WHEN 'companies' THEN 'companies.bulk_delete'
    WHEN 'requests' THEN 'requests.bulk_delete'
    WHEN 'visits' THEN 'visits.bulk_delete'
    WHEN 'earnings' THEN 'earnings.bulk_delete'
    WHEN 'payouts' THEN 'earnings.bulk_delete'
    WHEN 'attendance' THEN 'attendance.bulk_delete'
    WHEN 'notifications' THEN 'notifications.bulk_delete'
    WHEN 'vehicles' THEN 'vehicles.bulk_delete'
    WHEN 'fuel' THEN 'fuel.bulk_delete'
    WHEN 'wrong_actions' THEN 'wrong_actions.bulk_delete'
    WHEN 'order_recon' THEN 'order_recon.bulk_delete'
    WHEN 'verifications' THEN 'verifications.bulk_delete'
    WHEN 'esign' THEN 'esign.bulk_delete'
    WHEN 'payroll' THEN 'payroll.bulk_delete'
    WHEN 'documents' THEN 'documents.bulk_delete'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public._admin_purge_require_super_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.source_companies_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_catalog.current_setting('mggo.allow_company_purge', true) = 'on'
       AND COALESCE(OLD.is_system, false) IS NOT TRUE THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'source_company_delete_forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.key IS DISTINCT FROM OLD.key THEN
      RAISE EXCEPTION 'source_company_key_immutable' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.is_system AND (
      NEW.is_active IS DISTINCT FROM OLD.is_active
      OR NEW.client_code IS DISTINCT FROM OLD.client_code
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.is_system IS DISTINCT FROM OLD.is_system
    ) THEN
      RAISE EXCEPTION 'source_company_system_locked' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.is_active AND NOT NEW.is_active AND (
      EXISTS (
        SELECT 1 FROM public.drivers d
        WHERE d.source_company = OLD.key AND d.archived_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.driver_intakes i
        WHERE i.source_company = OLD.key AND i.archived_at IS NULL
      )
    ) THEN
      RAISE EXCEPTION 'source_company_in_use' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_preview_purge(
  p_entity_type text,
  p_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_blockers text[];
  v_counts jsonb;
  v_storage integer;
  v_slug text;
BEGIN
  v_slug := public._admin_purge_slug_for_entity(p_entity_type);
  PERFORM public._admin_purge_require(v_slug);

  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN jsonb_build_object('items', '[]'::jsonb);
  END IF;

  FOREACH v_id IN ARRAY p_ids LOOP
    v_blockers := ARRAY[]::text[];
    v_counts := '{}'::jsonb;
    v_storage := 0;

    IF p_entity_type = 'delivery' THEN
      SELECT jsonb_build_object(
        'deliveries', 1,
        'has_proof', CASE WHEN d.order_proof_url IS NOT NULL AND btrim(d.order_proof_url) <> '' THEN 1 ELSE 0 END
      )
      INTO v_counts
      FROM public.deliveries d
      WHERE d.id = v_id;

      IF v_counts IS NULL THEN
        v_blockers := array_append(v_blockers, 'not_found');
      ELSE
        SELECT COUNT(*)::integer INTO v_storage
        FROM public.deliveries d
        WHERE d.id = v_id AND d.order_proof_url IS NOT NULL AND btrim(d.order_proof_url) <> '';
      END IF;

    ELSIF p_entity_type = 'driver' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = v_id AND p.role = 'rider'::public.app_role
      ) THEN
        v_blockers := array_append(v_blockers, 'not_rider_profile');
      ELSE
        SELECT jsonb_build_object(
          'deliveries', (SELECT COUNT(*) FROM public.deliveries d WHERE d.driver_id = v_id),
          'attendance_logs', (SELECT COUNT(*) FROM public.attendance_logs al WHERE al.driver_id = v_id),
          'driver_attendance', (SELECT COUNT(*) FROM public.driver_attendance da WHERE da.driver_id = v_id),
          'driver_documents', (SELECT COUNT(*) FROM public.driver_documents dd WHERE dd.driver_id = v_id),
          'asset_assignments', (SELECT COUNT(*) FROM public.asset_assignments aa WHERE aa.driver_id = v_id),
          'linked_intakes', (SELECT COUNT(*) FROM public.driver_intakes di WHERE di.linked_profile_id = v_id)
        )
        INTO v_counts;

        SELECT (
          (SELECT COUNT(*) FROM public.driver_documents dd WHERE dd.driver_id = v_id)
          + (SELECT COUNT(*) FROM public.deliveries d WHERE d.driver_id = v_id AND d.order_proof_url IS NOT NULL AND btrim(d.order_proof_url) <> '')
          + 1
        )::integer INTO v_storage;
      END IF;

    ELSIF p_entity_type = 'intake' THEN
      IF EXISTS (
        SELECT 1 FROM public.driver_intakes di
        WHERE di.id = v_id AND di.linked_profile_id IS NOT NULL
      ) THEN
        v_blockers := array_append(v_blockers, 'linked_profile_use_driver_purge');
      ELSE
        SELECT jsonb_build_object(
          'asset_assignments', (SELECT COUNT(*) FROM public.asset_assignments aa WHERE aa.intake_id = v_id),
          'intake_restaurants', (SELECT COUNT(*) FROM public.driver_intake_restaurants dir WHERE dir.intake_id = v_id)
        )
        INTO v_counts;
        v_storage := 4;
      END IF;

    ELSIF p_entity_type = 'restaurant' THEN
      SELECT jsonb_build_object(
        'deliveries', (SELECT COUNT(*) FROM public.deliveries d WHERE d.restaurant_id = v_id),
        'driver_restaurants', (SELECT COUNT(*) FROM public.driver_restaurants dr WHERE dr.restaurant_id = v_id),
        'intake_restaurants', (SELECT COUNT(*) FROM public.driver_intake_restaurants dir WHERE dir.restaurant_id = v_id)
      )
      INTO v_counts;

      IF (v_counts->>'deliveries')::integer > 0 THEN
        v_blockers := array_append(v_blockers, 'has_deliveries');
      END IF;
      IF EXISTS (SELECT 1 FROM public.drivers d WHERE d.restaurant_id = v_id) THEN
        v_blockers := array_append(v_blockers, 'has_drivers');
      END IF;
      v_storage := 1;

    ELSIF p_entity_type = 'zone' THEN
      SELECT jsonb_build_object(
        'drivers', (SELECT COUNT(*) FROM public.drivers d WHERE d.zone_id = v_id),
        'intakes', (SELECT COUNT(*) FROM public.driver_intakes di WHERE di.zone_id = v_id),
        'restaurants', (SELECT COUNT(*) FROM public.restaurants r WHERE r.zone_id = v_id),
        'deliveries', (SELECT COUNT(*) FROM public.deliveries d WHERE d.zone_id = v_id)
      )
      INTO v_counts;

      IF (v_counts->>'intakes')::integer > 0 THEN
        v_blockers := array_append(v_blockers, 'has_intakes');
      END IF;
      IF (v_counts->>'restaurants')::integer > 0 THEN
        v_blockers := array_append(v_blockers, 'has_restaurants');
      END IF;
      IF (v_counts->>'deliveries')::integer > 0 THEN
        v_blockers := array_append(v_blockers, 'has_deliveries');
      END IF;

    ELSIF p_entity_type = 'delivery_rule' THEN
      SELECT jsonb_build_object(
        'scopes', (SELECT COUNT(*) FROM public.delivery_rule_scopes s WHERE s.delivery_rule_id = v_id)
      )
      INTO v_counts
      FROM public.delivery_rules dr
      WHERE dr.id = v_id;
      IF v_counts IS NULL THEN
        v_blockers := array_append(v_blockers, 'not_found');
      END IF;

    ELSIF p_entity_type = 'incentive_rule' THEN
      SELECT jsonb_build_object(
        'scopes', (SELECT COUNT(*) FROM public.incentive_rule_scopes s WHERE s.incentive_rule_id = v_id),
        'tiers', (SELECT COUNT(*) FROM public.incentive_rule_tiers t WHERE t.incentive_rule_id = v_id)
      )
      INTO v_counts
      FROM public.incentive_rules ir
      WHERE ir.id = v_id;
      IF v_counts IS NULL THEN
        v_blockers := array_append(v_blockers, 'not_found');
      END IF;

    ELSIF p_entity_type = 'asset_catalog' THEN
      SELECT jsonb_build_object(
        'assignments', (SELECT COUNT(*) FROM public.asset_assignments aa WHERE aa.catalog_item_id = v_id AND aa.status = 'assigned')
      )
      INTO v_counts
      FROM public.asset_catalog ac
      WHERE ac.id = v_id;
      IF v_counts IS NULL THEN
        v_blockers := array_append(v_blockers, 'not_found');
      END IF;
      IF (v_counts->>'assignments')::integer > 0 THEN
        v_blockers := array_append(v_blockers, 'has_active_assignments');
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.asset_catalog ac
        WHERE ac.id = v_id AND ac.image_url IS NOT NULL AND btrim(ac.image_url) <> ''
      ) THEN
        v_storage := 1;
      END IF;

    ELSE
      RAISE EXCEPTION 'invalid_entity_type';
    END IF;

    v_item := jsonb_build_object(
      'id', v_id,
      'counts', COALESCE(v_counts, '{}'::jsonb),
      'storage_key_count', COALESCE(v_storage, 0),
      'blockers', to_jsonb(v_blockers)
    );
    v_items := v_items || jsonb_build_array(v_item);
  END LOOP;

  RETURN jsonb_build_object('items', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_purge_deliveries(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keys text[] := ARRAY[]::text[];
BEGIN
  PERFORM public._admin_purge_require('deliveries.bulk_delete');

  SELECT COALESCE(array_agg(d.order_proof_url), ARRAY[]::text[])
  INTO v_keys
  FROM public.deliveries d
  WHERE d.id = ANY(p_ids)
    AND d.order_proof_url IS NOT NULL
    AND btrim(d.order_proof_url) <> '';

  DELETE FROM public.deliveries WHERE id = ANY(p_ids);

  RETURN jsonb_build_object(
    'deleted_count', cardinality(p_ids),
    'storage_keys', to_jsonb(COALESCE(v_keys, ARRAY[]::text[]))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_purge_drivers(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
  v_keys text[] := ARRAY[]::text[];
  v_doc_keys text[];
  v_proof_keys text[];
  v_manifest jsonb := '[]'::jsonb;
  v_intake_ids uuid[];
  v_intake_id uuid;
BEGIN
  PERFORM public._admin_purge_require('drivers.bulk_delete');

  FOREACH v_driver_id IN ARRAY p_ids LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = v_driver_id AND p.role = 'rider'::public.app_role
    ) THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(array_agg(dd.file_url), ARRAY[]::text[])
    INTO v_doc_keys
    FROM public.driver_documents dd
    WHERE dd.driver_id = v_driver_id
      AND dd.file_url IS NOT NULL
      AND btrim(dd.file_url) <> '';

    SELECT COALESCE(array_agg(d.order_proof_url), ARRAY[]::text[])
    INTO v_proof_keys
    FROM public.deliveries d
    WHERE d.driver_id = v_driver_id
      AND d.order_proof_url IS NOT NULL
      AND btrim(d.order_proof_url) <> '';

    v_keys := v_keys || COALESCE(v_doc_keys, ARRAY[]::text[]);
    v_keys := v_keys || COALESCE(v_proof_keys, ARRAY[]::text[]);

    SELECT COALESCE(array_agg(di.id), ARRAY[]::uuid[])
    INTO v_intake_ids
    FROM public.driver_intakes di
    WHERE di.linked_profile_id = v_driver_id;

    IF v_intake_ids IS NOT NULL THEN
      FOREACH v_intake_id IN ARRAY v_intake_ids LOOP
        v_keys := array_append(v_keys, 'drivers/intakes/' || v_intake_id::text || '/');
      END LOOP;
    END IF;

    v_keys := array_append(v_keys, 'drivers/' || v_driver_id::text || '/');

    UPDATE public.vehicles
    SET current_driver_id = NULL, updated_at = now()
    WHERE current_driver_id = v_driver_id;

    DELETE FROM public.driver_intake_restaurants
    WHERE intake_id IN (
      SELECT di.id FROM public.driver_intakes di WHERE di.linked_profile_id = v_driver_id
    );

    DELETE FROM public.driver_intakes
    WHERE linked_profile_id = v_driver_id;

    DELETE FROM public.profiles
    WHERE id = v_driver_id AND role = 'rider'::public.app_role;

    v_manifest := v_manifest || jsonb_build_array(
      jsonb_build_object(
        'driver_id', v_driver_id,
        'auth_user_id', v_driver_id,
        'intake_ids', to_jsonb(COALESCE(v_intake_ids, ARRAY[]::uuid[]))
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'manifest', v_manifest,
    'storage_keys', to_jsonb(v_keys)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_purge_intakes(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_keys text[] := ARRAY[]::text[];
BEGIN
  PERFORM public._admin_purge_require('drivers.bulk_delete');

  FOREACH v_id IN ARRAY p_ids LOOP
    IF EXISTS (
      SELECT 1 FROM public.driver_intakes di
      WHERE di.id = v_id AND di.linked_profile_id IS NOT NULL
    ) THEN
      CONTINUE;
    END IF;

    v_keys := array_append(v_keys, 'drivers/intakes/' || v_id::text || '/');

    DELETE FROM public.asset_assignments WHERE intake_id = v_id;
    DELETE FROM public.driver_intake_restaurants WHERE intake_id = v_id;
    DELETE FROM public.driver_intakes WHERE id = v_id AND linked_profile_id IS NULL;
  END LOOP;

  RETURN jsonb_build_object(
    'storage_prefixes', to_jsonb(v_keys)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_purge_restaurants(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_deleted integer := 0;
  v_keys text[] := ARRAY[]::text[];
BEGIN
  PERFORM public._admin_purge_require('restaurants.bulk_delete');

  FOREACH v_id IN ARRAY p_ids LOOP
    IF EXISTS (SELECT 1 FROM public.deliveries d WHERE d.restaurant_id = v_id) THEN
      RAISE EXCEPTION 'blocked_by_deliveries';
    END IF;
    IF EXISTS (SELECT 1 FROM public.drivers d WHERE d.restaurant_id = v_id) THEN
      RAISE EXCEPTION 'blocked_by_drivers';
    END IF;

    v_keys := array_append(v_keys, 'restaurants/' || v_id::text || '/');

    DELETE FROM public.restaurant_geofences WHERE restaurant_id = v_id;
    DELETE FROM public.driver_intake_restaurants WHERE restaurant_id = v_id;
    DELETE FROM public.driver_restaurants WHERE restaurant_id = v_id;
    DELETE FROM public.restaurants WHERE id = v_id;
    v_deleted := v_deleted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'deleted_count', v_deleted,
    'storage_prefixes', to_jsonb(v_keys)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_purge_zones(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_deleted integer := 0;
BEGIN
  PERFORM public._admin_purge_require('zones.bulk_delete');

  FOREACH v_id IN ARRAY p_ids LOOP
    IF EXISTS (SELECT 1 FROM public.deliveries d WHERE d.zone_id = v_id) THEN
      RAISE EXCEPTION 'blocked_by_deliveries';
    END IF;
    IF EXISTS (SELECT 1 FROM public.restaurants r WHERE r.zone_id = v_id) THEN
      RAISE EXCEPTION 'blocked_by_restaurants';
    END IF;
    IF EXISTS (SELECT 1 FROM public.driver_intakes di WHERE di.zone_id = v_id) THEN
      RAISE EXCEPTION 'blocked_by_intakes';
    END IF;

    UPDATE public.drivers SET zone_id = NULL, updated_at = now() WHERE zone_id = v_id;

    DELETE FROM public.zones WHERE id = v_id;
    v_deleted := v_deleted + 1;
  END LOOP;

  RETURN jsonb_build_object('deleted_count', v_deleted);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_purge_delivery_rules(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._admin_purge_require('earnings.bulk_delete');
  DELETE FROM public.delivery_rules WHERE id = ANY(p_ids);
  RETURN jsonb_build_object('deleted_count', cardinality(p_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_purge_incentive_rules(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._admin_purge_require('earnings.bulk_delete');
  DELETE FROM public.incentive_rules WHERE id = ANY(p_ids);
  RETURN jsonb_build_object('deleted_count', cardinality(p_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_purge_asset_catalog(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keys text[] := ARRAY[]::text[];
  v_id uuid;
  v_image_url text;
BEGIN
  PERFORM public._admin_purge_require('assets.bulk_delete');

  FOREACH v_id IN ARRAY p_ids LOOP
    SELECT ac.image_url
    INTO v_image_url
    FROM public.asset_catalog ac
    WHERE ac.id = v_id;

    IF v_image_url IS NOT NULL AND btrim(v_image_url) <> '' THEN
      v_keys := array_append(v_keys, v_image_url);
    END IF;

    DELETE FROM public.asset_assignments WHERE catalog_item_id = v_id;
  END LOOP;

  DELETE FROM public.asset_catalog WHERE id = ANY(p_ids);

  RETURN jsonb_build_object(
    'deleted_count', cardinality(p_ids),
    'storage_keys', to_jsonb(v_keys)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_purge_preview_all(p_entity text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_count integer := 0;
  v_blockers text[] := ARRAY[]::text[];
BEGIN
  v_slug := public._admin_purge_slug_for_entity(p_entity);
  PERFORM public._admin_purge_require(v_slug);

  IF p_entity IN ('deliveries', 'delivery') THEN
    SELECT count(*)::integer INTO v_count FROM public.deliveries;
  ELSIF p_entity IN ('drivers', 'driver') THEN
    SELECT (
      (SELECT count(*) FROM public.profiles WHERE role = 'rider'::public.app_role)
      + (SELECT count(*) FROM public.driver_intakes WHERE linked_profile_id IS NULL)
    )::integer INTO v_count;
  ELSIF p_entity IN ('restaurants', 'restaurant') THEN
    SELECT count(*)::integer INTO v_count FROM public.restaurants;
    IF EXISTS (SELECT 1 FROM public.deliveries d WHERE d.restaurant_id IS NOT NULL) THEN
      v_blockers := array_append(v_blockers, 'blocked_by_deliveries');
    END IF;
  ELSIF p_entity IN ('zones', 'zone') THEN
    SELECT count(*)::integer INTO v_count FROM public.zones;
    IF EXISTS (SELECT 1 FROM public.deliveries d WHERE d.zone_id IS NOT NULL) THEN
      v_blockers := array_append(v_blockers, 'blocked_by_deliveries');
    ELSIF EXISTS (SELECT 1 FROM public.restaurants r WHERE r.zone_id IS NOT NULL) THEN
      v_blockers := array_append(v_blockers, 'blocked_by_restaurants');
    END IF;
  ELSIF p_entity IN ('delivery_rules', 'delivery_rule') THEN
    SELECT count(*)::integer INTO v_count FROM public.delivery_rules;
  ELSIF p_entity IN ('incentive_rules', 'incentive_rule') THEN
    SELECT count(*)::integer INTO v_count FROM public.incentive_rules;
  ELSIF p_entity IN ('assets', 'asset_catalog') THEN
    SELECT count(*)::integer INTO v_count FROM public.asset_catalog;
  ELSIF p_entity = 'partners' THEN
    SELECT count(*)::integer INTO v_count FROM public.partners;
  ELSIF p_entity = 'driver_groups' THEN
    SELECT count(*)::integer INTO v_count FROM public.driver_groups;
  ELSIF p_entity = 'companies' THEN
    SELECT count(*)::integer INTO v_count FROM public.source_companies WHERE is_system IS NOT TRUE;
  ELSIF p_entity = 'requests' THEN
    SELECT count(*)::integer INTO v_count FROM public.requests;
  ELSIF p_entity = 'visits' THEN
    SELECT count(*)::integer INTO v_count FROM public.visit_bookings;
  ELSIF p_entity = 'earnings' THEN
    SELECT (
      (SELECT count(*) FROM public.driver_earnings_daily)
      + (SELECT count(*) FROM public.driver_wallet_entries)
    )::integer INTO v_count;
  ELSIF p_entity = 'payouts' THEN
    SELECT (
      (SELECT count(*) FROM public.payout_runs)
      + (SELECT count(*) FROM public.driver_payouts)
    )::integer INTO v_count;
  ELSIF p_entity = 'attendance' THEN
    SELECT count(*)::integer INTO v_count FROM public.attendance_logs;
  ELSIF p_entity = 'notifications' THEN
    SELECT count(*)::integer INTO v_count FROM public.notification_campaigns;
  ELSIF p_entity = 'vehicles' THEN
    SELECT count(*)::integer INTO v_count FROM public.vehicles;
    IF EXISTS (SELECT 1 FROM public.fuel_fills) THEN
      v_blockers := array_append(v_blockers, 'blocked_by_fuel');
    END IF;
  ELSIF p_entity = 'fuel' THEN
    SELECT count(*)::integer INTO v_count FROM public.fuel_fills;
  ELSIF p_entity = 'wrong_actions' THEN
    SELECT count(*)::integer INTO v_count FROM public.wrong_actions;
  ELSIF p_entity = 'order_recon' THEN
    SELECT count(*)::integer INTO v_count FROM public.order_recon_runs;
  ELSIF p_entity = 'verifications' THEN
    SELECT count(*)::integer INTO v_count FROM public.delivery_verifications;
  ELSIF p_entity = 'esign' THEN
    SELECT count(*)::integer INTO v_count FROM public.esign_requests;
  ELSIF p_entity = 'payroll' THEN
    SELECT count(*)::integer INTO v_count FROM public.driver_off_structure;
  ELSIF p_entity = 'documents' THEN
    SELECT count(*)::integer INTO v_count FROM public.document_tracking;
  ELSE
    RAISE EXCEPTION 'unknown_entity';
  END IF;

  RETURN jsonb_build_object(
    'count', COALESCE(v_count, 0),
    'blockers', to_jsonb(v_blockers)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_purge_run_all(p_entity text, p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_limit integer;
  v_ids uuid[];
  v_deleted integer := 0;
  v_remaining integer := 0;
  v_blockers text[] := ARRAY[]::text[];
  v_result jsonb := '{}'::jsonb;
  v_preview jsonb;
BEGIN
  v_slug := public._admin_purge_slug_for_entity(p_entity);
  PERFORM public._admin_purge_require(v_slug);
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 500), 500));

  v_preview := public.admin_purge_preview_all(p_entity);
  v_blockers := ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_preview->'blockers', '[]'::jsonb)));
  IF cardinality(v_blockers) > 0 THEN
    RETURN jsonb_build_object(
      'deleted', 0,
      'remaining', COALESCE((v_preview->>'count')::integer, 0),
      'blockers', to_jsonb(v_blockers),
      'storage_keys', '[]'::jsonb,
      'manifest', '[]'::jsonb
    );
  END IF;

  IF p_entity IN ('deliveries', 'delivery') THEN
    SELECT coalesce(array_agg(id), '{}') INTO v_ids
    FROM (SELECT id FROM public.deliveries ORDER BY created_at LIMIT v_limit) s;
    IF cardinality(v_ids) > 0 THEN
      v_result := public.admin_purge_deliveries(v_ids);
    END IF;
    v_deleted := coalesce(cardinality(v_ids), 0);
    SELECT count(*)::integer INTO v_remaining FROM public.deliveries;

  ELSIF p_entity IN ('drivers', 'driver') THEN
    SELECT coalesce(array_agg(id), '{}') INTO v_ids
    FROM (
      SELECT id FROM public.profiles
      WHERE role = 'rider'::public.app_role
      ORDER BY created_at
      LIMIT v_limit
    ) s;
    IF cardinality(v_ids) > 0 THEN
      v_result := public.admin_purge_drivers(v_ids);
      v_deleted := coalesce(cardinality(v_ids), 0);
    ELSE
      SELECT coalesce(array_agg(id), '{}') INTO v_ids
      FROM (
        SELECT id FROM public.driver_intakes
        WHERE linked_profile_id IS NULL
        ORDER BY created_at
        LIMIT v_limit
      ) s;
      IF cardinality(v_ids) > 0 THEN
        v_result := public.admin_purge_intakes(v_ids);
        v_deleted := coalesce(cardinality(v_ids), 0);
      END IF;
    END IF;
    SELECT (
      (SELECT count(*) FROM public.profiles WHERE role = 'rider'::public.app_role)
      + (SELECT count(*) FROM public.driver_intakes WHERE linked_profile_id IS NULL)
    )::integer INTO v_remaining;

  ELSIF p_entity IN ('restaurants', 'restaurant') THEN
    SELECT coalesce(array_agg(id), '{}') INTO v_ids
    FROM (SELECT id FROM public.restaurants ORDER BY created_at LIMIT v_limit) s;
    IF cardinality(v_ids) > 0 THEN
      v_result := public.admin_purge_restaurants(v_ids);
    END IF;
    v_deleted := coalesce(cardinality(v_ids), 0);
    SELECT count(*)::integer INTO v_remaining FROM public.restaurants;

  ELSIF p_entity IN ('zones', 'zone') THEN
    SELECT coalesce(array_agg(id), '{}') INTO v_ids
    FROM (SELECT id FROM public.zones ORDER BY created_at LIMIT v_limit) s;
    IF cardinality(v_ids) > 0 THEN
      v_result := public.admin_purge_zones(v_ids);
    END IF;
    v_deleted := coalesce(cardinality(v_ids), 0);
    SELECT count(*)::integer INTO v_remaining FROM public.zones;

  ELSIF p_entity IN ('delivery_rules', 'delivery_rule') THEN
    SELECT coalesce(array_agg(id), '{}') INTO v_ids
    FROM (SELECT id FROM public.delivery_rules ORDER BY created_at LIMIT v_limit) s;
    IF cardinality(v_ids) > 0 THEN
      v_result := public.admin_purge_delivery_rules(v_ids);
    END IF;
    v_deleted := coalesce(cardinality(v_ids), 0);
    SELECT count(*)::integer INTO v_remaining FROM public.delivery_rules;

  ELSIF p_entity IN ('incentive_rules', 'incentive_rule') THEN
    SELECT coalesce(array_agg(id), '{}') INTO v_ids
    FROM (SELECT id FROM public.incentive_rules ORDER BY created_at LIMIT v_limit) s;
    IF cardinality(v_ids) > 0 THEN
      v_result := public.admin_purge_incentive_rules(v_ids);
    END IF;
    v_deleted := coalesce(cardinality(v_ids), 0);
    SELECT count(*)::integer INTO v_remaining FROM public.incentive_rules;

  ELSIF p_entity IN ('assets', 'asset_catalog') THEN
    SELECT coalesce(array_agg(id), '{}') INTO v_ids
    FROM (SELECT id FROM public.asset_catalog ORDER BY created_at LIMIT v_limit) s;
    IF cardinality(v_ids) > 0 THEN
      v_result := public.admin_purge_asset_catalog(v_ids);
    END IF;
    v_deleted := coalesce(cardinality(v_ids), 0);
    SELECT count(*)::integer INTO v_remaining FROM public.asset_catalog;

  ELSIF p_entity = 'partners' THEN
    UPDATE public.restaurants SET partner_id = NULL WHERE partner_id IS NOT NULL;
    UPDATE public.drivers SET partner_id = NULL WHERE partner_id IS NOT NULL;
    DELETE FROM public.partners;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_remaining := 0;

  ELSIF p_entity = 'driver_groups' THEN
    DELETE FROM public.driver_groups;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_remaining := 0;

  ELSIF p_entity = 'companies' THEN
    UPDATE public.drivers SET source_company = NULL
    WHERE source_company IN (SELECT key FROM public.source_companies WHERE is_system IS NOT TRUE);
    UPDATE public.driver_intakes SET source_company = NULL
    WHERE source_company IN (SELECT key FROM public.source_companies WHERE is_system IS NOT TRUE);
    PERFORM set_config('mggo.allow_company_purge', 'on', true);
    DELETE FROM public.source_companies WHERE is_system IS NOT TRUE;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_remaining := 0;

  ELSIF p_entity = 'requests' THEN
    SELECT coalesce(array_agg(id), '{}') INTO v_ids
    FROM (SELECT id FROM public.requests ORDER BY created_at LIMIT v_limit) s;
    DELETE FROM public.requests WHERE id = ANY(v_ids);
    v_deleted := coalesce(cardinality(v_ids), 0);
    SELECT count(*)::integer INTO v_remaining FROM public.requests;

  ELSIF p_entity = 'visits' THEN
    SELECT coalesce(array_agg(id), '{}') INTO v_ids
    FROM (SELECT id FROM public.visit_bookings ORDER BY created_at LIMIT v_limit) s;
    DELETE FROM public.visit_bookings WHERE id = ANY(v_ids);
    v_deleted := coalesce(cardinality(v_ids), 0);
    SELECT count(*)::integer INTO v_remaining FROM public.visit_bookings;

  ELSIF p_entity = 'earnings' THEN
    DELETE FROM public.driver_earnings_daily
    WHERE id IN (SELECT id FROM public.driver_earnings_daily LIMIT v_limit);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted < v_limit THEN
      DELETE FROM public.driver_wallet_entries
      WHERE id IN (SELECT id FROM public.driver_wallet_entries LIMIT v_limit - v_deleted);
      GET DIAGNOSTICS v_remaining = ROW_COUNT;
      v_deleted := v_deleted + v_remaining;
    END IF;
    SELECT (
      (SELECT count(*) FROM public.driver_earnings_daily)
      + (SELECT count(*) FROM public.driver_wallet_entries)
    )::integer INTO v_remaining;

  ELSIF p_entity = 'payouts' THEN
    DELETE FROM public.driver_payouts;
    DELETE FROM public.payout_runs;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_remaining := 0;

  ELSIF p_entity = 'attendance' THEN
    DELETE FROM public.driver_sessions WHERE ended_at IS NULL;
    DELETE FROM public.attendance_logs
    WHERE id IN (SELECT id FROM public.attendance_logs ORDER BY created_at LIMIT v_limit);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    SELECT count(*)::integer INTO v_remaining FROM public.attendance_logs;

  ELSIF p_entity = 'notifications' THEN
    DELETE FROM public.notification_campaigns
    WHERE id IN (SELECT id FROM public.notification_campaigns ORDER BY created_at LIMIT v_limit);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    SELECT count(*)::integer INTO v_remaining FROM public.notification_campaigns;

  ELSIF p_entity = 'vehicles' THEN
    UPDATE public.drivers SET vehicle_id = NULL WHERE vehicle_id IS NOT NULL;
    UPDATE public.driver_intakes SET vehicle_id = NULL WHERE vehicle_id IS NOT NULL;
    UPDATE public.vehicles SET current_driver_id = NULL WHERE current_driver_id IS NOT NULL;
    DELETE FROM public.vehicles
    WHERE id IN (SELECT id FROM public.vehicles ORDER BY created_at LIMIT v_limit);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    SELECT count(*)::integer INTO v_remaining FROM public.vehicles;

  ELSIF p_entity = 'fuel' THEN
    DELETE FROM public.fuel_withdrawn_overrides;
    DELETE FROM public.fuel_fills
    WHERE id IN (SELECT id FROM public.fuel_fills ORDER BY filled_at LIMIT v_limit);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    SELECT count(*)::integer INTO v_remaining FROM public.fuel_fills;

  ELSIF p_entity = 'wrong_actions' THEN
    DELETE FROM public.wrong_actions
    WHERE id IN (SELECT id FROM public.wrong_actions ORDER BY created_at LIMIT v_limit);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    SELECT count(*)::integer INTO v_remaining FROM public.wrong_actions;

  ELSIF p_entity = 'order_recon' THEN
    DELETE FROM public.order_recon_runs
    WHERE id IN (SELECT id FROM public.order_recon_runs ORDER BY created_at LIMIT v_limit);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    SELECT count(*)::integer INTO v_remaining FROM public.order_recon_runs;

  ELSIF p_entity = 'verifications' THEN
    DELETE FROM public.delivery_verifications;
    DELETE FROM public.verification_balances;
    DELETE FROM public.verification_import_batches;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_remaining := 0;

  ELSIF p_entity = 'esign' THEN
    DELETE FROM public.esign_requests
    WHERE id IN (SELECT id FROM public.esign_requests ORDER BY created_at LIMIT v_limit);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    SELECT count(*)::integer INTO v_remaining FROM public.esign_requests;

  ELSIF p_entity = 'payroll' THEN
    DELETE FROM public.driver_off_structure;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_remaining := 0;

  ELSIF p_entity = 'documents' THEN
    DELETE FROM public.document_tracking;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_remaining := 0;

  ELSE
    RAISE EXCEPTION 'unknown_entity';
  END IF;

  RETURN jsonb_build_object(
    'deleted', COALESCE(v_deleted, 0),
    'remaining', COALESCE(v_remaining, 0),
    'blockers', '[]'::jsonb,
    'storage_keys', COALESCE(v_result->'storage_keys', v_result->'storage_prefixes', '[]'::jsonb),
    'manifest', COALESCE(v_result->'manifest', '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public._admin_purge_require(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._admin_purge_require(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._admin_purge_slug_for_entity(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_preview_all(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_run_all(text, integer) TO authenticated;
