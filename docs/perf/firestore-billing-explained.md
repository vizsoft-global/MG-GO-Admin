# Firestore + Cloud Functions billing, and what this programme moved

Written for one question: **how does the bill actually change?** Read this
together with [firestore-cost-baseline.md](./firestore-cost-baseline.md) (how to
measure) and [firestore-cost-reduction.md](./firestore-cost-reduction.md) (what
changed).

## Firestore is billed per document, not per query

A query that returns 500 documents costs 500 reads. It does not matter how many
`where` clauses it has, whether it used an index, or whether it was capped at
`limit(2000)` — the limit only decides how many *rows* come back, and the rows
are what you pay for. That single fact is the whole reason this programme
worked:

* Before: `driverGetHomeDashboard` read the active delivery rules, every rule
  scope, the restaurants those scopes name, the incentive rules, every incentive
  scope, the incentive tiers, both banner collections, the rider's whole session
  history and the week's wallet entries — **on every rider's every Home
  refresh**, even though none of the fleet-wide parts had changed.
* After: one `auth_epochs/current` document read covers all of that fleet-wide
  configuration, because it is served from the isolate's memory.

Two shapes are cheaper than "one read per row" and are now used where the answer
is a number rather than a list:

| Shape | Price |
|---|---|
| `count()` | 1 read per 1000 index entries matched |
| `AggregateField.sum()` / `aggregate()` | 1 read per 1000 index entries matched |

So six `count()` calls over a rider's lifetime deliveries cost six reads, not
thousands. That is why `performanceCounts` was left alone: it was already the
cheap shape.

## The meter, line by line

```json
{"perf":"handler","name":"driverGetHomeDashboard","reads":14,"docsRead":312,"sequentialAwaits":6,"ms":410}
{"perf":"block","name":"home.deliveryRules","reads":3,"docsRead":271,"sequentialAwaits":2,"ms":120}
```

`docsRead` is what the bill is computed from. `reads` is only the number of
round trips (a latency signal, not a cost signal). A warm Home call after this
programme should show the `home.deliveryRules`, `home.incentiveRules` and
`home.banner` blocks at a handful of reads or zero, and `home.epochs` at exactly
one.

## What the money parts are

Firestore on Blaze bills four SKUs that this work touches:

| SKU | Roughly | Effect of this programme |
|---|---|---|
| Document reads | the largest line | the main saving |
| Document writes | ~3–6× the reads rate | sampled operation log + tighter retention |
| Document deletes | small | fewer rows to delete because retention is tighter |
| Storage | per GiB/month | tighter retention |

Cloud Functions gen2 runs on Cloud Run, which is billed separately: instance
seconds × (CPU + memory) + invocations + egress. Reads drive *latency*, which
drives *instance seconds*, so a faster Home call also lowers the compute line —
which is the reason Phase 4 (the panel no longer polling every 10–60 s) shows up
here rather than in the read line.

Verify the actual rates for this project in **Google Cloud console → Billing →
Reports** (filter service `Cloud Firestore`, then group by SKU). Do not rely on
a remembered number: rates differ per region, and this project runs in
`me-central2`.

## Where to watch it

1. **Firebase console → Firestore → Usage** — reads / writes / deletes per day.
   Compare the same day of the previous week, not the previous day.
2. **Google Cloud console → Billing → Reports** — the `Document reads` and
   `Document writes` lines, plus `Cloud Run` instance time.
3. **Cloud Logging** — the `perf:"handler"` line per callable, for the per-request
   number that explains the movement.

## What to expect, and what would falsify it

* The **Document reads** line is the one that should drop, and it should drop
  first. It is the amplification that was removed.
* **Writes** drop modestly (sampled operation log, tighter retention).
* **Instance time** drops modestly (lane `minInstances` 0, shorter handlers, the
  panel polling less).
* The **free tier** (50,000 document reads/day) can hide the change entirely if
  the project was sitting under it. In that case the usage graph moves and the
  invoice does not.

If the reads line does *not* move, the most likely causes are, in order:

1. A warm-up problem — every request is a cold isolate, so the config cache never
   helps. Check whether the number of concurrent users is high enough to keep
   isolates alive.
2. `weekDeliveryCount` and the attendance day rows, which are real per-rider data
   and scale with the rider's actual work. If those dominate, the fleet is
   reading proportionally to delivery volume, which no cache can remove.
3. Tools outside this repo: console queries, the AL, exports, or a BigQuery/BI
   reader. Those do not appear in the callable's `docsRead`.

## Deliberately not optimised, with the arithmetic

`weekDeliveryCount` still reads the rider's own week of deliveries instead of
`rollups_driver_day`. The rollup is written by the panel's verify path, not by
the rider app, so a delivery the rider created has no rollup and the week would
silently undercount. Making the rider app write it costs, per status change:
`applyDeliveryRollup` = one transaction with **2 reads + 3 writes**, and a write
bills at roughly 3–6 reads, i.e. **~11 read-equivalents per status change**. A
rider does two status changes per delivery, so ~550 read-equivalents per rider
per day — to save the ~350 reads per rider per *week* (~50/day) the scan costs.
It is 11× worse. The win would need the rollup write path redesigned to a single
day-document write with no marker and no zone document.
