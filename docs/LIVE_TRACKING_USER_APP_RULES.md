# Live Tracking — User App Rules

The contract between the Flutter duty tracker and the Admin / server side.

§1–§10 describe the shared pipeline, which **V1 `/live-tracking` and V2 `/live-tracking-v2` both depend on**. §11 covers what V2 added on top. Cadence in §1 and §8 changed when V2 shipped; everything else is a straight audit of current behaviour.

Related: [`DRIVER_APP_HANDOFF.md`](DRIVER_APP_HANDOFF.md) (Live Tracking map + Live Tracking V2 edge rail paragraphs).

---

## 1. Cadence (app → server)

| Rule | Value | Source |
|---|---|---|
| FGS tick | **15s** — a **watchdog**, not the sampling clock | [`duty_background_service.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/duty_background_service.dart) `ForegroundTaskEventAction.repeat(15000)` |
| Moving report | **1s fixed** (was 5s; before that 10–15s jittered) | [`adaptive_location_scheduler.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/adaptive_location_scheduler.dart) `movingReportInterval` |
| Idle heartbeat | **30s fixed** (was 45–60s jittered) | same file, `idleReportInterval` |
| Edge batch | **2 fixes, or ≤2s** — whichever comes first | [`live_position_publisher.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/live_position_publisher.dart) `LiveCadence.batchSize` / `maxBufferHold` |
| Immediate | first on-duty sample, idle→moving, pickup/finish (`delivery_submit`) | `shouldReportToServer` (`force`, `needsInitialReport`, `movementJustStarted`, `deliverySubmit`) |

Android-only foreground service.

**The jitter was removed on purpose.** Randomised spacing is the right call when the server only needs a fresh row, and the wrong one the moment a client interpolates between fixes: a 10–15s window means the renderer cannot know when the next fix is due, so it either lags by the worst case or overshoots and snaps back. §11 depends on the fixed interval.

**Why 1Hz, and why idle did not follow.** The V2 renderer draws one buffer *behind* the newest fix so it interpolates between two known points instead of predicting past the last one. At 5s spacing that buffer would have to be seconds long to work, which is visible lag; at 1Hz a ~1.2s buffer both hides the network and stays continuously between fixes. Idle stayed at **30s** deliberately: a parked phone at 1Hz is the same coordinate thirty times over, and each copy costs a Durable Object turn to learn nothing. Batching 2 fixes halves the request rate without adding lag, because each point carries its own `client_ts` — a batch is not a coarser trail.

Two clocks now exist, and only one of them writes to Postgres:

- **Sampling** is continuous (`positionStream`, `distanceFilter: 0` with `AndroidSettings.intervalDuration` = 1s) and feeds the edge rail at the cadence above. A distance filter and a fixed rate are mutually exclusive, and the rate is what the renderer needs; a stationary rider is handled by the 30s idle interval rather than by starving the stream.
- **Durable writes** still happen on the 15s watchdog tick via `driver_report_location`, and are *skipped* while a recent edge publish already guarantees the row (`_edgeDurableGrace` = **25s**). State changes, the first sample and `delivery_submit` always write directly.

On a build that passes `LIVE_INGEST_URL=""` the stream is never started, so behaviour collapses to the pre-V2 path: watchdog-driven writes, now due on nearly every tick while moving and every other tick while idle. Server coalescing (§9) is what keeps that from becoming a write storm — a stationary rider still writes at most once per **60s**.

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

[`live_map_heartbeat.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/live_map_heartbeat.dart) `heartbeatPosition` (`coarseGpsAccuracyMeters = 50`):

- Accuracy **≤ 50 m**: send the live fix.
- Coarse **> 50 m**: resend the last-good pin if stationary; if live speed **≥ 1.5 m/s** send the live fix so the Admin pin travels. A **forced** tick does not override this — forcing decides *when* to report, not which fix to trust.
- The threshold was 100, which is exactly what Android's **network** provider reports from a cell tower that can be 600m away. Those fixes passed the gate, ping-ponged the admin pin and inflated `distance_today_meters` (65 km logged for a rider who stayed in one block). A real GPS fix degrades to ~20-40 m in an urban canyon, so 50 keeps every usable fix and rejects the tower. Mirrored by `COARSE_FIX_ACCURACY_M` in the fleet room and by the `accuracy_meters <= 50` exclusions in `admin_get_driver_day_route` / the odometer gate.
- The last-good pin only outranks a coarse fix for **2 minutes** (`coarseGpsHeartbeatMaxAge`); past that an honestly approximate pin beats a confidently old one.
- Never skip the report when a last-good pin exists (skipping used to drop the rider after ~8 min).
- Last-good cache updates only when reported accuracy **≤ 50 m** ([`duty_task_handler.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/duty_task_handler.dart)).
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
| Moving pin lag — V2 map | **~1.2s** — one adaptive render buffer behind the newest fix, and continuously in motion between fixes rather than jumping on arrival |
| Idle heartbeat | **~30s** |
| Trail window — V2 map | **10 min** per rider, held in the Durable Object (nothing to query, nothing persisted) |
| `driver_locations` rows while moving | **~17/min/rider** — the flush gate keeps 1Hz from becoming ~60/min, and the rate does not scale with speed |
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

`POST {LIVE_INGEST_URL}/ingest`, driver Supabase JWT as `Authorization: Bearer`, batched **2** fixes or ≤2s ([`live_position_publisher.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/live_position_publisher.dart)).

| Field | Meaning |
|---|---|
| `points[]` | `lat`, `lng`, `accuracy_m`, `speed_mps`, `heading_deg`, `battery_pct`, `network`, `tracking_status`, `active_delivery_id`, `is_mocked`, `captured_at` |
| `points[].heading_source` | `gps` / `compass` / `none` — where `heading_deg` came from. Absent on pre-fusion builds, which the Worker reads as `gps` when a bearing is present, so their markers keep rotating |
| `points[].compass_deg` | Smoothed compass bearing, sent alongside the fused value. Edge only; the durable RPC has a fixed signature and provenance is a live-map concern, not history |
| `points[].replay` | **History only.** A fix drained from `pending_location_reports` must never move the live pin — a reconnecting phone would otherwise teleport its marker back through the last hour |
| `duty_state_version` | Monotonic counter bumped on every clock-in / clock-out ([`duty_session_storage.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/duty_session_storage.dart)) |

### Heading (fused)

[`heading_fuser.dart`](C:/Users/Admin/Desktop/Vizsoft/MGgo(DPD)-USER/MG-GO/lib/features/duty/heading_fuser.dart) is a pure function with an injected clock, so every rule below is unit-tested without a sensor.

| Rule | Value |
|---|---|
| GPS course wins | course ≥ 0 **and** speed **≥ 1.0 m/s**, aged out after **6s** |
| Compass fills the gap | only when there is no usable course; dropped after **3s** of silence or reported accuracy worse than **±45°** |
| Compass smoothing | low-pass **0.2** per sensor event (~20Hz) |
| Published slew ceiling | **90°/s** |
| No bearing at all | `heading_source: none`, and the admin marker holds its previous bearing |

A GPS course is published **unfiltered** — a bike genuinely turns 90° in a second, and slew-limiting that would leave the marker pointing down the street the rider just left. The ceiling exists for the compass path, where a magnet near the mount or the gps→compass handover at a red light would otherwise spin the marker.

`heading_deg` keeps its existing meaning (the fused value), so nothing downstream of it changed. **The compass reports phone orientation, not bike orientation** — a phone flat in a delivery bag says nothing about where the bike is headed, which is the whole reason the GPS course stays authoritative while moving and the admin card labels the source.

`duty_state_version` exists because the batch and the duty state race: a flush in flight when the rider clocks out would re-animate a driver who is already Offline. The Durable Object answers `409 stale_duty_state` to anything older than the version it has seen, and the app treats that as final, not as a retry.

**`LIVE_INGEST_URL` defaults to the production Worker**, and the kill switch is passing it as an **empty string** — then `Env.isLiveIngestEnabled` is false and there is no stream, no publisher and no behaviour change. It needs no server deploy.

It defaults on because absent-means-off was silently catastrophic: Supabase, the admin API and Firebase all default to the production stack, so a release built without `--dart-define-from-file=env/prod.json` worked in every visible way while publishing not one fix to the edge — two `/ingest` requests in two days against 492 admin socket connections. On the admin side that looked like a healthy page: frozen pins, a speed left over from the last durable write, and statuses that changed when the room next re-read the roster.

**What a silent rail now looks like in the admin.** A socket that answers `ping` is not a socket delivering a fleet, so the page measures the rail in *positions*: 45s with drivers on duty and no position frame marks the connection `degraded` / `no_live_positions`, starts the 10s snapshot poll *underneath* the still-open socket, and says so on the pill. Separately, the admin re-ages statuses every second on its own clock, so `gps_offline` lands at its threshold whether or not anything is still arriving — a rider whose phone dies at speed stops reading Moving on time rather than at the next roster read.

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

Class B events (overspeed, idle, battery, zone, range, shift) are derived at the edge with hysteresis and cooldowns and stored in `fleet_events`; Class A events stay server-authored in `driver_operation_events`. Anything that oscillates on a boundary must produce **one** event per cooldown window, not one per sample — [`scripts/fleet-sim.mjs`](../scripts/fleet-sim.mjs) exists to check exactly that, and prints an explicit `OK` / `SUSPECT` verdict per flap scenario.

### Trails and marker (V2 only)

| Rule | Value |
|---|---|
| Trail window | **10 min** per rider, in Durable Object memory — never persisted, never queried per client |
| Trail point gate | ≥ **5 m** or ≥ **3s** from the last kept point, both edge and client side |
| Trail delivery | one `trail` frame the first time a rider enters a socket's view; extended from the delta frames that socket already receives |
| Trail colour | deterministic per rider, so two riders on one street stay tellable apart |
| Trail draw floor | a trail whose bounding box spans **< 25 m** is not drawn at all. The point gate keeps a parked phone's jitter (the "≥3s" half fires whether or not the rider moved), and drawn, ~200 of those points are a coloured blob sitting on the marker — which is what an operator reads as several drivers of several statuses. Suppressed for the selected rider too: their history is the route polyline, drawn from the durable record |
| Marker | top-down vehicle sprite on a status-coloured puck, rotated by `heading_deg`; holds the last bearing when a fix carries none |
| Route furniture | stops and the playback playhead are **hollow** rings — white centre, colour in the stroke. A filled coloured disc means "a rider is here, and this is their status" on this map, so anything that is not a rider gets the inverse treatment |

### On Delivery, and where the open delivery comes from (V2)

`fleetStatus` returns `on_delivery` whenever `activeDeliveryId` is set, and **not** only when `tracking_status = 'delivery_submit'`. Requiring both made the status practically unreachable: the app stamps `delivery_submit` when a pickup is logged and the very next position sample overwrites it with `moving` or `idle`, so the admin saw On Delivery for one frame at best.

That works because the id is no longer the phone's claim. `admin_live_fleet_snapshot` reads it from `deliveries` (`status = 'in_transit'`, newest first) rather than from `driver_locations.active_delivery_id`, which is only as fresh as whatever the last fix carried — usually nothing, because the foreground service reads it from a `SharedPreferences` cache belonging to a different isolate than the one that stored it.

Consequences worth knowing when reading the room's code:

- An ingest may **announce** a delivery the roster has not read yet, but it may never **clear** one. Honouring a `null` from the phone is what kept the status off the map; the clear comes from the roster.
- `delivery.*` operations join `duty.*` in the ops relay's roster-refresh trigger, so a pickup shows up in seconds rather than waiting out the 60s roster TTL.
- A roster read can change a driver's status with no new position at all (an opened delivery, a clock-in, a block), so `posVersion` is bumped when it does — status rides the position frame.

### Coarse fixes and "distance today"

One threshold, **50 m**, applied in four places: the app's heartbeat, the room's ingest (a coarse fix does not move a pin that has an accurate fix newer than 2 minutes — deferred, not dropped, so the durable history keeps what the device said), the odometer gate in both writers, and the day route's point selection.

`distance_today_meters` is now the single "distance today" everywhere: the driver card reads it from the snapshot, and `admin_get_driver_day_route` returns it as `distance_m` **for today** (a past day falls back to the sampled sum, which is also always available as `sampled_distance_m`, with `distance_source` naming which one you got). Before this the card showed the odometer and the panel showed the sampled sum — 4.6 km against 3.5 km on the same rider, and 65.7 km against 7.1 km on another, because the odometer was adding a few hundred metres every time the phone swapped to a network fix. Both writers now refuse a segment that touches a coarse fix or implies more than 40 m/s.

Deriving the card's figure from the sampled history instead was the other option, and was rejected on cost: history is written at 75 m spacing, so a 500-rider day is ~350k rows, and the snapshot is called every 60s by the room and every 10s per client by the polling rail. The odometer is maintained in O(1) per fix by code that already holds both endpoints of the segment.

### Durable write rate under 1Hz

The room flushes to `driver_locations` every 10s, thinning each batch first ([`fleet-room.ts`](../infra/workers/dpd-live/src/fleet-room.ts) `downsampleForDurability`): the first and last point of a batch always survive, as does anything significant (status change, `delivery_submit`, mocked, replay); everything else needs **≥5s and ≥5m** since the last kept point.

Both halves of that gate matter. Time alone would keep a parked phone's duplicates; distance *as an alternative trigger* — the first cut — made the write rate scale with speed, ~23 rows/min for a rider at 35km/h against 12 at the old cadence. As a joint requirement the ceiling is one row per 5s per rider whatever the speed, landing at ~17 rows/min. Nothing reads `driver_locations` at finer resolution: the day route simplifies it in PostGIS, and the live map takes its points from the room.

### Capacity

`node --import tsx scripts/fleet-sim.mjs --target room --drivers 500 --cadence 1000 --batch 2 --duration 90` runs the real `FleetRoom` in-process with Supabase stubbed at the `fetch` boundary. A Durable Object is single-threaded, so the number that decides capacity is CPU per second, not mean latency.

| Cadence | Requests/s | Room CPU p50 / p95 per budget | Load |
|---|---|---|---|
| 5s (pre-1Hz) | 100 | 321ms / 892ms per 5000ms | 18% |
| **1s** | **250** | **239ms / 374ms per 1000ms** | **37%** |

One room absorbs 500 riders at 1Hz with ~2.7x headroom, so `FLEET_ROOM` is **not** sharded. Re-run this before raising the cadence again or the fleet past ~1000 riders; the figures exclude workerd's own request overhead and real network.

---

## RPCs (location / duty)

| RPC | When |
|---|---|
| `driver_report_location` | On-duty heartbeats, pickup/finish |
| `driver_clear_live_location` | OS Location / permission off, still In |
| `driver_set_duty_state` | Clock in/out, profile sign-out |
| `driver_heartbeat` | Device session (not GPS) |
| `admin_ingest_driver_positions` | **Service role only** — the Durable Object's 10s durable flush (V2) |
