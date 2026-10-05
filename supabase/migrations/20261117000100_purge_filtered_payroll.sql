-- Clear by filter — payroll (driver off structure).
--
-- The one Clear-all module the first pass left out: `admin_purge_run_all` has
-- emptied `driver_off_structure` since 20261031000000, but the filtered engine
-- had no branch for it, so the dialog simply did not offer the module. This
-- migration adds that branch and changes nothing else.
--
-- `admin_purge_filter_columns`, `admin_purge_rows_of` and
-- `admin_purge_filtered_run` are re-created in full with the branch spliced in,
-- because each is a flat dispatcher: a `CREATE OR REPLACE` is the only way to add
-- a case to one. Every other line is byte-identical to 20261117000000, so the
-- entities that were already live keep the exact behaviour they shipped with —
-- `CREATE OR REPLACE` also preserves each function's ACL, and the grants are
-- restated at the end anyway.
--
-- The filter set is the module's own columns, and it is deliberately narrow:
-- `month` is a list of `YYYY-MM` (the column is a first-of-month date, so a
-- calendar would offer days the constraint rejects), `offDays` is a count range,
-- and `source` is the only other thing the table stores that an operator would
-- recognise. There is no date range and therefore no `date` key, which is why
-- this entity needs no `columnOverrides` entry.

CREATE OR REPLACE FUNCTION public.admin_purge_filter_columns(p_entity text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_entity
    WHEN 'drivers' THEN jsonb_build_array(
      jsonb_build_object('key', 'zone', 'kind', 'list'),
      jsonb_build_object('key', 'riderCategory', 'kind', 'list'),
      jsonb_build_object('key', 'companyName', 'kind', 'list'),
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'attendance', 'kind', 'list'),
      jsonb_build_object('key', 'restaurants', 'kind', 'list'),
      jsonb_build_object('key', 'platformName', 'kind', 'list'),
      jsonb_build_object('key', 'vehicleType', 'kind', 'list'),
      jsonb_build_object('key', 'todayDeliveries', 'kind', 'range')
    )
    WHEN 'vehicles' THEN jsonb_build_array(
      jsonb_build_object('key', 'kind', 'kind', 'list'),
      jsonb_build_object('key', 'condition', 'kind', 'list'),
      jsonb_build_object('key', 'carType', 'kind', 'list'),
      jsonb_build_object('key', 'typeOfUse', 'kind', 'list'),
      jsonb_build_object('key', 'fuelType', 'kind', 'list'),
      jsonb_build_object('key', 'fuelCompany', 'kind', 'list'),
      jsonb_build_object('key', 'carsCompany', 'kind', 'list'),
      jsonb_build_object('key', 'empCompany', 'kind', 'list'),
      jsonb_build_object('key', 'project', 'kind', 'list'),
      jsonb_build_object('key', 'replacement', 'kind', 'list'),
      jsonb_build_object('key', 'driver', 'kind', 'text'),
      jsonb_build_object('key', 'year', 'kind', 'range')
    )
    WHEN 'deliveries' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'zone', 'kind', 'list'),
      jsonb_build_object('key', 'partner', 'kind', 'list'),
      jsonb_build_object('key', 'restaurant', 'kind', 'list'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'attendance' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'earnings' THEN jsonb_build_array(
      jsonb_build_object('key', 'driver', 'kind', 'text'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'payouts' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'requests' THEN jsonb_build_array(
      jsonb_build_object('key', 'type', 'kind', 'list'),
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'driver', 'kind', 'text'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'visits' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'department', 'kind', 'list'),
      jsonb_build_object('key', 'driver', 'kind', 'text'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'notifications' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'category', 'kind', 'list'),
      jsonb_build_object('key', 'priority', 'kind', 'list'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'esign' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'category', 'kind', 'list'),
      jsonb_build_object('key', 'driver', 'kind', 'text'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'fuel' THEN jsonb_build_array(
      jsonb_build_object('key', 'driver', 'kind', 'text'),
      jsonb_build_object('key', 'station', 'kind', 'text'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'wrong_actions' THEN jsonb_build_array(
      jsonb_build_object('key', 'actionType', 'kind', 'list'),
      jsonb_build_object('key', 'severity', 'kind', 'list'),
      jsonb_build_object('key', 'driver', 'kind', 'text'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'documents' THEN jsonb_build_array(
      jsonb_build_object('key', 'docType', 'kind', 'list'),
      jsonb_build_object('key', 'tracking', 'kind', 'list'),
      jsonb_build_object('key', 'driver', 'kind', 'text'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'order_recon' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'file', 'kind', 'text'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'verifications' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'partner', 'kind', 'list'),
      jsonb_build_object('key', 'restaurant', 'kind', 'list'),
      jsonb_build_object('key', 'driver', 'kind', 'text'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'restaurants' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'active', 'kind', 'list'),
      jsonb_build_object('key', 'partner', 'kind', 'list'),
      jsonb_build_object('key', 'zone', 'kind', 'list'),
      jsonb_build_object('key', 'name', 'kind', 'text')
    )
    WHEN 'zones' THEN jsonb_build_array(
      jsonb_build_object('key', 'zoneType', 'kind', 'list'),
      jsonb_build_object('key', 'name', 'kind', 'text')
    )
    WHEN 'partners' THEN jsonb_build_array(
      jsonb_build_object('key', 'name', 'kind', 'text')
    )
    WHEN 'companies' THEN jsonb_build_array(
      jsonb_build_object('key', 'active', 'kind', 'list'),
      jsonb_build_object('key', 'name', 'kind', 'text')
    )
    WHEN 'driver_groups' THEN jsonb_build_array(
      jsonb_build_object('key', 'name', 'kind', 'text')
    )
    WHEN 'assets' THEN jsonb_build_array(
      jsonb_build_object('key', 'category', 'kind', 'list'),
      jsonb_build_object('key', 'active', 'kind', 'list'),
      jsonb_build_object('key', 'name', 'kind', 'text')
    )
    WHEN 'delivery_rules' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'scopeType', 'kind', 'list'),
      jsonb_build_object('key', 'name', 'kind', 'text')
    )
    WHEN 'incentive_rules' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'scopeType', 'kind', 'list'),
      jsonb_build_object('key', 'period', 'kind', 'list'),
      jsonb_build_object('key', 'name', 'kind', 'text')
    )
    WHEN 'payroll' THEN jsonb_build_array(
      jsonb_build_object('key', 'driver', 'kind', 'text'),
      jsonb_build_object('key', 'month', 'kind', 'list'),
      jsonb_build_object('key', 'source', 'kind', 'list'),
      jsonb_build_object('key', 'offDays', 'kind', 'range')
    )
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.admin_purge_rows_of(p_entity text)
RETURNS TABLE(purge_id text, row_json jsonb, purge_kind text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_entity = 'drivers' THEN
    RETURN QUERY
    WITH base AS (
      SELECT to_jsonb(b) AS b FROM public.admin_drivers_list_base(false) b
      UNION ALL
      SELECT to_jsonb(b) AS b FROM public.admin_drivers_list_base(true) b
    )
    SELECT
      coalesce(b->>'linked_profile_id', b->>'id'),
      b || jsonb_build_object(
             'label', coalesce(b->>'full_name', ''),
             'sublabel', concat_ws(' · ',
               nullif(b->>'driver_code', ''),
               nullif(b->>'zone_name', ''),
               nullif(b->>'company_name', '')),
             'status', coalesce(b->>'status_key', '')
           ),
      CASE WHEN b->>'linked_profile_id' IS NULL THEN 'intake' ELSE 'driver' END
    FROM base;
    RETURN;
  END IF;

  IF p_entity = 'vehicles' THEN
    RETURN QUERY
    SELECT f.vehicle_id::text, f.r, 'vehicles'
    FROM public.admin_purge_vehicle_filter_rows() f;
    RETURN;
  END IF;

  IF p_entity = 'deliveries' THEN
    RETURN QUERY
    SELECT d.id::text,
           jsonb_build_object(
             'id', d.id,
             'label', coalesce(nullif(d.external_order_id, ''), left(d.id::text, 8)),
             'sublabel', concat_ws(' · ', nullif(pr.full_name, ''), nullif(rs.name, '')),
             'status', d.status::text,
             'zone', coalesce(d.zone_id::text, ''),
             'partner', coalesce(d.partner_id::text, ''),
             'restaurant', coalesce(d.restaurant_id::text, ''),
             'date', to_jsonb(to_char(d.created_at AT TIME ZONE 'Asia/Kuwait', 'YYYYMMDD')::integer)
           ),
           'deliveries'
    FROM public.deliveries d
    LEFT JOIN public.profiles pr ON pr.id = d.driver_id
    LEFT JOIN public.restaurants rs ON rs.id = d.restaurant_id;
    RETURN;
  END IF;

  IF p_entity = 'attendance' THEN
    RETURN QUERY
    SELECT al.id::text,
           jsonb_build_object(
             'id', al.id,
             'label', coalesce(nullif(pr.full_name, ''), d.driver_code, ''),
             'sublabel', concat_ws(' · ', d.driver_code, al.log_date::text),
             'status', al.status::text,
             'date', to_jsonb(to_char(al.log_date, 'YYYYMMDD')::integer)
           ),
           'attendance_logs'
    FROM public.attendance_logs al
    LEFT JOIN public.profiles pr ON pr.id = al.driver_id
    LEFT JOIN public.drivers d ON d.id = al.driver_id;
    RETURN;
  END IF;

  IF p_entity = 'earnings' THEN
    -- Both halves of the earnings module are listed, because Clear all deletes
    -- both: a filtered purge that removed only the daily rows would leave the
    -- wallet ledger behind with nothing it points at.
    RETURN QUERY
    SELECT e.id::text,
           jsonb_build_object(
             'id', e.id,
             'label', coalesce(nullif(e.full_name, ''), e.driver_code, ''),
             'sublabel', concat_ws(' · ', e.earn_date::text, e.entry),
             'status', e.entry,
             'driver', concat_ws(' · ', nullif(e.full_name, ''), nullif(e.driver_code, '')),
             'date', to_jsonb(to_char(e.earn_date, 'YYYYMMDD')::integer)
           ),
           e.kind
    FROM (
      SELECT de.id, de.earn_date, pr.full_name, d.driver_code,
             'daily'::text AS entry, 'earnings_daily'::text AS kind
      FROM public.driver_earnings_daily de
      LEFT JOIN public.profiles pr ON pr.id = de.driver_id
      LEFT JOIN public.drivers d ON d.id = de.driver_id
      UNION ALL
      SELECT we.id, we.earn_date, pr.full_name, d.driver_code,
             coalesce(we.entry_type::text, 'wallet'), 'wallet'::text
      FROM public.driver_wallet_entries we
      LEFT JOIN public.profiles pr ON pr.id = we.driver_id
      LEFT JOIN public.drivers d ON d.id = we.driver_id
    ) e;
    RETURN;
  END IF;

  IF p_entity = 'payouts' THEN
    RETURN QUERY
    SELECT r.id::text,
           jsonb_build_object(
             'id', r.id,
             'label', r.period_start::text || ' → ' || r.period_end::text,
             'sublabel', coalesce(r.status::text, ''),
             'status', r.status::text,
             'date', to_jsonb(to_char(r.period_start, 'YYYYMMDD')::integer)
           ),
           'payout_run'
    FROM public.payout_runs r;
    RETURN;
  END IF;

  IF p_entity = 'requests' THEN
    RETURN QUERY
    SELECT q.id::text,
           jsonb_build_object(
             'id', q.id,
             'label', q.request_code,
             'sublabel', concat_ws(' · ', q.request_type, nullif(q.full_name, '')),
             'status', q.status::text,
             'type', q.request_type,
             'driver', concat_ws(' · ', nullif(q.full_name, ''), nullif(q.driver_code, '')),
             'date', to_jsonb(to_char(q.created_at AT TIME ZONE 'Asia/Kuwait', 'YYYYMMDD')::integer)
           ),
           'requests'
    FROM (
      SELECT rq.id, rq.request_code, rq.request_type, rq.status, rq.created_at,
             pr.full_name, d.driver_code
      FROM public.requests rq
      LEFT JOIN public.profiles pr ON pr.id = rq.driver_id
      LEFT JOIN public.drivers d ON d.id = rq.driver_id
    ) q;
    RETURN;
  END IF;

  IF p_entity = 'visits' THEN
    RETURN QUERY
    SELECT v.id::text,
           jsonb_build_object(
             'id', v.id,
             'label', v.booking_code,
             'sublabel', concat_ws(' · ', v.department_key, v.scheduled_date::text),
             'status', v.status::text,
             'department', v.department_key,
             'driver', concat_ws(' · ', nullif(pr.full_name, ''), nullif(d.driver_code, '')),
             'date', to_jsonb(to_char(v.scheduled_date, 'YYYYMMDD')::integer)
           ),
           'visit_bookings'
    FROM public.visit_bookings v
    LEFT JOIN public.profiles pr ON pr.id = v.driver_id
    LEFT JOIN public.drivers d ON d.id = v.driver_id;
    RETURN;
  END IF;

  IF p_entity = 'notifications' THEN
    RETURN QUERY
    SELECT c.id::text,
           jsonb_build_object(
             'id', c.id,
             'label', c.title,
             'sublabel', concat_ws(' · ', c.category::text, c.priority::text),
             'status', c.status::text,
             'category', c.category::text,
             'priority', c.priority::text,
             'date', to_jsonb(to_char(c.created_at AT TIME ZONE 'Asia/Kuwait', 'YYYYMMDD')::integer)
           ),
           'notification_campaigns'
    FROM public.notification_campaigns c;
    RETURN;
  END IF;

  IF p_entity = 'esign' THEN
    RETURN QUERY
    SELECT s.id::text,
           jsonb_build_object(
             'id', s.id,
             'label', s.request_code,
             'sublabel', concat_ws(' · ', nullif(s.title, ''), nullif(cat.label_en, ''), nullif(pr.full_name, '')),
             'status', s.status::text,
             'category', s.category_key,
             'driver', concat_ws(' · ', nullif(pr.full_name, ''), nullif(d.driver_code, '')),
             'date', to_jsonb(to_char(s.created_at AT TIME ZONE 'Asia/Kuwait', 'YYYYMMDD')::integer)
           ),
           'esign'
    FROM public.esign_requests s
    LEFT JOIN public.esign_categories cat ON cat.key = s.category_key
    LEFT JOIN public.profiles pr ON pr.id = s.driver_id
    LEFT JOIN public.drivers d ON d.id = s.driver_id;
    RETURN;
  END IF;

  IF p_entity = 'fuel' THEN
    RETURN QUERY
    SELECT f.id::text,
           jsonb_build_object(
             'id', f.id,
             'label', concat_ws(' · ', nullif(pr.full_name, ''), nullif(d.driver_code, '')),
             'sublabel', concat_ws(' · ', nullif(f.station_name, ''),
                                  to_char(f.filled_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD')),
             'status', 'fill',
             'driver', concat_ws(' · ', nullif(pr.full_name, ''), nullif(d.driver_code, '')),
             'station', coalesce(f.station_name, ''),
             'date', to_jsonb(to_char(f.filled_at AT TIME ZONE 'Asia/Kuwait', 'YYYYMMDD')::integer)
           ),
           'fuel_fill'
    FROM public.fuel_fills f
    LEFT JOIN public.profiles pr ON pr.id = f.driver_id
    LEFT JOIN public.drivers d ON d.id = f.driver_id;
    RETURN;
  END IF;

  IF p_entity = 'wrong_actions' THEN
    RETURN QUERY
    SELECT w.id::text,
           jsonb_build_object(
             'id', w.id,
             'label', coalesce(nullif(pr.full_name, ''), d.driver_code, '—'),
             'sublabel', concat_ws(' · ', w.action_type, w.severity::text,
                                   left(coalesce(w.details, ''), 60)),
             'status', w.severity::text,
             'actionType', w.action_type,
             'severity', w.severity::text,
             'driver', concat_ws(' · ', nullif(pr.full_name, ''), nullif(d.driver_code, '')),
             'date', to_jsonb(to_char(w.occurred_at AT TIME ZONE 'Asia/Kuwait', 'YYYYMMDD')::integer)
           ),
           'wrong_actions'
    FROM public.wrong_actions w
    LEFT JOIN public.profiles pr ON pr.id = w.driver_id
    LEFT JOIN public.drivers d ON d.id = w.driver_id;
    RETURN;
  END IF;

  IF p_entity = 'documents' THEN
    RETURN QUERY
    SELECT t.id::text,
           jsonb_build_object(
             'id', t.id,
             'label', t.doc_type::text,
             'sublabel', concat_ws(' · ',
                            coalesce(nullif(pr.full_name, ''), nullif(i.full_name, ''), ''),
                            t.expires_at::text),
             'status', CASE WHEN t.track_expiry THEN 'tracked' ELSE 'untracked' END,
             'docType', t.doc_type::text,
             'tracking', CASE WHEN t.track_expiry THEN 'yes' ELSE 'no' END,
             'driver', concat_ws(' · ', nullif(pr.full_name, ''), nullif(i.full_name, ''),
                                 nullif(d.driver_code, '')),
             'date', to_jsonb(to_char(t.expires_at, 'YYYYMMDD')::integer)
           ),
           'document_tracking'
    FROM public.document_tracking t
    LEFT JOIN public.profiles pr ON pr.id = t.driver_id
    LEFT JOIN public.drivers d ON d.id = t.driver_id
    LEFT JOIN public.driver_intakes i ON i.id = t.intake_id;
    RETURN;
  END IF;

  IF p_entity = 'order_recon' THEN
    RETURN QUERY
    SELECT rn.id::text,
           jsonb_build_object(
             'id', rn.id,
             'label', rn.file_name,
             'sublabel', rn.from_date::text || ' → ' || rn.to_date::text,
             'status', rn.status::text,
             'file', rn.file_name,
             'date', to_jsonb(to_char(rn.from_date, 'YYYYMMDD')::integer)
           ),
           'order_recon_run'
    FROM public.order_recon_runs rn;
    RETURN;
  END IF;

  IF p_entity = 'verifications' THEN
    RETURN QUERY
    SELECT v.id::text,
           jsonb_build_object(
             'id', v.id,
             'label', v.service_date::text || ' · ' || coalesce(rs.name, '—'),
             'sublabel', concat_ws(' · ', nullif(pr.full_name, ''), nullif(pt.name, '')),
             'status', v.status::text,
             'partner', coalesce(v.partner_id::text, ''),
             'restaurant', coalesce(v.restaurant_id::text, ''),
             'driver', concat_ws(' · ', nullif(pr.full_name, ''), nullif(d.driver_code, '')),
             'date', to_jsonb(to_char(v.service_date, 'YYYYMMDD')::integer)
           ),
           'verification'
    FROM public.delivery_verifications v
    LEFT JOIN public.profiles pr ON pr.id = v.driver_id
    LEFT JOIN public.drivers d ON d.id = v.driver_id
    LEFT JOIN public.restaurants rs ON rs.id = v.restaurant_id
    LEFT JOIN public.partners pt ON pt.id = v.partner_id;
    RETURN;
  END IF;

  IF p_entity = 'restaurants' THEN
    RETURN QUERY
    SELECT r.id::text,
           jsonb_build_object(
             'id', r.id,
             'label', r.name,
             'sublabel', concat_ws(' · ', pt.name, z.name),
             'status', r.status::text,
             'active', CASE WHEN r.is_active THEN 'yes' ELSE 'no' END,
             'partner', coalesce(r.partner_id::text, ''),
             'zone', coalesce(r.zone_id::text, ''),
             'name', r.name
           ),
           'restaurant'
    FROM public.restaurants r
    LEFT JOIN public.partners pt ON pt.id = r.partner_id
    LEFT JOIN public.zones z ON z.id = r.zone_id;
    RETURN;
  END IF;

  IF p_entity = 'zones' THEN
    RETURN QUERY
    SELECT z.id::text,
           jsonb_build_object(
             'id', z.id,
             'label', z.name,
             'sublabel', z.code,
             'status', z.zone_type::text,
             'zoneType', z.zone_type::text,
             'name', z.name
           ),
           'zone'
    FROM public.zones z;
    RETURN;
  END IF;

  IF p_entity = 'partners' THEN
    RETURN QUERY
    SELECT p.id::text,
           jsonb_build_object(
             'id', p.id,
             'label', p.name,
             'sublabel', p.slug,
             'status', '',
             'name', p.name
           ),
           'partner'
    FROM public.partners p;
    RETURN;
  END IF;

  IF p_entity = 'companies' THEN
    RETURN QUERY
    SELECT c.key,
           jsonb_build_object(
             'id', c.key,
             'label', c.name,
             'sublabel', c.key,
             'status', CASE WHEN c.is_active THEN 'active' ELSE 'inactive' END,
             'active', CASE WHEN c.is_active THEN 'yes' ELSE 'no' END,
             'name', c.name
           ),
           'company'
    FROM public.source_companies c
    WHERE c.is_system IS NOT TRUE;
    RETURN;
  END IF;

  IF p_entity = 'driver_groups' THEN
    RETURN QUERY
    SELECT g.id::text,
           jsonb_build_object(
             'id', g.id,
             'label', g.name,
             'sublabel', coalesce(g.description, ''),
             'status', '',
             'name', g.name
           ),
           'driver_group'
    FROM public.driver_groups g;
    RETURN;
  END IF;

  IF p_entity = 'assets' THEN
    RETURN QUERY
    SELECT a.id::text,
           jsonb_build_object(
             'id', a.id,
             'label', a.name,
             'sublabel', concat_ws(' · ', nullif(a.code, ''), nullif(a.category, '')),
             'status', CASE WHEN a.is_active THEN 'active' ELSE 'inactive' END,
             'category', coalesce(a.category, ''),
             'active', CASE WHEN a.is_active THEN 'yes' ELSE 'no' END,
             'name', a.name
           ),
           'asset'
    FROM public.asset_catalog a;
    RETURN;
  END IF;

  IF p_entity = 'delivery_rules' THEN
    RETURN QUERY
    SELECT r.id::text,
           jsonb_build_object(
             'id', r.id,
             'label', r.name,
             'sublabel', r.scope_type::text,
             'status', r.status::text,
             'scopeType', r.scope_type::text,
             'name', r.name
           ),
           'delivery_rule'
    FROM public.delivery_rules r;
    RETURN;
  END IF;

  IF p_entity = 'incentive_rules' THEN
    RETURN QUERY
    SELECT r.id::text,
           jsonb_build_object(
             'id', r.id,
             'label', r.name,
             'sublabel', concat_ws(' · ', r.scope_type::text, r.period::text),
             'status', r.status::text,
             'scopeType', r.scope_type::text,
             'period', r.period::text,
             'name', r.name
           ),
           'incentive_rule'
    FROM public.incentive_rules r;
    RETURN;
  END IF;

  IF p_entity = 'payroll' THEN
    RETURN QUERY
    -- The key is the row's own identity: this table is keyed
    -- (driver_id, period_month) and has no surrogate id, so the two columns
    -- that make a row unique are what the review list carries and the delete
    -- takes back. `offDays` is a jsonb number rather than text, because the
    -- range matcher only compares numbers.
    SELECT (s.driver_id::text || '|' || to_char(s.period_month, 'YYYYMMDD')),
           jsonb_build_object(
             'id', s.driver_id::text || '|' || to_char(s.period_month, 'YYYYMMDD'),
             'label', coalesce(nullif(pr.full_name, ''), s.driver_id::text),
             'sublabel', concat_ws(' · ',
                            to_char(s.period_month, 'YYYY-MM'),
                            s.off_days::text || ' OFF',
                            s.source),
             'status', s.source,
             'driver', concat_ws(' · ', nullif(pr.full_name, ''), nullif(d.driver_code, '')),
             'month', to_char(s.period_month, 'YYYY-MM'),
             'source', s.source,
             'offDays', to_jsonb(s.off_days)
           ),
           'off_structure'
    FROM public.driver_off_structure s
    LEFT JOIN public.profiles pr ON pr.id = s.driver_id
    LEFT JOIN public.drivers d ON d.id = s.driver_id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'unknown_entity' USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_purge_filtered_run(
  p_entity text,
  p_filters jsonb,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(coalesce(p_limit, 500), 500));
  v_preview jsonb;
  v_blockers text[];
  v_ids text[] := ARRAY[]::text[];
  v_kinds text[] := ARRAY[]::text[];
  v_uuid_ids uuid[];
  v_driver_ids uuid[];
  v_intake_ids uuid[];
  v_result jsonb := '{}'::jsonb;
  v_extra jsonb := '{}'::jsonb;
  v_deleted integer := 0;
  v_remaining integer := 0;
BEGIN
  PERFORM public._admin_purge_require_super_admin();
  PERFORM public.admin_purge_validate_filters(p_entity, p_filters);

  v_preview := public.admin_purge_filtered_preview(p_entity, p_filters);
  v_blockers := ARRAY(SELECT jsonb_array_elements_text(coalesce(v_preview->'blockers', '[]'::jsonb)));
  IF cardinality(v_blockers) > 0 THEN
    RETURN jsonb_build_object(
      'deleted', 0,
      'remaining', coalesce((v_preview->>'count')::integer, 0),
      'blockers', to_jsonb(v_blockers),
      'storage_keys', '[]'::jsonb,
      'manifest', '[]'::jsonb
    );
  END IF;

  SELECT array_agg(s.id_text ORDER BY s.id_text), array_agg(s.purge_kind ORDER BY s.id_text)
  INTO v_ids, v_kinds
  FROM (
    SELECT m.purge_id AS id_text, m.purge_kind
    FROM public.admin_purge_matched_rows(p_entity, p_filters) m
    ORDER BY m.purge_id
    LIMIT v_limit
  ) s;

  IF coalesce(cardinality(v_ids), 0) > 0 THEN

    IF p_entity = 'drivers' THEN
      v_driver_ids := ARRAY(SELECT u::uuid FROM unnest(v_ids, v_kinds) AS t(u, k) WHERE k = 'driver');
      v_intake_ids := ARRAY(SELECT u::uuid FROM unnest(v_ids, v_kinds) AS t(u, k) WHERE k = 'intake');
      IF cardinality(v_driver_ids) > 0 THEN
        v_result := public.admin_purge_drivers(v_driver_ids);
      END IF;
      IF cardinality(v_intake_ids) > 0 THEN
        v_extra := public.admin_purge_intakes(v_intake_ids);
        v_result := v_result
          || jsonb_build_object('storage_keys',
               coalesce(v_result->'storage_keys', '[]'::jsonb)
               || coalesce(v_extra->'storage_prefixes', '[]'::jsonb));
      END IF;

    ELSIF p_entity = 'deliveries' THEN
      v_result := public.admin_purge_deliveries(v_ids::uuid[]);

    ELSIF p_entity = 'restaurants' THEN
      v_result := public.admin_purge_restaurants(v_ids::uuid[]);

    ELSIF p_entity = 'zones' THEN
      v_result := public.admin_purge_zones(v_ids::uuid[]);

    ELSIF p_entity = 'assets' THEN
      v_result := public.admin_purge_asset_catalog(v_ids::uuid[]);

    ELSIF p_entity = 'delivery_rules' THEN
      v_result := public.admin_purge_delivery_rules(v_ids::uuid[]);

    ELSIF p_entity = 'incentive_rules' THEN
      v_result := public.admin_purge_incentive_rules(v_ids::uuid[]);

    ELSIF p_entity = 'vehicles' THEN
      v_uuid_ids := v_ids::uuid[];
      UPDATE public.drivers SET vehicle_id = NULL, updated_at = now()
      WHERE vehicle_id = ANY(v_uuid_ids);
      UPDATE public.driver_intakes SET vehicle_id = NULL WHERE vehicle_id = ANY(v_uuid_ids);
      UPDATE public.vehicles SET current_driver_id = NULL, updated_at = now()
      WHERE id = ANY(v_uuid_ids);
      -- Any matched vehicle with a fuel fill was already refused by the preview,
      -- so `fuel_fills` is never touched here: a fill's vehicle link is the
      -- record of which vehicle the fuel went into.
      DELETE FROM public.vehicles WHERE id = ANY(v_uuid_ids);

    ELSIF p_entity = 'attendance' THEN
      v_uuid_ids := v_ids::uuid[];
      -- `driver_sessions` has no `ended_at`; a live duty row is one that has not
      -- been signed out. Leaving it open beside a deleted log is the state that
      -- keeps the rider reading Clocked In with nothing behind it.
      DELETE FROM public.driver_sessions
      WHERE went_offline_at IS NULL
        AND driver_id IN (SELECT al.driver_id FROM public.attendance_logs al WHERE al.id = ANY(v_uuid_ids));
      DELETE FROM public.attendance_logs WHERE id = ANY(v_uuid_ids);

    ELSIF p_entity = 'earnings' THEN
      DELETE FROM public.driver_earnings_daily
      WHERE id = ANY(ARRAY(SELECT u::uuid FROM unnest(v_ids, v_kinds) AS t(u, k) WHERE k = 'earnings_daily'));
      DELETE FROM public.driver_wallet_entries
      WHERE id = ANY(ARRAY(SELECT u::uuid FROM unnest(v_ids, v_kinds) AS t(u, k) WHERE k = 'wallet'));

    ELSIF p_entity = 'payouts' THEN
      -- `driver_payouts.run_id` is ON DELETE CASCADE, so each run takes its own
      -- payment rows with it.
      DELETE FROM public.payout_runs WHERE id = ANY(v_ids::uuid[]);

    ELSIF p_entity = 'requests' THEN
      DELETE FROM public.requests WHERE id = ANY(v_ids::uuid[]);

    ELSIF p_entity = 'visits' THEN
      v_uuid_ids := v_ids::uuid[];
      -- A booking by another rider rescheduled off one of these visits is NO
      -- ACTION and would hold the row in place.
      UPDATE public.visit_bookings SET rescheduled_from_id = NULL
      WHERE rescheduled_from_id = ANY(v_uuid_ids);
      DELETE FROM public.visit_bookings WHERE id = ANY(v_uuid_ids);

    ELSIF p_entity = 'notifications' THEN
      DELETE FROM public.notification_campaigns WHERE id = ANY(v_ids::uuid[]);

    ELSIF p_entity = 'esign' THEN
      v_uuid_ids := v_ids::uuid[];
      UPDATE public.esign_batch_rows SET esign_request_id = NULL
      WHERE esign_request_id = ANY(v_uuid_ids);
      DELETE FROM public.esign_requests WHERE id = ANY(v_uuid_ids);

    ELSIF p_entity = 'fuel' THEN
      -- Deliberately not the Clear all behaviour of wiping fuel_withdrawn_
      -- overrides: those are per rider / vehicle / month, not per fill, and a
      -- narrow purge must not delete rows the operator did not select.
      DELETE FROM public.fuel_fills WHERE id = ANY(v_ids::uuid[]);

    ELSIF p_entity = 'wrong_actions' THEN
      DELETE FROM public.wrong_actions WHERE id = ANY(v_ids::uuid[]);

    ELSIF p_entity = 'documents' THEN
      DELETE FROM public.document_tracking WHERE id = ANY(v_ids::uuid[]);

    ELSIF p_entity = 'order_recon' THEN
      DELETE FROM public.order_recon_runs WHERE id = ANY(v_ids::uuid[]);

    ELSIF p_entity = 'verifications' THEN
      v_uuid_ids := v_ids::uuid[];
      -- `verification_balances.last_verification_id` is NO ACTION. The balance
      -- is a running total per rider, not a child of one verification, so the
      -- link is released rather than the balance deleted.
      UPDATE public.verification_balances SET last_verification_id = NULL
      WHERE last_verification_id = ANY(v_uuid_ids);
      DELETE FROM public.delivery_verifications WHERE id = ANY(v_uuid_ids);

    ELSIF p_entity = 'partners' THEN
      v_uuid_ids := v_ids::uuid[];
      UPDATE public.restaurants SET partner_id = NULL WHERE partner_id = ANY(v_uuid_ids);
      UPDATE public.drivers SET partner_id = NULL, updated_at = now() WHERE partner_id = ANY(v_uuid_ids);
      UPDATE public.driver_intakes SET partner_id = NULL WHERE partner_id = ANY(v_uuid_ids);
      UPDATE public.deliveries SET partner_id = NULL WHERE partner_id = ANY(v_uuid_ids);
      DELETE FROM public.partners WHERE id = ANY(v_uuid_ids);

    ELSIF p_entity = 'companies' THEN
      UPDATE public.drivers SET source_company = NULL, updated_at = now()
      WHERE source_company = ANY(v_ids);
      UPDATE public.driver_intakes SET source_company = NULL
      WHERE source_company = ANY(v_ids);
      PERFORM set_config('mggo.allow_company_purge', 'on', true);
      DELETE FROM public.source_companies
      WHERE key = ANY(v_ids) AND is_system IS NOT TRUE;

    ELSIF p_entity = 'driver_groups' THEN
      DELETE FROM public.driver_groups WHERE id = ANY(v_ids::uuid[]);

    ELSIF p_entity = 'payroll' THEN
      -- One row per (rider, month), so the composite key the row source emitted
      -- is decoded back here rather than matched against a column that does not
      -- exist. Nothing points at this table, so no link needs releasing first.
      DELETE FROM public.driver_off_structure s
      WHERE (s.driver_id::text || '|' || to_char(s.period_month, 'YYYYMMDD')) = ANY(v_ids);

    ELSE
      RAISE EXCEPTION 'unknown_entity' USING ERRCODE = '22023';
    END IF;

    v_deleted := cardinality(v_ids);
  END IF;

  SELECT count(*)::integer INTO v_remaining
  FROM public.admin_purge_matched_rows(p_entity, p_filters);

  RETURN jsonb_build_object(
    'deleted', coalesce(v_deleted, 0),
    'remaining', coalesce(v_remaining, 0),
    'blockers', '[]'::jsonb,
    'storage_keys', coalesce(v_result->'storage_keys', v_result->'storage_prefixes', '[]'::jsonb),
    'manifest', coalesce(v_result->'manifest', '[]'::jsonb)
  );
END;
$$;

/* ------------------------------------------------------------------ */
/* Grants                                                              */
/* ------------------------------------------------------------------ */

-- Restated rather than assumed: these three were replaced, and the two helpers
-- stay exactly as the previous migration left them. A DROP would have reset the
-- ACL to Postgres' PUBLIC default, so the contract is written down either way.
REVOKE ALL ON FUNCTION public.admin_purge_filter_columns(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_purge_rows_of(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_purge_filtered_run(text, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_purge_filter_columns(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_rows_of(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_filtered_run(text, jsonb, integer) TO authenticated;
