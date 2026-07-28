-- Super-admin data cleanup: preview + permanent purge RPCs for go-live test data removal.

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
BEGIN
  PERFORM public._admin_purge_require_super_admin();

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

      IF (v_counts->>'drivers')::integer > 0 THEN
        v_blockers := array_append(v_blockers, 'has_drivers');
      END IF;
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
  PERFORM public._admin_purge_require_super_admin();

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
  PERFORM public._admin_purge_require_super_admin();

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
  PERFORM public._admin_purge_require_super_admin();

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
  PERFORM public._admin_purge_require_super_admin();

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
  PERFORM public._admin_purge_require_super_admin();

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
  PERFORM public._admin_purge_require_super_admin();
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
  PERFORM public._admin_purge_require_super_admin();
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
  PERFORM public._admin_purge_require_super_admin();

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

GRANT EXECUTE ON FUNCTION public.admin_preview_purge(text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_deliveries(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_drivers(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_intakes(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_restaurants(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_zones(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_delivery_rules(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_incentive_rules(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_asset_catalog(uuid[]) TO authenticated;
