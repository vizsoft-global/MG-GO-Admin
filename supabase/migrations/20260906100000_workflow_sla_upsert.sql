-- Workflow builder can now persist per-step SLA. Columns have existed since
-- 20260831100100; admin_upsert_step_template was still dropping them on save.
-- Breach stays notify | escalate (attention only — never auto-decides a step).

CREATE OR REPLACE FUNCTION public.admin_upsert_step_template(p_request_type text, p_steps jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_step jsonb;
  v_sla int;
  v_breach text;
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
    v_sla := NULL;
    IF (v_step ->> 'sla_minutes') ~ '^[0-9]+$' AND (v_step ->> 'sla_minutes')::int > 0 THEN
      v_sla := (v_step ->> 'sla_minutes')::int;
    END IF;

    v_breach := NULLIF(lower(trim(v_step ->> 'breach_action')), '');
    IF v_breach IS NOT NULL AND v_breach NOT IN ('notify', 'escalate') THEN
      v_breach := NULL;
    END IF;
    IF v_sla IS NULL THEN
      v_breach := NULL;
    ELSIF v_breach IS NULL THEN
      v_breach := 'notify';
    END IF;

    INSERT INTO public.request_approval_step_templates (
      request_type, step_order, step_name, role_key, is_system_auto, allowed_actions,
      sla_minutes, breach_action
    ) VALUES (
      p_request_type,
      (v_step ->> 'step_order')::int,
      v_step ->> 'step_name',
      v_step ->> 'role_key',
      COALESCE((v_step ->> 'is_system_auto')::boolean, false),
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(v_step -> 'allowed_actions')),
        ARRAY['approve', 'reject']::text[]
      ),
      v_sla,
      v_breach
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_upsert_step_template(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_step_template(text, jsonb) TO authenticated;
