# Admin briefing — billing, speed, and what changed

**Date:** 2026-10-17 · **Scope:** rider app Cloud Functions + Firestore + admin panel
**One-line summary:** the rider Home dashboard was re-reading the whole
configuration of the fleet on every refresh. It now reads it once and remembers
it, so one Home call costs **528 → 25 documents** (about **34 billed reads** once
aggregates are counted), a **94–95% reduction**. Everything else in this document
follows from that.

---

## 1. What the problem actually was

Firestore bills **per document returned**, not per query. A query with
`limit(2000)` that matches 500 rows costs 500 reads, and a query with six filters
costs the same as one with two. The old `driverGetHomeDashboard` therefore paid
for:

* all 110 active delivery rules, all 120 rule scopes, and the 141 restaurants
  those scopes name — on **every rider's every Home refresh**,
* all 133 incentive rule scopes and the incentive tiers,
* both banner collections,
* the rider's **entire session history, twice** (82 reads for the sample rider),
* the rider's whole attendance history, twice (32 reads).

None of the fleet-wide half had changed since the last call. It was the same data
read thousands of times a day.

## 2. The measured result

| | Documents per Home call |
|---|---|
| Before | **528** |
| After | **25** (live `perf:"handler"` log line) |
| Billed reads, aggregates included | **~34** (9 `count()` / `sum()` aggregates bill ~1 read each) |
| **Reduction** | **94–95%** |

Per-call breakdown, measured with `scripts/measure-firestore-amplification.mts`
(read-only `count()` aggregates) against the callable's own logs:

| Part | Before | After |
|---|---|---|
| delivery rules + scopes + restaurants | 371 | 0 (served from isolate memory) |
| incentive scopes / tiers / banners | 0–688 depending on data | 0 |
| rider session history (read twice) | 82 | 1 |
| rider attendance history (read twice) | 32 | ~7 |
| rider's own week of deliveries | 75 (two scans) | **0 documents** (one `count()` aggregate) |
| lifetime counts, compliance, pins, shifts | 25 | 25 (real data, by design) |

The rider's own work — the day rows, six lifetime `count()` aggregates, the
week's count as an aggregate — is still read, because it is different for every
rider every day. That residual is what the "after" number is made of: 17 round
trips, 25 documents, ~1.2 s of handler time.

### Warm and cold — the two numbers to expect

| Call | Documents | What it is |
|---|---|---|
| Warm (any call after the first in an isolate) | **25** | the rider's own data plus one counter read |
| Cold (first call in an isolate, or first after a rule edit) | **~373** | the same, plus refilling the fleet-wide configuration once |

The 373 is the one-time fill, paid **once per isolate per 5-minute window**
instead of on every call, so the average settles with traffic:

| Calls per isolate per window | Average documents per call |
|---|---|
| 1 | ~373 |
| 5 | ~95 |
| 20 | ~43 |
| 50 | ~32 |

A working fleet sits at the bottom of that table. Measure the p50 over a busy
hour, not one hand-made call — and if you take one call by hand, take the second
one.

## 3. Billing: which lines move, and by how much

Four SKUs are affected. Firestore document reads is the one that carries the
programme.

| SKU | Direction | Why |
|---|---|---|
| **Document reads** | **large drop** | the amplification in §1 is gone |
| Document writes | modest drop | `driver_operation_events` is sampled 1-in-5 for the `location` module; retention defaults cut from 90/180/14 days to 30/90/7 |
| Document deletes + storage | modest drop | tighter retention means fewer rows for every later purge |
| Cloud Run instance seconds | modest drop | the scan lane lost its 24/7 warm instance (`minInstances` 1 → 0), handlers do fewer round trips, and the panel polls 6× less often |

**How to put a number on it.** Reads saved per day is:

```
Home calls per day  ×  (528 − 34)  ≈  Home calls per day × 494 reads
```

So 3,000 Home calls a day (≈150 riders × 20 refreshes) is **~1.5 million fewer
billed reads per day**, about **45 million fewer per month**. Multiply by your own
region's rate in *Google Cloud console → Billing → Reports* (filter service
`Cloud Firestore`, group by SKU) — list rates for document reads are on the order
of a few cents per 100,000, and this project runs in `me-central2` which has its
own price list.

**Be precise about the 94%.** It is the reduction on *this call's reads*, which was
the largest single source of read amplification in the app. The reduction on the
**whole bill** equals that saving divided by everything else on it (writes,
storage, Cloud Run CPU, the panel, the location ingest, exports, BI). To find the
rest, read the billing report by SKU and compare one weekday with the same weekday
a week earlier — and note the free tier (50,000 reads a day) can hide a change on
the invoice even when the usage graph moves.

## 4. Speed: what gets faster and why

Latency in this app is dominated by the **number of sequential Firestore round
trips**, not by payload size.

**Rider app — Home screen.** The old call made roughly eight separate reads of
fleet-wide data (rules, scopes, restaurants, incentive rules, scopes, tiers, both
banners, wallet entries). Each was at least one round trip to `me-central2`, and
the tiers/banners step waited on the previous one. They are now one read of
`auth_epochs/current`. The live block log shows it:

```json
{"perf":"block","name":"home.deliveryRules","reads":0,"docsRead":0,"ms":0}
{"perf":"block","name":"home.incentiveRules","reads":0,"docsRead":0,"ms":0}
{"perf":"block","name":"home.epochs","reads":2,"docsRead":2,"ms":22}
```

`ms: 0` is the point — the work simply does not happen any more. The call still
reads the rider's own week and day rows, and those round trips remain, so the
Home screen is faster rather than instant.

**Admin panel.** Several things compound:

* `staleTime` 60 s → **5 min** and `gcTime` → 30 min, so a screen that is merely
  re-rendered (tab switch, back-navigation, a modal closing) no longer re-asks the
  backend. That removes a full server-action round trip from the common case.
* Poll intervals that no longer needed to be live: assigned-drivers 10 s → 60 s,
  driver-assign 10 s → 60 s, performance feed 30 s → 60 s, live-tracking's
  "recent orders" panel 10 s → 60 s. A single open screen used to make 6 server
  actions a minute; it now makes 1.
* Permission documents are cached per `access` epoch, and the epoch is read in
  the **same `getAll` as the profile**, so the admin panel's ~250 callables each
  do one fewer read on their critical path — and the epoch read costs no extra
  round trip because it rides along with the profile.
* The three API lanes already run at `cpu: 1` with `concurrency` 8 (light) / 2
  (scan) / 1 (heavy), so independent admin requests share an instance instead of
  queueing for a new one.
* The scan lane no longer holds a warm instance 24/7; it starts on demand. The
  first scan request after an idle period can be slightly slower, in exchange for
  paying nothing while nobody is scanning.

**Runtime.** All 281 functions moved Node.js 20 → 22 (Node 20 is decommissioned
on 2026-10-30, which is why it was done now). Node 22 gives a newer V8 and a
smaller base image; expect marginally faster cold starts, not a step change.

**Region.** The panel's functions run in `bom1` (Mumbai) — one region close to the
Gulf — because **every admin data call is made from a Vercel server action**, not
from the browser, so the region is a latency multiplier for the whole panel. It
is set in `vercel.json`.

`dxb1` (Dubai) was the original choice and is the better one geographically, but
Vercel was refusing new deployments there (see the deploy record in
`firestore-cost-reduction.md`). `bom1` is the nearest region that accepts them.
To use both when Dubai returns, change the line to:

```json
"regions": ["bom1", "dxb1"]
```

and redeploy with `node scripts/deploy-panel.mjs`. Vercel requires **every**
region in the list to be available, which is why the list cannot stay as
`["bom1", "dxb1"]` while `dxb1` is down — the whole deployment is rejected.

## 5. What the admin user will notice

| Change | Effect |
|---|---|
| Rule / banner edits | A rider sees a new delivery rule, incentive rule, or banner on their **next** Home refresh, not after a cache expiry — the panel bumps the `config` counter. **Until the panel deploy lands, the fallback is up to 5 minutes.** |
| Data freshness on lists | A screen holds its data for up to 5 minutes unless it is edited in that tab or an operator changes a filter. Mutations still invalidate the exact keys they touch, so a save shows immediately. |
| Live tracking | Unchanged: the fleet feed from `/live-tracking-v2` is a WebSocket, not a poll. Only the secondary "recent orders" panel moved to 60 s. |
| Diagnostic / audit pages | `driver_operation_events` rows for the `location` module are now sampled 1-in-5 (every failure is always kept). Retention defaults are tighter: ops log 30 days, location events 90, telemetry 7. |
| Charts and counts | Unchanged values. `count()` aggregates return the same numbers as the old full scans. |
| Driver duty, attendance, payouts | Unchanged behaviour. Money-writing RPCs re-read permissions on every call (`requireStaffFresh`) instead of trusting the cache. |
| First load after a quiet period | Slightly slower for the scan lane (no warm instance). Unchanged elsewhere. |

### Where to look when something seems stale

1. **A rider reports an old rule.** Check that the panel deploy is live. If it
   is, the rule edit bumps `auth_epochs/current.config`; the rider's next Home
   call re-reads it. If the edit was made directly in the Firestore console (not
   in the panel), the 5-minute TTL is the only mechanism — that is by design.
2. **A permission change looks ignored.** Panel-made role/tick changes bump
   `access` and are visible on the very next call. Console-made edits wait for the
   TTL.
3. **Home looks slow again.** Read the `perf:"handler"` line for
   `driverGetHomeDashboard`. If `home.deliveryRules` is above zero, the isolate is
   cold (expected after a deploy or a long quiet period). If `home.weekDeliveries`
   is large, that is the rider's real week of work, not amplification.
4. **A query starts erroring after a schema change.** New composite indexes live
   in `firestore.indexes.json` and must be deployed and `READY`. The per-rider
   queries fall back to a bounded scan while an index builds, so a missing index
   shows up as slower, not broken.

## 6. Technical annex — what changed, where

**Rider Cloud Functions**

| File | Change |
|---|---|
| `core/config-cache.ts` (new) | isolate cache keyed on an `auth_epochs/current` counter, 5-minute hard TTL, in-flight coalescing, bounded key map |
| `core/epoch-write.ts` | added the `config` counter kind and a standalone `bumpEpoch` for non-transactional writers |
| `core/staff.ts` | permission documents cached per `access` epoch; the epoch is read in the same `getAll` as the profile; `requireStaffFresh` added for money/permission writers (53 call sites) |
| `core/fs-metrics.ts` | nested `measureBlock` totals now roll into the handler line; blocks emit their own `perf:"block"` log |
| `core/init.ts` | global `cpu: 0.08`, `concurrency: 1` (Cloud Functions rejects concurrent execution below one full CPU) |
| `router/lanes.ts` | `SCAN_MIN_INSTANCES` 1 → 0 |
| `rpcs/driver-home.ts` | config caches for rules/scopes/restaurants/incentive/tiers/banners/source-companies; `latestSession` → `orderBy + limit(1)`; `weekEarnings` → one `sum()` aggregate; day-bounded session reads; week-ranged attendance reads |
| `rpcs/driver-attendance-get.ts` | month-bounded pages instead of four 400-row scans; one open-session read |
| `rpcs/driver-earnings.ts` | lifetime `limit(20_000)` reads replaced by month windows in `driverGetWorkSummary` and `driverGetExtraEarnings` |
| `rpcs/rules.ts` | every delivery-rule / incentive-rule / source-company writer bumps the `config` counter |
| `rpcs/_shared.ts` | `logDriverOperation` sampling per module, failures always written |
| `rpcs/retention.ts` | default windows 30 / 90 / 7 days |

**Admin panel**

| File | Change |
|---|---|
| `lib/query/make-query-client.ts` | `staleTime` 5 min, `gcTime` 30 min |
| `lib/auth/auth-epochs.ts` | `bumpEpochs` + `EpochCounterKey` for writers outside a transaction |
| `features/dpd/dpd-actions.ts` | config-counter bump on every delivery rule / incentive rule / restaurant / import write (8 sites) |
| `features/settings/home-banners-actions.ts` | config-counter bump on banner create / update / delete |
| `features/*/use-*.ts`, `performance-live-panel.tsx`, `live-tracking-live-view.tsx` | poll intervals 10 s/30 s → 60 s where a realtime invalidator or a mutation already covers the screen |

**Firestore**

| Change |
|---|
| 4 new composite indexes (`driver_sessions` `updated_at`, `driver_wallet_entries` `status`, two `deliveries` window indexes) — all verified `READY` |
| `app_settings` deliberately **not** cached: it is one document, so a cache would cost one epoch read to save one document read |

**Platform**

| Change |
|---|
| Node.js 20 → 22 for all 281 functions (Node 20 is decommissioned 2026-10-30) |
| Admin panel region set in `vercel.json` — one region near the Gulf, because every admin data call is a server action |

## 7. How to re-measure, any time

| Question | Command / query |
|---|---|
| What did it cost before? | `node --import tsx scripts/measure-firestore-amplification.mts` (read-only counts) |
| What does one call cost now? | Cloud Logging: `jsonPayload.perf="handler" jsonPayload.name="driverGetHomeDashboard"`, read `docsRead` p50/p95 |
| Which helper is expensive? | same query with `jsonPayload.perf="block"`, group by `jsonPayload.name` |
| Which callables still trust the permission cache? | `node scripts/audit-staff-auth-paths.mjs` |
| What is safe to deploy? | `node scripts/print-fn-deploy-targets.mjs` (production holds 4 functions with no source on this branch; a full deploy would want to delete them) |
| Panel deploy | `node scripts/deploy-panel.mjs` |

**Ground rule for any future change:** measure the `perf:"handler"` line before
and after, and treat `docsRead` as the number that matters. `reads` is round
trips — a latency signal, not the bill.

storage, Cloud Run CPU, the panel, the location ingest, exports, BI). To find the
rest, read the billing report by SKU and compare one weekday with the same
weekday a week earlier — and note the free tier (50,000 reads a day) can hide a
change on the invoice even when the usage graph moves.
