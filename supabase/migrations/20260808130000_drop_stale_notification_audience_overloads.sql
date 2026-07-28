-- Remove stale 2-arg overloads now superseded by 3-arg versions (with p_import_spec default).
-- The 2-arg signatures caused ambiguous-function errors when callers pass two positional/named args.

DROP FUNCTION IF EXISTS public.estimate_notification_audience(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.compile_notification_audience_ids(jsonb, jsonb);
