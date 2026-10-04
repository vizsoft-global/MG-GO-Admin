-- Request form fields: numeric bounds are enforced, and a field can declare
-- when it is visible.
--
-- Two defects, one table. `request_field_definitions` has carried `min_value` /
-- `max_value` since the Asset form shipped and **nothing ever read them**, on
-- either side: `numberFieldSubmitIssue` took only a required flag, and
-- `rcm_validate_request_input` never looked at the columns. So a rider could
-- submit `quantity = 0` or `expected_amount = 999999999` and the server took it.
--
-- The second defect is that a field could not say *when* it applies. Asset
-- "Size" was shown for every asset type — a SIM card asked for a shirt size —
-- and because `is_required` is a static flag it could not be "required for
-- apparel only", so it was simply never required.
--
-- `visible_when` is one jsonb object rather than two columns because the two
-- facts are one fact: `{"field_key": "...", "in": ["..."], "required": true}`.
-- A field is validated only when it is visible, which is what makes the
-- conditional requirement safe — without it, `size` would be required of a SIM
-- card on the server while hidden on the form, and the submit could never pass.

-- ---------------------------------------------------------------------------
-- 1. visible_when
-- ---------------------------------------------------------------------------

ALTER TABLE public.request_field_definitions
  ADD COLUMN IF NOT EXISTS visible_when jsonb;

COMMENT ON COLUMN public.request_field_definitions.visible_when IS
  'Optional {field_key, in[], required?}. The field is shown (and validated) '
  'only when the named sibling currently holds one of `in`. `required: true` '
  'means required-when-visible, which a static is_required cannot express.';

-- ---------------------------------------------------------------------------
-- 2. Seed the bounds and the one conditional field that actually needs them
-- ---------------------------------------------------------------------------

-- Asset Size: apparel only, and required when it is shown. The five values are
-- the real `asset_type` options for garments; everything else in that list
-- (SIM card, Fuel card, Phone, Helmet, New bike, …) has no size at all.
UPDATE public.request_field_definitions
SET visible_when = jsonb_build_object(
      'field_key', 'asset_type',
      'in', jsonb_build_array(
        'Raincoat',
        'Delivery attire',
        'Delivery pants',
        'Reflective vest',
        'Winter jacket'
      ),
      'required', true
    ),
    updated_at = now()
WHERE type_key = 'asset'
  AND field_key = 'size';

-- Quantity is a count of items. The min of 1 was stored from the beginning;
-- the max was left NULL, which is how 1,000,000,000 was submittable.
UPDATE public.request_field_definitions
SET max_value = 100,
    updated_at = now()
WHERE type_key = 'asset'
  AND field_key = 'quantity';

-- Salary justification. `received_amount` keeps a floor of 0 on purpose: "I was
-- paid nothing this month" is the whole point of some of these requests, so
-- zero is an answer here and a hardcoded `> 0` rule would be wrong. The ceiling
-- is a data-entry guard, not a salary cap — 100,000 KWD is far above any
-- monthly figure and far below a pasted ten-digit number.
UPDATE public.request_field_definitions
SET min_value = 1,
    max_value = 100000,
    updated_at = now()
WHERE type_key = 'salary_justification'
  AND field_key = 'expected_amount';

UPDATE public.request_field_definitions
SET min_value = 0,
    max_value = 100000,
    updated_at = now()
WHERE type_key = 'salary_justification'
  AND field_key = 'received_amount';

-- ---------------------------------------------------------------------------
-- 3. Server-side enforcement
-- ---------------------------------------------------------------------------
--
-- `CREATE OR REPLACE` keeps the existing ACL (postgres + service_role only) and
-- the `search_path = public` / SECURITY DEFINER posture. The function is called
-- from `driver_create_request` / `admin_create_request`, not by clients.
--
-- Two additions and one ordering change:
--
--   * `visible_when` is resolved first, and a hidden field is skipped entirely
--     (`CONTINUE`). That is what stops `field_required:size` from firing on a
--     SIM card.
--   * `required: true` inside `visible_when` becomes a required check, using the
--     same `required_error_code` / `field_required:<key>` contract as
--     `is_server_required`, so the app needs no new error vocabulary.
--   * a `number` field is cast and bounded. An unparseable value is refused
--     rather than silently coerced, because `''::numeric` raising inside a
--     `RETURN text` validator would surface as a 500 to the rider.
--
-- `field_required:start_date` / `:end_date` keep their exact spelling — the app
-- and the date-range message mapper both match on those strings.

CREATE OR REPLACE FUNCTION public.rcm_validate_request_input(p_type text, p_payload jsonb, p_attachments jsonb, p_amount_kwd numeric, p_start_date date, p_end_date date, p_details text, p_severity severity_level)
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
  v_visible boolean;
  v_parent_key text;
  v_parent_value text;
  v_number numeric;
  v_has_static_options boolean;
  v_needed_by date;
  v_subtype text;
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

    -- Conditional visibility. The parent is resolved with the same target
    -- mapping as `v_value`, so a condition may name a real column and not only
    -- a payload key. Membership is tested with `jsonb_array_elements_text`
    -- rather than the `?` operator so a numeric option matches the same way the
    -- client's `values.contains('$v')` does.
    v_visible := true;
    IF v_field.visible_when IS NOT NULL THEN
      v_parent_key := NULLIF(v_field.visible_when ->> 'field_key', '');
      v_parent_value := CASE v_parent_key
        WHEN 'amount_kwd' THEN CASE WHEN p_amount_kwd IS NULL THEN NULL ELSE p_amount_kwd::text END
        WHEN 'start_date' THEN CASE WHEN p_start_date IS NULL THEN NULL ELSE p_start_date::text END
        WHEN 'end_date'   THEN CASE WHEN p_end_date IS NULL THEN NULL ELSE p_end_date::text END
        WHEN 'details'    THEN p_details
        WHEN 'severity'   THEN CASE WHEN p_severity IS NULL THEN NULL ELSE p_severity::text END
        ELSE v_payload ->> v_parent_key
      END;
      v_parent_value := NULLIF(trim(COALESCE(v_parent_value, '')), '');
      v_visible :=
        v_parent_key IS NOT NULL
        AND v_parent_value IS NOT NULL
        AND jsonb_typeof(v_field.visible_when -> 'in') = 'array'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(v_field.visible_when -> 'in') AS t(allowed)
          WHERE t.allowed = v_parent_value
        );
    END IF;

    -- A hidden field has no value on the form, so it can be neither required
    -- nor range-checked.
    CONTINUE WHEN NOT v_visible;

    IF v_field.is_server_required AND NOT v_present THEN
      RETURN COALESCE(v_field.required_error_code, 'field_required:' || v_field.field_key);
    END IF;

    IF NOT v_present
       AND COALESCE((v_field.visible_when ->> 'required')::boolean, false) THEN
      RETURN COALESCE(v_field.required_error_code, 'field_required:' || v_field.field_key);
    END IF;

    IF v_present AND v_field.kind = 'number' THEN
      BEGIN
        v_number := v_value::numeric;
      EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
          RETURN 'invalid_number:' || v_field.field_key;
      END;
      IF v_field.min_value IS NOT NULL AND v_number < v_field.min_value THEN
        RETURN 'number_too_small:' || v_field.field_key;
      END IF;
      IF v_field.max_value IS NOT NULL AND v_number > v_field.max_value THEN
        RETURN 'number_too_large:' || v_field.field_key;
      END IF;
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
    IF p_start_date IS NULL THEN
      RETURN 'field_required:start_date';
    END IF;
    IF p_end_date IS NULL THEN
      RETURN 'field_required:end_date';
    END IF;
    IF p_end_date < p_start_date THEN
      RETURN 'invalid_date_range';
    END IF;
  END IF;

  IF NULLIF(trim(COALESCE(v_payload ->> 'needed_by', '')), '') IS NOT NULL THEN
    BEGIN
      v_needed_by := (v_payload ->> 'needed_by')::date;
      IF v_needed_by < (timezone('Asia/Kuwait', now()))::date THEN
        RETURN 'date_in_past:needed_by';
      END IF;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RETURN 'date_in_past:needed_by';
    END;
  END IF;

  v_subtype := lower(trim(COALESCE(v_payload ->> 'leave_subtype', '')));
  IF p_type = 'sick_leave'
     AND v_subtype IN ('other', 'أخرى')
     AND NULLIF(trim(COALESCE(v_payload ->> 'leave_subtype_other', '')), '') IS NULL THEN
    RETURN 'field_required:leave_subtype_other';
  END IF;

  IF jsonb_array_length(COALESCE(p_attachments, '[]'::jsonb)) < v_def.min_attachments THEN
    RETURN COALESCE(v_def.attachments_error_code, 'attachments_required');
  END IF;

  RETURN NULL;
END;
$function$;
