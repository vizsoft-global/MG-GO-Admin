-- App create-kind slots (fuel / fuel_refund / asset) send source = gallery
-- when the rider picks from the photo library. The previous CHECK only
-- allowed mobile_camera | admin_upload, so a valid 3-kind refund insert
-- failed after the file was already in storage.

ALTER TABLE public.request_attachments
  DROP CONSTRAINT IF EXISTS request_attachments_source_check;

ALTER TABLE public.request_attachments
  ADD CONSTRAINT request_attachments_source_check
    CHECK (source IS NULL OR source IN ('mobile_camera', 'admin_upload', 'gallery'));
