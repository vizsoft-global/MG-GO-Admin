-- Convert the request_type enum columns to text backed by request_type_definitions.
--
-- The column KEEPS its name. Converting `requests.request_type` in place, rather
-- than adding a parallel `type_key`, means there is never a moment where two
-- columns can disagree, and it leaves every existing reader untouched: the admin
-- panel already treats `request_type` as a string, and the driver app reads it
-- out of the RPC JSON as a string too. Only the storage type changes; the wire
-- format does not.
--
-- The foreign key takes over the job the enum was doing -- rejecting a value that
-- is not a known type -- except that the set of known types is now a table an
-- admin can add to.
--
-- The three RPCs that take the enum as a parameter have to be dropped and
-- recreated, because a parameter type is part of the identity of a Postgres
-- function. This is invisible to callers: PostgREST sends `"p_type": "leave"`
-- either way. It does mean both signatures must never coexist, or PostgREST
-- cannot resolve the overload -- hence the explicit DROP.

-- ---------------------------------------------------------------------------
-- 1. Drop the functions that carry the enum in their signature.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.driver_create_request(
  public.request_type, jsonb, jsonb, numeric, date, date, text, public.severity_level);
DROP FUNCTION IF EXISTS public.admin_create_request(
  uuid, public.request_type, jsonb, jsonb, numeric, date, date, text, public.severity_level);
DROP FUNCTION IF EXISTS public.admin_upsert_step_template(public.request_type, jsonb);

-- ---------------------------------------------------------------------------
-- 2. Fold request_type_screenshot_policy into the definitions table.
--
-- That table was already acting as a proto type-config table: it carried both the
-- screenshot flag and the type's is_active flag. Both were copied across by the
-- previous migration, so keeping it would leave two places to toggle the same
-- thing.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS public.request_type_screenshot_policy;

-- ---------------------------------------------------------------------------
-- 3. Convert the columns.
-- ---------------------------------------------------------------------------

ALTER TABLE public.requests
  ALTER COLUMN request_type TYPE text USING request_type::text;

ALTER TABLE public.request_approval_step_templates
  ALTER COLUMN request_type TYPE text USING request_type::text;

ALTER TABLE public.request_staff_access
  ALTER COLUMN request_type TYPE text USING request_type::text;

-- Every existing value came from the enum and every enum value was seeded as a
-- definition, so these can only fail if the seed did not run.
ALTER TABLE public.requests
  DROP CONSTRAINT IF EXISTS requests_request_type_fkey,
  ADD CONSTRAINT requests_request_type_fkey
    FOREIGN KEY (request_type) REFERENCES public.request_type_definitions(key)
    ON UPDATE CASCADE;

ALTER TABLE public.request_approval_step_templates
  DROP CONSTRAINT IF EXISTS request_approval_step_templates_request_type_fkey,
  ADD CONSTRAINT request_approval_step_templates_request_type_fkey
    FOREIGN KEY (request_type) REFERENCES public.request_type_definitions(key)
    ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.request_staff_access
  DROP CONSTRAINT IF EXISTS request_staff_access_request_type_fkey,
  ADD CONSTRAINT request_staff_access_request_type_fkey
    FOREIGN KEY (request_type) REFERENCES public.request_type_definitions(key)
    ON UPDATE CASCADE ON DELETE CASCADE;

-- Nothing depends on the enum any more. Leaving it would only invite someone to
-- reintroduce it as a second source of truth.
DROP TYPE IF EXISTS public.request_type;

-- ---------------------------------------------------------------------------
-- 4. Recreate admin_upsert_step_template against text.
--
-- Body is unchanged apart from the parameter type; the workflow editor is not in
-- scope here.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_upsert_step_template(p_request_type text, p_steps jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_step jsonb;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_steps');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.request_type_definitions WHERE key = p_request_type
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_request_type');
  END IF;

  DELETE FROM public.request_approval_step_templates WHERE request_type = p_request_type;

  FOR v_step IN SELECT * FROM jsonb_array_elements(p_steps)
  LOOP
    INSERT INTO public.request_approval_step_templates (
      request_type, step_order, step_name, role_key, is_system_auto, allowed_actions
    ) VALUES (
      p_request_type,
      (v_step ->> 'step_order')::int,
      v_step ->> 'step_name',
      v_step ->> 'role_key',
      COALESCE((v_step ->> 'is_system_auto')::boolean, false),
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(v_step -> 'allowed_actions')),
        ARRAY['approve', 'reject']::text[]
      )
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_upsert_step_template(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_step_template(text, jsonb) TO authenticated;
