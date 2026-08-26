-- Archiving a driver releases their phone number, as it already releases their
-- civil ID and employee ID.
--
-- `driver_intakes_phone_unique` covers every row ever written, but the admin's
-- own pre-flight check has always looked only at live intakes:
--
--   phoneExists()  ->  from('driver_intakes').eq('phone', …).is('archived_at', null)
--
-- So re-adding a driver who had been archived passed the duplicate check and
-- then failed on the index — the operator got a raw 23505 instead of the
-- "already in use" warning, on a number the panel had just told them was free.
-- That mismatch predates this work, but it lands squarely on the duplicate
-- warning that phone being optional now depends on, and it left phone as the
-- one identity field whose uniqueness outlived the record:
--
--   driver_intakes_employee_id_unique_active   -> WHERE archived_at IS NULL
--   driver_intakes_civil_id_unique_active      -> WHERE archived_at IS NULL
--   driver_intakes_phone_unique                -> every row, forever
--
-- Narrowing a unique index can only ever accept rows it used to reject, so no
-- existing data can conflict and no backfill is possible.
--
-- `phone IS NOT NULL` is redundant against SQL's NULL-distinct rule but is
-- stated anyway to match the sibling indexes and to keep the predicate readable
-- next to the app query it mirrors.
--
-- Dropped as a CONSTRAINT rather than an index: phone was declared UNIQUE on the
-- column, so Postgres owns the index through the constraint and refuses a bare
-- DROP INDEX. A partial unique index cannot be expressed as a constraint at all,
-- which is why the replacement is an index.

ALTER TABLE public.driver_intakes
  DROP CONSTRAINT IF EXISTS driver_intakes_phone_unique;

CREATE UNIQUE INDEX IF NOT EXISTS driver_intakes_phone_unique_active
  ON public.driver_intakes (phone)
  WHERE phone IS NOT NULL AND archived_at IS NULL;

COMMENT ON INDEX public.driver_intakes_phone_unique_active IS
  'Live intakes only, mirroring phoneExists(). Archiving frees the number for re-entry.';
