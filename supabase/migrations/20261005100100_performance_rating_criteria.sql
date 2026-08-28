-- Rating criteria: behaviour, appearance, and whatever else a team judges on.
--
-- A team rating used to be one number answering "how is this rider", which is
-- three questions wearing one coat: Operations can hold that someone's conduct
-- is excellent and their appearance is not, and a single star row forces them to
-- average the two in their head and file the average as a fact.
--
-- So a rating is now filed per criterion, and a team's score is the weighted
-- average of its own criteria. The cross-team blend is untouched, which matters:
-- the rule that a team rating three months does not outvote a team rating one is
-- the reason the aggregation is per-team-first, and nothing here changes that.
--
-- Existing ratings are migrated onto a seeded `overall` criterion per team
-- rather than dropped or re-attributed. A filed review is a durable fact; a
-- schema change is not a reason to lose one.

-- Criteria -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.performance_rating_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_key text NOT NULL REFERENCES public.performance_rating_teams(key) ON DELETE CASCADE,
  -- Unique within a team, not globally: two teams may both want "communication"
  -- and they are different criteria with different raters.
  key text NOT NULL CHECK (btrim(key) <> ''),
  label_en text NOT NULL,
  label_ar text NOT NULL,
  -- Weight *within its team*, so re-weighting a team's rubric cannot move how
  -- much that team counts against the others.
  weight numeric NOT NULL DEFAULT 1 CHECK (weight >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_key, key)
);

CREATE INDEX IF NOT EXISTS performance_rating_criteria_team_idx
  ON public.performance_rating_criteria (team_key, sort_order);

-- One `overall` criterion per team, carrying every rating filed before today.
INSERT INTO public.performance_rating_criteria (team_key, key, label_en, label_ar, sort_order)
SELECT t.key, 'overall', 'Overall', 'التقييم العام', 0
FROM public.performance_rating_teams t
ON CONFLICT (team_key, key) DO NOTHING;

-- The two the client named. Seeded on operations only: Fleet and HR were not
-- asked for a rubric, and inventing one for them would put empty star rows in
-- front of raters who never requested them.
INSERT INTO public.performance_rating_criteria (team_key, key, label_en, label_ar, sort_order)
VALUES
  ('operations', 'behavior', 'Behavior', 'السلوك', 1),
  ('operations', 'appearance', 'Appearance', 'المظهر', 2)
ON CONFLICT (team_key, key) DO NOTHING;

-- Re-key the ratings ---------------------------------------------------------

ALTER TABLE public.driver_performance_ratings
  ADD COLUMN IF NOT EXISTS criterion_id uuid;

UPDATE public.driver_performance_ratings r
SET criterion_id = c.id
FROM public.performance_rating_criteria c
WHERE c.team_key = r.team_key
  AND c.key = 'overall'
  AND r.criterion_id IS NULL;

-- A rating with no criterion cannot be aggregated or displayed, and there is no
-- sensible default beyond the `overall` seed above. Refuse rather than guess.
DO $$
DECLARE
  v_orphans integer;
BEGIN
  SELECT COUNT(*) INTO v_orphans
  FROM public.driver_performance_ratings
  WHERE criterion_id IS NULL;

  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'ratings_without_criterion: %', v_orphans;
  END IF;
END;
$$;

ALTER TABLE public.driver_performance_ratings
  ALTER COLUMN criterion_id SET NOT NULL;

-- RESTRICT, not CASCADE. Deleting a criterion to tidy a settings list must not
-- erase the reviews filed under it — the settings RPC below refuses the delete
-- outright, and this is the lock behind that refusal.
ALTER TABLE public.driver_performance_ratings
  DROP CONSTRAINT IF EXISTS driver_performance_ratings_criterion_id_fkey;
ALTER TABLE public.driver_performance_ratings
  ADD CONSTRAINT driver_performance_ratings_criterion_id_fkey
  FOREIGN KEY (criterion_id)
  REFERENCES public.performance_rating_criteria(id)
  ON DELETE RESTRICT;

-- The comment moves out before team_key does, because it is a per-team fact.
-- Leaving it on a per-criterion row would mean three copies of one comment for
-- a three-criteria team, and three copies is three chances to disagree.
CREATE TABLE IF NOT EXISTS public.driver_performance_rating_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  team_key text NOT NULL REFERENCES public.performance_rating_teams(key) ON DELETE CASCADE,
  period_month date NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
  comment text NOT NULL CHECK (btrim(comment) <> ''),
  authored_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, team_key, period_month)
);

-- Lossless: today there is exactly one rating row per (driver, team, month), so
-- its comment is already the team's comment.
INSERT INTO public.driver_performance_rating_notes (
  driver_id, team_key, period_month, comment, authored_by, updated_at
)
SELECT r.driver_id, r.team_key, r.period_month, r.comment, r.rated_by, r.updated_at
FROM public.driver_performance_ratings r
WHERE r.comment IS NOT NULL
ON CONFLICT (driver_id, team_key, period_month) DO NOTHING;

ALTER TABLE public.driver_performance_ratings DROP COLUMN IF EXISTS comment;

ALTER TABLE public.driver_performance_ratings
  DROP CONSTRAINT IF EXISTS driver_performance_ratings_driver_id_team_key_period_month_key;

DROP INDEX IF EXISTS public.driver_performance_ratings_month_idx;

-- team_key is dropped rather than kept beside criterion_id. It is derivable
-- from the criterion, and a derivable column that is also writable is a column
-- that will eventually disagree with what it duplicates.
ALTER TABLE public.driver_performance_ratings DROP COLUMN IF EXISTS team_key;

CREATE UNIQUE INDEX IF NOT EXISTS driver_performance_ratings_unique_idx
  ON public.driver_performance_ratings (driver_id, criterion_id, period_month);

CREATE INDEX IF NOT EXISTS driver_performance_ratings_month_idx
  ON public.driver_performance_ratings (period_month, criterion_id);

ALTER TABLE public.performance_rating_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_performance_rating_notes ENABLE ROW LEVEL SECURITY;

-- Read for staff, and no write policy at all. The panel writes through PostgREST
-- under a staff role, so a permissive write policy would make the team
-- membership check advisory rather than a lock — the same reason
-- staff_rates_for_team exists and the same reason the RCM system-type guard had
-- to become a trigger.
DROP POLICY IF EXISTS performance_rating_criteria_staff_read ON public.performance_rating_criteria;
CREATE POLICY performance_rating_criteria_staff_read
  ON public.performance_rating_criteria FOR SELECT
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS driver_performance_rating_notes_staff_read ON public.driver_performance_rating_notes;
CREATE POLICY driver_performance_rating_notes_staff_read
  ON public.driver_performance_rating_notes FOR SELECT
  USING (public.is_admin_panel_user());

-- Rating RPCs ----------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_upsert_driver_performance_rating(uuid, text, date, integer, text);
DROP FUNCTION IF EXISTS public.admin_delete_driver_performance_rating(uuid, text, date);

CREATE OR REPLACE FUNCTION public.admin_upsert_driver_performance_rating(
  p_driver_id uuid,
  p_criterion_id uuid,
  p_period_month date,
  p_score integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month date;
  v_team text;
  v_row public.driver_performance_ratings;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT public.staff_has_permission('performance.rate') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT c.team_key INTO v_team
  FROM public.performance_rating_criteria c
  JOIN public.performance_rating_teams t ON t.key = c.team_key AND t.is_active
  WHERE c.id = p_criterion_id AND c.is_active;

  IF v_team IS NULL THEN
    RAISE EXCEPTION 'unknown_criterion';
  END IF;

  IF NOT public.staff_rates_for_team(v_team) THEN
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

  IF v_month > date_trunc('month', (now() AT TIME ZONE 'Asia/Kuwait')::date)::date THEN
    RAISE EXCEPTION 'future_period';
  END IF;

  INSERT INTO public.driver_performance_ratings AS r (
    driver_id, criterion_id, period_month, score, rated_by
  )
  VALUES (p_driver_id, p_criterion_id, v_month, p_score, auth.uid())
  ON CONFLICT (driver_id, criterion_id, period_month) DO UPDATE SET
    score = EXCLUDED.score,
    rated_by = EXCLUDED.rated_by,
    rated_at = now(),
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'driver_id', v_row.driver_id,
    'criterion_id', v_row.criterion_id,
    'team_key', v_team,
    'period_month', v_row.period_month,
    'score', v_row.score,
    'rated_by', v_row.rated_by,
    'rated_at', v_row.rated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_driver_performance_rating(uuid, uuid, date, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_upsert_driver_performance_rating(uuid, uuid, date, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_driver_performance_rating(uuid, uuid, date, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_driver_performance_rating(
  p_driver_id uuid,
  p_criterion_id uuid,
  p_period_month date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month date;
  v_team text;
  v_deleted integer;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT public.staff_has_permission('performance.rate') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT c.team_key INTO v_team
  FROM public.performance_rating_criteria c
  WHERE c.id = p_criterion_id;

  IF v_team IS NULL THEN
    RAISE EXCEPTION 'unknown_criterion';
  END IF;

  IF NOT public.staff_rates_for_team(v_team) THEN
    RAISE EXCEPTION 'not_team_member';
  END IF;

  v_month := date_trunc(
    'month',
    COALESCE(p_period_month, (now() AT TIME ZONE 'Asia/Kuwait')::date)
  )::date;

  DELETE FROM public.driver_performance_ratings r
  WHERE r.driver_id = p_driver_id
    AND r.criterion_id = p_criterion_id
    AND r.period_month = v_month;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('deleted', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_driver_performance_rating(uuid, uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_driver_performance_rating(uuid, uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_driver_performance_rating(uuid, uuid, date) TO authenticated;

-- The team note. Separate from the score because it is a different fact filed
-- at a different rhythm: a rater adjusts a star without retyping a paragraph.
CREATE OR REPLACE FUNCTION public.admin_set_driver_performance_rating_note(
  p_driver_id uuid,
  p_team_key text,
  p_period_month date,
  p_comment text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month date;
  v_comment text;
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

  v_month := date_trunc(
    'month',
    COALESCE(p_period_month, (now() AT TIME ZONE 'Asia/Kuwait')::date)
  )::date;

  IF v_month > date_trunc('month', (now() AT TIME ZONE 'Asia/Kuwait')::date)::date THEN
    RAISE EXCEPTION 'future_period';
  END IF;

  v_comment := NULLIF(btrim(COALESCE(p_comment, '')), '');

  IF v_comment IS NULL THEN
    DELETE FROM public.driver_performance_rating_notes n
    WHERE n.driver_id = p_driver_id
      AND n.team_key = p_team_key
      AND n.period_month = v_month;
    RETURN jsonb_build_object('comment', NULL);
  END IF;

  INSERT INTO public.driver_performance_rating_notes AS n (
    driver_id, team_key, period_month, comment, authored_by
  )
  VALUES (p_driver_id, p_team_key, v_month, v_comment, auth.uid())
  ON CONFLICT (driver_id, team_key, period_month) DO UPDATE SET
    comment = EXCLUDED.comment,
    authored_by = EXCLUDED.authored_by,
    updated_at = now();

  RETURN jsonb_build_object('comment', v_comment);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_driver_performance_rating_note(uuid, text, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_driver_performance_rating_note(uuid, text, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_driver_performance_rating_note(uuid, text, date, text) TO authenticated;

-- Panel read: teams, their criteria, this driver's ratings for the month, and
-- whether the caller may edit — decided by the server, never guessed by the
-- client, or the panel would either hide a row the server accepts or offer one
-- it refuses.
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
        'can_edit', v_can_rate AND public.staff_rates_for_team(t.key),
        'comment', n.comment,
        'comment_at', n.updated_at,
        'comment_by_name', np.full_name,
        -- The team's own rollup of its criteria, so the panel does not have to
        -- reimplement the weighting that the score uses.
        'score', crit.team_avg,
        'rated_at', crit.last_rated_at,
        'rated_by_name', crit.last_rated_by_name,
        'criteria', COALESCE(crit.rows, '[]'::jsonb)
      )
      ORDER BY t.sort_order, t.key
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.performance_rating_teams t
  LEFT JOIN public.driver_performance_rating_notes n
    ON n.team_key = t.key
   AND n.driver_id = p_driver_id
   AND n.period_month = v_month
  LEFT JOIN public.profiles np ON np.id = n.authored_by
  LEFT JOIN LATERAL (
    SELECT
      CASE
        WHEN SUM(c.weight) FILTER (WHERE r.score IS NOT NULL) > 0
          THEN ROUND(
            SUM(c.weight * r.score) FILTER (WHERE r.score IS NOT NULL)
            / SUM(c.weight) FILTER (WHERE r.score IS NOT NULL),
            2
          )
      END AS team_avg,
      MAX(r.rated_at) AS last_rated_at,
      (
        SELECT p2.full_name
        FROM public.driver_performance_ratings r2
        JOIN public.performance_rating_criteria c2 ON c2.id = r2.criterion_id
        LEFT JOIN public.profiles p2 ON p2.id = r2.rated_by
        WHERE c2.team_key = t.key
          AND r2.driver_id = p_driver_id
          AND r2.period_month = v_month
        ORDER BY r2.rated_at DESC
        LIMIT 1
      ) AS last_rated_by_name,
      jsonb_agg(
        jsonb_build_object(
          'criterion_id', c.id,
          'key', c.key,
          'label_en', c.label_en,
          'label_ar', c.label_ar,
          'weight', c.weight,
          'score', r.score,
          'rated_at', r.rated_at
        )
        ORDER BY c.sort_order, c.key
      ) AS rows
    FROM public.performance_rating_criteria c
    LEFT JOIN public.driver_performance_ratings r
      ON r.criterion_id = c.id
     AND r.driver_id = p_driver_id
     AND r.period_month = v_month
    WHERE c.team_key = t.key AND c.is_active
  ) crit ON true
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

-- Criteria management (settings surface) --------------------------------------

-- Gated on performance.manage_teams rather than a new slug: criteria belong to
-- teams, and a second permission here would be a slug nobody could explain.
CREATE OR REPLACE FUNCTION public.admin_upsert_performance_rating_criterion(
  p_id uuid,
  p_team_key text,
  p_key text,
  p_label_en text,
  p_label_ar text,
  p_weight numeric,
  p_sort_order integer,
  p_is_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_row public.performance_rating_criteria;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT public.staff_has_permission('performance.manage_teams') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.performance_rating_criteria c
    SET label_en = COALESCE(NULLIF(btrim(p_label_en), ''), c.label_en),
        label_ar = COALESCE(NULLIF(btrim(p_label_ar), ''), c.label_ar),
        weight = GREATEST(COALESCE(p_weight, c.weight), 0),
        sort_order = COALESCE(p_sort_order, c.sort_order),
        is_active = COALESCE(p_is_active, c.is_active)
    WHERE c.id = p_id
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'unknown_criterion';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.performance_rating_teams t WHERE t.key = p_team_key
    ) THEN
      RAISE EXCEPTION 'unknown_team';
    END IF;

    -- A key is what history is keyed on, so it is generated from the label once
    -- and never rewritten by a later label edit.
    v_key := NULLIF(
      btrim(regexp_replace(lower(COALESCE(p_key, p_label_en, '')), '[^a-z0-9]+', '_', 'g'), '_'),
      ''
    );

    IF v_key IS NULL THEN
      RAISE EXCEPTION 'key_required';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.performance_rating_criteria c
      WHERE c.team_key = p_team_key AND c.key = v_key
    ) THEN
      RAISE EXCEPTION 'duplicate_key';
    END IF;

    INSERT INTO public.performance_rating_criteria (
      team_key, key, label_en, label_ar, weight, sort_order, is_active
    )
    VALUES (
      p_team_key,
      v_key,
      COALESCE(NULLIF(btrim(p_label_en), ''), v_key),
      COALESCE(NULLIF(btrim(p_label_ar), ''), NULLIF(btrim(p_label_en), ''), v_key),
      GREATEST(COALESCE(p_weight, 1), 0),
      COALESCE(p_sort_order, 0),
      COALESCE(p_is_active, true)
    )
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'team_key', v_row.team_key,
    'key', v_row.key,
    'label_en', v_row.label_en,
    'label_ar', v_row.label_ar,
    'weight', v_row.weight,
    'sort_order', v_row.sort_order,
    'is_active', v_row.is_active
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_performance_rating_criterion(
  uuid, text, text, text, text, numeric, integer, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_upsert_performance_rating_criterion(
  uuid, text, text, text, text, numeric, integer, boolean
) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_performance_rating_criterion(
  uuid, text, text, text, text, numeric, integer, boolean
) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_performance_rating_criterion(
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used integer;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT public.staff_has_permission('performance.manage_teams') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT COUNT(*) INTO v_used
  FROM public.driver_performance_ratings r
  WHERE r.criterion_id = p_id;

  -- Deactivate instead. Deleting here would erase filed reviews to tidy a
  -- settings list, which is the trade the RESTRICT above exists to refuse.
  IF v_used > 0 THEN
    RAISE EXCEPTION 'criterion_in_use';
  END IF;

  DELETE FROM public.performance_rating_criteria c WHERE c.id = p_id;

  RETURN jsonb_build_object('deleted', 1);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_performance_rating_criterion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_performance_rating_criterion(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_performance_rating_criterion(uuid) TO authenticated;

-- The settings list gains criteria beside members.
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
        'members', COALESCE(m.members, '[]'::jsonb),
        'criteria', COALESCE(c.criteria, '[]'::jsonb)
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
  ) m ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
             jsonb_build_object(
               'id', cc.id,
               'team_key', cc.team_key,
               'key', cc.key,
               'label_en', cc.label_en,
               'label_ar', cc.label_ar,
               'weight', cc.weight,
               'sort_order', cc.sort_order,
               'is_active', cc.is_active,
               -- The panel needs this to know whether Delete is even offered,
               -- rather than offering it and reporting a refusal afterwards.
               'rating_count', (
                 SELECT COUNT(*)
                 FROM public.driver_performance_ratings rr
                 WHERE rr.criterion_id = cc.id
               )
             )
             ORDER BY cc.sort_order, cc.key
           ) AS criteria
    FROM public.performance_rating_criteria cc
    WHERE cc.team_key = t.key
  ) c ON true;

  RETURN jsonb_build_object('teams', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_performance_rating_teams() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_performance_rating_teams() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_performance_rating_teams() TO authenticated;
