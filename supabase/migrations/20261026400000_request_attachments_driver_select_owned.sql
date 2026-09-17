-- Additive driver SELECT on request-attachments.
-- Existing request_attachments_driver_own (ALL on folder[1] = auth.uid()) stays.
-- Existing request_attachments_staff_all stays.
-- Existing objects keep their keys. This only lets a rider read objects whose
-- second folder is a request they own (staff-prefix attach_send / attach_breakdown).
-- Driver INSERT/UPDATE/DELETE remain own-folder only.

DROP POLICY IF EXISTS request_attachments_driver_select_owned_request ON storage.objects;
CREATE POLICY request_attachments_driver_select_owned_request
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'request-attachments'
    AND EXISTS (
      SELECT 1
      FROM public.requests r
      WHERE public.is_current_driver(r.driver_id)
        AND (storage.foldername(name))[2] = r.id::text
    )
  );
