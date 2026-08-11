-- Signed-document composer for e-signatures.
--
-- Until now `driver_submit_esignature` only stored the driver's signature PNG
-- (`signature_storage_key`) next to the untouched source file
-- (`document_storage_key`); no merged artifact existed, so the driver could
-- only ever download the unsigned original. The `esign-compose-signed-document`
-- edge function now stamps the signature onto the source and writes the result
-- under the `signed/` prefix of the `esign-documents` bucket.
--
-- Write access stays service-role only: drivers have no UPDATE policy on
-- `esign_requests` and no storage write policy outside their own `{uid}/`
-- folder, so the signing party cannot author its own legal artifact.

ALTER TABLE public.esign_requests
  ADD COLUMN IF NOT EXISTS signed_document_storage_key text,
  ADD COLUMN IF NOT EXISTS signed_document_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS signed_document_error text;

COMMENT ON COLUMN public.esign_requests.signed_document_storage_key IS
  'Object key in `esign-documents` for the composed signature-stamped copy. Written only by the service role (esign-compose-signed-document edge function).';
COMMENT ON COLUMN public.esign_requests.signed_document_generated_at IS
  'When the composed copy was last written. NULL while composition is pending.';
COMMENT ON COLUMN public.esign_requests.signed_document_error IS
  'Structured error code from the last failed composition attempt (e.g. unsupported_source_type), NULL on success.';

-- Read-only access to the composed copy for the driver who signed it.
-- SELECT only: creating a signed URL needs read permission, and the driver
-- must never be able to overwrite the artifact they are a party to.
DROP POLICY IF EXISTS esign_documents_driver_read_signed ON storage.objects;
CREATE POLICY esign_documents_driver_read_signed ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'esign-documents'
    AND (storage.foldername(name))[1] = 'signed'
    AND EXISTS (
      SELECT 1
      FROM public.esign_requests e
      WHERE e.driver_id = auth.uid()
        AND e.signed_document_storage_key = storage.objects.name
    )
  );

-- Read path: hand the client one key to download plus explicit state, so the
-- UI can say "signed copy" vs "still generating" honestly instead of guessing.
CREATE OR REPLACE FUNCTION public.driver_get_esign_request(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.esign_requests%ROWTYPE;
  v_row jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_req FROM public.esign_requests
  WHERE id = p_id AND driver_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT to_jsonb(v_req) || jsonb_build_object(
    'category_label', (
      SELECT c.label_en FROM public.esign_categories c WHERE c.key = v_req.category_key
    ),
    'download_storage_key',
      COALESCE(v_req.signed_document_storage_key, v_req.document_storage_key),
    'signed_document_ready', v_req.signed_document_storage_key IS NOT NULL,
    'signed_document_pending',
      v_req.status = 'signed'
      AND v_req.signed_document_storage_key IS NULL
      AND v_req.signed_document_error IS NULL
  )
  INTO v_row;

  RETURN jsonb_build_object('ok', true, 'request', v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_get_esign_request(uuid) TO authenticated, service_role;
