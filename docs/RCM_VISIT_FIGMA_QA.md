# RCM + Visit Booking — Figma QA (§11 companion)

Source of truth for per-screen rows: plan `rcm_visit_booking_d61aff20.plan.md` §11 / §11.1.  
Figma: `n99SmGz5mrwpWoB363e314` — User `4004:10289` (33) · Admin RCM `3923:25694` (31) · Admin Visit `4539:10327` (9) = **73**.

## Baseline (2026-08-11 pin-to-pin)

| Result | Count |
|--------|------:|
| PASS | 23 |
| FAIL | 44 |
| BLOCKED | 6 |
| PENDING | 0 |
| **Total** | **73** |
| Figma compliance | **31.5%** |

**Figma-complete: NOT READY.** Fix → re-test cycle is running; rows flip only after a verified fix.

## Backend verification (parent agent, evidence-based)

Checked directly against project `eoksxkdssptgyqyywdju`.

| Locked rule | Evidence | Verdict |
|---|---|---|
| Leave chain | `request_approval_step_templates` (`leave`): 1 Submitted · 2 Reporting Manager `{approve,reject,reschedule}` · 3 HR `{approve,reject,reschedule}` · 4 Payroll `{approve,reject}` | UNCHANGED |
| Visit duplicate | unique partial index `visit_bookings_active_driver_date_dept_uidx` on `(driver_id, scheduled_date, department_key)` where status in (`confirmed`,`checked_in`); `driver_book_visit` also pre-checks and catches `unique_violation` → `duplicate_department_date` | ENFORCED SERVER-SIDE |
| Different dept, same date | no constraint on `(driver_id, scheduled_date)` alone | ALLOWED |
| Visit RBAC | `admin_update_visit_status` requires `visits.operate` for check-in / complete / no-show / cancel / reschedule; catalog pages gated by `visits.manage_catalog`; list by `visits.view` | CORRECT |
| KPI avg resolution | `avg(EXTRACT(EPOCH FROM (completed_at - created_at)))` over rows with `completed_at IS NOT NULL` | MATCHES RULE |
| KPI overdue | `completed_at IS NULL AND status NOT IN (approved,rejected,solved) AND created_at < now() - interval '15 days'` | MATCHES RULE |
| KPI trend | previous-month window (`v_from - 1 month` … `v_to - 1 month`), returned as `prev_*` keys | MATCHES RULE |
| Admin attention badge | `requests.needs_attention` + `attention_at`; `admin_clear_request_attention` sets `needs_attention=false, attention_cleared_at=now()`, invoked from `admin_get_request` | DB-BACKED, CLEARS ON OPEN |
| No Admin push | no notification dispatch in any `admin_*` request RPC; `notify_driver_transactional` is driver-directed only | CORRECT |
| Gated seeds | `loan_tenure_options` = 0 rows · `complaint_categories` = 0 rows | STILL GATED |
| Permissions present | `requests.approve`, `visits.view`, `visits.manage_catalog`, `visits.operate` | PRESENT |
| Migrations applied | `20260826100800`, `20260826100900`, `20260827100000` | APPLIED |

## Client confirmations still required

1. **Loan tenure options** (RSup/03 Advance, Admin Drawer Advance) — Figma shows only a `6 months` sample with no options annotation.
2. **Complaint categories** (RSup/07 Complaint, Admin Drawer Complaint, Admin `06-Complaint-Categories`) — Figma shows only a `Payments` sample.

Everything except the value list on those screens is implemented; the seed gap must not block their other QA columns.

## QA environment

- Single local dev server on port 3000.
- Authenticated admin session required for Admin Visual/Interaction re-test — this was the gap that produced the Admin FAIL/BLOCKED baseline.
- Exact Figma node IDs per Admin row are recorded in plan §11B / §11C.
