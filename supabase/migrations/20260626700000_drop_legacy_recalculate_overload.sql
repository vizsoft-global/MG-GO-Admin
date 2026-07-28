-- Hotfix: remove ambiguous legacy overload.
--
-- We now use the canonical signature:
--   public.recalculate_driver_earnings(uuid, date, uuid DEFAULT NULL)
-- Keeping the old 2-arg signature causes 42725 ("is not unique") when
-- callers invoke the function with just (driver_id, earn_date).

DROP FUNCTION IF EXISTS public.recalculate_driver_earnings(uuid, date);
