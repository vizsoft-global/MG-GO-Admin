-- Riders could not open the document they were being asked to sign.
--
-- The only rider-facing policies on `esign-documents` were `esign_documents_driver_own`
-- (first folder must equal auth.uid()) and `esign_documents_driver_read_signed` (first
-- folder must be `signed`). Admin uploads land under `admin/{uuid}.{ext}`, which matches
-- neither, so `createSignedUrl` on `esign_requests.document_storage_key` was denied for
-- every admin-sent request — the Sign Viewer could never display its document.
--
-- This mirrors the existing signed-copy policy: read is allowed only when the object IS
-- the source document of a request that belongs to the caller. It grants nothing else in
-- the bucket, and stays correct whatever prefix the admin uploader uses.
--
-- The bucket-prefixed comparison is deliberate: `esign-compose-signed-document` documents
-- that some rows store keys as `esign-documents/foo.pdf`, and a prefix mismatch is exactly
-- how the original bug hid.

create policy "esign_documents_driver_read_source"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'esign-documents'
    and exists (
      select 1
      from public.esign_requests e
      where e.driver_id = auth.uid()
        and e.document_storage_key is not null
        and (
          e.document_storage_key = objects.name
          or e.document_storage_key = 'esign-documents/' || objects.name
        )
    )
  );
