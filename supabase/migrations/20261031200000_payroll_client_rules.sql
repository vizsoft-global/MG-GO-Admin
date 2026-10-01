-- MGGO Payroll SOP v4.0 — client rules.
--
-- A client is the same thing the Payroll page already calls a Partner: it is
-- drivers.project_key. The SOP says outright "There is no Project column or
-- slicer — the Partner already separates the clients", so this table is the
-- catalog behind that existing value, and the hard-coded CHECK becomes an FK
-- exactly the way source_companies replaced the source_company CHECK: a client
-- added in Settings is valid everywhere without a migration.
--
-- Scope decisions confirmed with the client:
--   * only the RULE LIST is versioned per client + month. The criteria ticks,
--     the hour values, the required hours per day and the Good/Average
--     thresholds are one row per client.
--   * a new month copies the previous month's rules; the first-ever month
--     seeds the SOP starting rules. Reset to defaults restores those.
--
-- Additive only: no existing payroll row is touched or migrated.

-- 1. client catalog ------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payroll_clients (
  key text PRIMARY KEY,
  name text NOT NULL,
  uses_zone boolean NOT NULL DEFAULT false,
  uses_orders boolean NOT NULL DEFAULT true,
  uses_hours boolean NOT NULL DEFAULT false,
  full_day_hours numeric(5, 2) NOT NULL DEFAULT 12,
  half_day_hours numeric(5, 2) NOT NULL DEFAULT 6,
  reduced_hours numeric(5, 2) NOT NULL DEFAULT 3,
  required_hours_per_day numeric(5, 2) NOT NULL DEFAULT 12,
  default_off_days integer NOT NULL DEFAULT 2,
  /** Result used when no rule matches. Same shape as a rule's result. */
  default_result jsonb NOT NULL DEFAULT '{"kind":"12"}'::jsonb,
  good_threshold numeric(6, 2) NOT NULL DEFAULT 110,
  average_threshold numeric(6, 2) NOT NULL DEFAULT 70,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_clients_key_format CHECK (key ~ '^[a-z0-9_]{1,24}$'),
  CONSTRAINT payroll_clients_name_not_blank CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  CONSTRAINT payroll_clients_hours_range CHECK (
    full_day_hours >= 0 AND full_day_hours <= 24
    AND half_day_hours >= 0 AND half_day_hours <= 24
    AND reduced_hours >= 0 AND reduced_hours <= 24
    AND required_hours_per_day >= 0 AND required_hours_per_day <= 24
  ),
  CONSTRAINT payroll_clients_off_days_range CHECK (default_off_days >= 0 AND default_off_days <= 31),
  CONSTRAINT payroll_clients_thresholds CHECK (
    good_threshold >= 0 AND average_threshold >= 0 AND good_threshold >= average_threshold
  )
);

COMMENT ON TABLE public.payroll_clients IS
  'Payroll client (= drivers.project_key). Hours, criteria ticks and zone thresholds are one row per client; the rule list is per month.';
COMMENT ON COLUMN public.payroll_clients.default_result IS
  'Attendance result when no rule matches, e.g. {"kind":"12"} for Americana and {"kind":"ACT"} for Keeta.';

INSERT INTO public.payroll_clients (
  key, name, uses_zone, uses_orders, uses_hours, default_result, is_system, sort_order
)
VALUES
  ('americana', 'Americana', true, true, false, '{"kind":"12"}'::jsonb, true, 10),
  ('keeta', 'Keeta', false, true, true, '{"kind":"ACT"}'::jsonb, true, 20)
ON CONFLICT (key) DO NOTHING;

-- The project-key CHECK becomes an FK so a client added in Settings can hold
-- riders. Existing rows can only be keeta / americana / NULL, so narrowing it
-- to the catalog cannot reject anything already written.
ALTER TABLE public.drivers DROP CONSTRAINT IF EXISTS drivers_project_key_check;
ALTER TABLE public.driver_intakes DROP CONSTRAINT IF EXISTS driver_intakes_project_key_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drivers_project_key_fkey'
  ) THEN
    ALTER TABLE public.drivers
      ADD CONSTRAINT drivers_project_key_fkey
      FOREIGN KEY (project_key) REFERENCES public.payroll_clients (key)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'driver_intakes_project_key_fkey'
  ) THEN
    ALTER TABLE public.driver_intakes
      ADD CONSTRAINT driver_intakes_project_key_fkey
      FOREIGN KEY (project_key) REFERENCES public.payroll_clients (key)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END $$;

-- 2. the rule list, per client and month ---------------------------------

CREATE TABLE IF NOT EXISTS public.payroll_client_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_key text NOT NULL REFERENCES public.payroll_clients (key) ON DELETE CASCADE,
  period_month date NOT NULL,
  sort_order integer NOT NULL,
  label text NOT NULL DEFAULT '',
  /** {"all":[{"field":"zone_category"|"zone"|"orders"|"hours","op":"...","value":...}]} */
  conditions jsonb NOT NULL,
  /** {"kind":"12"|"3h"|"HALF"|"ACT"|"ABS"|"ALH"|"ALO"|"CUS","hours":n} */
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_client_rules_month_check CHECK (period_month = date_trunc('month', period_month)::date),
  CONSTRAINT payroll_client_rules_sort_check CHECK (sort_order >= 0 AND sort_order <= 9999)
);

COMMENT ON TABLE public.payroll_client_rules IS
  'Attendance rules for one client and one month. Evaluated top to bottom by sort_order; the first match decides the day.';

CREATE UNIQUE INDEX IF NOT EXISTS payroll_client_rules_order_uidx
  ON public.payroll_client_rules (client_key, period_month, sort_order);

CREATE INDEX IF NOT EXISTS payroll_client_rules_month_idx
  ON public.payroll_client_rules (client_key, period_month DESC);

-- 3. change log ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payroll_rule_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_key text,
  period_month date,
  entity text NOT NULL,
  action text NOT NULL,
  actor_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  actor_name text,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payroll_rule_audit_logs IS
  'Read-only rule change log: every change to a client, a rule, a threshold or a zone with user and time.';

CREATE INDEX IF NOT EXISTS payroll_rule_audit_logs_created_idx
  ON public.payroll_rule_audit_logs (created_at DESC);

-- 4. RLS ----------------------------------------------------------------
-- Staff read; every write goes through the RPCs below so payroll.manage is a
-- lock rather than a disabled button (same posture as the rating tables).

ALTER TABLE public.payroll_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_client_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_rule_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_clients_staff_read ON public.payroll_clients;
CREATE POLICY payroll_clients_staff_read ON public.payroll_clients
  FOR SELECT TO authenticated USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS payroll_client_rules_staff_read ON public.payroll_client_rules;
CREATE POLICY payroll_client_rules_staff_read ON public.payroll_client_rules
  FOR SELECT TO authenticated USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS payroll_rule_audit_logs_staff_read ON public.payroll_rule_audit_logs;
CREATE POLICY payroll_rule_audit_logs_staff_read ON public.payroll_rule_audit_logs
  FOR SELECT TO authenticated USING (public.is_admin_panel_user());

REVOKE ALL ON public.payroll_clients FROM anon;
REVOKE ALL ON public.payroll_client_rules FROM anon;
REVOKE ALL ON public.payroll_rule_audit_logs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.payroll_clients FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.payroll_client_rules FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.payroll_rule_audit_logs FROM authenticated;
GRANT SELECT ON public.payroll_clients TO authenticated;
GRANT SELECT ON public.payroll_client_rules TO authenticated;
GRANT SELECT ON public.payroll_rule_audit_logs TO authenticated;

-- 5. starting rules (SOP sections 5.2 and 5.3) ---------------------------

-- The SOP's documented starting rules, kept in one place so the month seed,
-- "Reset to defaults" and the lazy month-open cannot disagree.
CREATE OR REPLACE FUNCTION public.payroll_default_rules(p_client_key text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_client_key
    WHEN 'americana' THEN jsonb_build_array(
      jsonb_build_object(
        'sort_order', 10,
        'label', 'Orders less than 1',
        'conditions', jsonb_build_array(
          jsonb_build_object('field', 'orders', 'op', 'lt', 'value', 1)
        ),
        'result', jsonb_build_object('kind', 'ABS')
      ),
      jsonb_build_object(
        'sort_order', 20,
        'label', 'Zone Khiran (low-volume zone)',
        'conditions', jsonb_build_array(
          jsonb_build_object('field', 'zone', 'op', 'eq', 'value', 'Khiran')
        ),
        'result', jsonb_build_object('kind', '12')
      ),
      jsonb_build_object(
        'sort_order', 30,
        'label', 'Low zone and orders less than 5',
        'conditions', jsonb_build_array(
          jsonb_build_object('field', 'zone_category', 'op', 'eq', 'value', 'low'),
          jsonb_build_object('field', 'orders', 'op', 'lt', 'value', 5)
        ),
        'result', jsonb_build_object('kind', '3h')
      ),
      jsonb_build_object(
        'sort_order', 40,
        'label', 'Good or Average zone and orders less than 7',
        'conditions', jsonb_build_array(
          jsonb_build_object('field', 'zone_category', 'op', 'in', 'value', jsonb_build_array('good', 'average')),
          jsonb_build_object('field', 'orders', 'op', 'lt', 'value', 7)
        ),
        'result', jsonb_build_object('kind', '3h')
      )
    )
    WHEN 'keeta' THEN jsonb_build_array(
      jsonb_build_object(
        'sort_order', 10,
        'label', 'No worked hours and no orders',
        'conditions', jsonb_build_array(
          jsonb_build_object('field', 'hours', 'op', 'lt', 'value', 0.5),
          jsonb_build_object('field', 'orders', 'op', 'lt', 'value', 1)
        ),
        'result', jsonb_build_object('kind', 'ABS')
      ),
      jsonb_build_object(
        'sort_order', 20,
        'label', 'Orders less than 3',
        'conditions', jsonb_build_array(
          jsonb_build_object('field', 'orders', 'op', 'lt', 'value', 3)
        ),
        'result', jsonb_build_object('kind', 'ALO')
      ),
      jsonb_build_object(
        'sort_order', 30,
        'label', 'Worked hours less than 4',
        'conditions', jsonb_build_array(
          jsonb_build_object('field', 'hours', 'op', 'lt', 'value', 4)
        ),
        'result', jsonb_build_object('kind', 'ALH')
      ),
      jsonb_build_object(
        'sort_order', 40,
        'label', 'Under 6 hours and 6 orders or more',
        'conditions', jsonb_build_array(
          jsonb_build_object('field', 'hours', 'op', 'lt', 'value', 6),
          jsonb_build_object('field', 'orders', 'op', 'gte', 'value', 6)
        ),
        'result', jsonb_build_object('kind', 'HALF')
      ),
      jsonb_build_object(
        'sort_order', 50,
        'label', '10 to 12 hours and 6 orders or more',
        'conditions', jsonb_build_array(
          jsonb_build_object('field', 'hours', 'op', 'gte', 'value', 10),
          jsonb_build_object('field', 'hours', 'op', 'lte', 'value', 12),
          jsonb_build_object('field', 'orders', 'op', 'gte', 'value', 6)
        ),
        'result', jsonb_build_object('kind', 'ACT')
      ),
      jsonb_build_object(
        'sort_order', 60,
        'label', '10 to 12 hours and orders under 6',
        'conditions', jsonb_build_array(
          jsonb_build_object('field', 'hours', 'op', 'gte', 'value', 10),
          jsonb_build_object('field', 'hours', 'op', 'lte', 'value', 12),
          jsonb_build_object('field', 'orders', 'op', 'lt', 'value', 6)
        ),
        'result', jsonb_build_object('kind', 'HALF')
      ),
      jsonb_build_object(
        'sort_order', 70,
        'label', 'More than 12 hours',
        'conditions', jsonb_build_array(
          jsonb_build_object('field', 'hours', 'op', 'gt', 'value', 12)
        ),
        'result', jsonb_build_object('kind', '12')
      )
    )
    ELSE '[]'::jsonb
  END;
$$;

REVOKE ALL ON FUNCTION public.payroll_default_rules(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_default_rules(text) TO authenticated, service_role;

-- Seed the current Kuwait month so /payroll behaves the moment the migration
-- is applied. Idempotent: a client that already has rows for the month is left
-- exactly as it is.
DO $$
DECLARE
  v_month date := date_trunc('month', (timezone('Asia/Kuwait', now()))::date)::date;
BEGIN
  INSERT INTO public.payroll_client_rules (client_key, period_month, sort_order, label, conditions, result)
  SELECT
    c.key,
    v_month,
    (r ->> 'sort_order')::int,
    COALESCE(r ->> 'label', ''),
    r -> 'conditions',
    r -> 'result'
  FROM public.payroll_clients c
  CROSS JOIN jsonb_array_elements(public.payroll_default_rules(c.key)) AS r
  WHERE NOT EXISTS (
    SELECT 1 FROM public.payroll_client_rules x
    WHERE x.client_key = c.key AND x.period_month = v_month
  );
END $$;

-- 6. audit helper --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.payroll_log_rule_change(
  p_client_key text,
  p_month date,
  p_entity text,
  p_action text,
  p_before jsonb,
  p_after jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name text;
BEGIN
  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'Unknown')
    INTO v_name
  FROM public.profiles p
  WHERE p.id = auth.uid();

  INSERT INTO public.payroll_rule_audit_logs (
    client_key, period_month, entity, action, actor_id, actor_name, before, after
  ) VALUES (
    p_client_key, p_month, p_entity, p_action, auth.uid(), v_name, p_before, p_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_log_rule_change(text, date, text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_log_rule_change(text, date, text, text, jsonb, jsonb) TO authenticated, service_role;

-- 7. rule validation -----------------------------------------------------

CREATE OR REPLACE FUNCTION public.payroll_validate_rule(p_rule jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_conditions jsonb;
  v_result jsonb;
  v_kind text;
  v_hours numeric;
  v_cond jsonb;
  v_field text;
  v_op text;
BEGIN
  IF p_rule IS NULL OR jsonb_typeof(p_rule) <> 'object' THEN
    RAISE EXCEPTION 'invalid_rule' USING ERRCODE = 'P0001';
  END IF;

  v_conditions := COALESCE(p_rule -> 'conditions', p_rule -> 'all');
  IF v_conditions IS NULL OR jsonb_typeof(v_conditions) <> 'array' THEN
    v_conditions := '[]'::jsonb;
  END IF;
  -- A rule with no condition would match every day and silently swallow the
  -- rules below it. The client default is where "nothing matched" belongs.
  IF jsonb_array_length(v_conditions) = 0 THEN
    RAISE EXCEPTION 'rule_condition_required' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(v_conditions) > 8 THEN
    RAISE EXCEPTION 'too_many_conditions' USING ERRCODE = 'P0001';
  END IF;

  FOR v_cond IN SELECT * FROM jsonb_array_elements(v_conditions) LOOP
    v_field := v_cond ->> 'field';
    v_op := v_cond ->> 'op';
    IF v_field NOT IN ('zone_category', 'zone', 'orders', 'hours') THEN
      RAISE EXCEPTION 'invalid_rule_field:%', COALESCE(v_field, '') USING ERRCODE = 'P0001';
    END IF;
    IF v_field IN ('zone_category', 'zone') THEN
      IF v_op NOT IN ('eq', 'neq', 'in', 'not_in') THEN
        RAISE EXCEPTION 'invalid_rule_operator:%', COALESCE(v_op, '') USING ERRCODE = 'P0001';
      END IF;
      IF v_cond -> 'value' IS NULL OR jsonb_typeof(v_cond -> 'value') = 'null' THEN
        RAISE EXCEPTION 'rule_value_required' USING ERRCODE = 'P0001';
      END IF;
      IF v_field = 'zone_category' THEN
        IF v_op IN ('eq', 'neq') THEN
          IF lower(btrim(v_cond ->> 'value')) NOT IN ('good', 'average', 'low', 'not_set') THEN
            RAISE EXCEPTION 'invalid_zone_category' USING ERRCODE = 'P0001';
          END IF;
        ELSE
          IF EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_cond -> 'value') AS v
            WHERE lower(btrim(v)) NOT IN ('good', 'average', 'low', 'not_set')
          ) THEN
            RAISE EXCEPTION 'invalid_zone_category' USING ERRCODE = 'P0001';
          END IF;
        END IF;
      END IF;
    ELSE
      IF v_op NOT IN ('lt', 'lte', 'gt', 'gte', 'eq', 'neq') THEN
        RAISE EXCEPTION 'invalid_rule_operator:%', COALESCE(v_op, '') USING ERRCODE = 'P0001';
      END IF;
      IF v_cond -> 'value' IS NULL OR jsonb_typeof(v_cond -> 'value') <> 'number' THEN
        RAISE EXCEPTION 'rule_value_number_required' USING ERRCODE = 'P0001';
      END IF;
      IF (v_cond ->> 'value')::numeric < 0 OR (v_cond ->> 'value')::numeric > 100000 THEN
        RAISE EXCEPTION 'rule_value_out_of_range' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  v_result := COALESCE(p_rule -> 'result', p_rule);
  v_kind := upper(btrim(COALESCE(v_result ->> 'kind', '')));
  IF v_kind NOT IN ('12', '3H', 'HALF', 'ACT', 'ABS', 'ALH', 'ALO', 'CUS') THEN
    RAISE EXCEPTION 'invalid_rule_result:%', v_kind USING ERRCODE = 'P0001';
  END IF;
  IF v_kind = '3H' THEN v_kind := '3h'; END IF;

  IF v_kind = 'CUS' THEN
    v_hours := NULLIF(v_result ->> 'hours', '')::numeric;
    IF v_hours IS NULL OR v_hours < 0 OR v_hours > 24 THEN
      RAISE EXCEPTION 'invalid_custom_hours' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'kind', v_kind,
    'hours', CASE WHEN v_kind = 'CUS' THEN to_jsonb(v_hours) ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_validate_rule(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_validate_rule(jsonb) TO authenticated, service_role;

-- 8. rule month window --------------------------------------------------

-- Same window the Payroll page allows, so a rule month can never be one the
-- grid cannot show.
CREATE OR REPLACE FUNCTION public.payroll_assert_rule_month(p_month date)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_month date := date_trunc('month', p_month)::date;
  v_cur date := date_trunc('month', (timezone('Asia/Kuwait', now()))::date)::date;
BEGIN
  IF v_month IS NULL THEN
    RAISE EXCEPTION 'invalid_month' USING ERRCODE = 'P0001';
  END IF;
  IF v_month > v_cur OR v_month < (v_cur - INTERVAL '2 months')::date THEN
    RAISE EXCEPTION 'month_out_of_range' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_month;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_assert_rule_month(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_assert_rule_month(date) TO authenticated, service_role;

-- The rules that actually apply to a month: its own rows, else the most recent
-- earlier month, else the SOP defaults. Read-only, so the grid can resolve a
-- month that was never opened in Settings and still agree with what the
-- Settings tab shows once it is opened.
CREATE OR REPLACE FUNCTION public.payroll_effective_rules(
  p_client_key text,
  p_month date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH picked AS (
    SELECT period_month
    FROM public.payroll_client_rules
    WHERE client_key = p_client_key
      AND period_month <= date_trunc('month', p_month)::date
    ORDER BY period_month DESC
    LIMIT 1
  )
  SELECT COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'clientKey', r.client_key,
          'periodMonth', to_char(r.period_month, 'YYYY-MM-DD'),
          'sortOrder', r.sort_order,
          'label', r.label,
          'conditions', r.conditions,
          'result', r.result
        )
        ORDER BY r.sort_order
      )
      FROM public.payroll_client_rules r
      JOIN picked pk ON pk.period_month = r.period_month
      WHERE r.client_key = p_client_key
    ),
    '[]'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.payroll_effective_rules(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_effective_rules(text, date) TO authenticated, service_role;

-- 9. config read + lazy month open ---------------------------------------

-- "Open a month": materialise every active client that has no rules for the
-- month, copying the most recent earlier month, or the SOP defaults the first
-- time. Idempotent, so the Settings tab can call it on every open.
CREATE OR REPLACE FUNCTION public.admin_open_payroll_rule_month(p_month date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_month date;
  v_client record;
  v_prev date;
  v_rules jsonb;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.payroll_can_manage() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  v_month := public.payroll_assert_rule_month(p_month);

  FOR v_client IN
    SELECT key FROM public.payroll_clients WHERE is_active ORDER BY sort_order, key
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.payroll_client_rules r
      WHERE r.client_key = v_client.key AND r.period_month = v_month
    );

    SELECT max(r.period_month) INTO v_prev
    FROM public.payroll_client_rules r
    WHERE r.client_key = v_client.key AND r.period_month < v_month;

    IF v_prev IS NOT NULL THEN
      INSERT INTO public.payroll_client_rules (client_key, period_month, sort_order, label, conditions, result)
      SELECT r.client_key, v_month, r.sort_order, r.label, r.conditions, r.result
      FROM public.payroll_client_rules r
      WHERE r.client_key = v_client.key AND r.period_month = v_prev;
      CONTINUE;
    END IF;

    v_rules := public.payroll_default_rules(v_client.key);
    CONTINUE WHEN jsonb_array_length(v_rules) = 0;

    INSERT INTO public.payroll_client_rules (client_key, period_month, sort_order, label, conditions, result)
    SELECT
      v_client.key,
      v_month,
      (r ->> 'sort_order')::int,
      COALESCE(r ->> 'label', ''),
      r -> 'conditions',
      r -> 'result'
    FROM jsonb_array_elements(v_rules) AS r;
  END LOOP;

  RETURN public.admin_payroll_rule_config(p_month);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_open_payroll_rule_month(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_open_payroll_rule_month(date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_payroll_rule_config(p_month date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH m AS (
    SELECT date_trunc('month', p_month)::date AS month
  ),
  clients AS (
    SELECT
      c.key,
      c.name,
      c.uses_zone,
      c.uses_orders,
      c.uses_hours,
      c.full_day_hours,
      c.half_day_hours,
      c.reduced_hours,
      c.required_hours_per_day,
      c.default_off_days,
      c.default_result,
      c.good_threshold,
      c.average_threshold,
      c.is_system,
      c.sort_order
    FROM public.payroll_clients c
    WHERE c.is_active
  )
  SELECT jsonb_build_object(
    'month', (SELECT month FROM m),
    'canManage', public.payroll_can_manage(),
    'clients', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'key', c.key,
          'name', c.name,
          'usesZone', c.uses_zone,
          'usesOrders', c.uses_orders,
          'usesHours', c.uses_hours,
          'fullDayHours', c.full_day_hours,
          'halfDayHours', c.half_day_hours,
          'reducedHours', c.reduced_hours,
          'requiredHoursPerDay', c.required_hours_per_day,
          'defaultOffDays', c.default_off_days,
          'defaultResult', c.default_result,
          'goodThreshold', c.good_threshold,
          'averageThreshold', c.average_threshold,
          'isSystem', c.is_system,
          'sortOrder', c.sort_order,
          'riderCount', (
            SELECT count(*) FROM public.drivers d
            WHERE d.project_key = c.key AND d.archived_at IS NULL
          ),
          'effectiveMonth', to_char((
            SELECT max(r.period_month) FROM public.payroll_client_rules r
            WHERE r.client_key = c.key AND r.period_month <= (SELECT month FROM m)
          ), 'YYYY-MM-DD'),
          'hasRulesForMonth', EXISTS (
            SELECT 1 FROM public.payroll_client_rules r
            WHERE r.client_key = c.key AND r.period_month = (SELECT month FROM m)
          )
        )
        ORDER BY c.sort_order, c.key
      )
      FROM clients c
    ), '[]'::jsonb),
    'rules', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'clientKey', r.client_key,
          'periodMonth', to_char(r.period_month, 'YYYY-MM-DD'),
          'sortOrder', r.sort_order,
          'label', r.label,
          'conditions', r.conditions,
          'result', r.result
        )
        ORDER BY r.client_key, r.sort_order
      )
      FROM public.payroll_client_rules r
      JOIN clients c ON c.key = r.client_key
      WHERE r.period_month = (SELECT month FROM m)
    ), '[]'::jsonb),
    'audit', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'clientKey', a.client_key,
          'periodMonth', to_char(a.period_month, 'YYYY-MM-DD'),
          'entity', a.entity,
          'action', a.action,
          'actorName', COALESCE(a.actor_name, '—'),
          'createdAt', to_char(a.created_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD HH24:MI'),
          'before', a.before,
          'after', a.after
        )
        ORDER BY a.created_at DESC
      )
      FROM (
        SELECT * FROM public.payroll_rule_audit_logs
        ORDER BY created_at DESC
        LIMIT 100
      ) a
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.admin_payroll_rule_config(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payroll_rule_config(date) TO authenticated, service_role;

-- 10. writes -------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_save_payroll_client(
  p_key text,
  p_name text,
  p_uses_zone boolean,
  p_uses_orders boolean,
  p_uses_hours boolean,
  p_full_day_hours numeric,
  p_half_day_hours numeric,
  p_reduced_hours numeric,
  p_required_hours_per_day numeric,
  p_default_off_days integer,
  p_default_result text,
  p_good_threshold numeric,
  p_average_threshold numeric,
  p_sort_order integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text := lower(btrim(COALESCE(p_key, '')));
  v_name text := btrim(COALESCE(p_name, ''));
  v_default jsonb;
  v_before jsonb;
  v_row public.payroll_clients;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.payroll_can_manage() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_key !~ '^[a-z0-9_]{1,24}$' THEN
    RAISE EXCEPTION 'invalid_client_key' USING ERRCODE = 'P0001';
  END IF;
  IF v_name = '' OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'invalid_client_name' USING ERRCODE = 'P0001';
  END IF;

  v_default := public.payroll_validate_rule(jsonb_build_object(
    'conditions', jsonb_build_array(jsonb_build_object('field', 'orders', 'op', 'lt', 'value', 0)),
    'result', jsonb_build_object('kind', COALESCE(NULLIF(p_default_result, ''), '12'))
  ));

  SELECT to_jsonb(c) INTO v_before
  FROM public.payroll_clients c WHERE c.key = v_key;

  INSERT INTO public.payroll_clients AS c (
    key, name, uses_zone, uses_orders, uses_hours,
    full_day_hours, half_day_hours, reduced_hours, required_hours_per_day,
    default_off_days, default_result, good_threshold, average_threshold, sort_order
  ) VALUES (
    v_key, v_name,
    COALESCE(p_uses_zone, false), COALESCE(p_uses_orders, true), COALESCE(p_uses_hours, false),
    COALESCE(p_full_day_hours, 12), COALESCE(p_half_day_hours, 6), COALESCE(p_reduced_hours, 3),
    COALESCE(p_required_hours_per_day, 12),
    COALESCE(p_default_off_days, 2), v_default,
    COALESCE(p_good_threshold, 110), COALESCE(p_average_threshold, 70),
    COALESCE(p_sort_order, 100)
  )
  ON CONFLICT (key) DO UPDATE SET
    name = EXCLUDED.name,
    uses_zone = EXCLUDED.uses_zone,
    uses_orders = EXCLUDED.uses_orders,
    uses_hours = EXCLUDED.uses_hours,
    full_day_hours = EXCLUDED.full_day_hours,
    half_day_hours = EXCLUDED.half_day_hours,
    reduced_hours = EXCLUDED.reduced_hours,
    required_hours_per_day = EXCLUDED.required_hours_per_day,
    default_off_days = EXCLUDED.default_off_days,
    default_result = EXCLUDED.default_result,
    good_threshold = EXCLUDED.good_threshold,
    average_threshold = EXCLUDED.average_threshold,
    sort_order = COALESCE(p_sort_order, c.sort_order),
    updated_at = now()
  RETURNING c.* INTO v_row;

  PERFORM public.payroll_log_rule_change(
    v_key,
    NULL,
    'client',
    CASE WHEN v_before IS NULL THEN 'create' ELSE 'update' END,
    v_before,
    to_jsonb(v_row)
  );

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_payroll_client(
  text, text, boolean, boolean, boolean, numeric, numeric, numeric, numeric, integer, text, numeric, numeric, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_payroll_client(
  text, text, boolean, boolean, boolean, numeric, numeric, numeric, numeric, integer, text, numeric, numeric, integer
) TO authenticated, service_role;

-- Replaces the whole list for one client and month in one transaction, so a
-- reorder cannot half-apply, and one audit row carries the full before/after.
CREATE OR REPLACE FUNCTION public.admin_save_payroll_client_rules(
  p_client_key text,
  p_month date,
  p_rules jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_month date;
  v_key text := lower(btrim(COALESCE(p_client_key, '')));
  v_before jsonb;
  v_after jsonb;
  v_rule jsonb;
  v_valid jsonb;
  v_idx integer := 0;
  v_order integer;
  v_seen integer[] := ARRAY[]::integer[];
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.payroll_can_manage() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payroll_clients c WHERE c.key = v_key) THEN
    RAISE EXCEPTION 'unknown_client' USING ERRCODE = 'P0001';
  END IF;

  v_month := public.payroll_assert_rule_month(p_month);

  p_rules := COALESCE(p_rules, '[]'::jsonb);
  IF jsonb_typeof(p_rules) <> 'array' THEN
    RAISE EXCEPTION 'invalid_rules' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(p_rules) > 50 THEN
    RAISE EXCEPTION 'too_many_rules' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.sort_order), '[]'::jsonb)
    INTO v_before
  FROM public.payroll_client_rules r
  WHERE r.client_key = v_key AND r.period_month = v_month;

  DELETE FROM public.payroll_client_rules r
  WHERE r.client_key = v_key AND r.period_month = v_month;

  FOR v_rule IN SELECT * FROM jsonb_array_elements(p_rules) LOOP
    v_idx := v_idx + 1;
    v_valid := public.payroll_validate_rule(v_rule);
    v_order := COALESCE(NULLIF(v_rule ->> 'sortOrder', '')::int, v_idx * 10);
    IF v_order < 0 OR v_order > 9999 THEN
      RAISE EXCEPTION 'invalid_rule_order' USING ERRCODE = 'P0001';
    END IF;
    IF v_order = ANY (v_seen) THEN
      RAISE EXCEPTION 'duplicate_rule_order' USING ERRCODE = 'P0001';
    END IF;
    v_seen := v_seen || v_order;

    INSERT INTO public.payroll_client_rules (client_key, period_month, sort_order, label, conditions, result)
    VALUES (
      v_key,
      v_month,
      v_order,
      left(COALESCE(btrim(v_rule ->> 'label'), ''), 120),
      COALESCE(v_rule -> 'conditions', v_rule -> 'all'),
      v_valid
    );
  END LOOP;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.sort_order), '[]'::jsonb)
    INTO v_after
  FROM public.payroll_client_rules r
  WHERE r.client_key = v_key AND r.period_month = v_month;

  IF v_before IS DISTINCT FROM v_after THEN
    PERFORM public.payroll_log_rule_change(v_key, v_month, 'rules', 'update', v_before, v_after);
  END IF;

  RETURN public.admin_payroll_rule_config(v_month);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_payroll_client_rules(text, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_payroll_client_rules(text, date, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_reset_payroll_client_rules(
  p_client_key text,
  p_month date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text := lower(btrim(COALESCE(p_client_key, '')));
  v_month date;
  v_rules jsonb;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.payroll_can_manage() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payroll_clients c WHERE c.key = v_key) THEN
    RAISE EXCEPTION 'unknown_client' USING ERRCODE = 'P0001';
  END IF;

  v_month := public.payroll_assert_rule_month(p_month);
  v_rules := public.payroll_default_rules(v_key);

  IF jsonb_array_length(v_rules) = 0 THEN
    RAISE EXCEPTION 'no_default_rules' USING ERRCODE = 'P0001';
  END IF;

  RETURN public.admin_save_payroll_client_rules(v_key, v_month, v_rules);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_payroll_client_rules(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_payroll_client_rules(text, date) TO authenticated, service_role;

-- Add client: name + criteria, then blank rules or a copy of another client.
CREATE OR REPLACE FUNCTION public.admin_add_payroll_client(
  p_name text,
  p_uses_zone boolean,
  p_uses_orders boolean,
  p_uses_hours boolean,
  p_copy_from text DEFAULT NULL,
  p_month date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name text := btrim(COALESCE(p_name, ''));
  v_key text;
  v_base integer := 100;
  v_month date;
  v_rules jsonb;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.payroll_can_manage() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_name = '' OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'invalid_client_name' USING ERRCODE = 'P0001';
  END IF;

  -- Key is derived from the name, because drivers.project_key is what the
  -- rider record stores. Kept ascii-lower so it round-trips through the FK.
  v_key := regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g');
  v_key := btrim(v_key, '_');
  IF v_key = '' OR char_length(v_key) > 24 THEN
    RAISE EXCEPTION 'invalid_client_key' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payroll_clients c WHERE c.key = v_key) THEN
    RAISE EXCEPTION 'client_key_taken' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(max(c.sort_order), 0) + 10 INTO v_base FROM public.payroll_clients c;

  PERFORM public.admin_save_payroll_client(
    v_key, v_name, p_uses_zone, p_uses_orders, p_uses_hours,
    12, 6, 3, 12, 2, '12', 110, 70, v_base
  );

  IF p_copy_from IS NOT NULL AND btrim(p_copy_from) <> '' THEN
    IF NOT EXISTS (SELECT 1 FROM public.payroll_clients c WHERE c.key = btrim(p_copy_from)) THEN
      RAISE EXCEPTION 'unknown_client' USING ERRCODE = 'P0001';
    END IF;
    v_month := public.payroll_assert_rule_month(COALESCE(p_month, (timezone('Asia/Kuwait', now()))::date));
    v_rules := public.payroll_effective_rules(btrim(p_copy_from), v_month);
    IF jsonb_array_length(v_rules) > 0 THEN
      PERFORM public.admin_save_payroll_client_rules(v_key, v_month, v_rules);
    END IF;
  END IF;

  RETURN public.admin_payroll_rule_config(
    public.payroll_assert_rule_month(COALESCE(p_month, (timezone('Asia/Kuwait', now()))::date))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_payroll_client(text, boolean, boolean, boolean, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_payroll_client(text, boolean, boolean, boolean, text, date) TO authenticated, service_role;
