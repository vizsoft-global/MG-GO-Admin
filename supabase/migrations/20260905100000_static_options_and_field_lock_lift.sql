-- The driver app now renders every request type — including the eight built-ins —
-- from request_field_definitions. Two consequences:
--
-- 1. Static option lists become a server gate. An admin editing a select's
--    options must not leave a rider able to submit a value that is no longer
--    on the list. DB-backed sources (loan tenure, complaint categories) were
--    already checked; `options_source = 'static'` (and a non-empty options
--    array with a null source) now is too. Multiselect checks every chosen
--    value. Empty lists still grey out submit on the client; a present value
--    that is not in the list is rejected here.
--
-- 2. The field-set lock on system types lifts. Labels, chain, SLA and the
--    is_system flag stay as they were: a built-in still cannot be deleted,
--    renamed, or demoted. Field rows on those types are now ordinary writes.
--    Older app builds that still ship handwritten forms will ignore extra
--    fields and will not send newly required ones — that is the remaining
--    rollout cost, and it is why is_server_required stays a separate toggle.

CREATE OR REPLACE FUNCTION public.rcm_validate_request_input(
  p_type text,
  p_payload jsonb,
  p_attachments jsonb,
  p_amount_kwd numeric,
  p_start_date date,
  p_end_date date,
  p_details text,
  p_severity public.severity_level
)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_def public.request_type_definitions%ROWTYPE;
  v_field public.request_field_definitions%ROWTYPE;
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_value text;
  v_present boolean;
  v_has_static_options boolean;
BEGIN
  SELECT * INTO v_def FROM public.request_type_definitions WHERE key = p_type;
  IF NOT FOUND THEN
    RETURN 'unknown_request_type';
  END IF;
  IF NOT v_def.is_active THEN
    RETURN 'request_type_inactive';
  END IF;

  FOR v_field IN
    SELECT * FROM public.request_field_definitions
    WHERE type_key = p_type
    ORDER BY sort_order, field_key
  LOOP
    CONTINUE WHEN v_field.kind = 'file' OR v_field.target = 'attachments';

    v_value := CASE v_field.target
      WHEN 'amount_kwd' THEN CASE WHEN p_amount_kwd IS NULL THEN NULL ELSE p_amount_kwd::text END
      WHEN 'start_date' THEN CASE WHEN p_start_date IS NULL THEN NULL ELSE p_start_date::text END
      WHEN 'end_date'   THEN CASE WHEN p_end_date IS NULL THEN NULL ELSE p_end_date::text END
      WHEN 'details'    THEN p_details
      WHEN 'severity'   THEN CASE WHEN p_severity IS NULL THEN NULL ELSE p_severity::text END
      ELSE v_payload ->> v_field.field_key
    END;
    v_value := NULLIF(trim(COALESCE(v_value, '')), '');
    v_present := v_value IS NOT NULL;

    IF v_field.is_server_required AND NOT v_present THEN
      RETURN COALESCE(v_field.required_error_code, 'field_required:' || v_field.field_key);
    END IF;

    IF v_present AND v_field.options_source = 'loan_tenure_options' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.loan_tenure_options
        WHERE is_active AND months::text = v_value
      ) THEN
        RETURN COALESCE(v_field.options_error_code, 'invalid_option:' || v_field.field_key);
      END IF;
    ELSIF v_present AND v_field.options_source = 'complaint_categories' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.complaint_categories
        WHERE is_active AND (key = v_value OR label_en = v_value)
      ) THEN
        RETURN COALESCE(v_field.options_error_code, 'invalid_option:' || v_field.field_key);
      END IF;
    ELSIF v_present AND v_field.kind IN ('select', 'multiselect') THEN
      v_has_static_options :=
        v_field.options_source = 'static'
        OR (
          v_field.options_source IS NULL
          AND jsonb_typeof(v_field.options) = 'array'
          AND jsonb_array_length(v_field.options) > 0
        );
      IF v_has_static_options THEN
        IF v_field.kind = 'multiselect' THEN
          IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(
              CASE
                WHEN jsonb_typeof(v_payload -> v_field.field_key) = 'array'
                  THEN v_payload -> v_field.field_key
                ELSE '[]'::jsonb
              END
            ) AS t(chosen)
            WHERE NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(v_field.options) AS a(allowed)
              WHERE a.allowed = t.chosen
            )
          ) THEN
            RETURN COALESCE(v_field.options_error_code, 'invalid_option:' || v_field.field_key);
          END IF;
        ELSIF NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(v_field.options) AS a(allowed)
          WHERE a.allowed = v_value
        ) THEN
          RETURN COALESCE(v_field.options_error_code, 'invalid_option:' || v_field.field_key);
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF v_def.date_range_required THEN
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
      RETURN 'invalid_date_range';
    END IF;
  END IF;

  IF jsonb_array_length(COALESCE(p_attachments, '[]'::jsonb)) < v_def.min_attachments THEN
    RETURN COALESCE(v_def.attachments_error_code, 'attachments_required');
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rcm_validate_request_input(
  text, jsonb, jsonb, numeric, date, date, text, public.severity_level)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.rcm_validate_request_input(
  text, jsonb, jsonb, numeric, date, date, text, public.severity_level) IS
  'Internal helper for the request create RPCs. Returns an error code, or NULL when valid. Static select/multiselect options are checked the same way as DB-backed lists.';

-- Field rows on system types are ordinary writes now. The type-level guards
-- (no delete, no key rename, no is_system flip) stay.
DROP TRIGGER IF EXISTS trg_guard_system_request_fields ON public.request_field_definitions;

CREATE OR REPLACE FUNCTION public.rcm_guard_system_request_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_bypass boolean := COALESCE(current_setting('rcm.allow_system_edit', true), '') = 'on';
BEGIN
  IF v_bypass THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

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
    RAISE EXCEPTION 'system_type_flag_immutable';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.rcm_guard_system_request_type() IS
  'Blocks delete, key rename and is_system flips on built-in request types. Field rows are not guarded.';
