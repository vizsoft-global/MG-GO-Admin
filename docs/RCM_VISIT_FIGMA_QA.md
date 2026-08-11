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

### 2026-08-12 — Admin Visit Booking authenticated re-test (7 screens)

Re-tested at 1366×768 with a real admin session; every mutation was rolled back afterwards (VIS-00001 back to `confirmed`, branch desk count restored, blocked date removed, department handling time cleared).

| Node | Screen | Result | One-line reason |
|---|---|---|---|
| `4195:11440` | VB/07 Branches | PASS | Footer-first Add/Edit modal with Close outside; edit round-trip written to DB and restored. |
| `4195:8626` | VB/01 All visits | PASS + gap | Fixed status pill, `12 Aug` date order and a clipped ACTIONS column (`fa9d3ca`); Figma's bulk-select checkbox column has no visits bulk RPC to drive it. |
| `4195:8350` | VB/00 Hub | PASS | MANAGE / CONFIGURE grouping with live badge counts. |
| `4195:9172` | VB/02 Calendar | PASS + gap | Day/Week toggle and branch picker correct; the purple Appointment overlay belongs to the appointments module. |
| `4195:10894` | VB/05 Slots | PASS | Blocked-date add → verify → remove round-trip, table back to 0 rows. |
| `4195:11133` | VB/06 Departments | PASS + gap | 11 rows above the fold; no branch filter because `visit_departments` has no `branch_id`. |
| `4195:11679` | VB/08 Reports | PASS | Bars and date presets work; KPI trend deltas need a prior-period aggregate RPC. |

Day view scrolls horizontally with 11 real departments against Figma's 5 mock columns, which is acceptable for a resource calendar. The dev server died once from memory exhaustion and was restarted with `--max-old-space-size=6144`. `npx tsc --noEmit` clean.

### 2026-08-12 — Admin RCM detail + typed drawers re-test (11 rows)

| Node | Screen | Result | One-line reason |
|---|---|---|---|
| `4149:24728` | Request detail | PASS | `docH == 768` on all 8 requests; approve / reject / clarify / decision-terms round-trips verified against the DB. |
| `4149:25358` | "detail variant" | OUT OF SCOPE | The node is actually the list page's *Raise a request to a rider* modal, not a detail state. |
| `4149:26963` | Drawer Leave | PASS | 633px tall, no inner scroll; From/To collapsed into Figma's single "Dates" row. |
| `4149:27065` | Drawer Asset | PASS | Only populated rows, matching Figma (7 empty "—" rows removed). |
| `4149:27167` | Drawer Fuel | PASS | Amount reads `18.500 KWD`. |
| `4149:27269` | Drawer Complaint | BLOCKED (values only) | `complaint_categories` still 0 rows; the gated message renders. |
| `4149:27371` | Drawer Document | PASS | 534px. |
| `4332:4342` | Drawer Advance | BLOCKED (values only) | `loan_tenure_options` still 0 rows; everything else correct. |
| `4332:4455` | Drawer Salary justification | PASS | Reordered to Figma's Period / Net paid / Expected. |
| `4332:4561` | Drawer Sick leave | PASS | Attachment click reaches the server action (storage object genuinely absent). |
| `4321:8349` | Status conventions | PASS + gap | Every enum-backed status maps with a dot; `Rescheduled` / `Responded` / `Closed` are not in the `request_status` enum. |

Root cause of the drawer failure: `w-[min(440px,calc(100vw-24px))]` produced invalid CSS (`calc` needs spaces around the operator), so the drawer lost its width **and** height and ran off screen. Sized inline instead. Also removed the duplicate footer Close per ui-system §7.

Gaps needing server or client decisions: approval steps carry `decided_by` as a bare uuid with no `started_at`, so Figma's "Submitted by Divya R" / "Waiting since 09 Jul" cannot render; the requester row cannot show zone because the RPC does not return it; Fuel's "Transfer type (on approval)" is not in the frozen decision-meta key list and would invent a driver-app contract.

Two dev-environment red herrings that three separate re-tests reported, now explained rather than chased:

- The "hydration mismatch on every dashboard page" is `data-cursor-ref` injected into the sidebar by the QA browser tooling itself, not app code.
- The intermittent `No QueryClient set` 500 arrives with Turbopack panics of the form `process has locked a portion of the file (os error 33)` — Windows file locking on `.next` while several browsers compile at once. `@tanstack/react-query` is a single deduped copy and `QueryProvider` does wrap the tree, so re-confirm on the next production build rather than refactoring the provider. `scripts/qa-manifest-guard.mjs` repairs the manifest those panics corrupt.

### 2026-08-12 — "Fits one viewport" was measured wrong; four screens actually overflowed

Every earlier Rsp verdict in this file, mine included, measured `documentElement.scrollHeight`. The dashboard shell is `h-svh overflow-hidden`, so that value is **always** 768 and the check could never fail. The real content scroller is `<main>`. After fixing the metric (`scripts/qa-shot.mjs`, plus `scripts/qa-overflow.mjs` and `scripts/qa-heights.mjs` for attribution), four of the 25 Admin routes were over the fold with production data:

| Route | Was | Now | What changed |
|---|--:|--:|---|
| `/requests/overview` | +294px | 0px | Rebuilt to the Figma architecture: no page-title band (breadcrumb only), the nine queue tabs share one row with Export / Settings / New request, filters + result count + search on the second row, `12 Aug` dates, eye-icon row action, compact KPI strip. |
| `/requests/settings/reports` | +295px | 0px | Density pass: compact KPI strip, shorter bars, department bar list capped at the four slowest (the table below still lists every department), single-line card headers. |
| `/requests/settings/screenshot` | +141px | 0px | Split the one 17-row table into the two groups Figma already labels — Request types beside E-Signature categories — with a fixed table layout so no column is clipped. |
| `/requests/settings/roles` | +13px | 0px | Page stack tightened to `space-y-3`. |

`KpiCard` / `KpiGrid` gained an opt-in `compact` prop (caption beside the value, as in Figma) — no existing caller changed. Sweep after the fixes: **25/25 routes at `scroll=0px side=0px inner=0`**, one console error in the whole run (a Supabase 429 from the sweep's own request rate).

Deliberate deviation to record: Figma's screenshot-settings mock has 10 rows in one table; production has 15, which cannot fit stacked. The two-column split keeps every row and both group labels.
