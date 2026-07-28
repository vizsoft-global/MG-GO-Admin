-- Driver intake + partner logo files are stored in Cloudflare R2 (see .env R2_*).
-- Supabase buckets driver-intakes and partner-logos are deprecated; no new writes from the app.

COMMENT ON TABLE public.driver_intakes IS
  'Admin-created driver records awaiting mobile OTP link. Documents in R2: drivers/intakes/{id}/';
