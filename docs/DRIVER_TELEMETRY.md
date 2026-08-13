# Driver app client telemetry (Phase 3)

Phase 1/2 answer **what the driver did** — `driver_operation_events`, business
operations, realtime, 90-day retention. This stream answers **what the phone was
doing at the time**: which screen was open, whether a permission was refused,
whether the device went offline and queued. Nothing here modifies Phase 1/2.

| | Phase 1 `driver_operation_events` | Phase 3 `driver_telemetry_events` |
|---|---|---|
| Written by | server RPCs (`log_driver_operation*`) | the app, via one batched RPC |
| Trust | server-authored | client-authored, therefore allowlisted and sanitised |
| Realtime | yes (`supabase_realtime`) | **no** — polled on demand |
| Retention | 90 days | 14 days (`app_settings.driver_telemetry_retention_days`) |
| Admin surface | Live Tracking → **Activity** | Live Tracking → **Diagnostics** |
| Permissions | `driver_ops.view` / `.export` | `driver_telemetry.view` / `.export` |

## Ingestion

```
driver app → local FIFO queue (bounded 2000)
           → batch ≤ 100
           → public.driver_ingest_telemetry(jsonb)   [rider JWT]
           → driver_telemetry_events
```

`driver_ingest_telemetry(p_events jsonb)` is `SECURITY DEFINER`, owner `postgres`,
`SET search_path = ''` with every reference schema-qualified. It returns a result
object instead of raising, so the app can tell "drop this event" from "retry
later", and so **no autonomous dblink logging is involved anywhere in this
phase** (that path opens a connection per call and must never touch a
high-volume client path).

Per-event body (all optional except the three marked):

| field | notes |
|---|---|
| `event_id` | **required**, client UUID v4 generated at enqueue — the idempotency key |
| `event_name` | **required**, must exist and be active in `driver_telemetry_event_types` |
| `client_ts` | **required**, stamped at enqueue, not at flush; rejected beyond ±7 days |
| `session_id`, `correlation_id` | truncated to 64 chars |
| `platform`, `network_state` | truncated to 16 chars |
| `app_version_name` | truncated to 32 chars |
| `app_version_code` | falls back to `drivers.current_app_version_code` |
| `severity` | `info` \| `warn` \| `error`; forced to `error` for `client.error` |
| `context` | sanitised object, ≤ 1024 chars after sanitising |

`driver_id` is **always** `auth.uid()`. A `driver_id` in the body is ignored.
`device_id` is stamped from `drivers.active_device_id`.

Result: `{ok, accepted, duplicates, rejected, throttled, rejects:[{event_id, reason}]}`.

| outcome | app behaviour |
|---|---|
| `ok:false, error:'not_authenticated'` | keep the queue, flush after login |
| `ok:false, error:'batch_too_large'` \| `'invalid_payload'` | split / fix, this is a client bug |
| `ok:true, throttled:true` | **clear the batch**, do not retry — the hourly quota is closed |
| `rejects[]` entry | delete that one event permanently |
| network / 5xx | retry with backoff 5s, 15s, 60s, 300s, then wait for the next trigger |

Caps: 100 events per call, 1024-char `context`, ±7 day clock window, and
`app_settings.driver_telemetry_max_events_per_hour` (default 2000) per driver.

## Event catalog and permitted context keys

Bounded names with the detail in `context` — `screen.open` + `context.screen`,
not `delivery_screen.open` — so the allowlist cannot grow with every app screen.

| event | category | permitted context keys |
|---|---|---|
| `app.startup` | lifecycle | `cold_start`, `boot_ms` |
| `app.foreground` | lifecycle | `screen`, `duration_ms` |
| `app.background` | lifecycle | `screen`, `duration_ms` |
| `app.client_info` | lifecycle | `platform`, `os_version`, `device_model`, `app_version_name`, `app_version_code`, `locale` |
| `screen.open` | screen | `screen`, `from_screen`, `load_ms` |
| `action.tap` | action | `action`, `screen`, `result` |
| `permission.location_granted` | permission | `status`, `screen`, `is_permanent`, `attempt` |
| `permission.location_denied` | permission | same |
| `permission.notification_granted` | permission | same |
| `permission.notification_denied` | permission | same |
| `permission.camera_denied` | permission | same |
| `network.offline` | network | `network_state`, `offline_ms` |
| `network.online` | network | `network_state`, `offline_ms` |
| `queue.created` | queue | `queue`, `depth`, `dropped`, `reason` |
| `queue.flushed` | queue | `queue`, `depth`, `batch_count`, `flush_ms`, `reason` |
| `client.error` | client_error | `code`, `screen`, `http_status`, `retryable` |

`action.tap` is for **decision-grade** taps only: clock in/out, pickup submit,
finish submit, retry, sign out. No per-render, per-scroll or per-keystroke events.

Explicit non-goal: **no telemetry mirror of a business operation.** `duty.*`,
`delivery.*`, `request.*` and `esign.*` stay server-authored in Phase 1.

## The context contract is enforced, not documented

`public._telemetry_sanitize_context(text, jsonb)` runs on every event, before the
size check and before the insert. Four rules, in order:

1. **Per-event key allowlist** — anything outside that event's `context_keys` is
   stripped. Stripping rather than rejecting keeps an older or newer build's
   timeline usable; `context_stripped_keys` on the row makes the mismatch visible
   in Admin.
2. **Key denylist, applied even to allowlisted keys** — `token`, `password`,
   `passcode`, `secret`, `bearer`, `jwt`, `refresh`, `phone`, `mobile`, `msisdn`,
   `civil`, `national_id`, `iqama`, `address`, `street`, `email`, `stack`,
   `traceback`, `message`, `cookie`, `payload`, `header`, `body`, `auth` as
   substrings, plus `pin`, `otp`, `lat`, `lng`, `latitude`, `longitude`, `iban`,
   `dob` as whole words. A second line of defence against a mis-seeded allowlist.
3. **Scalars only** — nested objects and arrays are dropped. This is what
   structurally prevents a stack trace, a headers map or a request body landing.
4. **Value bounds** — strings truncated to 120 chars; the identifier-shaped keys
   `screen`, `from_screen`, `action`, `code`, `queue`, `reason`, `result`,
   `status`, `network_state` must match `^[a-z][a-z0-9_.-]{0,63}$` or they are
   stripped, so a free-form sentence or a phone number cannot ride in on a legal
   key.

`client.error` has **no** `message` and no `stack` key. Send a short stable code
(`timeout`, `parse_failed`, `upload_failed`), the screen, and optionally an HTTP
status. Full errors belong in the app's own crash reporter.

Withdrawing a key is a data change:

```sql
update public.driver_telemetry_event_types
   set context_keys = array_remove(context_keys, 'load_ms')
 where name = 'screen.open';
```

## Security posture

- `driver_id` only ever from `auth.uid()`.
- **No** INSERT/UPDATE/DELETE policy on `driver_telemetry_events` for any role —
  a driver cannot forge, edit or erase telemetry, their own or anyone else's.
  Staff SELECT requires `is_admin_panel_user()`.
- Grants are explicit, not inherited from Postgres' `PUBLIC EXECUTE` default:

  ```sql
  REVOKE ALL ON FUNCTION public.driver_ingest_telemetry(jsonb) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.driver_ingest_telemetry(jsonb) TO authenticated;
  REVOKE ALL ON FUNCTION public._telemetry_sanitize_context(text, jsonb) FROM PUBLIC, anon, authenticated;
  ```

  Repeat that block after any future `DROP FUNCTION` + recreate: `CREATE OR
  REPLACE` keeps the ACL, a `DROP` resets it to the `PUBLIC` default.
- Both functions run `SET search_path = ''` with fully qualified references, so a
  shadowing object in another schema cannot hijack a call made with `postgres`
  privileges.
- The sanitiser needs no grant at all: the ingest RPC runs as its definer, which
  owns it, so the inner call succeeds while no client role can reach it directly.

## Retention and realtime

- 14 days by default, trimmed by `cleanup_driver_telemetry_events` via
  `/api/cron/driver-telemetry-retention` at `40 1 * * *` — deliberately a
  separate cron from `/api/cron/driver-ops-retention` (`20 1 * * *`), which also
  carries the Phase 1 autonomous-audit health probe.
- The table is **not** in `supabase_realtime`. Diagnostics has a Refresh button
  and an opt-in 20s poll that runs only while the tab is mounted.

## Kill switches (no deploy needed)

| goal | action |
|---|---|
| Hide the tab | revoke `driver_telemetry.view` from the roles |
| Stop one noisy event | `update driver_telemetry_event_types set is_active = false where name = '…'` |
| Stop all ingestion | `update app_settings set driver_telemetry_max_events_per_hour = 0 where id = 1` |
| Withdraw a context key | `update driver_telemetry_event_types set context_keys = …` |

Ingestion stopping is not an error for the driver: the app is told `throttled` or
given a reject reason and drops the batch. Telemetry is best-effort by design and
never blocks a driver action.
