-- Enable Supabase Realtime (logical replication via supabase_realtime publication)
-- for tables that power the admin live views. Without this, the admin app cannot
-- subscribe to postgres_changes events and pages require a manual refresh after
-- another user creates/edits a row.
--
-- driver_locations, zones, drivers, etc. are already part of the publication.
-- This adds the missing tables that back the Deliveries and Drivers admin pages.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'deliveries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.deliveries;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'driver_intakes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_intakes;
  END IF;
END
$$;
