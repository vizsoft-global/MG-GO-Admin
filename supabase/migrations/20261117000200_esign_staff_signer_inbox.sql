-- EmployeeDesk V2 — a second signer becomes usable: staff counter-signature (F15).
--
-- `20261116000500` normalised signers into `esign_request_signers` but left the
-- table a *projection* of the legacy `esign_requests` columns, written only by
-- trigger. That is enough to store a second signer and nothing else — there was
-- no way to add one, no way for the assigned staff member to see it, and no way
-- to sign it. This file is the rest of the lifecycle.
--
-- ## The direction, and the property it is chosen to preserve
--
-- Multi-signer has an easy-to-miss trap: the obvious implementation makes the
-- request `signed` only once **every** signer has signed, which quietly changes
-- the meaning of `esign_requests.status` for a rider. Every installed build of
-- the driver app, the V1 detail page and the CSV export read that column as
-- "has the employee signed". If it started meaning "is the whole document
-- finished", a rider who signed a document that then sat with a manager for
-- approval would have it reappear in their Pending list as work still to do —
-- the exact "it says I have to sign something I already signed" bug.
--
-- So `esign_requests.status` stays the **employee's** signature state, and the
-- counter-signature lives on the signer row. The new derived column is
-- `awaiting_counter_signature`: true when the employee has signed and a staff
-- signer row is still `pending`. That is additive, it is what the rider app was
-- told to parse, and it does not move a single value any existing reader sees.
--
-- ## No write policy on the signer table
--
-- The RPCs below are the only writers, and they are `SECURITY DEFINER` behind a
-- real membership check. The table keeps its staff/rider `SELECT` policies and
-- no INSERT/UPDATE/DELETE policy at all, so a staff session with `requests.manage`
-- still cannot forge a signature through PostgREST — exactly the posture
-- `20261116000500` established for the projection trigger.

-- ---------------------------------------------------------------------------
-- 1. Permission — the To Sign inbox
-- ---------------------------------------------------------------------------
--
-- Membership in `staff_user_id` is what actually decides who may sign; the slug
-- exists so the route and the sidebar entry have something to gate on, and so a
-- User-kind staff member can be given the inbox without being handed
-- `requests.manage` (which would also let them send and delete documents).
--
-- Granted to roles that already manage requests, because those are the roles
-- whose members were being asked to counter-sign before this shipped.

INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('esign.sign', 'Counter-sign documents assigned to me', 'employeedesk')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, 'esign.sign'
  FROM public.admin_roles r
 WHERE EXISTS (
   SELECT 1 FROM public.admin_role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_slug IN ('requests.manage', 'employeedesk.manage')
 )
ON CONFLICT (role_id, permission_slug) DO NOTHING;

-- User-kind staff keep their own tick list; a role grant does not rewrite it.
-- Anyone already trusted to send documents is the person who was being asked
-- to counter-sign, so they get the inbox without a second Staff Access pass.
INSERT INTO public.admin_user_permissions (user_id, permission_slug)
SELECT DISTINCT aup.user_id, 'esign.sign'
  FROM public.admin_user_permissions aup
 WHERE aup.permission_slug IN ('requests.manage', 'employeedesk.manage')
ON CONFLICT (user_id, permission_slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. A staff actor on a signer row
-- ---------------------------------------------------------------------------
--
-- Nullable, and the two actor columns are mutually exclusive by CHECK rather
-- than by convention: a row that names both a rider and a staff member is a row
-- nobody can read a single answer out of, and the alternative — deciding which
-- wins in every query — is the drift this table was normalised to avoid.
--
-- The unique constraint stays as it is. `driver_id` is NULL on a staff row and
-- Postgres treats NULLs as distinct, so a request may hold several staff signers;
-- `sort_order` is what keeps them ordered, and the RPC allocates it.

ALTER TABLE public.esign_request_signers
  ADD COLUMN IF NOT EXISTS staff_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.esign_request_signers.staff_user_id IS
  'Staff signer for a counter-signature. Mutually exclusive with driver_id.';

ALTER TABLE public.esign_request_signers
  DROP CONSTRAINT IF EXISTS esign_request_signers_actor_check;
ALTER TABLE public.esign_request_signers
  ADD CONSTRAINT esign_request_signers_actor_check
  CHECK (num_nonnulls(driver_id, staff_user_id) <= 1);

CREATE INDEX IF NOT EXISTS esign_request_signers_staff_idx
  ON public.esign_request_signers (staff_user_id, status);

-- One staff member, one role, one document. `driver_id` is NULL on these
-- rows, so the existing `(request_id, driver_id, role)` unique cannot catch a
-- double-add — Postgres treats the NULL as distinct. The add RPC already
-- refuses `already_added`; this is the constraint that makes two concurrent
-- clicks lose rather than create two inbox rows for the same person.
CREATE UNIQUE INDEX IF NOT EXISTS esign_request_signers_staff_role_uidx
  ON public.esign_request_signers (request_id, staff_user_id, role)
  WHERE staff_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. One derivation, read by every surface
-- ---------------------------------------------------------------------------
--
-- The admin tracker, the rider inbox and the rider detail all need the same
-- answer to "is this document waiting on a counter-signature", and three copies
-- of a predicate is how the tracker and the rider's screen end up disagreeing
-- about a document that is plainly in one state. The employee must have signed
-- first: a staff member asked to sign a document the rider has not touched has
-- nothing to counter-sign, and offering it in their inbox would be the "button
-- that does nothing" failure.

CREATE OR REPLACE FUNCTION public._esign_awaiting_counter_signature(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.esign_request_signers s
     WHERE s.request_id = p_request_id
       AND s.staff_user_id IS NOT NULL
       AND s.status = 'pending'
  )
  AND EXISTS (
    SELECT 1 FROM public.esign_requests e
     WHERE e.id = p_request_id AND e.status = 'signed'
  );
$$;

-- The aggregate state of the counter-signature, for the admin list and detail.
-- `none` when the document asked for nobody's countersignature — which is every
-- document sent before this shipped, so no existing row reads as `pending`.
CREATE OR REPLACE FUNCTION public._esign_counter_signature_state(p_request_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN bool_or(s.status = 'declined') THEN 'declined'
        WHEN bool_or(s.status = 'pending') THEN 'pending'
        ELSE 'signed'
      END
        FROM public.esign_request_signers s
       WHERE s.request_id = p_request_id
         AND s.staff_user_id IS NOT NULL
    ),
    'none'
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Manage the signer set
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_esign_signers(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.view') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'awaiting_counter_signature', public._esign_awaiting_counter_signature(p_request_id),
    'counter_signature_state', public._esign_counter_signature_state(p_request_id),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sort_order, x.created_at)
      FROM (
        SELECT
          s.id,
          s.request_id,
          s.role,
          s.sort_order,
          s.status,
          s.driver_id,
          s.staff_user_id,
          COALESCE(
            s.signer_display_name,
            p.full_name,
            d_prof.full_name
          ) AS display_name,
          -- `profiles` carries no `employee_id` (it belongs to the rider
          -- record), so the two actor kinds report the identifier each one
          -- actually has rather than a coalesce over a column that does not
          -- exist on half the join.
          d.employee_id,
          d.driver_code,
          COALESCE(p.email, p.phone) AS staff_contact,
          (s.staff_user_id IS NOT NULL) AS is_staff_signer,
          s.viewed_at,
          s.signed_at,
          s.declined_at,
          (s.signer_meta ->> 'declined_reason') AS declined_reason,
          s.created_at
        FROM public.esign_request_signers s
        LEFT JOIN public.profiles p ON p.id = s.staff_user_id
        LEFT JOIN public.drivers d ON d.id = s.driver_id
        LEFT JOIN public.profiles d_prof ON d_prof.id = s.driver_id
        WHERE s.request_id = p_request_id
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

-- Staff who may be picked as countersigners. Deliberately a small projection:
-- the editor needs a searchable label and a stable id, nothing else.
CREATE OR REPLACE FUNCTION public.admin_esign_signer_options()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.full_name)
      FROM (
        SELECT p.id, p.full_name, p.email, p.phone
          FROM public.profiles p
         WHERE p.role = 'staff'
           AND p.approval_status = 'approved'
           AND p.archived_at IS NULL
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

-- The lowest free staff slot (>= 10). `(request_id, sort_order)` is unique, so
-- this cannot be a `MAX + 1` — a removed signer leaves a hole that `MAX + 1`
-- would step over forever, and two concurrent adds both compute the same
-- number. Scanning for the first gap makes a retry after a collision land
-- somewhere valid instead of colliding again.
CREATE OR REPLACE FUNCTION public._esign_next_signer_order(p_request_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(MIN(g.slot), 10)
    FROM generate_series(10, 200) AS g(slot)
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.esign_request_signers s
      WHERE s.request_id = p_request_id
        AND s.sort_order = g.slot
   );
$$;

CREATE OR REPLACE FUNCTION public.admin_add_esign_signer(
  p_request_id uuid,
  p_staff_user_id uuid,
  p_role text DEFAULT 'countersigner',
  p_display_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := lower(btrim(COALESCE(p_role, 'countersigner')));
  v_request public.esign_requests%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_order int;
  v_id uuid;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  -- `signer` is reserved for the employee row the projection trigger owns. A
  -- second `signer` row would collide with the "which of these is the signature"
  -- question the driver app answers from `esign_requests`.
  IF v_role NOT IN ('countersigner', 'manager', 'witness') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_role');
  END IF;

  SELECT * INTO v_request FROM public.esign_requests WHERE id = p_request_id;
  IF v_request.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_request.status IN ('cancelled', 'declined') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'closed');
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_staff_user_id;
  IF v_profile.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_signer');
  END IF;
  IF v_profile.role <> 'staff' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_staff');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.esign_request_signers
     WHERE request_id = p_request_id
       AND staff_user_id = p_staff_user_id
       AND role = v_role
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_added');
  END IF;

  -- Staff rows sort after the employee (0) with a comfortable gap, so the
  -- legacy projection can never land on a staff slot.
  v_order := public._esign_next_signer_order(p_request_id);

  -- `(request_id, sort_order)` is unique, so two operators adding a signer at
  -- the same instant can both compute the same next slot. The loser of that
  -- race recomputes and retries rather than surfacing a raw 23505, because the
  -- collision is an artefact of concurrency and not something the operator did.
  BEGIN
    INSERT INTO public.esign_request_signers (
      request_id, staff_user_id, role, sort_order, status, signer_display_name
    ) VALUES (
      p_request_id, p_staff_user_id, v_role, v_order, 'pending',
      COALESCE(NULLIF(btrim(COALESCE(p_display_name, '')), ''), v_profile.full_name)
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    v_order := public._esign_next_signer_order(p_request_id);
    INSERT INTO public.esign_request_signers (
      request_id, staff_user_id, role, sort_order, status, signer_display_name
    ) VALUES (
      p_request_id, p_staff_user_id, v_role, v_order, 'pending',
      COALESCE(NULLIF(btrim(COALESCE(p_display_name, '')), ''), v_profile.full_name)
    )
    RETURNING id INTO v_id;
  END;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'sort_order', v_order);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remove_esign_signer(p_signer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.esign_request_signers%ROWTYPE;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  SELECT * INTO v_row FROM public.esign_request_signers WHERE id = p_signer_id;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  -- A signature that exists is a record, not a draft. Removing it would leave a
  -- `signed_at` in the audit with no row behind it, which is the one thing a
  -- counter-signature must not be able to do.
  IF v_row.staff_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_staff_signer');
  END IF;
  IF v_row.status = 'signed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_signed');
  END IF;

  DELETE FROM public.esign_request_signers WHERE id = p_signer_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reorder_esign_signers(
  p_request_id uuid,
  p_signer_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift int := 1000;
  v_id uuid;
  v_idx int := 0;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF p_signer_ids IS NULL OR array_length(p_signer_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_ids');
  END IF;

  -- Two-phase on purpose. `(request_id, sort_order)` is unique, so writing the
  -- final order straight through collides the moment two rows swap — the update
  -- of the first row meets the second row's not-yet-moved value. The offset pass
  -- parks every staff row out of the way (negative, so it cannot collide with a
  -- final slot) and then the assignment is conflict-free.
  UPDATE public.esign_request_signers
     SET sort_order = -(sort_order + v_shift), updated_at = now()
   WHERE request_id = p_request_id AND staff_user_id IS NOT NULL;

  FOREACH v_id IN ARRAY p_signer_ids LOOP
    UPDATE public.esign_request_signers
       SET sort_order = 10 + v_idx,
           updated_at = now()
     WHERE id = v_id
       AND request_id = p_request_id
       AND staff_user_id IS NOT NULL;
    v_idx := v_idx + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'count', v_idx);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. The staff member's own inbox, and signing
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_my_esign_signatures(
  p_ready_only boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.is_admin_panel_user() OR v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.signed_at NULLS FIRST, x.created_at DESC)
      FROM (
        SELECT
          s.id AS signer_id,
          s.request_id,
          s.role,
          s.status AS signer_status,
          s.created_at AS assigned_at,
          e.request_code,
          e.title,
          e.status::text AS request_status,
          e.created_at,
          e.signed_at,
          e.due_at,
          e.category_key,
          c.label_en AS category_label,
          e.driver_id,
          p.full_name AS driver_name,
          d.driver_code,
          COALESCE(c.screenshot_restricted, e.screenshot_restricted) AS screenshot_restricted,
          (e.status = 'signed') AS ready,
          (s.signer_meta ->> 'declined_reason') AS declined_reason
        FROM public.esign_request_signers s
        JOIN public.esign_requests e ON e.id = s.request_id
        LEFT JOIN public.esign_categories c ON c.key = e.category_key
        LEFT JOIN public.drivers d ON d.id = e.driver_id
        LEFT JOIN public.profiles p ON p.id = e.driver_id
        WHERE s.staff_user_id = v_uid
      ) x
      -- `ready_only` hides a document the employee has not signed yet, because
      -- it is not the staff member's outstanding work; it is the rider's. The
      -- inbox's All tab passes false so a signer can confirm they were assigned
      -- something that has not reached them.
      WHERE COALESCE(p_ready_only, true) IS FALSE OR x.ready IS TRUE
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_submit_esign_signature(
  p_request_id uuid,
  p_signature_storage_key text,
  p_signer_meta jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := NULLIF(btrim(COALESCE(p_signature_storage_key, '')), '');
  v_row public.esign_request_signers%ROWTYPE;
  v_state text;
BEGIN
  IF NOT public.is_admin_panel_user() OR v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF v_key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'signature_required');
  END IF;

  SELECT * INTO v_row
    FROM public.esign_request_signers
   WHERE request_id = p_request_id
     AND staff_user_id = v_uid
     AND status = 'pending'
   ORDER BY sort_order
   LIMIT 1;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_assigned');
  END IF;

  -- The document has to have the employee's signature before it can hold a
  -- countersignature: signing first would produce a document that reads as
  -- countersigned above an unsigned body.
  IF NOT EXISTS (
    SELECT 1 FROM public.esign_requests
     WHERE id = p_request_id AND status = 'signed'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_ready');
  END IF;

  UPDATE public.esign_request_signers
     SET status = 'signed',
         signed_at = now(),
         signature_storage_key = v_key,
         signer_meta = COALESCE(p_signer_meta, signer_meta, '{}'::jsonb),
         updated_at = now()
   WHERE id = v_row.id;

  v_state := public._esign_counter_signature_state(p_request_id);

  INSERT INTO public.admin_activity_logs (
    admin_user_id, action, entity_type, entity_id, route_name, context
  ) VALUES (
    v_uid, 'update', 'esign_request_signers', v_row.id::text, 'esign.sign',
    jsonb_build_object(
      'request_id', p_request_id,
      'signer_role', v_row.role,
      'counter_signature_state', v_state
    )
  );

  RETURN jsonb_build_object('ok', true, 'counter_signature_state', v_state);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_decline_esign_signature(
  p_request_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.esign_request_signers%ROWTYPE;
  v_state text;
BEGIN
  IF NOT public.is_admin_panel_user() OR v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  SELECT * INTO v_row
    FROM public.esign_request_signers
   WHERE request_id = p_request_id
     AND staff_user_id = v_uid
     AND status = 'pending'
   ORDER BY sort_order
   LIMIT 1;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_assigned');
  END IF;

  -- A declined counter-signature returns the document to the sender for
  -- correction. The employee's signature is untouched — it did happen, and
  -- erasing it would make the rider's own Signed list lie — so the request stays
  -- `signed` and the refusal lives on the signer row.
  UPDATE public.esign_request_signers
     SET status = 'declined',
         declined_at = now(),
         signer_meta = COALESCE(signer_meta, '{}'::jsonb)
                        || jsonb_build_object('declined_reason', NULLIF(btrim(COALESCE(p_reason, '')), '')),
         updated_at = now()
   WHERE id = v_row.id;

  v_state := public._esign_counter_signature_state(p_request_id);

  INSERT INTO public.admin_activity_logs (
    admin_user_id, action, entity_type, entity_id, route_name, context
  ) VALUES (
    v_uid, 'update', 'esign_request_signers', v_row.id::text, 'esign.decline_sign',
    jsonb_build_object(
      'request_id', p_request_id,
      'signer_role', v_row.role,
      'counter_signature_state', v_state
    )
  );

  RETURN jsonb_build_object('ok', true, 'counter_signature_state', v_state);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Reads carry the derived state
-- ---------------------------------------------------------------------------
--
-- `admin_list_esign_requests` is reproduced **byte-identical** to
-- `20261116000400` except for two added columns, so the tracker, the filters and
-- the `expired` remap keep their exact behaviour. A `CREATE OR REPLACE` cannot
-- change a RETURNS shape, but these are new keys inside one jsonb, not new OUT
-- parameters, so replacing in place is enough and the ACL survives.

CREATE OR REPLACE FUNCTION public.admin_list_esign_requests(
  p_status text DEFAULT NULL::text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  PERFORM public.admin_expire_esign_requests();

  RETURN jsonb_build_object(
    'ok', true,
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at DESC)
      FROM (
        SELECT *
        FROM (
          SELECT e.*,
                 p.full_name AS driver_name,
                 d.driver_code,
                 c.label_en AS category_label,
                 CASE
                   WHEN e.status = 'pending'
                        AND e.due_at IS NOT NULL
                        AND e.due_at < (timezone('Asia/Kuwait', now()))::date
                   THEN 'expired'
                   ELSE e.status::text
                 END AS display_status,
                 CASE
                   WHEN e.status <> 'pending' THEN e.status::text
                   WHEN e.due_at IS NOT NULL
                        AND e.due_at < (timezone('Asia/Kuwait', now()))::date
                   THEN 'expired'
                   WHEN e.viewed_at IS NOT NULL THEN 'opened'
                   ELSE 'not_opened'
                 END AS recipient_stage,
                 public._esign_awaiting_counter_signature(e.id) AS awaiting_counter_signature,
                 public._esign_counter_signature_state(e.id) AS counter_signature_state
          FROM public.esign_requests e
          LEFT JOIN public.drivers d ON d.id = e.driver_id
          LEFT JOIN public.profiles p ON p.id = e.driver_id
          LEFT JOIN public.esign_categories c ON c.key = e.category_key
        ) s
        WHERE (
          p_status IS NULL
          OR (
            p_status IN ('opened', 'not_opened')
            AND s.recipient_stage = p_status
          )
          OR (
            p_status NOT IN ('opened', 'not_opened')
            AND s.display_status = p_status
          )
        )
        ORDER BY s.created_at DESC
        LIMIT GREATEST(COALESCE(p_limit, 50), 1)
        OFFSET GREATEST(COALESCE(p_offset, 0), 0)
      ) b
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_esign_requests(text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_esign_requests(text, int, int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.driver_list_esign_requests(
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY
        CASE WHEN x.status = 'pending' THEN 0 ELSE 1 END,
        x.created_at DESC)
      FROM (
        SELECT e.id, e.request_code, e.title,
               CASE
                 WHEN e.status = 'pending'
                      AND e.due_at IS NOT NULL
                      AND e.due_at < (timezone('Asia/Kuwait', now()))::date
                 THEN 'expired'
                 ELSE e.status::text
               END AS status,
               e.due_at, e.signed_at, e.viewed_at,
               CASE
                 WHEN e.status <> 'pending' THEN e.status::text
                 WHEN e.due_at IS NOT NULL
                      AND e.due_at < (timezone('Asia/Kuwait', now()))::date
                 THEN 'expired'
                 WHEN e.viewed_at IS NOT NULL THEN 'opened'
                 ELSE 'not_opened'
               END AS recipient_stage,
               COALESCE(c.screenshot_restricted, e.screenshot_restricted)
                 AS screenshot_restricted,
               e.category_key, c.label_en AS category_label,
               public._esign_awaiting_counter_signature(e.id) AS awaiting_counter_signature,
               e.created_at
        FROM public.esign_requests e
        LEFT JOIN public.esign_categories c ON c.key = e.category_key
        WHERE e.driver_id = v_uid
        ORDER BY CASE
          WHEN e.status = 'pending'
               AND NOT (
                 e.due_at IS NOT NULL
                 AND e.due_at < (timezone('Asia/Kuwait', now()))::date
               )
          THEN 0 ELSE 1 END,
          e.created_at DESC
        LIMIT GREATEST(COALESCE(p_limit, 50), 1)
        OFFSET GREATEST(COALESCE(p_offset, 0), 0)
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_list_esign_requests(int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_list_esign_requests(int, int) TO authenticated, service_role;

-- The rider's own detail read, reproduced from `20261027600000` with just the
-- derived flag added beside `signed_document_pending`. The rider has to be able
-- to see *why* a document they signed has not produced the final signed copy
-- yet, and "the manager has not countersigned" is a different fact from "the
-- composer is still working" — the two were indistinguishable on the screen.
CREATE OR REPLACE FUNCTION public.driver_get_esign_request(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.esign_requests%ROWTYPE;
  v_row jsonb;
  v_cat_restricted boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_req FROM public.esign_requests
  WHERE id = p_id AND driver_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT c.screenshot_restricted
    INTO v_cat_restricted
  FROM public.esign_categories c
  WHERE c.key = v_req.category_key;

  SELECT to_jsonb(v_req) || jsonb_build_object(
    'category_label', (
      SELECT c.label_en FROM public.esign_categories c WHERE c.key = v_req.category_key
    ),
    'screenshot_restricted', COALESCE(v_cat_restricted, v_req.screenshot_restricted),
    'download_storage_key',
      COALESCE(v_req.signed_document_storage_key, v_req.document_storage_key),
    'signed_document_ready', v_req.signed_document_storage_key IS NOT NULL,
    'signed_document_pending',
      v_req.status = 'signed'
      AND v_req.signed_document_storage_key IS NULL
      AND v_req.signed_document_error IS NULL,
    'awaiting_counter_signature', public._esign_awaiting_counter_signature(v_req.id),
    'counter_signature_state', public._esign_counter_signature_state(v_req.id),
    'template_name', (
      SELECT t.name_en FROM public.esign_templates t WHERE t.id = v_req.template_id
    ),
    'template_name_ar', (
      SELECT t.name_ar FROM public.esign_templates t WHERE t.id = v_req.template_id
    ),
    'field_values_labeled', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'key', f.field_key,
        'label_en', f.label_en,
        'label_ar', f.label_ar,
        'value', v_req.field_values ->> f.field_key
      ) ORDER BY f.sort_order)
      FROM public.esign_template_fields f
      WHERE f.template_id = v_req.template_id
    ), '[]'::jsonb)
  )
  INTO v_row;

  RETURN jsonb_build_object('ok', true, 'request', v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.driver_get_esign_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_get_esign_request(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
--
-- The two helpers must never be callable by a rider — they leak whether a
-- document is awaiting a staff signature, which is an internal workflow fact —
-- so they are revoked from `authenticated` as well as `anon`. They are reached
-- only from inside the SECURITY DEFINER readers above.

REVOKE ALL ON FUNCTION public._esign_awaiting_counter_signature(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._esign_counter_signature_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._esign_next_signer_order(uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.admin_list_esign_signers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_esign_signers(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_esign_signer_options() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_esign_signer_options() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_add_esign_signer(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_esign_signer(uuid, uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_remove_esign_signer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_esign_signer(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_reorder_esign_signers(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reorder_esign_signers(uuid, uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_list_my_esign_signatures(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_my_esign_signatures(boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_submit_esign_signature(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_submit_esign_signature(uuid, text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_decline_esign_signature(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_decline_esign_signature(uuid, text) TO authenticated, service_role;
