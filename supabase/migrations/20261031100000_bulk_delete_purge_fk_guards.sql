-- Clear all: close the foreign-key gaps found by auditing every FK that points
-- at a table the purge deletes.
--
-- Three classes of gap, all of which would have surfaced as a 23503 the first
-- time an operator pressed Clear all on live data:
--   1. fuel_fills.vehicle_id is ON DELETE RESTRICT, so vehicles could never be
--      cleared while any fill existed. The fill keeps its driver, litres and
--      cost; only the vehicle link goes.
--   2. deliveries.partner_id and driver_intakes.partner_id are NOT NULL-free
--      NO ACTION columns that the partners branch never cleared.
--   3. visit_bookings.rescheduled_from_id and esign_batch_rows.esign_request_id
--      are NO ACTION self/child links that must be released before the parent
--      row can go. esign_batch_rows.driver_id is NO ACTION on drivers too.
-- Zones also gain the two assignment columns the delete was missing
-- (profiles.zone_id for staff scope, offers.zone_id for the legacy ledger), and
-- the per-zone blocker for intakes is dropped in favour of nulling the
-- assignment, so the preview and the run can no longer disagree about whether a
-- zone is clearable.

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

    UPDATE public.drivers SET zone_id = NULL, updated_at = now() WHERE zone_id = v_id;
    UPDATE public.driver_intakes SET zone_id = NULL, updated_at = now() WHERE zone_id = v_id;
    UPDATE public.profiles SET zone_id = NULL, updated_at = now() WHERE zone_id = v_id;
    UPDATE public.offers SET zone_id = NULL WHERE zone_id = v_id;

    DELETE FROM public.zones WHERE id = v_id;
    v_deleted := v_deleted + 1;
  END LOOP;

  RETURN jsonb_build_object('deleted_count', v_deleted);
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

    DELETE FROM public.esign_batch_rows WHERE driver_id = v_driver_id;

    -- visit_bookings.rescheduled_from_id is NO ACTION, so a booking by another
    -- rider that was rescheduled off one of this rider's visits would hold the
    -- row in place and abort the whole delete.
    UPDATE public.visit_bookings
    SET rescheduled_from_id = NULL
    WHERE rescheduled_from_id IN (
      SELECT vb.id FROM public.visit_bookings vb WHERE vb.driver_id = v_driver_id
    );

    -- drivers.frozen_by is a NO ACTION self-reference: a rider who froze another
    -- rider would otherwise block that rider's profile row from being deleted.
    UPDATE public.drivers
    SET frozen_by = NULL, updated_at = now()
    WHERE frozen_by = v_driver_id;

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
    IF EXISTS (SELECT 1 FROM public.drivers d WHERE d.restaurant_id IS NOT NULL) THEN
      v_blockers := array_append(v_blockers, 'blocked_by_drivers');
    END IF;
  ELSIF p_entity IN ('zones', 'zone') THEN
    SELECT count(*)::integer INTO v_count FROM public.zones;
    IF EXISTS (SELECT 1 FROM public.deliveries d WHERE d.zone_id IS NOT NULL) THEN
      v_blockers := array_append(v_blockers, 'blocked_by_deliveries');
    END IF;
    IF EXISTS (SELECT 1 FROM public.restaurants r WHERE r.zone_id IS NOT NULL) THEN
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
  v_extra integer := 0;
  v_keys text[] := ARRAY[]::text[];
  v_more text[];
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
    UPDATE public.drivers SET partner_id = NULL, updated_at = now() WHERE partner_id IS NOT NULL;
    UPDATE public.driver_intakes SET partner_id = NULL, updated_at = now() WHERE partner_id IS NOT NULL;
    UPDATE public.deliveries SET partner_id = NULL WHERE partner_id IS NOT NULL;
    DELETE FROM public.partners;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_remaining := 0;

  ELSIF p_entity = 'driver_groups' THEN
    DELETE FROM public.driver_groups;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_remaining := 0;

  ELSIF p_entity = 'companies' THEN
    UPDATE public.drivers SET source_company = NULL, updated_at = now()
    WHERE source_company IN (SELECT key FROM public.source_companies WHERE is_system IS NOT TRUE);
    UPDATE public.driver_intakes SET source_company = NULL, updated_at = now()
    WHERE source_company IN (SELECT key FROM public.source_companies WHERE is_system IS NOT TRUE);
    PERFORM set_config('mggo.allow_company_purge', 'on', true);
    DELETE FROM public.source_companies WHERE is_system IS NOT TRUE;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_remaining := 0;

  ELSIF p_entity = 'requests' THEN
    SELECT coalesce(array_agg(id), '{}') INTO v_ids
    FROM (SELECT id FROM public.requests ORDER BY created_at LIMIT v_limit) s;
    SELECT COALESCE(array_agg(ra.storage_key), '{}') INTO v_more
    FROM public.request_attachments ra
    WHERE ra.request_id = ANY(COALESCE(v_ids, ARRAY[]::uuid[]))
      AND ra.storage_key IS NOT NULL
      AND btrim(ra.storage_key) <> '';
    v_keys := v_keys || COALESCE(v_more, ARRAY[]::text[]);
    DELETE FROM public.requests WHERE id = ANY(v_ids);
    v_deleted := coalesce(cardinality(v_ids), 0);
    SELECT count(*)::integer INTO v_remaining FROM public.requests;

  ELSIF p_entity = 'visits' THEN
    SELECT coalesce(array_agg(id), '{}') INTO v_ids
    FROM (SELECT id FROM public.visit_bookings ORDER BY created_at LIMIT v_limit) s;
    UPDATE public.visit_bookings SET rescheduled_from_id = NULL
    WHERE rescheduled_from_id = ANY(COALESCE(v_ids, ARRAY[]::uuid[]));
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
      GET DIAGNOSTICS v_extra = ROW_COUNT;
      v_deleted := v_deleted + v_extra;
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
    -- driver_sessions has no ended_at column: a live duty row is one that has
    -- not been signed out (went_offline_at IS NULL). Clearing attendance has to
    -- retire those or the fleet stays clocked in against deleted logs.
    DELETE FROM public.driver_sessions WHERE went_offline_at IS NULL;
    GET DIAGNOSTICS v_extra = ROW_COUNT;
    DELETE FROM public.attendance_logs
    WHERE id IN (SELECT id FROM public.attendance_logs ORDER BY created_at LIMIT v_limit);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_deleted := v_deleted + v_extra;
    SELECT count(*)::integer INTO v_remaining FROM public.attendance_logs;

  ELSIF p_entity = 'notifications' THEN
    DELETE FROM public.notification_campaigns
    WHERE id IN (SELECT id FROM public.notification_campaigns ORDER BY created_at LIMIT v_limit);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    SELECT count(*)::integer INTO v_remaining FROM public.notification_campaigns;

  ELSIF p_entity = 'vehicles' THEN
    UPDATE public.drivers SET vehicle_id = NULL, updated_at = now() WHERE vehicle_id IS NOT NULL;
    UPDATE public.driver_intakes SET vehicle_id = NULL, updated_at = now() WHERE vehicle_id IS NOT NULL;
    UPDATE public.vehicles SET current_driver_id = NULL WHERE current_driver_id IS NOT NULL;
    UPDATE public.fuel_fills SET vehicle_id = NULL WHERE vehicle_id IS NOT NULL;
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
    DELETE FROM public.verification_balances;
    DELETE FROM public.delivery_verifications;
    DELETE FROM public.verification_import_batches;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_remaining := 0;

  ELSIF p_entity = 'esign' THEN
    SELECT coalesce(array_agg(id), '{}') INTO v_ids
    FROM (SELECT id FROM public.esign_requests ORDER BY created_at LIMIT v_limit) s;
    SELECT COALESCE(array_agg(k), '{}') INTO v_more
    FROM (
      SELECT er.document_storage_key AS k
      FROM public.esign_requests er
      WHERE er.id = ANY(COALESCE(v_ids, ARRAY[]::uuid[])) AND er.document_storage_key IS NOT NULL
      UNION ALL
      SELECT er.signature_storage_key
      FROM public.esign_requests er
      WHERE er.id = ANY(COALESCE(v_ids, ARRAY[]::uuid[])) AND er.signature_storage_key IS NOT NULL
      UNION ALL
      SELECT er.signed_document_storage_key
      FROM public.esign_requests er
      WHERE er.id = ANY(COALESCE(v_ids, ARRAY[]::uuid[])) AND er.signed_document_storage_key IS NOT NULL
    ) keys;
    v_keys := v_keys || COALESCE(v_more, ARRAY[]::text[]);
    DELETE FROM public.esign_batch_rows
    WHERE esign_request_id = ANY(COALESCE(v_ids, ARRAY[]::uuid[]));
    DELETE FROM public.esign_requests WHERE id = ANY(v_ids);
    v_deleted := coalesce(cardinality(v_ids), 0);
    SELECT count(*)::integer INTO v_remaining FROM public.esign_requests;

  ELSIF p_entity = 'payroll' THEN
    DELETE FROM public.driver_off_structure;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_remaining := 0;

  ELSIF p_entity = 'documents' THEN
    SELECT COALESCE(array_agg(dt.object_key), '{}') INTO v_more
    FROM public.document_tracking dt
    WHERE dt.object_key IS NOT NULL AND btrim(dt.object_key) <> '';
    v_keys := v_keys || COALESCE(v_more, ARRAY[]::text[]);
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
    'storage_keys', COALESCE(v_result->'storage_keys', v_result->'storage_prefixes', '[]'::jsonb) || to_jsonb(COALESCE(v_keys, ARRAY[]::text[])),
    'manifest', COALESCE(v_result->'manifest', '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_purge_zones(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_purge_zones(uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_purge_drivers(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_purge_drivers(uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_purge_preview_all(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_purge_preview_all(text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_purge_run_all(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_purge_run_all(text, integer) TO authenticated;
