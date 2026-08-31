# Driver profile history

**Date:** 2026-08-31  
**Surface:** Admin only (`/drivers/[id]` History tab)  
**Approved:** dedicated `driver_change_events` table; History tab; every write path that touches the rider; going forward only.

## Problem

A rider’s file has no staff changelog. `admin_activity_logs` already exists, but create/edit store a couple of ids, import is one batch line, and restaurant / document / asset writes are keyed as other entities. The driver **Activity** tab is the rider’s own clock-in / deliveries, not who changed the profile.

## Decision

A dedicated append-only table, written by one helper from every admin write path. History tab queries that table. Settings → Logs stays the fleet-wide dump (`admin_activity_logs`); each helper call also writes a thin row there so the two views do not fork.

No backfill. Old diffs were never stored. The first History row for an existing rider is the next change after this ships.

## Data model

`public.driver_change_events`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `created_at` | timestamptz | Kuwait-displayed in UI; stored UTC |
| `intake_id` | uuid not null | Always the intake. History query uses this even before approve |
| `driver_id` | uuid null | Set when the write knows the linked profile. Not backfilled onto older rows |
| `actor_id` | uuid not null | `profiles.id` of the staff member |
| `actor_name` | text not null | Copied at write time so a later rename does not rewrite history |
| `source` | text not null | See catalogue below |
| `changes` | jsonb not null | `[{ "field": "phone", "before": "…", "after": "…" }]` — diffs only |
| `context` | jsonb not null default `{}` | Optional extras: import file name, document type, batch id |

Indexes: `(intake_id, created_at desc)`, `(driver_id, created_at desc)` where `driver_id is not null`.

`source` check constraint — exactly these values:

`manual_create` · `bulk_import` · `edit` · `approve` · `archive` · `restore` · `status` · `block` · `unblock` · `passcode` · `document` · `asset` · `assignment`

`changes` is an array. A first create uses `before: null` for each field that was set. An update omits unchanged fields. A write that produces `[]` does **not** insert a row (except `passcode`, `archive`, `restore`, `approve` with no field diffs — those still insert one row with an empty `changes` array and a `context.note` such as `passcode replaced`).

Passcodes, raw tokens, and object bytes never appear in `changes` or `context`.

### RLS

- Enable RLS.
- Staff `SELECT` where `is_admin_panel_user()`.
- **No** `INSERT` / `UPDATE` / `DELETE` policy. History is append-only and not writable from PostgREST under a staff role.
- No driver policy. Riders never read this table.

Writes use the service-role admin client from the server helper only.

## Helper

`logDriverChange` in `src/features/drivers/driver-change-log.ts` (server-only).

```
logDriverChange({
  intakeId, driverId?, source, before, after, context?
})
```

- Resolves `actor_id` / `actor_name` from the session. If there is no staff session, no-op.
- Diffs `before` vs `after` with the same JSON-stringify rule `computeChangedFields` already uses. Values in the stored diff are display strings (zone **name**, restaurant names joined, `yes`/`no`, not UUIDs).
- Skips the insert when `changes` is empty **and** `source` is `edit`, `bulk_import`, `document`, `asset`, or `assignment`.
- Inserts via `createAdminClient`. Swallows errors. **Never throws.** A dead log must not fail Add / Edit / Import / Approve.
- Also calls `logAdminMutation` with `entityType: "driver_change"`, `entityId: intakeId`, `context.source`, so Settings → Logs still sees the action.

Pure `diffDriverChange(before, after)` is exported and unit-tested. It is the only place field keys are decided.

### Field keys (profile snapshot)

Used on `manual_create`, `bulk_import`, `edit`, and `approve` when those paths also copy fields:

`full_name` · `phone` · `civil_id` · `employee_id` · `driver_code` · `partner` · `zone` · `restaurants` · `vehicle` · `nationality` · `rider_category` · `client_id` · `client_name` · `workflow_status` · `account_status` · `custom_fields` (one change entry per custom key: `custom.<key>`)

Assignment-only paths (`assignment`) use `zone` and/or `restaurants`. Document paths use `document.<doc_type>` with before/after `absent` / `uploaded` / `replaced` and optional `expiry`. Asset paths use `asset.<catalog_key>` with quantity before/after.

## Write paths

Every path below calls the helper after the main write succeeds.

| Source | Call site |
|---|---|
| `manual_create` | `createDriverIntake` |
| `bulk_import` | `applyOneImportRow` (create or update). A second call with `approve` if that row minted a login |
| `edit` | `updateDriverIntake` — snapshot the intake (and linked `drivers` row) **before** the update |
| `approve` | `approveDriverIntake` |
| `archive` / `restore` | `archiveDriverIntake` / `restoreDriverIntake` |
| `status` | `updateDriverAccountStatus`, `updateDriverWorkflowStatus` |
| `block` / `unblock` | `setDriverBlocked` |
| `passcode` | `regenerateDriverPasscode` — `context.note = "passcode replaced"` |
| `document` | Admin document upload / replace / expiry routes and actions |
| `asset` | Asset sync on create/edit and Assets tab assigns/removes |
| `assignment` | `assignDriverToRestaurant`, `assignDriverToZone`, `unassignDriverFromRestaurant`, and restaurant-page assigned-driver writes that go through those actions |

`forceSignOutDriver` and `setDriverLoginVerificationExempt` are **out of scope**. They are session / verification flags, not the rider file.

## UI

New **History** tab on `/drivers/[id]`, first in the tab list (before Attendance).

- Visible to `drivers.view` (same as the rest of the detail page). Not gated on `audit.view`.
- Newest first. Timestamp in Kuwait, `31 Aug, 15:27`.
- Columns / row: when, who (`actor_name`), source badge, changes.
- Source badges: Created (manual) · Imported · Edited · Approved · Archived · Restored · Status · Blocked · Unblocked · Passcode · Document · Asset · Assignment.
- Changes render as `Label    before  →  after`. `before` of `null` shows `—`.
- Empty state: “No profile history yet. Changes from this point on will appear here.”
- Infinite scroll or “Load more”, page size 30. Query key `queryKeys.drivers.history(intakeId)`.
- No inner modal. This is a detail tab (view page pattern).
- Dense: `h-9` is N/A; table uses `TABLE_HEAD_CLASS`. Selected source filter chips use `ToggleChip` emerald when narrowed (All / Created / Edited / Assignment / …). Default All.

English + Arabic under `pages.driverDetail.history.*`.

## Query

`listDriverChangeEvents({ intakeId, driverId, source?, cursor? })` — `drivers.view`. Filter `intake_id = intakeId` (driver_id alone is not enough: pre-approve rows have no `driver_id`). Optional `source` filter.

## Failure

- Helper catch-all: log failure is invisible to the operator. The save they just did still succeeds.
- History query failure: tab shows a distinct load-failed state, not the empty state (same lesson as the performance list).
- No retries, no queue. A missed row is gone.

## Tests

`src/features/drivers/driver-change-log.test.ts` via `npm run test:drivers`:

- Diff: unchanged keys omitted; create emits `before: null`; custom fields keyed `custom.<key>`.
- Empty edit produces no insert (assert via a captured “wouldInsert” or by testing the skip rule).
- Passcode source never includes a `passcode` key in `changes` or `context`.
- Source catalogue is exhaustive vs the check constraint list.

No production probe rows.

## Out of scope

- Reconstructing history from existing `admin_activity_logs`.
- Driver-app visibility.
- Editing or deleting history.
- `forceSignOutDriver` / login-verification exemption.
- Export CSV (can follow; Settings → Logs already exports the thin twin).

## Admin changelog line

`[admin only] 2026-08-31` — Driver History tab from a dedicated `driver_change_events` ledger. No app / schema handoff beyond the new staff-only table.
