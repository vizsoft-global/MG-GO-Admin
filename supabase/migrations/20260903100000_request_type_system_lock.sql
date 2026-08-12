-- Enforce the system-type lock in the database, not just in the UI.
--
-- The 8 built-in request types are rendered by installed driver-app builds from
-- hardcoded Dart. Adding a required field to `leave` would block every rider on
-- an older build the moment it is saved, and a Play Store rollout is not instant.
-- The builder screen disables those controls, but the panel writes to these
-- tables through PostgREST with a staff RLS policy that permits any write -- a
-- disabled button is not a lock.
--
-- Renaming a system key is guarded for the same reason: `request_type` FKs cascade
-- on update, so `leave` -> `annual_leave` would silently rewrite every historical
-- request and then fail to match any app build.
--
-- Migrations that legitimately need to change a built-in (for example when the app
-- ships the generic renderer and the lock lifts) set the escape hatch first:
--
--   SET LOCAL rcm.allow_system_edit = 'on';

CREATE OR REPLACE FUNCTION public.rcm_guard_system_request_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_bypass boolean := COALESCE(current_setting('rcm.allow_system_edit', true), '') = 'on';
  v_type_key text;
BEGIN
  IF v_bypass THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'request_field_definitions' THEN
    v_type_key := COALESCE(NEW.type_key, OLD.type_key);
    IF EXISTS (
      SELECT 1 FROM public.request_type_definitions
      WHERE key = v_type_key AND is_system
    ) THEN
      RAISE EXCEPTION 'system_type_fields_locked'
        USING HINT = 'Built-in request type forms are rendered by installed driver-app builds and cannot be changed.';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- request_type_definitions
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'system_type_undeletable';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_system THEN
    IF NEW.key IS DISTINCT FROM OLD.key THEN
      RAISE EXCEPTION 'system_type_key_immutable';
    END IF;
    IF NEW.is_system IS DISTINCT FROM OLD.is_system THEN
      RAISE EXCEPTION 'system_type_flag_immutable';
    END IF;
  ELSIF NEW.is_system AND NOT OLD.is_system THEN
    -- Promoting a custom type to system would lock it against its own author.
    RAISE EXCEPTION 'system_type_flag_immutable';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_system_request_fields ON public.request_field_definitions;
CREATE TRIGGER trg_guard_system_request_fields
  BEFORE INSERT OR UPDATE OR DELETE ON public.request_field_definitions
  FOR EACH ROW EXECUTE FUNCTION public.rcm_guard_system_request_type();

DROP TRIGGER IF EXISTS trg_guard_system_request_types ON public.request_type_definitions;
CREATE TRIGGER trg_guard_system_request_types
  BEFORE UPDATE OR DELETE ON public.request_type_definitions
  FOR EACH ROW EXECUTE FUNCTION public.rcm_guard_system_request_type();

-- A type cannot be inserted as a system type from the panel either; only a
-- migration (which sets the escape hatch) may mint one.
CREATE OR REPLACE FUNCTION public.rcm_guard_system_request_type_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_system
     AND COALESCE(current_setting('rcm.allow_system_edit', true), '') <> 'on' THEN
    RAISE EXCEPTION 'system_type_flag_immutable';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_system_request_types_insert ON public.request_type_definitions;
CREATE TRIGGER trg_guard_system_request_types_insert
  BEFORE INSERT ON public.request_type_definitions
  FOR EACH ROW EXECUTE FUNCTION public.rcm_guard_system_request_type_insert();
