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

## Changelog

### 2026-08-11 — Admin RCM settings + ESign Visual/Fields fix pass

Not a full re-run against the baseline above (§ Baseline numbers unchanged — do not claim 100%). Screens touched this pass:

| Screen | Result | One-line reason |
|---|---|---|
| 05 Workflow Builder | PASS | Rebuilt as a vertical connected step chain (step number, role key, system-auto toggle, allowed actions, move/delete) matching Figma; leave seed still renders Submitted→Reporting Manager→HR→Payroll unchanged. |
| 06 Complaint Categories | BLOCKED (values only) | Full CRUD UI shipped (key, EN/AR labels, active toggle, delete confirm); list stays empty — no invented seed values per locked constraint. |
| 06b Request Types | PASS | Request types + fields config with inline screenshot-restriction and active toggles. |
| 07 Asset Catalog settings | PASS | Converted from a static link stub to a real read-only preview table (name, stock, active status). |
| 08 Departments | PASS | New `request_departments` / `request_department_members` tables + settings panel; starts empty, no invented seeds. |
| Drawer Edit access / Assign staff | PASS | Staff-access drawer with 3-state control (None/View/Approve) grouped by staff member. |
| 09 Reports | PASS | `requests-reports-panel.tsx` extended per Figma density. |
| 10 Audit | PASS | Auto-loads on mount with a loading-spinner empty state instead of requiring a manual trigger. |
| 11 Bulk import/export | PASS | Added an RCM Requests export card alongside the existing E-Sign export card. |
| 12 Settings Home | PASS | Settings landing wired to the panels above. |
| 13 Roles | PASS | Staff-access matrix grouped by staff member, chip-based view/approve state. |
| 14 Screenshot settings | PASS | Inline restriction toggle on request types, tri-state override respected. |
| Status conventions | PASS | `request-status-utils.ts` maps Pending/needs_clarification → orange, In review/submitted → blue, Approved/Solved → green, Rejected/Overdue → red, Awaiting acknowledgement → amber (via `payload.awaiting_driver_ack`), Draft → neutral. |
| ESign hub | PASS | Redesigned with a primary "New signature request" CTA card + two-column icon grid. |
| ESign sent/signatures/detail | PASS | Field and visual gaps closed (`esign-sent-shell.tsx`, related detail/category panels). |
| ESign categories | PASS | Covered by the same settings-actions wiring as request categories. |

Locked constraints respected: loan tenure options and complaint categories remain empty (no invented seed values); Leave approval chain and Admin notification rules unchanged (attention-badge-only, verified in Backend verification table above). Migrations `20260827100000`–`20260827105000` applied to `eoksxkdssptgyqyywdju` (migration history repaired for `20260827102100`, which had been applied out-of-band). Production build (`npm run build`) passed clean. Not deployed per instruction.
