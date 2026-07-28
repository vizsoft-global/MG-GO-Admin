# Driver tracking — admin panel reference

**Production Supabase:** `ytfmsgckjatiserpgdbz` (DPD)  
**Timezone:** Asia/Kuwait (UTC+3, no DST)

## Admin routes

| Route | Data sources |
|-------|----------------|
| `/attendance` | `attendance_logs`, `drivers.is_on_duty` — corrections via `admin_correct_attendance` |
| `/driver-shifts` | `driver_daily_shifts` (read-only) |
| `/worktime` | `attendance_logs` + `driver_attendance` + `driver_sessions` + `driver_location_events` |
| `/live-tracking` | `driver_locations` (realtime), `driver_location_events` (history) |

## Two flags (driver app)

| Flag | Column | Meaning |
|------|--------|---------|
| On duty | `drivers.is_on_duty` | Active work session; GPS allowed |
| Online | `driver_sessions.is_online` | Online stint for time accounting |

App rule: online sets both true; offline sets both false.

## Metric sources (do not merge silently)

| Label | Table / RPC |
|-------|-------------|
| Check-in / out | `attendance_logs` |
| Log duration | `check_out_at - check_in_at` |
| Online seconds | `driver_attendance.online_seconds` (+ live partial for today) |
| Weekly online | Sum `driver_sessions` (Kuwait week) — `driver_get_home_dashboard` |
| Distance at checkout | `attendance_logs.distance_meters` |
| Live distance | `driver_locations.distance_today_meters` |
| Idle / moving (history) | `driver_location_events` aggregates |
| Shift window | `driver_daily_shifts` + `is_within_window` / `is_locked` |
| Validation | `driver_attendance.status` |

## Key RPCs (driver app — do not change in admin v1)

- `driver_set_duty_state`, `driver_report_location`, `driver_submit_daily_shift`, `driver_get_attendance`
- Admin: `admin_correct_attendance` → `attendance_logs` only

## Migrations (reference)

| Version | Topic |
|---------|--------|
| `20260526120000` | `driver_daily_shifts`, shift RPCs |
| `20260619100000` | `attendance_logs`, admin module, realtime |
| `20260620100000` | `driver_locations`, `driver_location_events` |
| `20260624100000` | Distance today, weekly online_seconds |
| `20260625100000` | `driver_attendance`, geo validation, cron finalize |
| `20260628200000` | Realtime `deliveries`, `driver_intakes` |

Verify applied versions: `npx supabase migration list` (linked to `ytfmsgckjatiserpgdbz`).

## Cron

Schedule `finalize_attendance_stale_sessions` with **service_role** so open `driver_sessions` flush into `driver_attendance.online_seconds`.

## Full spec

See driver app handoff: [`DRIVER_APP_HANDOFF.md`](./DRIVER_APP_HANDOFF.md).
