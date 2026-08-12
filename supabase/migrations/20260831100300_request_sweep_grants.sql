-- Both sweeps are SECURITY DEFINER with no caller check because only the cron route runs them,
-- and that route uses the service role. Postgres grants EXECUTE to PUBLIC by default, which
-- would let any signed-in rider close or flag requests in bulk through PostgREST.

REVOKE EXECUTE ON FUNCTION public.admin_auto_close_requests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_auto_close_requests() TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_run_request_sla_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_run_request_sla_sweep() TO service_role;

-- The rider reply is caller-scoped (auth.uid() must own the request), so it stays open to
-- authenticated and closed to anon.
REVOKE EXECUTE ON FUNCTION public.driver_respond_reschedule(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_respond_reschedule(uuid, boolean, text) TO authenticated;
