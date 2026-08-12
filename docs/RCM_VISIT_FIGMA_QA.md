# RCM + Visit Booking — Figma QA (§11 companion)

Source of truth for per-screen rows: plan `rcm_visit_booking_d61aff20.plan.md` §11 / §11.1.  
Figma: `n99SmGz5mrwpWoB363e314` — User `4004:10289` (33) · Admin RCM `3923:25694` (31) · Admin Visit `4539:10327` (9) = **73**.

## Score (re-scored 2026-08-12)

| Result | Admin (40) | User (33) | Total |
|--------|-----------:|----------:|------:|
| PASS | 30 | 23 | **53** |
| PARTIAL — Figma element, no server support | 6 | 4 | **10** |
| BLOCKED — client value list / no signed row | 3 | 3 | **6** |
| FAIL | 0 | 3 | **3** |
| OUT OF SCOPE | 1 | 0 | 1 |
| Figma compliance | **75.0%** | 69.7% | **72.6%** |

Baseline on 2026-08-11 was PASS 23 · FAIL 44 · BLOCKED 6 (31.5%). Counting PARTIAL as shipped-with-a-documented-gap gives 63/73 = 86.3%. Per-row verdicts live in plan §11A / §11B / §11C.

**Admin side has no FAIL rows left** — all 40 rows were re-tested against a real admin session at 1366×768, then re-swept on a production build (25/25 routes fit the viewport).

**The largest remaining defect is not in this table.** The driver app's `lib/features/support/` has zero `AppLocalizations` references, so every RCM / Visit Booking / E-Sign string in the rider app is hardcoded English while the rest of the app ships `app_en.arb` and `app_ar.arb`. No User row has Arabic parity; the 69.7% above is English-only parity.

**Figma-complete: NOT READY** — blocked on that localisation gap, the 3 unverified User rows (RSup/11, 25, 26), the 6 client value/decision items, and the 6 PARTIAL rows that each need a server-side addition.

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

### 2026-08-12 — Admin E-Sign authenticated re-test (5 screens)

Nodes `4447:4342` (hub), `4345:4342` (Sent), `4345:5006` (Signatures), `4345:5670` (detail), `4345:6334` (Categories) at 1366×768. All five now **PASS**; the detail row carries two BLOCKED columns (Val, Ix) because production has no signed request to exercise. Fixes in `fa10777` and `4de6ba3`:

| Screen | Was | Fix |
|---|---|---|
| Detail `4345:5670` | Page scrolled 1194px; Figma's two columns rendered as one | `lg:grid-cols-[1fr,320px]` is invalid CSS — a bare comma inside the bracket makes the whole declaration drop. Now `minmax(0,1fr)_320px`, 768/768. |
| Detail | Figma's "Viewed" step showed a schema explanation to the user | Renders as an explicit "Not tracked yet" state; proof rows in two columns so a signed request with 8 fields still fits. |
| Categories `4345:6334` | Switch showed green ON beside **Blocked** — fails the ui-system §5 squint test | ON = Allowed, as in Figma. Headers CATEGORY / SCREENSHOTS / ACTIVE. |
| Sent + Signatures | KPI labels clipped, a third of the strip empty, ACTIONS column caused horizontal scroll | 4-up KPI strip, ACTIONS dropped (not in Figma) in favour of the §6 "View details" row link. hScroll 0. |
| Create modal | Category trigger printed raw `__none` | Renders "No category". |
| `esign-actions.ts` | **Functional:** create never sent `document_storage_key`, so every admin-raised request reached the driver with nothing to sign | Uploads the file (WebP rejected, 10MB cap) and passes the key; categories persist `icon_key`. |

The invalid-bracket-comma bug was checked across `src/` — that was the only occurrence, and the `calc()` cases all sit in Tailwind arbitrary values where the compiler inserts the spaces.

Shared-component defect this surfaced: `KpiGrid` was hard-coded to `xl:grid-cols-6`, so **every** page with fewer than six KPIs clipped its labels (visible on `/requests/settings/reports` as "AVG. RESOLUTI…"). The column count now follows the item count.

Third dev-environment red herring, for the record: the dark disc overlapping the sidebar avatar in every screenshot is `nextjs-portal`, the Next dev-tools indicator, confirmed by hit-testing that point. Not app markup.

### 2026-08-12 — QA demo data removed from production

The temporary QA rows are gone from `eoksxkdssptgyqyywdju`: 8 requests tagged `payload.demo_qa` (RCM-0002…0007, RCM-0010 approved+ack, RCM-0011 needs_clarification), 3 visits (VIS-00001…00003), and 2 e-sign rows (SIG-1400/1401, the ones whose `document_storage_key` was bucket-prefixed at a non-existent object). Children cascaded cleanly — `request_approval_steps`, `request_clarifications`, `request_attachments`, `loan_terms` and `visit_booking_notes` are all at 0. Configuration was left alone (`esign_categories` still holds its 7 rows, as do the visit branches / departments / slots).

Also removed the 7 transactional campaigns those QA actions generated, with their dispatch runs and items. They deep-linked to records that no longer exist, so a rider tapping one would have opened a dead screen.

Consequence to expect: **`/requests`, `/visit-bookings` and `/requests/esign` now show empty states**, because every row in those three tables was QA data — no rider has submitted a real request, visit or signature yet.

E-Sign gaps that need a client or schema decision: `Accepted` / `Completed` statuses exist in Figma but not in `esign_requests`; there is no `viewed_at` column or driver-app write for Figma's "Viewed" timestamp; "Download audit trail" has no artifact defined. Also two QA seed rows (SIG-1400/1401) carry `document_storage_key` values prefixed with the bucket name (`esign-documents/demo/...`) pointing at objects that do not exist, so they can never render a document — real uploads use bucket-relative keys. And all five routes require `requests.manage`, not `requests.view`, which hides E-Sign entirely from read-only operators — fail-closed, but confirm it is intended.

### 2026-08-12 � Driver app re-verify (RCM + Visit Booking + E-Sign)

Verified in the Flutter repo (`MGgo(DPD)-USER/MG-GO`, branch `vikram-dev`) against Figma, `pg_proc` and the admin implementation. No emulator or device was available, so this is contract-and-layout verification, not runtime.

The good news first: **all 14 RPC calls in `support_service.dart` match the real function signatures exactly** � every function name, every argument name, all 8 `request_type` values and all 3 `severity_level` values. So none of the earlier User FAIL rows was a silent-failure defect. Two names in the re-test brief do not exist server-side and the app already used the correct ones (`driver_list_my_requests`, `driver_submit_clarification`). `listMyVisits()` deliberately queries `visit_bookings` directly rather than through an RPC, which works because of the `drivers_select_own_visit_bookings` policy.

Three commits: `03c22fb` � the rider check-in QR now encodes the bare `booking_code` through a shared `booking_qr.dart` (ticket step 88px, confirmed-visit row 48px), matching the admin's `<QRCodeSVG value={visit.booking_code} level="M">`; the previous code fell back to the literal string `visit` when the code was empty, which rendered a perfectly scannable QR pointing at no booking. It also adds a white background and padding, because `QrImageView` defaults to transparent and scanners read that as low contrast. `04df327` � approval-step decision times render in local time instead of UTC. `7517f36` � Figma's step wording, replacing a row that read "In review since" with nothing after it (`request_approval_steps` has no `started_at`, and `decided_at` is null while a step is open).

`qr_flutter` was already a dependency at `^4.1.0` resolving to 4.1.0 under `sdk: ^3.11.0`, so no version bump was needed. `flutter analyze`: 7 issues, 0 errors, all pre-existing.

**Release blocker found:** `lib/features/support/` contains **zero** `AppLocalizations` references. Every string across RCM, Visit Booking and E-Sign is hardcoded English, in an app whose other ~75 files are driven by `app_en.arb` / `app_ar.arb`. Roughly 20 files and several hundred strings. Too large to fix surgically inside a QA pass � needs its own task.

Smaller items flagged and deliberately left alone: `support_models.dart` maps both `pending` and `submitted` to the label "Pending" while Figma RSup/10b shows "Submitted" (changing it ripples through every list); the tab reads "Request Recieved", which is Figma's own spelling; and `DriverAppointment.needsResponse` checks only `status == 'pending'` although `driver_respond_appointment` accepts `pending` or `scheduled` � the getter is currently unused, so it is a trap rather than a live bug.

Server-side gaps that cap these screens: `request_approval_steps.decided_by` is a bare uuid with no name join, so Figma's "Ahmed K � 12 Jul, 09:14" can only ever render the timestamp; there is no `started_at`; and loan / complaint submission is blocked by design until `loan_tenure_options` and `complaint_categories` are seeded.

One consequence of the demo purge to keep in mind: because all four tables are now empty, nobody can exercise these screens with real data until a rider submits something or a staging seed is agreed.
