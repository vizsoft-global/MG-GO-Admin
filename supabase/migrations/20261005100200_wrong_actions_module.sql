-- /wrong-actions becomes a real module.
--
-- The table has existed since the core schema and has never held a row, because
-- nothing could write one: the route is a ModuleListShell with every KPI
-- hardcoded to an em dash. Three things it needs before it can carry a record
-- that will later move a driver's score.
--
-- 1. An author. An incident filed against a driver is an adverse record, and one
--    with no author cannot be questioned, defended or withdrawn by anyone in
--    particular. `source` already distinguishes system from admin, but "an
--    admin" is not a person. Nullable, because every future system-raised row
--    genuinely has no author, and because the column is being added to a table
--    that is empty today but need not stay that way before this deploys.
--
-- 2. Indexes. The conduct component reads this table per driver per day for the
--    whole fleet across a window; the list reads it by date. Neither has an
--    index today beyond the primary key.
--
-- 3. A write lock that is not advisory. The core schema gave every table one
--    `FOR ALL` staff policy, so `wrong_actions.manage` was enforced only in
--    TypeScript — an Operator holding view-only could POST through PostgREST and
--    file an incident. That gap is tolerable on a table nobody writes; it is not
--    tolerable on the one table whose rows subtract from a driver's score. The
--    policy is split so the slug is the lock, which is the same reasoning that
--    turned the RCM system-type guard into a trigger.

ALTER TABLE public.wrong_actions
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.wrong_actions.created_by IS
  'Panel user who filed the incident. NULL for system-raised rows, which have no author rather than an unknown one.';

CREATE INDEX IF NOT EXISTS wrong_actions_driver_occurred_idx
  ON public.wrong_actions (driver_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS wrong_actions_occurred_idx
  ON public.wrong_actions (occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Policies
--
-- Read for any panel user, write only for the manage slug. Dropping the FOR ALL
-- policy first matters: policies are OR-ed, so leaving it in place would make
-- the new one decorative.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS staff_all_wrong_actions ON public.wrong_actions;

DROP POLICY IF EXISTS wrong_actions_staff_read ON public.wrong_actions;
CREATE POLICY wrong_actions_staff_read
  ON public.wrong_actions FOR SELECT
  TO authenticated
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS wrong_actions_manage_insert ON public.wrong_actions;
CREATE POLICY wrong_actions_manage_insert
  ON public.wrong_actions FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin_panel_user()
    AND public.staff_has_permission('wrong_actions.manage')
  );

DROP POLICY IF EXISTS wrong_actions_manage_update ON public.wrong_actions;
CREATE POLICY wrong_actions_manage_update
  ON public.wrong_actions FOR UPDATE
  TO authenticated
  USING (
    public.is_admin_panel_user()
    AND public.staff_has_permission('wrong_actions.manage')
  )
  WITH CHECK (
    public.is_admin_panel_user()
    AND public.staff_has_permission('wrong_actions.manage')
  );

DROP POLICY IF EXISTS wrong_actions_manage_delete ON public.wrong_actions;
CREATE POLICY wrong_actions_manage_delete
  ON public.wrong_actions FOR DELETE
  TO authenticated
  USING (
    public.is_admin_panel_user()
    AND public.staff_has_permission('wrong_actions.manage')
  );
