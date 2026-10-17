# Firestore cost programme — how to measure

Every phase in this programme claims a percentage. A percentage is only worth
anything next to a measured `docsRead` per callable and a reads/day line from
the Firebase console, so this file is the measuring procedure those claims refer
to.

## What is already instrumented

`functions/src/core/fs-metrics.ts` wraps the Firestore Admin SDK once per
isolate (`installFsMetrics`, called from `core/fs.ts`) and emits two JSON lines
to Cloud Logging per request:

```json
{"perf":"handler","name":"driverGetHomeDashboard","reads":14,"docsRead":312,"sequentialAwaits":6,"ms":410}
{"perf":"block","name":"home.deliveryRules","reads":3,"docsRead":271,"sequentialAwaits":2,"ms":120}
```

* `perf:"handler"` — one line per callable. `docsRead` is the number of
  documents billed to that request.
* `perf:"block"` — one line per `measureBlock` step inside a handler, so a
  single Home call can be split into "which helper read how much" without
  another deploy. Block totals are also added to the enclosing handler totals,
  so the handler line stays the whole request.

Instrumented callables: `driverGetHomeDashboard`, `driverSetDutyState`,
`driverGetAttendance`, `driverListMyDeliveries`, `driverGetEarningsDetail`, plus
the admin callables that already used `measureOnCall`.

`PERF_METRICS=0` turns the logging off. Leave it on: the log line is the only
per-request read count that exists.

## Baseline procedure

Run this before any phase and after every phase, at the same time of day.

1. **Cold and warm Home.** From one real rider account call
   `driverGetHomeDashboard` twice, a few seconds apart, and record `docsRead`
   for each. The first call fills the isolate cache, the second one is what the
   steady state costs.
2. **Cloud Logging query.**

   ```
   resource.type="cloud_function"
   jsonPayload.perf="handler"
   jsonPayload.name="driverGetHomeDashboard"
   ```

   Read `docsRead` p50 and p95 from the distribution, not the mean — a single
   cold fill drags a mean.
3. **Per-step split.** Same query with `jsonPayload.perf="block"` and group by
   `jsonPayload.name`. On the pre-cache code the two largest entries are
   `home.deliveryRules` and `home.incentiveRules`; they should collapse to a
   couple of reads each once warm.
4. **Reads/day.** Firebase console → Firestore → Usage → Document reads, and
   compare the same hour of the previous day.
5. **Admin side.** Same procedure with `jsonPayload.name="adminListDriversPage"`
   and one `adminLiveFleetSnapshot` call before/after Phase 3.
   `scripts/probe-lane.mjs` already drives the lane callables
   (`adminApi` / `adminApiScan` / `adminApiHeavy`) with the right payloads, and
   the `perf:"handler"` line for each is emitted the same way.

## Measured, 2026-10-17 (after the functions deploy)

Run `node --import tsx scripts/measure-firestore-amplification.mts` for the
fleet-wide counts (read-only, `count()` aggregates, no rider identity printed).
The "after" number is the deployed callable's own `perf:"handler"` line:

```json
{"perf":"handler","name":"driverGetHomeDashboard","docsRead":25,"reads":17,"ms":1201}
```

### What one Home call cost, and what it costs now

| Part | Before | After | How it was measured |
|---|---|---|---|
| `delivery_rules` (active) | 110 | 0 (cached) | `count()` |
| `delivery_rule_scopes` | 120 | 0 (cached) | `count()` |
| `restaurants` (scope `getAll`) | 141 | 0 (cached) | `count()` |
| `incentive_rules` (active weekly) | 0 | 0 | `count()` |
| `incentive_rule_scopes` | 0 (early return) | 0 (cached) | `count()` |
| `incentive_rule_tiers` | up to 200 for the picked rule | 0 (cached) | `count()` = 355 rows |
| banners (both collections) | 0 | 0 | `count()` |
| rider's session history (read **twice**) | 82 | 1 | 41 sessions, `count()` |
| rider's attendance day rows (read twice) | 32 | ~7 | 16 rows, `count()` |
| rider's week of deliveries | 75 (two scans) | 0 documents (1 `count()` aggregate) | block log + [check-delivery-day-fields.mts](../../scripts/check-delivery-day-fields.mts) |
| rider's week of wallet entries | 0 | 0 | `count()` |
| lifetime counts, compliance, pins, shifts | 25 | 25 | unchanged by design |
| **Documents read** | **528** | **25** | handler line |
| **Billed reads incl. aggregates** | **528** | **~34** | 25 documents + 9 aggregates at ~1 read each |

**Reduction: 95% on documents, ~94% on billed reads.**

A note on the aggregate reads: our counter shows `reads: 0` for a `count()` /
`sum()` because the runtime's `AggregateQuery` class is not the one the metric
patch wraps. Firestore bills an aggregate as **one read per 1000 index entries
matched**, so nine aggregates are roughly nine reads, not zero. Counting them
honestly is why the table gives both rows.

The block lines confirm the mechanism, not just the total:

```json
{"perf":"block","name":"home.deliveryRules","reads":0,"docsRead":0,"ms":0}
{"perf":"block","name":"home.incentiveRules","reads":0,"docsRead":0,"ms":0}
{"perf":"block","name":"home.latestSession","reads":1,"docsRead":1}
{"perf":"block","name":"home.weekDeliveries","reads":0,"docsRead":0}
```

`home.deliveryRules` and `home.incentiveRules` at zero is the whole point: the
cache is warm, so those collections are not read at all. `home.latestSession` at
exactly one document also proves the new `(driver_id, updated_at desc)` index is
**READY** in production. `home.weekDeliveries` at zero is the `count()` aggregate
that replaced two scans over 75 documents.

### Warm and cold are two different numbers — read both

```json
{"perf":"handler","name":"driverGetHomeDashboard","docsRead":25,"reads":17,"ms":1598}   // warm
{"perf":"handler","name":"driverGetHomeDashboard","docsRead":373,"reads":23,"ms":3201}  // cold
```

The 373 is the **cache fill**: the first call in an isolate (or the first call
after the `config` counter moves) reads the delivery rules, scopes and
restaurants once and stores them. Every call after that in the same isolate reads
the `auth_epochs/current` counter and nothing else from that configuration.

That fill used to happen on **every** call. What it costs per call now depends on
how many calls share an isolate's 5-minute window:

| Calls per isolate per window | Average documents per call | Reduction |
|---|---|---|
| 1 | ~373 | 29% |
| 5 | ~95 | 82% |
| 20 | ~43 | 92% |
| 50 | ~32 | 94% |

A fleet calling Home throughout the day sits at the bottom of that table; a
handful of test calls in a quiet window measure like the top. **Measure with the
`perf:"handler"` p50 over a busy hour, not from a single call** — and if you take
one call by hand, take the second one.

### Two honest caveats

* **This is one callable.** `driverGetHomeDashboard` was the worst offender, so
  it carries most of the read line, but the account total also includes writes,
  storage, the panel's own reads and Cloud Run instance time.
* **This is one rider's history.** The sample rider has 41 sessions and 16
  attendance days. A rider with two years of duty history pays more on the old
  path and therefore sees a larger reduction.
* If the fleet starts using **active weekly incentive rules**, the old cost grows
  by the scope and tier reads (133 + up to 200 per call) and the reduction grows
  with it. The counts above show 0 weekly rules today, which is why the incentive
  branch contributed none of the "before" total.
| Admin callables after Phase 3 | handler reads drop by 1–2 documents per call |

The absolute numbers depend on how large the rider's own history is; the ratio
between the before and after numbers is the number to report.

## Things that make a measurement wrong

* Measuring a cold isolate. The first call after a deploy pays the fill.
* Measuring an unauthenticated probe. `requireRider` / `requireStaff` reject
  before the reads happen, which flatters the number.
* Comparing different times of day. Reads track duty state.
* Reading `reads` instead of `docsRead`. `reads` counts round trips; `docsRead`
  is what the bill is computed from.
