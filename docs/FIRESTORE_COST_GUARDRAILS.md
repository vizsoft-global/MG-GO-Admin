# Firestore cost guardrails

## Invariants

- The three Worker doors (`workerFleetRead`, `adminIngestDriverPositions`,
  `adminRecordFleetEvents`) are the only functions allowed to override the
  global `cpu: 0.08 / concurrency: 1 / maxInstances: 2` shape. They run at
  `cpu: 1 / concurrency: 40 / maxInstances: 20 / minInstances: 1`.
  Deploy each one separately with `--force` (Firebase asks for it because
  `minInstances` raises the minimum bill); the option change is still the
  rollback boundary.
- GPS history targets R2 (`GPS_SINK=r2`, `GPS_SINK_PERCENT=100`). The
  2026-10-19 cutover set `GPS_DUAL_WRITE=0` and
  `app_settings/1.location_gps_r2_since=2026-10-19`; Firestore is now the
  pre-cutover history and the pin store, not the live history sink.
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
the Firestore fallback writes. Provision these with a project Owner/Monitoring
Admin; the Firebase service account used by the scripts does not have
`monitoring.alertPolicies.*`, so it cannot create them (`403 PERMISSION_DENIED`).

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
2. Export the cutover day from Firestore to R2 (the export also writes
   `rider_day_stats`):

   ```sh
   CONFIRM_GPS_EXPORT=yes node scripts/gps-archive-export.mjs \
     --from <YYYY-MM-DD> --before <next-day> --apply
   ```

3. Compare the archive with Firestore. The script reads the Worker `/history`
   archive (not the export-written stats) and dedupes Firestore timestamps:

   ```sh
   node scripts/gps-dual-write-compare.mjs --day <YYYY-MM-DD>
   ```

   A clean full-day run is `OK <all>, DIFF 0`. The 2026-10-19 run was
   **220/220 OK**. `--since <ISO>` is available for a partial cutover-day
   overlap; the comparison tolerates Firestore's intentionally thinner history
   by requiring distance coverage, not equal point counts.

4. Only after the compare is clean, stamp the cutover day first, then set
   `GPS_DUAL_WRITE=0` and redeploy the Worker:

   ```sh
   CONFIRM_GPS_CUTOVER=yes node scripts/gps-r2-cutover.mjs --day <YYYY-MM-DD> --apply
   ```

   Stamping first is safe because the day is already in R2; readers switch while
   the Worker is still dual-writing, so there is no history gap if the deploy
   fails.

5. Only after the cutover may `LOCATION_EVENTS_ARCHIVED=1` shorten Firestore
   location retention to 7 days. Do not set it until the historical export is
   complete; the existing 24M-row backlog is still pre-cutover history.

Rollback: set `GPS_DUAL_WRITE=1`, redeploy, and clear
`location_gps_r2_since` (or point it at a later day). `GPS_SINK=off` +
`GPS_SINK_PERCENT=0` is the full edge rollback. The phone fallback keeps working.

### Export pagination gotcha

`gps-archive-export.mjs` must paginate with an explicit `.orderBy("__name__")`
before `.limit(2000); startAfter(cursor)`. Without it Firestore can skip rows at
the page boundary; the first 2026-10-19 export lost 6,646 points across riders
and the fixed run exported 113,340. Re-run the export after any pagination
change and require `failed 0`.

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
