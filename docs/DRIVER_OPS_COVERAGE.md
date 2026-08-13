# Driver operation coverage

What the Admin Activity feed can and cannot tell you about a driver's day.

Every row lands in `driver_operation_events`. Two emitters put them there, and which one is used is decided by how the RPC reports failure, not by preference:

| Emitter | Used when | Behaviour on caller rollback |
|---|---|---|
| `log_driver_operation` | Success, and failures returned as `{ok:false}` | Row is rolled back with the caller |
| `log_driver_operation_autonomous` | Failures raised with `RAISE EXCEPTION` | Row survives, written over a dblink loopback as `driver_ops_auditor` |

`driver_ops_fail(driver, category, key, source, code, context)` is the shorthand for the second case: it logs, then re-raises the original code as the message, so no driver app build can tell the difference.

Verify the autonomous path is alive with `select public.driver_ops_audit_health()`. It must report `configured: true, reachable: true`. When it does not, failure logging silently degrades to nothing — successes are unaffected — and the daily retention cron reports it to Sentry.

---

## Covered operations

Failure codes in **bold** were added on 2026-08-13; the rest were already covered.

### Auth

| Operation key | Source RPC | Success | Failures recorded | Not recorded |
|---|---|---|---|---|
| `auth.passcode_lookup` | `driver_app_lookup_by_passcode` | yes | wrong passcode, unknown code, archived, inactive | — |
| `auth.login_selfie` | `driver_record_login_verification` | yes | **object_key_required**, **invalid_object_key** | `not_a_driver` |
| `profile.register_sync` | `register_or_sync_rider_profile` | **yes** — records whether the driver row and profile were created and which intake matched by phone | — | `staff_not_allowed`, `not_authenticated` |

### Device

| Operation key | Source RPC | Success | Failures recorded | Not recorded |
|---|---|---|---|---|
| `device.signout` | `driver_release_device_session` | yes | — | — |
| `device.heartbeat_rejected` | `driver_heartbeat` | n/a | device mismatch rejections | accepted heartbeats (hot path) |
| `device.reconciliation_flushed` | `driver_finalize_reconciliation` | yes | — | `device_id_required` |

### Duty and shifts

| Operation key | Source RPC | Success | Failures recorded |
|---|---|---|---|
| `duty.on` / `duty.off` / `duty.online` / `duty.offline` | `driver_set_duty_state` | yes | `shift_required` |
| `shift.submit` | `driver_submit_daily_shift` | yes | `shift_locked`, **invalid_shift_type**, **future_date**, **session1_required**, **invalid_session1_duration**, **session_too_long**, **session2_required**, **sessions_overlap**, **invalid_session2_duration**, **session2_not_allowed** |

Shift failures carry the full submitted form (both sessions, the date, the type) in `context`, because the question afterwards is always which field was wrong.

### Delivery

| Operation key | Source RPC | Success | Failures recorded |
|---|---|---|---|
| `delivery.pickup_create` | `driver_create_pickup` | yes | `active_pickup_exists`, `delivery_out_of_range`, `duplicate_order_id` (both the same-day check and the unique index), **location_required**, **invalid_order_id** |
| `delivery.complete` | `driver_complete_delivery` | yes | `delivery_not_found`, `invalid_delivery_status`, **delivery_id_required**, **location_required** |
| `delivery.cancel` | `driver_cancel_delivery` | yes | `delivery_not_found`, `invalid_delivery_status`, **delivery_id_required**, **cancel_reason_required**, **location_required** |

`driver_create_delivery` is a wrapper that calls pickup then complete, so it needs no logging of its own — both halves report themselves.

### Location

| Operation key | Source RPC | Recorded |
|---|---|---|
| `location.zone_entry` / `location.zone_exit` | `driver_report_location` | geofence flips only |

Individual GPS fixes are deliberately absent — see exclusions. Liveness during stationary periods comes from `driver_locations.last_report_at` and `coalesced_since_count`, not from events.

### Requests, e-sign, visits

| Operation key | Source RPC |
|---|---|
| `request.create`, `request.clarify`, `request.acknowledge`, `request.reschedule_respond` | `driver_create_request`, `driver_submit_clarification`, `driver_acknowledge_request`, `driver_respond_reschedule` |
| `esign.viewed`, `esign.sign`, `esign.decline` | `driver_mark_esign_viewed`, `driver_submit_esignature`, `driver_decline_esignature` |
| `visit.book`, `visit.cancel`, `appointment.accept`, `appointment.reject`, `appointment.reschedule_request` | `driver_book_visit`, `driver_cancel_visit`, `driver_respond_appointment` |

All of these are Class A: they return `{ok:false, error}` rather than raising, so both outcomes commit normally and every validation failure is already recorded.

### Notifications, profile, security

| Operation key | Source RPC | Note |
|---|---|---|
| `notification.read`, `notification.dismiss` | `driver_mark_notifications_read`, `driver_dismiss_notifications` | marks that change nothing are not logged |
| `profile.avatar` + `security.avatar_key_rejected` | `driver_update_avatar` | a key outside the driver's own prefix is logged as a security event |
| `app.version_change` | `driver_record_app_version` | only when the version actually changes |
| `security.*` | `driver_log_security_event` | mirrors `driver_security_events` into the unified stream |

---

## Deliberate exclusions

These produce no row, on purpose. Each one is a decision, not an oversight.

**1. `not_authenticated`, `not_a_driver`, `driver_not_found`** — unrepresentable, not merely unwanted. `driver_operation_events.driver_id` is a foreign key to `drivers`, and in each of these cases there is no driver row to point at. A caller with no identity cannot be attributed to anyone, so an event would be a row about nobody. Unauthenticated traffic belongs in the PostgREST and auth logs.

**2. Per-fix GPS reports and accepted heartbeats** — `driver_report_location` and `driver_heartbeat` run every few seconds per on-duty driver. At that rate an event per call would outgrow every other stream combined, and a failing one would open a loopback connection per call and exhaust the pool — which is why `log_driver_operation_autonomous` carries a comment forbidding exactly that. Only state changes are recorded: zone entry and exit, and heartbeats rejected for device mismatch. `driver_report_location` failures (`location_required`, `driver_off_duty`, `invalid_tracking_status`, `delivery_id_required`) fall under the same rule.

**3. Read-only RPCs** — `driver_get_home_dashboard`, `driver_get_earnings_summary`, `driver_get_extra_earnings`, `driver_get_attendance`, `driver_get_active_app_release`, `driver_get_delivery_proximity_context`. Reading a screen is not an operation, and their failures (`invalid_period`, `driver_not_found`) describe a malformed query rather than a driver action.

**4. Shared precondition asserts — the one real remaining gap.** `_driver_assert_active_on_duty` (`driver_not_active`, `driver_off_duty`) and `_driver_assert_device_match` (`device_id_required`, `device_revoked`) raise before any delivery RPC reaches its own logic, so a driver blocked by a revoked device leaves no trace. They are excluded for now for two structural reasons: a shared helper does not know which operation the caller was attempting, so every row would have to be filed under the helper rather than under `delivery.complete`; and `_driver_assert_active_on_duty` is declared `STABLE`, so emitting from it would mean changing the volatility of a helper on the delivery hot path. `device_revoked` is the most valuable single event still missing and is the recommended next addition.

**5. Malformed client calls** — `driver_log_security_event` (`event_type_required`, `invalid_severity`) and `driver_record_app_version` (`unsupported_platform`) indicate an app bug, not a driver action.

**6. No-op writes** — marking an already-read notification, or reporting an unchanged app version. These are chatter, and logging them would bury real state changes.

**7. Client-side telemetry** — screen views, taps, offline queue depth, permission prompts. Phase 3, not built. Nothing here depends on it.

---

## Security note on `driver_ops_auditor`

The role that writes failure rows over the loopback holds: no table privileges, no column privileges, no role memberships, no `SUPERUSER` / `CREATEROLE` / `CREATEDB` / `BYPASSRLS` / `REPLICATION`, a connection limit of 5, and `EXECUTE` on exactly one function — `driver_ops_audit.log_driver_operation_remote`, which is `SECURITY DEFINER`, owned by `postgres`, and runs with an empty `search_path`. It lives in its own schema so that granting the auditor access to it does not require `USAGE` on `public`.

It does nonetheless retain `USAGE` on `public`, because that is granted to the `PUBLIC` pseudo-role and no per-role `REVOKE` can remove it. What that leaves reachable is the set of `public` functions still carrying the default `PUBLIC EXECUTE` — the same set `anon` already reaches through PostgREST, and `anon` additionally holds table grants this role does not. The auditor is therefore strictly less privileged than a role whose key ships inside the app. Narrowing that shared surface (auditing `PUBLIC EXECUTE` on `SECURITY DEFINER` functions such as `admin_purge_*` and `claim_super_admin`) is worthwhile, unrelated to this feature, and not attempted here.

---

## Retention

| Stream | Setting | Default |
|---|---|---|
| `driver_operation_events` | `app_settings.driver_ops_log_retention_days` | 90 |
| `driver_location_events` | `app_settings.driver_location_events_retention_days` | 180 |

`/api/cron/driver-ops-retention` runs daily at 01:20, trims both, and reports the audit health probe.

## Known behaviour, not a defect

Zone entry and exit can flap for a driver parked on a geofence boundary — several `location.zone_entry` / `location.zone_exit` pairs within a couple of minutes are normal and were observed in production during verification. Hysteresis or a debounce window would suppress it; that is deferred by decision, not missed.
