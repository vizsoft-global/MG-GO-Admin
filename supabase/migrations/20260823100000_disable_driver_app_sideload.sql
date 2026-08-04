-- Permanently disable in-app / sideload APK OTA (Play Store policy).
update public.app_settings
set
  driver_app_sideload_updates_enabled = false,
  updated_at = now()
where id = 1
  and coalesce(driver_app_sideload_updates_enabled, true) is distinct from false;

comment on column public.app_settings.driver_app_sideload_updates_enabled is
  'Deprecated: sideload OTA removed. Always false; force-disabled for Play Store.';
