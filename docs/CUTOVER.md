# Production cutover — Supabase pause to Firestore

This is the ordered plan. It is not a record of a completed cutover.

Production alias stays `dpl_Fuoo3cbEgaqichhpWL9HTX19sYBD`. Do not move it in this plan until the go/no-go list is signed.

Backend target: Firestore named database `default` on `musallam-delivery-prod` (Enterprise, `me-central2`). Cloud Functions gen2: `me-central1`.

## What is already true

Plan 3 load was verified on 2026-10-10 (`plan3-verify` mismatches = 0). Counted collections were loaded. History collections (`driver_location_events` and siblings) were never loaded. That gap is expected.

Supabase project `eoksxkdssptgyqyywdju` is paused. The admin panel and the Worker no longer call it. A live delta cannot be read from a paused project.

Delivery search still full-scans. `DELIVERY_SEARCH_BACKFILL_COMPLETE` stays false until a real backfill is approved and a prefix probe finds stamped rows. One stamped document is not completion.

`order_id_lower` + `created_at` was not deployed. Eighteen delivery prefix composites and `rollups_driver_day` (`driver_id` + day) were built. Rollup collections were empty on 2026-10-13 (`rollups_driver_day` 0, `rollups_zone_month` 0). `order_id_lower` stamped count on deliveries was 0.

## 1. Final delta sync (not executed)

Method, in order:

1. Freeze writers. Stop admin deploys, stop the rider release, and stop cron that creates deliveries. Leave read traffic up.
2. Unpause `eoksxkdssptgyqyywdju` or use a dump taken at the freeze. A paused project has no live tail.
3. Export rows changed after the Plan 3 dump watermark (table `updated_at` / `created_at` greater than the dump). Reuse `scripts/plan3-export.mjs` and `scripts/plan3-load.mjs` for those tables only. Do not load the history NEVER set.
4. Load into Firestore `default` with the same id mapping the Plan 3 load used. Do not `--apply` the rollup backfill in this step.
5. Re-run `plan3-verify` on the delta tables. mismatches must be 0 before the freeze lifts.
6. Pause Supabase again after the delta is loaded, or leave it paused for reads only. The panel must not be pointed back at it.

Duration: not measured. The full Plan 3 load was a multi-hour dump plus load. A delta is the rows written after that dump, which is unknown until the unpause. Budget a night window. Do not invent a minute count.

Freeze window: Kuwait night, after the last shift of the day, before the first clock-in. Hold writers until verify returns mismatches = 0. Reads stay on the current Firestore snapshot, which will be missing the delta until the load commits.

## 2. Ordered production steps

Do these after the delta verify, still inside the freeze for steps that write rollups.

1. Deploy non-rider writer functions that stamp search fields and set rollups: `adminBulkUpdateDeliveries`, `adminExpireStalePickups`, `reconcileDeliveryVerification`, plus any other `admin*` writer in the creation-path list. One function at a time. No `--force`. This step does not include anything named `driver*`.
2. Owner approval, then deploy rider writer functions: `driverCreatePickup`, `driverCompleteDelivery`, `driverCancelDelivery`. The owner confirms MG-GO still calls these three and does not write `deliveries` itself. See the external-writer list below.
3. Night backfill. `CONFIRM_BACKFILL_APPLY=yes` and `BACKFILL_SNAPSHOT_ID` set to the PITR snapshot taken at the freeze. Run `scripts/perf-backfill.mjs --apply` against `musallam-delivery-prod` `default`. It SETs absolute counts in batches of 400 and can resume with `--resume --checkpoint`. It does not increment. Do not run it without the snapshot id.
4. `--reconcile` pass. Same script with `--reconcile` instead of `--apply`. It scans again and SETs again. A second pass must leave rollup totals unchanged. Same confirm, same snapshot id, same resume checkpoint.
5. Set `DELIVERY_SEARCH_BACKFILL_COMPLETE=true` in code only after a prefix probe shows stamped `order_id_lower` rows and the reconcile mismatches are 0. Until that flip, delivery search stays on the full scan.

## 3. Production env vars

Set on the Vercel project before a production alias move. Do not print values.

| Name | Why |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` | Admin SDK |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Callable and staff session |
| `NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION` | Defaults to `me-central1` when unset |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Storage bucket on the Admin app |
| `ADMIN_API_ROUTER` | Unset or any value other than `off` uses the lane URLs. `off` is the legacy-URL rollback |
| `FLEET_WS_TOKEN_SECRET` | Live Tracking V2 token route |
| `FLEET_WS_URL` | Live Tracking V2 token route |
| `FLEET_ROOM` | Defaults to `fleet-kw` when unset |
| `NOTIFICATION_APPROVAL_REQUIRED_CATEGORIES` | Notification send gate |
| `NOTIFICATION_SEND_RATE_PER_MINUTE` | Notification send gate |
| `NOTIFICATION_BATCH_SIZE` | Notification send gate |

`BACKFILL_SNAPSHOT_ID` and `CONFIRM_BACKFILL_APPLY` are operator env for the backfill script. They are not Vercel runtime vars.

`DELIVERY_SEARCH_BACKFILL_COMPLETE` is a source constant, not an env var.

## 4. `/employeedesk/esign/batches`

On this branch the route was missing, so the URL 404ed. The hub card pointed at `/requests/esign/batches` and the page comment said a V2 batches URL would be a second screen.

The branch now has `/employeedesk/esign/batches` and `/employeedesk/esign/batches/[id]`. Both render the existing `EsignBatchesShell` / `EsignBatchDetailShell`. The hub card points at the EmployeeDesk URL. `/requests/esign/batches` still works. Drafts and Sent stay on `/requests/esign/...` only.

## 5. Supabase Auth to Firebase Auth

Staff login and `src/proxy.ts` already use a Firebase session cookie. Supabase Auth is not on the panel path.

Rider sign-in is employee id plus the 6-digit app passcode through Firebase (`driver_app_lookup_by_passcode` / the Firebase callable), not a Supabase password.

Tell staff: the panel password is the Firebase Auth password. A Supabase password that was never copied will not sign in. Use the panel reset flow. Existing Firebase sessions keep working.

Tell riders: the app login is still employee id and passcode. A Play build that still calls Supabase Auth will fail while the project is paused. The fleet must be on the Firebase build before the freeze lifts. This document does not claim that copy was verified in MG-GO.

## 6. Go / no-go

Go only when every line is true:

- Delta verify mismatches = 0, or the owner accepts the named gap in writing.
- Non-rider writer functions are the new revisions and a probe did not show p95 more than 20% worse.
- Rider writer functions are deployed only after the owner signed step 2.
- Backfill `--apply` finished, `--reconcile` left the same totals, scan mismatches = 0.
- Prefix probe shows stamped delivery search fields. Only then flip `DELIVERY_SEARCH_BACKFILL_COMPLETE`.
- Preview smoke of the main pages passed, or the owner accepts the untested list.
- `FLEET_WS_TOKEN_SECRET` and `FLEET_WS_URL` are set if Live Tracking V2 must issue tokens.
- Production alias move is a separate approval. This plan does not move `dpl_Fuoo3cbEgaqichhpWL9HTX19sYBD`.

No-go if any probe errors rise, a function deploy demanded `--force`, or the reconcile totals move.

## 7. Rollback, per step

| Step | Rollback |
|---|---|
| One function deploy | Redeploy the previous Cloud Run revision of that function only. Stop the sequence. |
| Lane deploy (`adminApi`, `adminApiScan`, `adminApiHeavy`) | Same: previous revision of that lane. |
| Panel preview | Leave the production alias. Do not promote the preview. |
| Panel production (future, not this plan) | `vercel promote dpl_Fuoo3cbEgaqichhpWL9HTX19sYBD` |
| Lane routing | Set `ADMIN_API_ROUTER=off` so the panel uses the legacy function URLs |
| Backfill | Do not delete rollup docs as a rollback. A bad SET is repaired by another `--reconcile` from the same snapshot. There is no down migration in this plan. |
| Auth | Do not delete Firebase users to "undo" the cutover. Supabase Auth stays paused. |

## 8. External deliveries writers the owner must verify

In this repo, and not deployed by the latency branch without a separate approval:

- `driverCreatePickup`
- `driverCompleteDelivery`
- `driverCancelDelivery`

Staff writers in this repo:

- `adminBulkUpdateDeliveries`
- `reconcileDeliveryVerification`
- `adminExpireStalePickups`
- Panel `updateDeliveryStatus` and `revertImportBatch` (Vercel, not a function)

The Worker ingest writes locations, geofence, and fleet events. It does not create delivery documents.

MG-GO / the rider app was not inspected from this repo. The owner must confirm:

- The app creates and updates deliveries only by calling the three `driver*` functions above.
- It does not write the `deliveries` collection from the client.
- It does not increment `rollups_driver_day` or `rollups_zone_month` itself.

Any writer outside those functions, including a direct client write, must stamp these six fields on every delivery document:

- `order_id_lower`
- `rider_name_lower`
- `driver_name_lower`
- `driver_code_lower`
- `employee_id_lower`
- `search_name`

Empty values are omitted. A writer that increments rollups without the marker subcollection will double-count the absolute backfill SET.

## 9. Zone cards after a future backfill

The dry-run on 2026-10-13 matched the performance snapshot when the zone is the driver's `zone_id` (mismatches 0 on the boundary week, September, and August). The backfill writer uses that driver zone. Live `applyDeliveryRollup` uses the zone the caller passes, which is often the delivery's zone. After `--apply`, a full-month zone card can move if those two zones differ. Driver KPI order counts are not overlaid. August and September had most verified orders on drivers with no zone (`none`). Do not treat that as a bug in the snapshot.

## 10. What this branch does not do

- No `vercel deploy --prod`.
- No production alias change.
- No `--apply` or `--reconcile` against production.
- No rider function deploy.
- No delete of the Stage D test user, the probe user, or `adminPerfPing`.
- No real FCM send.
- No IAM or quota change.

Driver zone, status, and attendance filters still join the fleet. Those values are computed after the driver document is read (a block overlays status, attendance is today's log). A stored-field query would disagree with the row the page shows. The default intake-sorted page defers that join. Its KPI strip still counts each intake once: linked driver `status` and `is_on_duty` only, with the same pending rule as the joined roster. A driver document that has no intake is not a KPI row.

Attendance date pages no longer stop at 5000 rows. `problems_first`, `scheduled`, `checked_in`, and `late` keyset the window up to 40000 rows and still rank in memory. A window above that still returns `attendance_window_too_large`.
