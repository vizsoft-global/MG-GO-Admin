# Employees backfill — APPLY plan

**Status: blocked.** Owner OK is still required. This pass ran a read-only dry-run only. Do **not** run `--apply`. Do **not** set `CONFIRM_EMPLOYEE_BACKFILL=yes`.

`--apply` exits `2` with `apply_blocked_this_pass` even when the confirm env is set (`scripts/employees-backfill.mjs`). The script has no write loop yet; lifting the guard in a later commit is a separate change from this plan.

Target: `musallam-delivery-prod` named database `default` only.

Source of the numbers below: `node scripts/employees-backfill.mjs` (no `--apply`) on 2026-10-15. Elapsed **99636 ms** (~99.6 s). Exit 0.

## Dry-run JSON (this pass)

```json
{
  "mode": "dry-run",
  "scanned": 1799,
  "drivers": 899,
  "intakes": 900,
  "live": 1799,
  "archived": 0,
  "live_missing_status_would_set_running": 1799,
  "archived_status_never_written": 0,
  "archived_search_stamps_only": 0,
  "stamp_civil_id_lower": 179,
  "stamp_passport_lower": 0,
  "planned_writes_if_apply": 1799
}
```

| Metric | Value |
|---|---|
| `planned_writes_if_apply` | **1799** |
| `live_missing_status_would_set_running` | **1799** (899 `drivers` + 900 `driver_intakes`) |
| `stamp_civil_id_lower` | 179 (subset of the 1799; same docs, extra field) |
| `stamp_passport_lower` | 0 |
| `archived` | 0 in this scan |
| Dry-run elapsed | **99.6 s** (measured) |
| Apply duration | **estimate 2–5 min** (not measured). Dry-run was ~100 s of reads. A later write path for 1799 docs (Firestore batch cap 500 ⇒ four batches plus the same scan) is expected in that band. Label: estimate. |

This JSON is **counts only**. It does not list document ids.

## What `running` is set on

Copied from the script header:

- ONLY live (`archived_at == null`) rows with an empty `employee_status_key` are planned as `employee_status_key=running`.

## What is never touched

Copied from the script header:

- never writes `new`, `absent_mosal`, `absent_moi`, `transfer_from_company`, `on_hold`, `training`, `extension`, `accident`, `running` (already set), or any custom non-empty key
- never writes `employee_status_key` on archived drivers/intakes
- never touches `drivers.status`, `is_blocked`, or `archived_at`
- archived and live rows may still be planned for `civil_id_lower` / `passport_lower` search stamps
- passport uniqueness is among live rows only (`archived_at == null`)

This dry-run matched that: every scanned row was live and missing status; 179 would also get `civil_id_lower`; no passport stamps; no archived status writes.

## Verification after apply (when owner later allows it)

1. Re-run `node scripts/employees-backfill.mjs` (no `--apply`).
2. Expect `live_missing_status_would_set_running` = **0**.
3. Expect `planned_writes_if_apply` = **0** for the running + search stamps this plan covers (`civil_id_lower` is inside the 1799). A non-zero remaining count must be search-only, never `employee_status_key:running`.
4. Spot-check archived never received `running`: this scan had `archived` = 0, so there is no archived id list to check today. After apply, any row with `archived_at` set must still have empty / pre-existing `employee_status_key`, never a backfill `running`.
5. Spot-check a few live drivers: `employee_status_key` is `running`; `status` / `is_blocked` / `archived_at` unchanged.

## Rollback

Setting `running` cannot be undone without a snapshot. There is **no** down migration and none should be invented.

- **PITR** of `musallam-delivery-prod` / `default` to a time before apply.
- **Manual unset** of `employee_status_key` only for ids that appear in a dry-run JSON that lists them.

This 2026-10-15 dry-run JSON has **no ids**, so manual unset cannot be executed from it. Do not unset from the counts. Capture ids in a later dry-run before any apply if manual unset must stay an option.

## Still waiting

- Owner OK: **no**.
- Apply: **blocked** (`apply_blocked_this_pass`).
- Confirm env: must stay unset. `CONFIRM_EMPLOYEE_BACKFILL=yes` is not enough while the script guard remains.
