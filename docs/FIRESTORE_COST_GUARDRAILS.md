# Firestore cost guardrails

## Invariants

- The three Worker doors (`workerFleetRead`, `adminIngestDriverPositions`,
  `adminRecordFleetEvents`) are the only functions allowed to override the
  global `cpu: 0.08 / concurrency: 1 / maxInstances: 2` shape. They run at
  `cpu: 1 / concurrency: 40 / maxInstances: 20 / minInstances: 1`.
  Deploy each one separately with `--force` (Firebase asks for it because
  `minInstances` raises the minimum bill); the option change is still the
  rollback boundary.
- GPS history targets R2 (`GPS_SINK=r2`, `GPS_SINK_PERCENT=100`). Firestore is
  kept for the 24-hour dual-write compare, then `GPS_DUAL_WRITE=0`.
- `driver_location_events`, `driver_operation_events` and
  `driver_telemetry_events` must carry `expire_at`; TTL cannot delete a row that
  does not have the field.

## Alerts (Cloud Monitoring)

Create one alert per signal, grouped by function/collection:

| Signal | Threshold | Window |
|---|---|---|
| `firestore.googleapis.com/document/read_count` | > 250,000/day | 24h |
| `firestore.googleapis.com/document/write_count` | > 200,000/day | 24h |
| Worker 5xx/429 ratio on the three doors | > 1% | 5m |
| `driver_location_events` daily growth | > 0.5M/day | 24h |

The first two are cost alarms; the third is the 429 feedback loop that causes
the Firestore fallback writes.

## Daily check

```sh
node scripts/firebase-cost-baseline.mjs
node scripts/admin-cost-audit.mjs --day <kuwait-day> --top 40
```

`ADMIN_COST_AUDIT_SAMPLE=0.01` must stay set in Vercel production. It samples
1% of admin callables/pages and writes weighted `admin_cost_samples` rows.

## GPS cutover

1. Deploy the Worker with `GPS_SINK=r2`, `GPS_SINK_PERCENT=100`,
   `GPS_DUAL_WRITE=1`.
2. Wait 24 hours, then run `node scripts/gps-dual-write-compare.mjs`.
3. If the compare is clean, set `GPS_DUAL_WRITE=0`, redeploy the Worker, and
   stamp the cutover day:
   `CONFIRM_GPS_CUTOVER=yes node scripts/gps-r2-cutover.mjs --day <YYYY-MM-DD> --apply`.
4. Only after that may `LOCATION_EVENTS_ARCHIVED=1` shorten Firestore location
   retention to 7 days.

Rollback: `GPS_SINK=off`, `GPS_SINK_PERCENT=0`, redeploy. The phone fallback
keeps working.

## Expiry backfill

```sh
# inspect one bounded slice; repeat with the printed next_cursor
node scripts/firestore-expiry-backfill.mjs --collection driver_location_events --max-docs 5000

# write that slice
CONFIRM_EXPIRY_BACKFILL=yes node scripts/firestore-expiry-backfill.mjs \
  --collection driver_location_events --max-docs 5000 --apply
```

Export location history to R2 (`scripts/gps-archive-export.mjs`) before running
destructive retention sweeps. TTL and `cleanupDriver*Events` only remove rows
whose retention window has passed.
