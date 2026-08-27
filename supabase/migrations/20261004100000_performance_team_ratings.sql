-- Fleet / HR / Operations rating of a driver.
--
-- The automatic score answers "did the rider hit their numbers". It cannot
-- answer "is this rider good to work with", which is the question Fleet, HR and
-- Operations each answer from their own seat. Those answers are recorded here
-- as one durable fact per team per driver per month, deliberately keyed on a
-- month rather than on whatever date range happens to be on screen: a rating
-- that changed when the operator moved the date filter would not be a rating.
--
-- Nothing here moves an existing score. The `manual` weight is seeded at 0, so
-- shipping this migration is inert until an admin opts in on
-- /performance/settings.

CREATE TABLE IF NOT EXISTS public.performance_rating_teams (
  key text PRIMARY KEY,
  label_en text NOT NULL,
  label_ar text NOT NULL,
  -- Weight *within* the manual average, not within the overall score. A tenant
  -- that trusts Fleet twice as much as HR can say so without touching the
  -- automatic/manual split.
  weight numeric NOT NULL DEFAULT 1 CHECK (weight >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.performance_rating_teams (key, label_en, label_ar, sort_order)
VALUES
  ('fleet', 'Fleet', 'الأسطول', 1),
  ('hr', 'HR', 'الموارد البشرية', 2),
  ('operations', 'Operations', 'العمليات', 3)
ON CONFLICT (key) DO UPDATE SET
  label_en = EXCLUDED.label_en,
  label_ar = EXCLUDED.label_ar,
  sort_order = EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS public.performance_rating_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_key text NOT NULL REFERENCES public.performance_rating_teams(key) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (team_key, profile_id)
);

CREATE INDEX IF NOT EXISTS performance_rating_team_members_profile_idx
  ON public.performance_rating_team_members (profile_id);

CREATE TABLE IF NOT EXISTS public.driver_performance_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  team_key text NOT NULL REFERENCES public.performance_rating_teams(key) ON DELETE CASCADE,
  -- Always the first of the Kuwait month. Storing any other day in the month
  -- would make (driver, team, month) uniqueness a lie.
  period_month date NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
  score integer NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR btrim(comment) <> ''),
  rated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  rated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, team_key, period_month)
);

CREATE INDEX IF NOT EXISTS driver_performance_ratings_month_idx
  ON public.driver_performance_ratings (period_month, team_key);

ALTER TABLE public.performance_rating_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_rating_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_performance_ratings ENABLE ROW LEVEL SECURITY;

-- Read for staff; every write goes through a SECURITY DEFINER RPC that checks
-- team membership. There is deliberately no INSERT/UPDATE/DELETE policy: the
-- panel writes through PostgREST under a staff role, so a permissive write
-- policy would make the membership check advisory rather than a lock.
DROP POLICY IF EXISTS performance_rating_teams_staff_read ON public.performance_rating_teams;
CREATE POLICY performance_rating_teams_staff_read
  ON public.performance_rating_teams FOR SELECT
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS performance_rating_team_members_staff_read ON public.performance_rating_team_members;
CREATE POLICY performance_rating_team_members_staff_read
  ON public.performance_rating_team_members FOR SELECT
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS driver_performance_ratings_staff_read ON public.driver_performance_ratings;
CREATE POLICY driver_performance_ratings_staff_read
  ON public.driver_performance_ratings FOR SELECT
  USING (public.is_admin_panel_user());

-- Permissions -----------------------------------------------------------------

INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('performance.rate', 'Rate drivers as a team', 'performance'),
  ('performance.manage_teams', 'Manage rating teams and members', 'performance')
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category;

-- performance.rate goes to roles that already manage drivers; membership is
-- still required per team, so the grant alone rates nobody.
INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT rp.role_id, 'performance.rate'
FROM public.admin_role_permissions rp
WHERE rp.permission_slug = 'drivers.manage'
ON CONFLICT DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT rp.role_id, 'performance.manage_teams'
FROM public.admin_role_permissions rp
WHERE rp.permission_slug = 'settings.manage'
ON CONFLICT DO NOTHING;

-- The manual weight starts at 0 so no existing score moves on deploy.
UPDATE public.app_settings
SET performance_score_weights =
  COALESCE(performance_score_weights, '{}'::jsonb)
  || jsonb_build_object(
       'manual',
       COALESCE(performance_score_weights->'manual', '0'::jsonb)
     )
WHERE id = 1;

-- Helpers ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_rates_for_team(p_team_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin_user()
    OR EXISTS (
      SELECT 1
      FROM public.performance_rating_team_members m
      WHERE m.team_key = p_team_key
        AND m.profile_id = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION public.staff_rates_for_team(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_rates_for_team(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.staff_rates_for_team(text) TO authenticated;

-- RPCs ------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_upsert_driver_performance_rating(
  p_driver_id uuid,
  p_team_key text,
  p_period_month date,
  p_score integer,
  p_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month date;
  v_comment text;
  v_row public.driver_performance_ratings;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT public.staff_has_permission('performance.rate') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.performance_rating_teams t
    WHERE t.key = p_team_key AND t.is_active
  ) THEN
    RAISE EXCEPTION 'unknown_team';
  END IF;

  IF NOT public.staff_rates_for_team(p_team_key) THEN
    RAISE EXCEPTION 'not_team_member';
  END IF;

  IF p_score IS NULL OR p_score < 1 OR p_score > 5 THEN
    RAISE EXCEPTION 'invalid_score';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = p_driver_id AND d.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'driver_not_found';
  END IF;

  v_month := date_trunc(
    'month',
    COALESCE(p_period_month, (now() AT TIME ZONE 'Asia/Kuwait')::date)
  )::date;

  -- A rating cannot be filed against a month that has not started. The current
  -- month is allowed: a review mid-month is a normal thing to record.
  IF v_month > date_trunc('month', (now() AT TIME ZONE 'Asia/Kuwait')::date)::date THEN
    RAISE EXCEPTION 'future_period';
  END IF;

  v_comment := NULLIF(btrim(COALESCE(p_comment, '')), '');

  INSERT INTO public.driver_performance_ratings AS r (
    driver_id, team_key, period_month, score, comment, rated_by
  )
  VALUES (p_driver_id, p_team_key, v_month, p_score, v_comment, auth.uid())
  ON CONFLICT (driver_id, team_key, period_month) DO UPDATE SET
    score = EXCLUDED.score,
    comment = EXCLUDED.comment,
    rated_by = EXCLUDED.rated_by,
    rated_at = now(),
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'driver_id', v_row.driver_id,
    'team_key', v_row.team_key,
    'period_month', v_row.period_month,
    'score', v_row.score,
    'comment', v_row.comment,
    'rated_by', v_row.rated_by,
    'rated_at', v_row.rated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_driver_performance_rating(
  uuid, text, date, integer, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_upsert_driver_performance_rating(
  uuid, text, date, integer, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_driver_performance_rating(
  uuid, text, date, integer, text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_driver_performance_rating(
  p_driver_id uuid,
  p_team_key text,
  p_period_month date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month date;
  v_deleted integer;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT public.staff_has_permission('performance.rate') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF NOT public.staff_rates_for_team(p_team_key) THEN
    RAISE EXCEPTION 'not_team_member';
  END IF;

  v_month := date_trunc(
    'month',
    COALESCE(p_period_month, (now() AT TIME ZONE 'Asia/Kuwait')::date)
  )::date;

  DELETE FROM public.driver_performance_ratings r
  WHERE r.driver_id = p_driver_id
    AND r.team_key = p_team_key
    AND r.period_month = v_month;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('deleted', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_driver_performance_rating(uuid, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_driver_performance_rating(uuid, text, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_driver_performance_rating(uuid, text, date) TO authenticated;

-- One call for the rating panel: every active team, the rating it holds for
-- this driver and month (or null), and whether the signed-in user may edit it.
-- The panel must not decide editability from its own permission set — a client
-- that guesses would either hide a row the server accepts or offer one it
-- refuses.
CREATE OR REPLACE FUNCTION public.admin_list_driver_performance_ratings(
  p_driver_id uuid,
  p_period_month date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month date;
  v_can_rate boolean;
  v_rows jsonb;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT public.staff_has_permission('performance.view') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_month := date_trunc(
    'month',
    COALESCE(p_period_month, (now() AT TIME ZONE 'Asia/Kuwait')::date)
  )::date;

  v_can_rate := public.staff_has_permission('performance.rate');

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'team_key', t.key,
        'label_en', t.label_en,
        'label_ar', t.label_ar,
        'weight', t.weight,
        'score', r.score,
        'comment', r.comment,
        'rated_at', r.rated_at,
        'rated_by', r.rated_by,
        'rated_by_name', rp.full_name,
        'can_edit', v_can_rate AND public.staff_rates_for_team(t.key)
      )
      ORDER BY t.sort_order, t.key
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.performance_rating_teams t
  LEFT JOIN public.driver_performance_ratings r
    ON r.team_key = t.key
   AND r.driver_id = p_driver_id
   AND r.period_month = v_month
  LEFT JOIN public.profiles rp ON rp.id = r.rated_by
  WHERE t.is_active;

  RETURN jsonb_build_object(
    'driver_id', p_driver_id,
    'period_month', v_month,
    'teams', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_driver_performance_ratings(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_driver_performance_ratings(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_driver_performance_ratings(uuid, date) TO authenticated;

-- Team membership management (settings surface) --------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_performance_rating_teams()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT public.staff_has_permission('performance.view') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'key', t.key,
        'label_en', t.label_en,
        'label_ar', t.label_ar,
        'weight', t.weight,
        'sort_order', t.sort_order,
        'is_active', t.is_active,
        'members', COALESCE(m.members, '[]'::jsonb)
      )
      ORDER BY t.sort_order, t.key
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.performance_rating_teams t
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
             jsonb_build_object(
               'profile_id', mm.profile_id,
               'full_name', COALESCE(p.full_name, '—'),
               'email', p.email
             )
             ORDER BY p.full_name
           ) AS members
    FROM public.performance_rating_team_members mm
    JOIN public.profiles p ON p.id = mm.profile_id
    WHERE mm.team_key = t.key
  ) m ON true;

  RETURN jsonb_build_object('teams', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_performance_rating_teams() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_performance_rating_teams() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_performance_rating_teams() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_performance_team_member(
  p_team_key text,
  p_profile_id uuid,
  p_member boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT public.staff_has_permission('performance.manage_teams') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.performance_rating_teams t WHERE t.key = p_team_key
  ) THEN
    RAISE EXCEPTION 'unknown_team';
  END IF;

  -- Only panel staff may sit on a rating team. A rider profile here would be a
  -- driver rating drivers.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_profile_id
      AND p.role = 'staff'
      AND p.approval_status = 'approved'
      AND p.admin_role_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'not_staff';
  END IF;

  IF COALESCE(p_member, false) THEN
    INSERT INTO public.performance_rating_team_members (team_key, profile_id, created_by)
    VALUES (p_team_key, p_profile_id, auth.uid())
    ON CONFLICT (team_key, profile_id) DO NOTHING;
  ELSE
    DELETE FROM public.performance_rating_team_members m
    WHERE m.team_key = p_team_key AND m.profile_id = p_profile_id;
  END IF;

  RETURN jsonb_build_object('team_key', p_team_key, 'member', COALESCE(p_member, false));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_performance_team_member(text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_performance_team_member(text, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_performance_team_member(text, uuid, boolean) TO authenticated;
