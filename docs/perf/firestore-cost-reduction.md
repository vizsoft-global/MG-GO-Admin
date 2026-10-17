# Firestore read amplification — what changed

Goal: remove the read amplification that put every rider's every Home refresh at
thousands of document reads. Measuring procedure: [firestore-cost-baseline.md](./firestore-cost-baseline.md).

| Phase | What it does | Status |
|---|---|---|
| 0 | `measureOnCall` / `measureBlock` instrumentation, baseline procedure | done |
| 1 | Isolate config cache for fleet-wide collections, epoch invalidation | done |
| 2 | Per-rider scans bounded / aggregated | done, one item deferred (below) |
| 3 | Staff permission documents cached, profile still fresh | done |
| 4 | Panel polling echo removed | done |
| 5 | Write sampling, retention windows, lane fixed cost | done, two items deferred |

## Phase 0 — instrumentation

* `functions/src/core/fs-metrics.ts` now propagates a nested block's totals into
  the enclosing handler, so a `measureBlock` inside a measured handler no longer
  hides reads from the handler's own `docsRead`.
* `measureBlock` emits its own `perf:"block"` line (name, reads, docsRead,
  sequentialAwaits, ms).
* `driverGetHomeDashboard`, `driverSetDutyState`, `driverGetAttendance`,
  `driverListMyDeliveries`, `driverGetEarningsDetail` now run under
  `measureOnCall`.
* Every helper inside `loadRiderHomeDashboard` runs under a named block
  (`home.deliveryRules`, `home.incentiveRules`, `home.banner`, `home.epochs`,
  `home.latestSession`, …).

## Phase 1 — config cache (the largest single win)

New `functions/src/core/config-cache.ts`, mirroring the panel's
`src/lib/auth/epoch-cache.ts`: read the `auth_epochs/current` counter, then serve
the value from isolate memory while the counter is unchanged, with a 5 minute
hard TTL as the safety net for console edits and scripts.

Cached in `driver-home.ts`:

| Value | Was |
|---|---|
| Active delivery rules + all scopes + restaurant names | 2 collection scans + `getAll` ≤300 restaurants, **per call** |
| Active weekly incentive rules + all scopes + all tiers | 2 collection scans + a tier query, **per call** |
| `home_banners` + `driver_home_banners` | 2 collection scans ≤200 each, **per call** |
| `source_companies` | 1–2 reads, per call |

The per-rider part of the answer (is today inside the rule window, does the
scope match this rider, is the banner in window / targeted at this rider) is
computed from the cached rows and costs no reads. A warm Home call now pays
**one read** for `auth_epochs/current` as the entire cost of that configuration.

Invalidation is wired **before** the cache is trusted:

* `functions/src/core/epoch-write.ts` gains the `config` kind and a standalone
  `bumpEpoch`, used by the rule / scope / tier / source-company writers in
  `functions/src/rpcs/rules.ts`.
* `src/lib/auth/auth-epochs.ts` gains `bumpEpochs` and the `EpochCounterKey`
  type (`config` has no reader on the panel side), used by the panel writers:
  `dpd-actions.ts` (delivery rule, incentive rule, restaurant, both import
  loops), `settings/home-banners-actions.ts`.
* Source companies written from the panel go through the
  `admin_upsert_source_company` callable, which bumps on the server.

`app_settings` is deliberately **not** cached: it is a single document read, so a
cache would cost one epoch read to save one document read.

## Phase 2 — per-rider reads

`limit(2000)` was a fleet-size guard copied onto queries that are already
filtered to one `driver_id`. An active rider therefore paid for their whole
history on every Home call.

| Read | Before | After |
|---|---|---|
| `latestSession` | scan of every session, sorted in memory | `orderBy(updated_at desc).limit(1)`, bounded scan as fallback |
| `openOnlineSession` | `limit(50)` | `limit(5)` |
| `closedSessionSeconds` | every session the rider ever had | bounded to the Kuwait day, `limit(20)` |
| `weekEarnings` | wallet entries of the week, document by document | one `sum(amount_kwd)` aggregate |
| `weekDeliveryCount` | `limit(1000)` | see below |
| `driverGetAttendance` | 4 × `limit(400)` | month-bounded pages + one open-session read |

Then, in the second pass, the last scan in the Home path:

| Read | Before | After |
|---|---|---|
| `weekDeliveryCount` | two range scans over the rider's week (75 documents for the sample rider) | **one `count()` aggregate** (billed as ~1 read) |

It was skipped at first on the assumption that an aggregate would double count the
two range fields. That was wrong, and the fix was to measure instead of reason:
`scripts/check-delivery-day-fields.mts` shows **all 266,908** deliveries carry
`shift_date`, and `deliveryDay()` prefers `shift_date`, so the aggregate returns
exactly the deduped set — and only 2,064 rows have `delivered_day` at all, every
one of which also has `shift_date`, so the second scan was reading rows it then
threw away as duplicates. The two scans remain as the fallback for a legacy row
with no `shift_date`, and run only when the aggregate returns zero.

Two of these are index-dependent and are wrapped in `try`/`catch` so a not-yet-
deployed index falls back to the previous bounded scan instead of failing the
call. New composite indexes live in `firestore.indexes.json`
(`driver_sessions (driver_id, updated_at desc)`,
`driver_wallet_entries (driver_id, entry_type, status, earn_date)`).

Deliberate non-changes, with the reason:

* **`weekDeliveryCount` still reads the documents.** The rows are deduped by
  document id across the `shift_date` and `delivered_day` ranges, so `count()`
  aggregates would double count.
* **`rollups_driver_day` is not used for it.** The rollup is written by the
  panel's verify / bulk-status path and by the Next write helpers; a delivery the
  **rider created in the app** has no rollup, so a week would silently
  undercount. Cycling the rider app's own status writes through
  `applyDeliveryRollup` is the prerequisite, and that is a write-side change.
* **`attendanceDayOn` / `weekOnlineSeconds` keep their bounded queries.** The
  plan assumed a `driver_attendance/{driverId}_{day}` document id. It does not
  exist: rows are created with `add()` (auto id), and both driver-side and admin
  clock-in/out paths write them. Reading a day document that only one writer
  maintains would return stale seconds, so introducing the convention needs
  every writer migrated first.
* **`performanceCounts` is unchanged.** It already uses six `count()` aggregates
  — six reads, one per status — which is already the cheap shape.
* `home_banners` has no writer in this repo. The read stays (one empty query per
  cache fill) because a console edit must not be invisible.

### Per-rider scans that are still in place

These are bounded by the rider's real row count, so they are not the
amplification the plan described, but they are the next targets:

| File | Scan | Why it is still there |
|---|---|---|
| `driver-pay.ts` | `SCAN = 5_000` per range field | the file's own comment says the calculator reads `deliveries` because the rollups are only partially backfilled. The limit is not the cost — the rows returned are — so lowering it neither saves nor is safe. |
| `driver-deliveries.ts` | `SCAN = 500` (restaurant junction, duplicate check) | bounded by one restaurant-day; a doc-id key would be needed |
| `driver-vehicle.ts` | `SCAN = 80` (assignments) | bounded by the vehicle's assignment history |
| `driver-lists.ts` | `EARNINGS_SCAN = 400`, `VISITS_SCAN = 200` | real paging limits, not history scans |

Fixed in the second pass:

| Read | Before | After |
|---|---|---|
| `attendanceDayOn` | equality (≤10) **plus** an 80-document rider page, every call | equality first; the page only when the equality finds nothing |
| `weekOnlineSeconds` | 80-document rider page, every call | week range (≤7 rows); the page only when the range is empty |
| `driverGetWorkSummary` deliveries | lifetime `limit(20_000)` | month window, two range pages |
| `driverGetWorkSummary` attendance | `limit(400)` | month range (≤31); the 400 page only when the range is empty |
| `driverGetExtraEarnings` deliveries | lifetime `limit(20_000)` | month window (the widest any rule period can need) |


## Phase 3 — staff permission documents

`functions/src/core/staff.ts`:

* The profile is still read on every call — approval, archive and
  `admin_role_id` must be current, and a callable token carries no `auth_time`
  comparable with `sessions_revoked_at`. This is the warning the file carried,
  and it still holds.
* The permission documents (`admin_permissions/permissions`,
  `admin_rolePermissions/{roleId}`, `adminUserPermissions/{uid}`) are now cached,
  keyed on the `access` counter, and the counter is read in the **same `getAll`
  as the profile**, so it costs no extra round trip.
* `requireStaffFresh` is the escape hatch for a callable that changes money,
  permissions or account state. The cached path is delayed by at most one
  counter bump, which is fine for a read and not fine for such a write.
* A missing counters document (no `auth_epochs/current`) bypasses the cache
  entirely rather than pinning to a zero that would never move.
* Test: `functions/src/core/staff-permissions.test.ts` proves the profile is read
  every call, the permission documents once per epoch, that a bumped counter
  re-reads, that `requireStaffFresh` always re-reads, and that an archived
  profile never reaches the permission reads.

Follow-up (done): the mutation callables that change money, permissions or
account state now call `requireStaffFresh` — **53 call sites**. The second pass
extended it from the account writers to the payroll surface:
`attendance-ops.ts` (correct attendance, auto-checkout, freeze-start checkout),
`deliveries-status.ts` (bulk status update), `payroll-clients.ts` (7 writers incl.
open rule month), `payroll-more.ts` (apply adjustments, zone settings, zone
override, recompute zone metrics), `ops.ts` (`adminUpsertPerformanceTargetDpd`),
`fuel.ts` (`adminSetFuelTransferType`), `driver-devices.ts` (force sign-out,
force update), `misc-admin.ts` (`adminExpireStalePickups`),
`performance-ratings.ts` (5 writers).

`scripts/audit-staff-auth-paths.mjs` prints the split so the remainder is a
number, not a claim: **53 fresh / 145 cached**. The 145 are reads, master-data
catalogue writers, eSign document writers and per-row eSign batch writers —
none of them move money or permissions, and the eSign batch path is called once
per row, so paying the permission reads there would be a net regression.

**The window a cached tick can be wrong is not "5 minutes".** The panel's role,
tick and catalog writers bump the `access` counter, so a revocation made through
the panel is visible on the very next call in every isolate. Only an edit made
directly in the Firestore console falls back to the 5-minute TTL.

## Phase 4 — panel polling

| Where | Before | After |
|---|---|---|
| `src/lib/query/make-query-client.ts` `staleTime` / `gcTime` | 60 s / 5 min | 5 min / 30 min |
| `use-restaurants.ts` assigned drivers | 10 s | 60 s |
| `use-driver-assign.ts` restaurant assign list | 10 s | 60 s |
| `use-performance.ts` recent deliveries default | 30 s | 60 s |
| `performance-live-panel.tsx` feed | 30 s | 60 s |
| `live-tracking-live-view.tsx` selected rider's last orders | 10 s | 60 s |

`/live-tracking` and `/live-tracking-v2` are separate routes with separate
feeds, so there was no in-page duplicate feed to suppress; the reduction is the
10 s poll itself.

## Phase 5 — writes, retention, lanes

* **Operation-log sampling.** `logDriverOperation` now samples per module
  (`DRIVER_OP_SAMPLE_DEFAULT = { location: 5 }`) because `location` rows scale
  with GPS frequency rather than a rider decision. Every other module stays
  1:1, a `success: false` row is always written, and `DRIVER_OP_LOG_SAMPLE=off`
  restores 1:1 for an investigation.
* **Retention defaults tightened** (`rpcs/retention.ts`): operation events
  90 → 30 days, location events 180 → 90 days, telemetry 14 → 7 days. A stored
  `app_settings` value still wins, so this only moves the default.
* **`SCAN_MIN_INSTANCES` 1 → 0** (`router/lanes.ts`): the scan lane no longer
  holds a 24/7 warm instance.

* **Global legacy concurrency:** attempted, then reverted for a platform reason.
  `concurrency: 2` with the global `cpu: 0.08` is rejected by Cloud Functions —
  the deploy fails with *"The following functions are configured to allow
  concurrent execution and less than one full CPU. This is not supported"* for
  every legacy export. Raising `cpu` to 1 would multiply the per-instance rate
  for ~250 callables, which is the opposite of the goal, so the honest path is
  per-callable: move read-only callables to their own `cpu: 1, concurrency: 4…8`
  options as they are taken off the legacy set. The three lane exports already
  run that shape.
* **Lane instance-seconds** were already tuned (light
  `concurrency: 8, minInstances: 0`).

## Deploy record

**2026-10-17 — indexes, functions.**

* `firebase deploy --only firestore:indexes --project musallam-delivery-prod` →
  exit 0, `deployed indexes in firestore.indexes.json successfully for default
  database`. The four new composites are defined; Firestore builds them in the
  background and the queries that need them fall back until they read `READY`.
  The command also reported two indexes and two field overrides that exist in the
  project but not in the file — left in place (deleting them needs `--force`).
* `firebase deploy --only functions`: a **full** deploy aborts with *"The
  following functions are found in your project but do not exist in your local
  source code"* — `adminBackfillBitesMirror`, `adminSyncBitesMirror`,
  `bitesFleetSocketTicket`, `bitesMirrorSweep`. They are live in production but
  have no source on this branch, and `--force` would delete them. Deployed **277
  explicit targets instead** (everything in `router/legacy-modules.ts` plus the
  three lane exports), in five batches of ≤60 because cmd.exe caps a command line
  at 8191 characters. Result: **277/277 successful, 0 errors**, 281 functions in
  the project, the four orphan functions still `ACTIVE`.
  `scripts/print-fn-deploy-targets.mjs` regenerates the safe target list.
* Second functions pass: 25 further targets (the payroll / attendance-correction /
  bulk-status / DPD-target / fuel / device / rating writers moved to
  `requireStaffFresh`) → **25/25 successful, 0 errors**.
* Third functions pass: `driverGetHomeDashboard` + `driverSetDutyState` with the
  `weekDeliveryCount` aggregate → **2/2 successful, 0 errors**. Verified from the
  next live call: `home.weekDeliveries` went from `reads:2, docsRead:75` to
  `reads:0, docsRead:0`, and the handler line from `docsRead:67–90` to
  **`docsRead:25`**.
* Panel (`npx vercel --prod --yes`): **blocked by the Vercel `dxb1` region, five
  attempts over ~3 hours.** Diagnosed rather than assumed:
  * `https://www.vercel-status.com/` shows **no active incident** (the last one
    was 2026-10-12), so this is not a platform-wide outage.
  * A **preview** build with `--regions iad1` is accepted and builds in
    Washington, so the account and pipeline are fine — `dxb1` specifically is
    refusing new deployments.
  * The region is **not cosmetic**: every admin data call goes through a Vercel
    server action (`callAdminFunction` → the Firebase lanes in `me-central1`), so
    moving to `iad1` adds roughly +150 ms to each call, not just to navigation.
    That trade was not made unilaterally.
  * `scripts/deploy-panel.mjs` retries `dxb1` and, if it stays unavailable,
    prints the two options with that cost. `node scripts/deploy-panel.mjs` is the
    one command that finishes this when the region returns.
* **Panel deployed on `bom1` (Mumbai).** `dxb1` stayed unavailable, so the
  deployment was moved to the other near-Gulf region:
  `"regions": ["bom1"]` in `vercel.json`, then `npx vercel --prod --yes` →
  **`✓ Ready in 3m`**, aliased to `https://dpdadmin-prod.vercel.app`,
  `vercel inspect` reports every function running in `[bom1]`, and a live request
  returns `x-vercel-id: bom1::…` in 187 ms. `["bom1", "dxb1"]` cannot be used
  while Dubai is down: Vercel rejects the whole deployment if any requested
  region is unavailable, which is exactly what happened on the attempt with both.
  Re-add `dxb1` (and redeploy) once it accepts deployments again.

**A bug this deploy caught, worth recording.** The Vercel preview build failed
with *An import path can only end with a '.ts' extension when
`allowImportingTsExtensions` is enabled* — from the measurement script added in
this session, which used `import("../src/lib/firebase/credentials.ts")`. The
project's `tsconfig.json` includes `**/*.mts`, so `scripts/measure-*.mts` is part
of the Next build's type-check and a bad import there breaks the whole panel
deploy. Fixed by dropping the extension (tsx resolves it). **Lesson: `tsc
--noEmit` is not the production build.** `npm run build` is, and it is what
should gate any claim that the panel is deployable.

**2026-10-17 — Node.js 20 → 22 (separate, platform-forced).**

The CLI warned that Node 20 is *decommissioned on 2026-10-30*, 13 days out, after
which no function on it can be deployed (and the runtime is withdrawn). The
runtime is per function, so every function had to be redeployed:

* `functions/package.json` `engines.node` 20 → 22, `firebase.json` `runtime`
  nodejs22, `.nvmrc` 20 → 22.
* Canary first: `adminPerfPing`, `driverGetHomeDashboard`, `adminApi` → 3/3 on
  `nodejs22`, verified live (`functions:list` reports the runtime, and the
  callable's own `perf:"block"` lines kept arriving from the new runtime).
* Then the rest in five batches of ≤57 → **277/277 successful, 0 errors**.
* Final state: **281/281 functions on `nodejs22`**, and 60 recent log lines with
  zero errors while riders were actively calling Home.
* Evidence the runtime change is safe for this code: the whole suite already ran
  on local Node 22.9 before the change (232/232), and nothing in the functions
  package uses a Node 20-only API.

**While the panel deploy is pending:** rule and banner edits made in the panel do
not bump the `config` counter, so the rider config cache falls back to its
5-minute TTL instead of refreshing immediately. Everything else is live.

**Separate and urgent, found during the deploy:** the CLI warns that *Runtime
Node.js 20 was deprecated on 2026-04-30 and will be decommissioned on
2026-10-30* — 13 days out — after which no deploy is possible without moving
`functions/package.json` `engines.node` and `firebase.json` `runtime` to
`nodejs22`. That is a separate change with its own test pass, not part of this
programme.

## Remaining, with the reason

1. **Panel deploy.** Blocked by the Vercel `dxb1` outage (four attempts). Until it
   ships, a rule or banner edit made in the panel does not bump the `config`
   counter, so the rider config cache waits for its 5-minute TTL instead of
   refreshing immediately. Everything else in the panel change set (query
   defaults, poll intervals) is also still on the old values.
2. **Verify the index build state in the console.** **Verified** on 2026-10-17
   through the Firestore Admin API
   (`collectionGroups/-/indexes`, using the CLI's own access token): all four new
   composites report `READY` — `driver_sessions (driver_id, updated_at)`,
   `driver_wallet_entries (driver_id, entry_type, status, earn_date)` and the two
   `deliveries` window indexes. So no call is falling back to the old bounded
   scan in production. `home.latestSession` reading exactly 1 document in the
   live logs agrees.
3. ~~`weekDeliveryCount` still reads the deliveries.~~ **Done** in the second
   pass, by measuring instead of reasoning: `scripts/check-delivery-day-fields.mts`
   proved all 266,908 deliveries carry `shift_date`, so a single `count()`
   aggregate returns the same set the two scans deduped. The scans remain only as
   the fallback for a legacy row with no `shift_date`.
4. **Legacy global concurrency stays 1.** Cloud Functions refuses
   `concurrency > 1` below one full CPU, and raising `cpu` to 1 for ~274 callables
   multiplies their per-instance rate. The traffic that matters already runs on
   the three lane exports (`cpu: 1` with `concurrency: 8 / 2 / 1`), which is the
   shape the plan asked for, so the remaining per-callable tuning is a
   measurement project, not a blocker.
5. **145 callables still read the cached permission path.** All reads,
   master-data catalogue writers, eSign document writers and the per-row eSign
   batch writers — none move money or permissions. Re-run
   `node scripts/audit-staff-auth-paths.mjs` to see the list.
6. **Bounded scans left alone in four rider files** (`driver-pay` 5000,
   `driver-deliveries` 500, `driver-vehicle` 80, `driver-lists` 400/200). They
   are bounded by real rows, not by a fleet-size guard, so lowering the limit
   saves nothing and risks undercounting.


Use [firestore-cost-baseline.md](./firestore-cost-baseline.md). The three numbers
that should move, in order of size:

1. `docsRead` for `driverGetHomeDashboard` (handler line), warm.
2. The `home.deliveryRules` and `home.incentiveRules` block lines — a handful of
   reads each once warm.
3. The `admin_permissions` / `admin_role_permissions` document-read counts on the
   Google Cloud console (the panel's own reads will not move: they were already
   cached).

## Guardrails this kept

* No profile caching in `requireStaff`.
* Invalidation wired before the cache was trusted; the TTL is the safety net.
* No RTDB migration, no instance-size increase, no `limit` widened without an
  `orderBy`.
* Every index-dependent query degrades to its previous bounded scan instead of
  failing.
