# Live Tracking — User App Rules

Audit of the Flutter duty tracker and the Admin / server contract. No behavior change — reference only.

Related: [`DRIVER_APP_HANDOFF.md`](DRIVER_APP_HANDOFF.md) (Live Tracking paragraph).

---

## 1. Cadence (app → server)

| Rule | Value | Source |
|---|---|---|
| FGS tick | **15s** | [`duty_background_service.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/duty_background_service.dart) `ForegroundTaskEventAction.repeat(15000)` |
| Moving report | **10–15s** (`10 + random(0–5)`) | [`adaptive_location_scheduler.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/adaptive_location_scheduler.dart) `_intervalForStatus(moving)` |
| Idle heartbeat | **45–60s** (`45 + random(0–15)`) | same file, `_intervalForStatus(idle)` |
| Immediate | first on-duty sample, idle→moving, pickup/finish (`delivery_submit`) | `shouldReportToServer` (`force`, `needsInitialReport`, `movementJustStarted`, `deliverySubmit`) |

Android-only foreground service. Scheduler `tickInterval` is also 15s; the FGS repeat is what actually drives `_tick()`.

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
- Offline queue: FGS HTTP fail → `pending_location_reports` → replay the same status ([`sync_controller.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/core/offline/sync_controller.dart)).
- Local zone stream: **5 m** filter (UI only) ([`local_zone_monitor.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/local_zone_monitor.dart)).
- Out-of-zone client checkout: **45 min** idle; **20 min** grace after finish outside zone ([`zone_monitor_provider.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/home/zone_monitor_provider.dart)).
- GPS sample per tick: last-known max age **10s**, timeLimit **12s**, last-known reject accuracy **> 80 m**.

---

## 8. Timing cheat-sheet (ops)

| What | Delay |
|---|---|
| Moving pin lag | **~10–15s** |
| Idle heartbeat | **~45–60s** |
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

## RPCs (location / duty)

| RPC | When |
|---|---|
| `driver_report_location` | On-duty heartbeats, pickup/finish |
| `driver_clear_live_location` | OS Location / permission off, still In |
| `driver_set_duty_state` | Clock in/out, profile sign-out |
| `driver_heartbeat` | Device session (not GPS) |
