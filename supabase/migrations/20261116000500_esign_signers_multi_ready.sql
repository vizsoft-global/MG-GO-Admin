-- EmployeeDesk V2 — signers become a table, so a second signer is a data change (F15).
--
-- Today a request has exactly one signer, and that signer *is* four columns on
-- `esign_requests` (`driver_id`, `signature_storage_key`, `signer_meta`,
-- `signer_display_name`). That is fine until a document needs an employee and a
-- countersigning manager, at which point the columns cannot express it and the
-- change lands as a rewrite of every RPC and every screen at once.
--
-- So the relationship is normalised now, while it still has one row per request.
-- The columns stay and stay authoritative: every writer in the system
-- (`admin_create_esign_request`, `driver_submit_esignature`,
-- `driver_decline_esignature`, `driver_mark_esign_viewed`) already updates them,
-- and `driver_get_esign_request` reads them, so making the new table the write
-- target would be a rewrite of the whole read surface for a feature nobody has
-- asked for yet. Instead the table is a **projection of the legacy columns**,
-- kept current by trigger. Adding a real second signer later means writing to
-- this table directly and relaxing the projection — a local change rather than a
-- cross-cutting one, which is what "multi-ready" is for.
--
-- The direction is enforced rather than conventional: the trigger runs only
-- `esign_requests → esign_request_signers`, and there is deliberately **no**
-- reverse trigger. Two synchronous triggers that each "write only when
-- different" do terminate, but they terminate by agreeing, and the failure mode
-- when they disagree is a request whose signer is whichever trigger ran last.
-- One direction cannot have that argument.

CREATE TABLE IF NOT EXISTS public.esign_request_signers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.esign_requests(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  role text NOT NULL DEFAULT 'signer',
  sort_order int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  viewed_at timestamptz,
  signed_at timestamptz,
  declined_at timestamptz,
  signature_storage_key text,
  signed_document_storage_key text,
  signer_display_name text,
  signer_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT esign_request_signers_order_unique UNIQUE (request_id, sort_order),
  -- A person signs a given document in a given capacity once. Without this the
  -- same rider could hold both `signer` and `witness` rows on one document,
  -- which is exactly the "which of these signatures is the signature" question
  -- this table exists to answer.
  CONSTRAINT esign_request_signers_driver_role_unique UNIQUE (request_id, driver_id, role)
);

COMMENT ON TABLE public.esign_request_signers IS
  'Projection of the legacy single-signer columns on esign_requests. Written by trigger; read by the signer panel.';

CREATE INDEX IF NOT EXISTS esign_request_signers_request_idx
  ON public.esign_request_signers (request_id, sort_order);
CREATE INDEX IF NOT EXISTS esign_request_signers_driver_idx
  ON public.esign_request_signers (driver_id);

-- ---------------------------------------------------------------------------
-- Projection trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.esign_project_primary_signer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.esign_request_signers (
    request_id, driver_id, role, sort_order, status,
    viewed_at, signed_at, declined_at,
    signature_storage_key, signed_document_storage_key,
    signer_display_name, signer_meta, updated_at
  ) VALUES (
    NEW.id, NEW.driver_id, 'signer', 0, NEW.status::text,
    NEW.viewed_at, NEW.signed_at, NEW.declined_at,
    NEW.signature_storage_key, NEW.signed_document_storage_key,
    NEW.signer_display_name, COALESCE(NEW.signer_meta, '{}'::jsonb), now()
  )
  ON CONFLICT (request_id, sort_order) DO UPDATE SET
    driver_id = EXCLUDED.driver_id,
    status = EXCLUDED.status,
    -- The timestamps are first-write-wins on the legacy columns already
    -- (`driver_mark_esign_viewed` only stamps `viewed_at` when it is null), so
    -- COALESCE keeps the projection from un-setting a value a race had already
    -- written. A non-null incoming value still replaces, which is what a
    -- correction needs.
    viewed_at = COALESCE(EXCLUDED.viewed_at, public.esign_request_signers.viewed_at),
    signed_at = COALESCE(EXCLUDED.signed_at, public.esign_request_signers.signed_at),
    declined_at = COALESCE(EXCLUDED.declined_at, public.esign_request_signers.declined_at),
    signature_storage_key = COALESCE(EXCLUDED.signature_storage_key, public.esign_request_signers.signature_storage_key),
    signed_document_storage_key = COALESCE(EXCLUDED.signed_document_storage_key, public.esign_request_signers.signed_document_storage_key),
    signer_display_name = COALESCE(EXCLUDED.signer_display_name, public.esign_request_signers.signer_display_name),
    signer_meta = CASE
      WHEN EXCLUDED.signer_meta = '{}'::jsonb THEN public.esign_request_signers.signer_meta
      ELSE EXCLUDED.signer_meta
    END,
    updated_at = now();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS esign_requests_project_primary_signer ON public.esign_requests;
CREATE TRIGGER esign_requests_project_primary_signer
  AFTER INSERT OR UPDATE OF
    driver_id, status, viewed_at, signed_at, declined_at,
    signature_storage_key, signed_document_storage_key,
    signer_display_name, signer_meta
  ON public.esign_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.esign_project_primary_signer();

-- ---------------------------------------------------------------------------
-- Backfill — one `signer` row per existing request
-- ---------------------------------------------------------------------------
--
-- Ordered **after** the trigger on purpose. Running it first would leave a
-- window in which a request could be updated with no row to project onto, and
-- nothing would ever revisit it: the trigger only fires on future writes. With
-- the trigger in place first, the backfill is the only statement that has to be
-- complete, and `ON CONFLICT DO NOTHING` on the order key makes a re-run after a
-- partial failure idempotent rather than duplicating a signer.
--
-- The legacy columns are read as-is: a request sent but never opened correctly
-- yields a `pending` signer with no timestamps, which is what the panel should
-- draw.

INSERT INTO public.esign_request_signers (
  request_id, driver_id, role, sort_order, status,
  viewed_at, signed_at, declined_at,
  signature_storage_key, signed_document_storage_key,
  signer_display_name, signer_meta
)
SELECT
  e.id,
  e.driver_id,
  'signer',
  0,
  e.status::text,
  e.viewed_at,
  e.signed_at,
  e.declined_at,
  e.signature_storage_key,
  e.signed_document_storage_key,
  e.signer_display_name,
  COALESCE(e.signer_meta, '{}'::jsonb)
FROM public.esign_requests e
ON CONFLICT (request_id, sort_order) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS — staff read, rider reads own. No write policy at all.
-- ---------------------------------------------------------------------------
--
-- Signatures are write-through-trigger only, and a permissive write policy would
-- make that a convention rather than a lock: the panel writes through PostgREST
-- under a staff role, so an INSERT policy here would let any staff session forge
-- a signature row for any request. The trigger is the sole writer, and it runs
-- SECURITY DEFINER.

ALTER TABLE public.esign_request_signers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS esign_request_signers_staff_read ON public.esign_request_signers;
CREATE POLICY esign_request_signers_staff_read
  ON public.esign_request_signers
  FOR SELECT
  TO authenticated
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS esign_request_signers_driver_read ON public.esign_request_signers;
CREATE POLICY esign_request_signers_driver_read
  ON public.esign_request_signers
  FOR SELECT
  TO authenticated
  USING (driver_id = auth.uid());

GRANT SELECT ON public.esign_request_signers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.esign_request_signers TO service_role;
