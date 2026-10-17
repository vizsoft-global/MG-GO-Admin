# Firebase cost baseline (2026-10-17)

Source: `node scripts/firebase-cost-baseline.mjs` (read-only) against `musallam-delivery-prod`.

## `app_settings/1`

| Flag | Value |
|---|---|
| `home_poll_enabled` | unset (app default: off) |
| `home_snapshot_enabled` | unset (server default: off) |
| `driver_app_force_update` | `true` |
| `driver_app_min_version_code` | `102` |
| `rider_signal_mode`, `rider_fallback_refresh_minutes`, `gps_sink`, `gps_r2_rollout_percent` | unset (new in this pass) |

Force update is on at 102, so builds below 102 sit on Update Required and cannot
poll Home. The Home volume therefore comes from current builds: resume and
pull-to-refresh fire Home twice, every FCM `record_type` invalidates it, and the
60s `live_db_refresh` tick drives `.get()`s on `app_settings/1` and `drivers/{uid}`
plus a proximity callable on every phone.

## Fleet

- 909 live drivers, 39 on duty at measurement time.
- Reported build: 103 (67), 102 (16), older (71, blocked), unknown (755 — never
  reported a version code; most have not logged in since the field existed).

## Collection sizes

| Collection | Docs |
|---|---|
| `driver_locations` | 629 |
| `driver_location_events` | 23,759,483 |
| `driver_operation_events` | 1,026,420 |
| `driver_telemetry_events` | 2,593,672 |
| `driver_home_daily` | 0 (snapshot never enabled) |

## Cost model (from `firestore-hotspot-report.md`)

About $1,150/month: reads ~$720, writes ~$108, storage ~$7, Cloud Run ~$300–350,
Cloudflare ~$8. `driver_location_events` is ~95% of stored documents and about
half of all writes.
