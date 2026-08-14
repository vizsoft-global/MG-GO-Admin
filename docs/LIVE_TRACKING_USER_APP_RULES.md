# Live Tracking — User App Rules

The contract between the Flutter duty tracker and the Admin / server side.

§1–§10 describe the shared pipeline, which **V1 `/live-tracking` and V2 `/live-tracking-v2` both depend on**. §11 covers what V2 added on top. Cadence in §1 and §8 changed when V2 shipped; everything else is a straight audit of current behaviour.

Related: [`DRIVER_APP_HANDOFF.md`](DRIVER_APP_HANDOFF.md) (Live Tracking map + Live Tracking V2 edge rail paragraphs).

---

## 1. Cadence (app → server)

| Rule | Value | Source |
|---|---|---|
| FGS tick | **15s** — a **watchdog**, not the sampling clock | [`duty_background_service.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/duty_background_service.dart) `ForegroundTaskEventAction.repeat(15000)` |
| Moving report | **5s fixed** (was 10–15s jittered) | [`adaptive_location_scheduler.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/adaptive_location_scheduler.dart) `movingReportInterval` |
| Idle heartbeat | **30s fixed** (was 45–60s jittered) | same file, `idleReportInterval` |
| Immediate | first on-duty sample, idle→moving, pickup/finish (`delivery_submit`) | `shouldReportToServer` (`force`, `needsInitialReport`, `movementJustStarted`, `deliverySubmit`) |

Android-only foreground service.

**The jitter was removed on purpose.** Randomised spacing is the right call when the server only needs a fresh row, and the wrong one the moment a client interpolates between fixes: a 10–15s window means the renderer cannot know when the next fix is due, so it either lags by the worst case or overshoots and snaps back. §11 depends on the fixed 5s.

Two clocks now exist, and only one of them writes to Postgres:

- **Sampling** is continuous (`positionStream`, 10m `distanceFilter`) and feeds the edge rail at the cadence above.
- **Durable writes** still happen on the 15s watchdog tick via `driver_report_location`, and are *skipped* while a recent edge publish already guarantees the row (`_edgeDurableGrace` = **25s**). State changes, the first sample and `delivery_submit` always write directly.

On a build with no `LIVE_INGEST_URL` the stream is never started, so behaviour collapses to the pre-V2 path: watchdog-driven writes, now due on nearly every tick while moving and every other tick while idle. Server coalescing (§9) is what keeps that from becoming a write storm — a stationary rider still writes at most once per **60s**.

---

## 2. Motion classification

Source: **live GPS fix**, not the last-good indoor pin — [`live_map_heartbeat.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/live_map_heartbeat.dart) `applyLiveMotion` → [`AdaptiveLocationScheduler.updateFromPosition`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/adaptive_location_scheduler.dart).

| Rule | Value |
|---|---|
| Moving | speed **≥ 1.5 m/s** (~5.4 km/h) **or** displacement **≥ 15 m** |
| Stay Moving | until **90s** with no motion **and** speed **< 0.8 m/s** |
| Home speed display | floors below 1.5 m/s to **0** (`displaySpeedMps`) |

Admin mirrors `MOVING_SPEED_THRESHOLD_MPS = 1.5` in [`src/features/locations/location-status.ts`](../src/features/locations/location-status.ts). Overspeed (**60 km/h**) is Admin-only (`OVERSPEED_KMH` in [`src/features/live-tracking/tracking-metrics.ts`](../src/features/live-tracking/tracking-metrics.ts)).

---

## 3. Which coords are sent

[`live_map_heartbeat.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/live_map_heartbeat.dart) `heartbeatPosition` (`coarseGpsAccuracyMeters = 100`):

- Accuracy **≤ 100 m**: send the live fix.
- Coarse indoor **> 100 m**: resend the last-good pin if stationary; if live speed **≥ 1.5 m/s** send the live fix so the Admin pin travels.
- Never skip the report when a last-good pin exists (skipping used to drop the rider after ~8 min).
- Last-good cache updates only when reported accuracy **≤ 100 m** ([`duty_task_handler.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/duty_task_handler.dart)).
- Sampler last-known reject: accuracy **> 80 m** or older than **10s** on the duty tick ([`location_sampler.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/core/geo/location_sampler.dart)).

Motion is always classified from the **live** sample; coords sent may still be last-good.

---

## 4. Status sent to `driver_report_location`

Allowed: `idle` | `moving` | `delivery_submit`.

- While `duty_active_delivery_id` is set: `holdDeliveryStatus()` → always `delivery_submit` (Admin **On Delivery**). `p_delivery_id` is required; `p_active_delivery_id` is the open pickup UUID. `p_force_history = true` on submit.
- After finish/cancel: clear the session id; next tick is idle/moving. Leftover `delivery_submit` without an open pickup is **not** On Delivery.
- Pickup/finish also call `DutyBackgroundService.notifyDeliverySubmitted()` so the FGS forces a sample.

RPC wrapper: [`location_tracking_service.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/location_tracking_service.dart) (`reportLocation` / `reportLocationViaHttp`).

---

## 5. Server coalesce (app must expect this)

- Same status + move **< 18 m**: no pin write; `last_report_at` at most every **60s**.
- Admin realtime moves the pin only on a **full write** (~1s after).
- `coalesced: true` is success — do not treat it as a failed report.

Canonical SQL: [`supabase/migrations/20260908170000_gps_liveness_and_geofence_events.sql`](../supabase/migrations/20260908170000_gps_liveness_and_geofence_events.sql). See §9 for the full contract.

---

## 6. Clock-out vs Location-off vs silent

| Event | App | Admin map |
|---|---|---|
| Clock-out / sign-out | `driver_set_duty_state(false)` — **do not** clear GPS | **Offline immediately**, last pin stays |
| OS Location / permission off | `driver_clear_live_location()` once (on-duty only) | **Removed** in ~15s (not Idle) |
| App/GPS dies, still In | reports stop | **Offline after ~8 min** (`LIVE_GPS_MAX_AGE_MS`); GPS Offline insight **~90s** |

Clock-out / profile sign-out: [`on_duty_gate.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/shift/on_duty_gate.dart), [`sign_out_cleanup.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/auth/sign_out_cleanup.dart). Location-off: [`duty_task_handler.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/duty_task_handler.dart) `_maybeClearLiveLocation`. Keep-pin migration: [`20260912100000_keep_gps_on_clock_out.sql`](../supabase/migrations/20260912100000_keep_gps_on_clock_out.sql). Clear-pin RPC: [`20260913100000_driver_clear_live_location.sql`](../supabase/migrations/20260913100000_driver_clear_live_location.sql).

---

## 7. Other duty-tracker rules

- Mock GPS: block the report and notify (unless security bypass); security log cooldown **2 min** ([`duty_task_handler.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/duty_task_handler.dart)).
- Off-duty report: server raises `driver_off_duty` — do not keep pushing.
- Android-only FGS; extras: heading, battery, network, `active_delivery_id`.
- Admin UI rechecks Offline age every **10s** ([`live-tracking-live-view.tsx`](../src/features/live-tracking/live-tracking-live-view.tsx) `nowTick`).
- Battery restriction: warn only, **never** clocks out (cooldown **3 min**) ([`duty_battery_exemption.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/core/permissions/duty_battery_exemption.dart)).
- Offline queue: FGS HTTP fail → `pending_location_reports` → replay the same status ([`sync_controller.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/core/offline/sync_controller.dart)). Replay goes through the edge first when configured, always with `replay: true` (§11) so a drained queue writes history without moving the live pin.
- Local zone stream: **5 m** filter (UI only) ([`local_zone_monitor.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/local_zone_monitor.dart)).
- Out-of-zone client checkout: **45 min** idle; **20 min** grace after finish outside zone ([`zone_monitor_provider.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/home/zone_monitor_provider.dart)).
- GPS sample per tick: last-known max age **10s**, timeLimit **12s**, last-known reject accuracy **> 80 m**.

---

## 8. Timing cheat-sheet (ops)

| What | Delay |
|---|---|
| Moving pin lag — V1 map | **~15s** (watchdog tick) |
| Moving pin lag — V2 map | **~5s** minus interpolation, so the pin is continuously in motion |
| Idle heartbeat | **~30s** |
| Clock-out Offline | **~1s** (realtime) |
| Silent → Offline chip | **~8 min** (`LIVE_GPS_MAX_AGE_MS`) |
| GPS Offline insight | **~90s** (`GPS_HEARTBEAT_STALE_MS`) |
| Location-off removed from list | **~15s** (next FGS tick + `driver_clear_live_location`) |

---

## 9. Server coalesce (full contract)

Skip the pin write when **all** of these are true ([`20260908170000_gps_liveness_and_geofence_events.sql`](../supabase/migrations/20260908170000_gps_liveness_and_geofence_events.sql)):

- a previous `driver_locations` row exists
- `p_force_history` is false
- status is **not** `delivery_submit`
- last write **< 8 s**
- move **< 18 m**
- same `tracking_status` and same `zone_status`

Otherwise a full UPSERT runs (and `delivery_submit` / first row always write).

| Topic | Rule |
|---|---|
| Stationary liveness | `last_report_at` every **60 s**; `coalesced: true` is success |
| History row (`driver_location_events`) | force, `delivery_submit`, status change, **≥75 m**, or **≥300 s** |
| Distance today | `moving` / `delivery_submit` or speed **≥ 1.0 m/s**; drop segments **> 500 m** (Kuwait day) |
| RPC errors | `driver_off_duty`, `location_required`, `invalid_tracking_status`, `delivery_id_required` |

`driver_clear_live_location`: deletes the caller’s row only while on duty; after clock-out returns `{ cleared: false, reason: "off_duty" }`.

---

## 10. Admin `liveListStatus` (what the app must satisfy)

[`src/features/live-tracking/tracking-status.tsx`](../src/features/live-tracking/tracking-status.tsx) `liveListStatus`, using `latestGpsAt(last_seen_at, last_report_at)`:

1. Blocked → **Blocked**
2. Off duty → **Offline**
3. GPS older than **8 min** → **Offline**
4. `delivery_submit` + open pickup (`activeDeliveryId`) → **On Delivery**
5. `moving` or speed ≥ 1.5 → **Moving**
6. else **Idle**

Also:

- Overspeed insight: **60 km/h**
- Out-of-zone + live GPS → **alert** pin (`derivePinStatus` in [`location-status.ts`](../src/features/locations/location-status.ts))
- Leftover `delivery_submit` without an open pickup is Idle/Moving from speed — never a green On Delivery pin
- In Progress KPI counts only `liveListStatus === delivery_submit`

---

## 11. Live Tracking **V2** — the edge rail

V2 (`/live-tracking-v2`) does not replace anything above. `driver_report_location` remains the durable record; the edge rail is a **second, faster copy** of the same fixes, and V1 keeps reading Postgres exactly as it did.

### App → edge

`POST {LIVE_INGEST_URL}/ingest`, driver Supabase JWT as `Authorization: Bearer`, batched up to **3** fixes ([`live_position_publisher.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/live_position_publisher.dart)).

| Field | Meaning |
|---|---|
| `points[]` | `lat`, `lng`, `accuracy_m`, `speed_mps`, `heading_deg`, `battery_pct`, `network`, `tracking_status`, `active_delivery_id`, `is_mocked`, `captured_at` |
| `points[].replay` | **History only.** A fix drained from `pending_location_reports` must never move the live pin — a reconnecting phone would otherwise teleport its marker back through the last hour |
| `duty_state_version` | Monotonic counter bumped on every clock-in / clock-out ([`duty_session_storage.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/duty_session_storage.dart)) |

`duty_state_version` exists because the batch and the duty state race: a flush in flight when the rider clocks out would re-animate a driver who is already Offline. The Durable Object answers `409 stale_duty_state` to anything older than the version it has seen, and the app treats that as final, not as a retry.

**Unset `LIVE_INGEST_URL` disables the whole rail** (`Env.isLiveIngestEnabled`) — no stream, no publisher, no behaviour change. That is the kill switch, and it needs no server deploy.

### Failure order

1. Edge publish succeeds → the Durable Object flushes to `driver_locations` every **10s**, so the durable row still lands and the watchdog stands down for **25s**.
2. Edge publish fails → the fix goes straight to `driver_report_location` on the same pass, not on the next tick.
3. No network at all → the existing `pending_location_reports` queue, replayed with `replay: true` first via the edge and falling back to the RPC per row ([`sync_controller.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/core/offline/sync_controller.dart)).

### Admin thresholds (V2 only)

Shared by the Worker and the browser from one file, [`src/features/live-tracking-v2/fleet-status.ts`](../src/features/live-tracking-v2/fleet-status.ts), overridable per environment from `app_settings`:

| Threshold | Default |
|---|---|
| Moving | **1.5 m/s** (same as V1) |
| Overspeed | **60 km/h** |
| Low battery | **20%** |
| Stale GPS / GPS offline | **30s** / **90s** |
| Sustained idle | **5 min** |
| Zone hysteresis buffer | **25 m** |
| Shift late grace | **10 min** |

Status is one value; **flags are independent booleans** (`out_of_zone`, `overspeed`, `low_battery`, `mocked_gps`, `shift_late`, …), so "Moving" and "out of zone" no longer have to fight over one pill the way V1's single status does.

Class B events (overspeed, idle, battery, zone, range, shift) are derived at the edge with hysteresis and cooldowns and stored in `fleet_events`; Class A events stay server-authored in `driver_operation_events`. Anything that oscillates on a boundary must produce **one** event, not one per sample — [`scripts/fleet-sim.mjs`](../scripts/fleet-sim.mjs) exists to check exactly that, and prints an explicit `OK` / `SUSPECT` verdict per flap scenario.

---

## RPCs (location / duty)

| RPC | When |
|---|---|
| `driver_report_location` | On-duty heartbeats, pickup/finish |
| `driver_clear_live_location` | OS Location / permission off, still In |
| `driver_set_duty_state` | Clock in/out, profile sign-out |
| `driver_heartbeat` | Device session (not GPS) |
| `admin_ingest_driver_positions` | **Service role only** — the Durable Object's 10s durable flush (V2) |
