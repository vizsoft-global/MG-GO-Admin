# Home dashboard reads — steps 1 to 4

Scope: the Firestore **read** work on the rider Home call only. Out of scope in
this file: Cloudflare, HomeRoom, R2 history, and step 5 (the write tier).

Companion to [firestore-read-reduction-plan.md](./firestore-read-reduction-plan.md)
(untouched by this file), [firestore-cost-reduction.md](./firestore-cost-reduction.md),
[firestore-billing-explained.md](./firestore-billing-explained.md) and
[firestore-cost-baseline.md](./firestore-cost-baseline.md).

## 1. Where we are, and the target

| Metric | Value |
|---|---|
| Warm `driverGetHomeDashboard` | **25 documents**, about **34 billed reads** (9 aggregates bill extra) |
| Cold call (isolate fill) | ~373 documents |
| Production read line | ~1.2B — this is **call volume**, about **2.3M calls a day**, not per-call waste |
| Target after steps 1–2 | 25 documents per call, but a handful of callers per rider per day |
| Target after step 3 | **4 documents per call** |
| Target after step 4 | cold fill ~373 → ~47 |

The rider-day arithmetic that closes the gap:

```
900 riders × ~6 calls/day × 4 reads = ~21,600 reads/day (~22K)
```

That is inside the 50K/day free tier with room for the `drivers/{uid}` watcher.
Everything below exists to make those three factors true at once: fewer calls
(step 1), fewer calls on repeat opens (step 2), fewer reads per call (step 3),
and a cheaper cold start so the steady state can afford the cache (step 4).

## 2. Hard constraints — rules, not preferences

1. **Do not change `POSTGRES_FLUSH_MS` or `FLUSH_MIN_GAP_MS`.** Live Tracking
   does not call Home; its cadence is not a lever for this plan.
2. **Never cache** `drivers.is_on_duty`, `session.is_online`,
   `force_app_update` / `force_app_update_min_code`, `shift_adherence`,
   `today_online_seconds`. These come from the watcher or a fresh call, always.
3. **`daily_dpd` and `daily_dpd_targets` stay computed in the RPCs.** Home
   displays them; it is never the source of truth for money or targets.
4. **The day key is `shift_date`.** Not the calendar day, not the Kuwait
   midnight of the response.
5. **Writers land before the read path flips.** A snapshot whose writers are
   incomplete undercounts silently; shipping the read side first is how that
   becomes a support ticket at 08:00.

## 3. Step 1 — event-driven refresh

The call volume exists because the phone asks on a timer, not because the data
changed. The fix is one refresh signal per real event.

### Server (this repo)

Push envelopes already carry `action_params.record_type`
(`dpd_target` | `compliance` | `delivery` | `esign` | `visit` | `appointment`;
see [`docs/DRIVER_APP_HANDOFF.md`](../DRIVER_APP_HANDOFF.md) §563, §595).

Add a **data-only** push with `record_type: 'home'` — no title, no body, no tray
item; it is a refresh signal, not a message — from the duty writes that change
Home but currently notify nothing:

| Writer | Where |
|---|---|
| Server auto-checkout / checkout | `applyRiderCheckout` — [`functions/src/rpcs/driver-home.ts`](../../functions/src/rpcs/driver-home.ts) L1249 |
| Blocked toggle | `set_driver_blocked` — [`functions/src/rpcs/drivers.ts`](../../functions/src/rpcs/drivers.ts) L1170 |
| Inactive-status clock-out | the status write path that clears duty |
| Admin duty correction | the admin attendance/duty edit |

The existing notice builders already produce this envelope shape —
`deliveryDecisionNotice` sets `actionParams.record_type`
([`delivery-notify.ts`](../../functions/src/rpcs/delivery-notify.ts) L25), and the
operation log stores the same key ([`_shared.ts`](../../functions/src/rpcs/_shared.ts)
L272). Reuse the existing driver send helper with a **silent** variant (empty
title/body) instead of adding a second push format.

Old app builds ignore an unknown `record_type`, so this half can ship alone.

### App (MG-GO, separate repo, Play release)

* Remove the periodic Home poll.
* Refresh on: app open, app resume, clock-in, clock-out, pickup, complete, and an
  FCM `record_type` in `{home, dpd_target, compliance, delivery}`.
* Keep **one** realtime watcher on `drivers/{uid}` for `is_on_duty`,
  `force_app_update*`, `zone_id`, `partner_id`. Without it a server-side
  auto-checkout leaves the toggle showing *In* and the rider taps a dead
  Deliver button.
* Gate the poll removal behind an `app_settings` flag so a bad build reverts
  without a Play release. The key is `app_settings/1.home_poll_enabled`: absent
  or `false` keeps Home event-driven, `true` restores the old 60-second poll.

**Acceptance:** Home refreshes at least once per duty transition and once per
silent push; an auto-checkout shows in the toggle within one watcher event;
`docsRead` p50 is unchanged at 25 per call while calls per rider-day fall.

## 4. Step 2 — phone cache and epoch

Even with step 1, a rider who opens Home four times in ten minutes pays four
calls. Cache the response on the phone, and make the cache invalidate for the
right reasons.

**Server.** Add two fields to the Home payload in `loadRiderHomeDashboard`
([`driver-home.ts`](../../functions/src/rpcs/driver-home.ts) L1138, returned at
L1212; the callable wrapper is L1338):

* `config_epoch` — the `config` counter already read once per call via
  `readConfigEpochs()` from `auth_epochs/current`
  ([`config-cache.ts`](../../functions/src/core/config-cache.ts) L32, L61).
* `server_day` — the Kuwait day and the `shift_date` the payload was built for.

**App.** Cache the payload for 5–15 minutes keyed on **uid + shift day +
`config_epoch`**. The five live fields listed in §2 rule 2 are never served from
this cache: they come from the `drivers/{uid}` watcher, or from a fresh call.

A rule or banner edit in the panel bumps `auth_epochs/current.config`, so the
next open misses the cache and shows the edit — no waiting out a TTL. Keying on
the shift day as well as the Kuwait day stops a 01:00 open from showing
yesterday's counters.

**Acceptance:** a second open inside the window costs zero reads; a config edit
is visible on the next open; no live field is ever stale by more than one
watcher event.

## 5. Step 3 — one snapshot document, behind a flag

This is the per-call win. Today's warm call re-reads 25 real per-rider rows.

New collection `driver_home_daily/{driverId}_{shiftDate}`:

```
week:        { deliveries_count, online_seconds, earnings_kwd,
               invalid_days, rejected_orders, cancelled_orders }
performance: { total, verified, pending, in_transit, rejected, cancelled }  // lifetime
session:     { is_online, went_online_at, speed_mps, distance_today_meters,
               elapsed_base, open_since }
shift:       { shift_adherence block, online_seconds_base }
updated_at, updated_at_ms, version, schema_version, shift_date,
stale, stale_reason, stale_at_ms
```

`daily_dpd` / `daily_dpd_targets` are **not** stored here — §2 rule 3.

### One rebuild, many callers — writers invalidate, the read path recomputes

`rebuildDriverHomeDaily(driverId, day, reason)` is **idempotent** and recomputes
the whole document from source. It is the only implementation: the read path,
the hourly repair and any manual repair all call it.

Writers do **not** call it. A full recompute costs ~35 document reads (week
aggregates, six lifetime counts, seven compliance rows, sessions, adherence), so
recomputing on every pickup and complete would cost *more* reads than the Home
calls it saves — six events × 35 is worse than six calls × 25. Each writer
instead writes one flag (`stale: true`, `stale_reason`, `stale_at_ms`), and the
next Home call — which has to produce the new numbers anyway — recomputes and
rewrites the document at **no extra read**. An invalidation for a rider with no
document is a single `update()` that returns `not-found`: no read, no write.

Callers that invalidate:

| Event | Source |
|---|---|
| Duty change and checkout | `driverSetDutyState`, `applyRiderCheckout`, `applyCheckout` |
| Pickup | `driverCreatePickup` |
| Complete | `driverCompleteDelivery` |
| Cancel / expire | `driverCancelDelivery` and `adminExpireStalePickups` |
| Admin verify and bulk status | `adminBulkUpdateDeliveries` |
| Compliance upload | `adminNotifyComplianceRefresh` |
| Earnings recalc | `recalculateDriverEarnings` (today only) |
| Blocked / account status | `set_driver_blocked`, `set_driver_account_status` |

### Online seconds

`today_online_seconds` is stored as `elapsed_base` plus `open_since`. The client
adds the open interval; the server reconciles the total at checkout. Two writers
must never both add the same seconds.

### Staleness fallback — this is what makes the flag safe

The snapshot is served only when all of these hold: `schema_version` matches,
`stale` is not `true`, `shift_date` is today, `zone_id` / `partner_id` still
match the driver document, and `updated_at_ms` is **within 30 minutes**.

Otherwise the RPC takes today's 25-document path and rewrites the snapshot from
the values it just computed. An hourly repair cron walks on-duty riders and
rebuilds anything missing or stale, so one missed writer is wrong for at most an
hour, not until midnight.

### Rollout

* Flags: `app_settings/1.home_snapshot_enabled` and `home_snapshot_shadow`, both
  **default off**. `app_settings` is the `1` document (`APP_SETTINGS_DOC_ID` in
  [`settings.ts`](../../functions/src/core/settings.ts) L4); the typed reader is
  `loadHomeSnapshotFlags`, because `loadAppSettings` only lifts known
  numeric/string keys and would drop a boolean silently. Both are cached in the
  isolate under `auth_epochs/current.config`, so a flip costs no read per call.
* Shadow week: `home_snapshot_enabled: true` + `home_snapshot_shadow: true`. The
  RPC serves the snapshot, computes the source path as well, and logs a
  `perf:"home"` line naming any field that disagreed. Clear the shadow flag
  after the week.
* Expected warm call once flipped: `drivers` + `profiles` + `auth_epochs` +
  `driver_home_daily` = **4 documents**.

**Acceptance:** warm `docsRead` p50 is 4–5, zero mismatch lines for a full
weekday in shadow mode, and the fallback path is exercised at least once
(delete one doc in staging).

## 6. Step 4 — runtime options for the callable

`measureOnCall` ([`functions/src/core/fs-metrics.ts`](../../functions/src/core/fs-metrics.ts)
L223) takes **no options**, so `driverGetHomeDashboard` inherits every global:
`cpu: 0.08`, `concurrency: 1`, `maxInstances: 2`, `memory: "256MiB"` from
[`functions/src/core/init.ts`](../../functions/src/core/init.ts) L31. The
consequence is structural, not cosmetic: **every rider gets a private isolate
and pays the ~373-document cold fill.**

Add an options argument to `measureOnCall` and pass it through to `onCall`:

```ts
export function measureOnCall<T>(
  name: string,
  handler: (request: CallableRequest<unknown>) => Promise<T>,
  options?: CallableOptions,
) {
  return onCall(options ?? {}, (request) =>
    runWithFsMetrics(name, () => handler(request)));
}
```

Then give the Home callable its own shape:

| Option | Value | Why |
|---|---|---|
| `region` | `FUNCTIONS_REGION` | stay on `me-central1` (init.ts L15); pass it explicitly so the override cannot drift |
| `cpu` | `1` | gen2 rejects `concurrency > 1` below one full CPU — the deploy fails outright |
| `memory` | `"1GiB"` | 8 concurrent handlers sharing one config cache |
| `concurrency` | `8` | one config fill serves 8 riders, ~373 → ~47 `docsRead` per call |
| `maxInstances` | `20` | size for the 08:00 shift-start herd: 8 × 20 = 160 in flight |
| per-read timeout | per Firestore call | one hung read must not block 8 riders |

`driverSetDutyState` gets the **same CPU and concurrency shape only if** a read
of its handler shows it can safely overlap — it writes a batch, an attendance
rollup and a session, and a shared-cache concurrency win does not justify making
a write path concurrent.

Do **not** route this through `adminApi`. `isDriverAppCallable`
([`functions/src/router/lanes.ts`](../../functions/src/router/lanes.ts) L137)
excludes every `driver*` name; the lane takes `{fn, data}` and a 60s client
timeout, which is an app release for zero read benefit.

**Acceptance:** the cold-call `docsRead` moves from ~373 to ~47, warm p50 is
unchanged, no callable in the fleet changes shape except these two.

## 7. Gates, order and rollback

### The only log filter that counts

```
jsonPayload.perf="handler" jsonPayload.name="driverGetHomeDashboard"
```

### Expected `docsRead` after each step

| After | Warm p50 | Cold |
|---|---|---|
| today | 25 (~34 billed) | ~373 |
| steps 1–2 | **25** — unchanged per call; calls per rider-day drop to single digits | ~373 |
| step 3 | 4–5 | ~373 (fallback path only) |
| step 4 | 4–5 | ~47 |

A call that follows an invalidation pays 25 once — it is the call that has to
produce the new numbers — and rewrites the snapshot for the calls after it.

Do not claim a step until its line moves. Also record Firestore `reads/day` for
the same weekday before and after.

### Order

1. **Step 4** — server only, no behaviour change. Deploy, verify the cold-fill
   drop on a single traffic burst.
2. **Step 1, server half** — the `record_type: 'home'` pushes. Deploy alone; old
   app builds ignore an unknown `record_type`.
3. **Steps 1–2, app** — Play release behind the `app_settings` poll flag.
4. **Step 3** — `home_snapshot_enabled` on, shadow week, then flip.

### Rollback

The remote flag (app), `home_snapshot_enabled` (RPC), and a single-target
function deploy (server). **No data migration in either direction** — the
snapshot collection can be deleted and rebuilt from source at any time.

## 8. Feature guards — what breaks if a guard is skipped

* **Duty toggle and server auto-checkout** regress if the poll goes away without
  the `drivers/{uid}` watcher: the toggle shows *In* after a server checkout and
  the Deliver button is dead until the next manual open.
* **DPD, zone and partner cards** lag until the next recompute. A zone or partner
  move is caught without a writer: the snapshot stores `zone_id` / `partner_id`,
  and `snapshotFresh` refuses a document that no longer matches the driver, so
  the next Home call pays the source path and rewrites it.
* **Earnings and compliance cards** are invalidated by their own writes
  (earnings recalc, compliance refresh) so Home can never disagree with the
  Earnings tab or the Compliance screen for longer than the next call.
* **Blocked and force-update** stay off the phone cache entirely. They are
  display-only on Home and must never be delayed by a cache hit — a blocked
  rider who can still tap Deliver is the failure this guard prevents.
* **`shift_adherence` and `today_online_seconds`** stay out of the snapshot's
  served fields as live values; only the `elapsed_base` + `open_since` pair is
  stored, and the client computes the rest.
