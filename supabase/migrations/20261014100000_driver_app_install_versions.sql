-- Which app build each active driver is actually running, read from the device
-- session their current phone logged in with. `drivers.current_app_version_code`
-- is not used: it was fed by an adoption endpoint the app no longer calls and is
-- NULL for 775 of 850 drivers, while `driver_device_sessions.app_version_code` is
-- stamped by `driver-passcode-login` on every login and is populated for every
-- driver with a live device.
--
-- Feeds two things on /settings/app: the count of installs below the force-update
-- minimum (so the operator can see who a toggle will lock out before flipping it)
-- and the "Notify outdated installs" push, which is the only channel that reaches
-- a build too old to carry the Update Required screen.

CREATE OR REPLACE FUNCTION public.admin_driver_app_install_versions()
RETURNS TABLE (
  driver_id uuid,
  app_version_code integer,
  app_version_name text,
  last_seen_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id AS driver_id,
    s.app_version_code,
    s.app_version_name,
    s.last_seen_at
  FROM public.drivers d
  JOIN public.driver_device_sessions s
    ON s.driver_id = d.id
   AND s.device_id = d.active_device_id
   AND s.revoked_at IS NULL
  WHERE d.archived_at IS NULL
    AND public.is_admin_panel_user();
$$;

COMMENT ON FUNCTION public.admin_driver_app_install_versions() IS
  'One row per non-archived driver with a live device session: the app build on that device. Staff only (returns nothing otherwise).';

REVOKE ALL ON FUNCTION public.admin_driver_app_install_versions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_driver_app_install_versions() TO authenticated, service_role;
