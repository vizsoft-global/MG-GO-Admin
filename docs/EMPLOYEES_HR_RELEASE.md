# Employees HR + list toolbar — release order

Branch `feat/employees-hr-list-toolbar`. This pass does **not** deploy, does **not** run `--prod`, does **not** `--force`, and does **not** write production.

## 1. Functions (`me-central1`, one name at a time, no `--force`)

Deploy only after this branch is reviewed. Existing callable names stay; do not create a second `adminListDriversPage`.

| Order | Export | Lane | Why |
|---|---|---|---|
| 1 | `archiveDriverIntake` | legacy URL | Required `archiveReason` / `p_archive_reason`. Empty reason returns `missing_archive_reason` and writes nothing. |
| 2 | `adminUpsertEmployeeCatalog` | legacy URL | Catalog writes fail-closed until this exists. Empty collections still serve in-memory seeds. |
| 3 | `adminEmployeesDashboard` | `adminApiScan` | `/drivers/dashboard` local-only until this lands. |
| 4 | `adminListDriversPage` | `adminApiScan` | `searchField` / `groupBy` / `group_counts` / `groupSortMs`. Panel Group By is already in-memory on the loaded page; this deploy is the CF sort + counts path. |
| 5 | `adminApiScan` | scan lane | Only if (4) is served through the router and the revision is still the pre-groupBy handler. |

Do not deploy rider (`driver*`) functions in this release.

## 2. Indexes READY

Prefix search for civil ID / passport uses single-field range queries on `drivers` and `driver_intakes`:

- `civil_id_lower`
- `passport_lower`

Firestore builds those automatically on first query. Wait until the Firebase console shows **READY** (not CREATING) before treating a prefix miss as a real empty page. An empty index still falls through to the existing full scan; do not flip any delivery-search backfill flag.

No new composite is required for Group By. `adminListDriversPage` still loads the list, then sorts `groupSortMs` in memory.

## 3. Backfill (dry-run, then apply)

```bash
node scripts/employees-backfill.mjs
```

This pass: `--apply` always exits `2` (`apply_blocked_this_pass`) even with `CONFIRM_EMPLOYEE_BACKFILL=yes`. Lift that guard in a later commit before any write.

When apply is later allowed:

1. Dry-run and keep the JSON (`live_missing_status_would_set_running`, `planned_writes_if_apply`).
2. Set `CONFIRM_EMPLOYEE_BACKFILL=yes`.
3. `node scripts/employees-backfill.mjs --apply` against `musallam-delivery-prod` `default` only.

### What `running` is set on

Live (`archived_at == null`) drivers and intakes whose `employee_status_key` is missing or blank.

### Statuses / fields the backfill will not touch

- `new`
- `running` already stored
- `absent_mosal`
- `absent_moi`
- `transfer_from_company`
- `on_hold`
- `training`
- `extension`
- `accident`
- any custom non-empty `employee_status_key`
- every `employee_status_key` on an archived driver or intake
- login / account fields: `drivers.status`, `is_blocked`, `archived_at`

Archived rows may still receive `civil_id_lower` / `passport_lower` search stamps. Passport uniqueness stays live-only.

## 4. Panel

Vercel **preview** first. Move `dpdadmin-prod` only after an explicit production-deploy approval. Not this branch.

## Combined Payroll Group By (implemented)

`CombinedPayrollTab` wraps `PayrollDayGrid` in `GroupedSections` the same way the Payroll summary tab wraps `PayrollSummaryTable` (`zone` / `partner` / `status`). `groupBy=none` is one grid, no extra headers.

Selection, fill, and paste stay inside that group’s grid. Shared undo/redo (`usePayrollAdjust`) is unchanged.

## Attendance & Orders Group By (not implemented)

AO is one inlined virtualized sheet: identity columns plus paired payroll/orders cells, one selection rectangle, one fill handle, and the Combined undo stack. `GroupedSections` would mount N sheets, so fill/paste could not cross a group, column filters would fork, and each group would repeat the already-wide day-header pair. The toolbar Group By on AO is therefore a no-op until that sheet is extracted the way Combined’s `PayrollDayGrid` already is.

## Re-measure `adminListDriversPage` after the Group By CF path

Read-only. Needs `PERF_PROBE_EMAIL` and `PERF_PROBE_PASSWORD` in `.env.local`. Never prints tokens.

Baseline captured on this branch (production, no deploy):

```
adminApiScan n=10 ok p50=2338 p95=3073
adminListDriversPage (legacy) n=10 ok p50=21135 p95=48568
```

Do not treat 2338 ms as the older ~1.3 s memory. That figure was not reproduced.

After `adminListDriversPage` is updated in `me-central1`:

```bash
node scripts/probe-lane.mjs
node scripts/probe-lane.mjs group-by
```

`group-by` samples three payloads on the scan lane **and** the legacy URL (10 each):

- `tag: none` — `{ tab: "all", limit: 25, offset: 0 }`
- `tag: zone` — same plus `groupBy: "zone"`
- `tag: employeeStatus` — same plus `groupBy: "employeeStatus"`

Record p50/p95 per tag for `adminApiScan` vs `adminListDriversPage`. `groupBy` must not add a second Firestore scan; extra time belongs in `groupSortMs` (CF phase log). A `groupBy` p50 more than ~200 ms above `none` on the same lane is a regression to inspect before the panel alias moves.

Invalid `groupBy` must stay `invalid_group_by` (HTTP 400), not an empty page.
