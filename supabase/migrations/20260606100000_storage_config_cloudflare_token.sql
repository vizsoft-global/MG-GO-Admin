-- Optional Cloudflare account API token (cfut_*) for REST verify; R2 S3 keys stay separate.

ALTER TABLE public.storage_config
  ADD COLUMN IF NOT EXISTS cloudflare_api_token text;

COMMENT ON COLUMN public.storage_config.cloudflare_api_token IS
  'Optional Cloudflare account API token (cfut_*) for /user/tokens/verify only; not used for S3.';

UPDATE public.storage_config SET
  r2_account_id = COALESCE(NULLIF(trim(r2_account_id), ''), 'b7723707360cee894c723e0f9d0439df'),
  r2_s3_endpoint = COALESCE(NULLIF(trim(r2_s3_endpoint), ''), 'https://b7723707360cee894c723e0f9d0439df.r2.cloudflarestorage.com'),
  r2_bucket_name = COALESCE(NULLIF(trim(r2_bucket_name), ''), 'dpd-private')
WHERE id = 1;
