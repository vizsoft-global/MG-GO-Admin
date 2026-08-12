# RCM + Visit Booking — Figma QA (§11 companion)

Source of truth for per-screen rows: plan `rcm_visit_booking_d61aff20.plan.md` §11 / §11.1.  
Figma: `n99SmGz5mrwpWoB363e314` — User `4004:10289` (33) · Admin RCM `3923:25694` (31) · Admin Visit `4539:10327` (9) = **73**.

## Score (re-scored 2026-08-12)

| Result | Admin (40) | User (33) | Total |
|--------|-----------:|----------:|------:|
| PASS | 33 | 26 | **59** |
| PARTIAL — Figma element, no server support | 6 | 6 | **12** |
| BLOCKED — no signed row / device | 0 | 1 | **1** |
| FAIL | 0 | 0 | **0** |
| OUT OF SCOPE | 1 | 0 | 1 |
| Figma compliance | **82.5%** | 78.8% | **80.8%** |

Baseline on 2026-08-11 was PASS 23 · FAIL 44 · BLOCKED 6 (31.5%). Counting PARTIAL as shipped-with-a-documented-gap gives 71/73 = 97.3%, and no FAIL row remains. Per-row verdicts live in plan §11A / §11B / §11C.

**Admin side has no FAIL rows left** — all 40 rows were re-tested against a real admin session at 1366×768, then re-swept on a production build (25/25 routes fit the viewport).

**The localisation gap that dominated this table is closed.** `lib/features/support/` had zero `AppLocalizations` references; 19 files now go through `context.l10n` with 352 new English/Arabic key pairs, parity proven at 856 keys each side with matching placeholder sets. The Arabic has not been seen rendered, and a handful of coined terms want a Gulf-native reviewer.

**Figma-complete: NOT READY** — what remains is the client decisions now approved and queued as schema work, the 12 PARTIAL rows that each need a server-side addition, one Arabic review pass on a real device, and the fact that no driver screen has ever been rendered here (no emulator or device), so every User row is a code-and-Figma verdict rather than an observed one.

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
| Gated seeds | `loan_tenure_options` = 6 rows (3/6/9/12/18/24) · `complaint_categories` = 9 rows, all active | SEEDED 2026-08-12 |
| Permissions present | `requests.approve`, `visits.view`, `visits.manage_catalog`, `visits.operate` | PRESENT |
| Migrations applied | `20260826100800`, `20260826100900`, `20260827100000` | APPLIED |

## Client confirmations received

Both value lists came back on 2026-08-12 and are seeded in production, so the five rows that were blocked on them are now scored:

1. **Loan tenure options** — 3, 6, 9, 12, 18 and 24 months. Unblocks RSup/03 Advance and Admin Drawer Advance.
2. **Complaint categories** — Payments, Salary Issues, Attendance / Check-in, Visit / Booking Issues, Vehicle / Fuel, HR / Workplace, Document / E-Sign Issues, App / Technical Issue, Other. Unblocks RSup/07 Complaint, Admin Drawer Complaint and Admin `06-Complaint-Categories`.

Every other confirmed decision is tracked in [`RCM_VISIT_OPEN_ITEMS.md`](RCM_VISIT_OPEN_ITEMS.md).

## QA environment

- Single local dev server on port 3000.
- Authenticated admin session required for Admin Visual/Interaction re-test — this was the gap that produced the Admin FAIL/BLOCKED baseline.
- Exact Figma node IDs per Admin row are recorded in plan §11B / §11C.

## Changelog

### 2026-08-12 - Phase 3c: the driver-app field renderer

A request type an admin creates is now reachable and fillable on the phone.

**Hub tiles are server-driven.** `support_hub_screen` reads `request_type_definitions` ordered by `sort_order`; a pending or failed fetch falls back to the built-in eight, so the hub is never empty offline. For the eight known keys the tile keeps its ARB label and icon rather than the server's, which preserves the Figma wording ("Sick / Accident leave") and the reviewed Arabic.

**Custom types render from their field definitions.** The router sends any key outside `kBuiltInRequestTypes` to `DynamicRequestFormScreen`, which draws one control per `request_field_definitions` row - text, textarea, number, date, month, select, multiselect, checkbox, file - and routes each value by `target` to a payload key or a `requests` column. The eight built-ins keep their handwritten forms untouched, so there is no regression surface on the forms riders actually use today.

**Verified.** Four widget tests (`test/dynamic_request_form_test.dart`) cover: one control per definition, required-field validation firing before any RPC is attempted, Arabic labels chosen from `label_ar`, and multiselect accumulating every tapped option. The wire contract was checked against production in a self-rolling-back transaction: a temporary custom type with a required select, a required `details` field and `min_attachments = 1` returned ACCEPTED for the payload shape the renderer produces, and `field_required:item`, `field_required:reason`, `attachments_required` for each omission. `flutter analyze` reports the same 7 pre-existing issues as before the change, none in the new files.

**Not covered.** No on-device pass yet; the multiselect and month controls have never been drawn on a real screen, and Arabic bidi for a server-authored label is untested (Phase 4). Static option lists are still not validated server-side, so a stale build can submit an option an admin has since removed.

### 2026-08-12 - Phase 3b: the request-type builder

Row **06b Request Types** was PASS against Figma while being, in substance, a screenshot/active toggle over eight hardcoded slugs with a disabled Add button. It is now a builder over `request_type_definitions`: the list shows fields, chain steps and live requests per type, Add opens a `?add=1` modal, and each row leads to `/requests/settings/types/[key]` where the form fields are edited against `request_field_definitions`. The workflow builder's type dropdown reads the same table, so a new type can be given a chain without a migration.

Verified in a real admin session at 1366x768 rather than from the build manifest: the eight built-ins render with lock badges; the Add modal fits in 400px of a 768px viewport with no inner scroller, auto-derives `uniform_replacement` from "Uniform Replacement", and disables the acknowledgement switch the moment the terminal status is set to Solved (a resolved request has nothing to acknowledge). On `/types/leave` all 43 inputs and 15 selects are inert, the switches refuse to toggle, Add field and Save are disabled and no Delete button is rendered. A full create -> add field -> save -> delete round trip through the real server actions was run against production and cleaned up.

**The lock is a trigger, not a disabled button.** The panel writes to these tables through PostgREST under a staff policy that permits any write, so `rcm_guard_system_request_type` (`20260903100000`) is what actually stops a built-in from being edited. Nine cases were replayed in a rolled-back block: field insert/update/delete on a system type, key rename, system delete, and minting `is_system` from outside a migration were all rejected; a label edit on a built-in, full CRUD on a custom type, and the `SET LOCAL rcm.allow_system_edit = 'on'` escape hatch were all allowed. A type created purely through the builder is then enforced by `rcm_validate_request_input` exactly as a built-in is (`field_required:uniform_size`, `attachments_required`, `request_type_inactive`), with `leave` unchanged alongside it.

Two links moved rather than being dropped: `Tenure options` and `Complaint categories` were reachable only from the types list, so they now sit on the loan and complaint detail pages, next to the value lists they populate.

Still honest about the gap: a custom type has no form anywhere until the app ships the field renderer, and the admin on-behalf dialog is likewise still hardcoded to the eight. The Add modal says exactly that instead of implying riders can already see it.

### 2026-08-12 — Phase 1: the client's answers, shipped

Every question in `RCM_VISIT_OPEN_ITEMS.md` section A came back answered, and this is the first of the phased releases against those answers.

**The two value lists are seeded** (`20260830100000`): 6 loan tenures (3/6/9/12/18/24) and 9 complaint categories with Arabic labels. Both tables gate their rider form server-side — `driver_create_request` refused a loan with `tenure_options_not_configured` and a complaint with `complaint_categories_not_configured` — so seeding alone un-gates both flows with no app change. Five QA rows were blocked on nothing but these empty tables and are now scored: RSup/03, RSup/07, Drawer Advance, Drawer Complaint, 06-Categories. The Arabic labels are MSA and still owed a Gulf-native review.

Loan tenure had no admin editor, unlike complaint categories, so the client could not change their own answer later. There is one now at `/requests/settings/tenure`, reachable from the loan row of Request types & fields, with the same add / activate / remove shape as the categories panel. Verified by production build (the route is in `app-path-routes-manifest.json`) and by resolving all 20 of its translation keys in both locales; an authenticated render was not possible in this session because the local login form would not submit.

**`managers` is gone** (`20260830100100`). The loan chain's fourth step carried the plural while asset and fuel used `manager`, and `admin_list_requests` builds its department filter from those role keys, so the same team appeared twice and its queue was split. One template row and one in-flight step row were corrected.

**The e-sign preview now shows what print and download show.** It read `document_storage_key` while print already preferred `signed_document_storage_key`, so a signed request previewed the unsigned original. It now prefers the stamped copy and captions the fact; falling back to the original stays correct while the composer runs or after it fails, and the sidebar already says which of those happened.

**The composer can no longer be killed by a bad image.** It always wrote `signed_document_error` on failure, but a malformed PNG took the worker down with `WORKER_RESOURCE_LIMIT` before that handler ran, leaving the request looking stuck. It now walks the PNG chunk table (IHDR shape, dimensions, a chunk length that fits the file, IDAT before IEND), checks JPEG for a real end-of-image marker, and caps sizes at 15MB source / 4MB signature. Proven end to end against production: a PNG with a valid signature and a bogus IHDR length returns 422 `malformed_signature_image` in 2.7s with the error recorded, and the real signature still composes a 2103-byte PDF.

**Driver app: `submitted` no longer reads "Pending".** `RequestStatusView.of` collapsed `pending` and `submitted` onto one label, and the post-create screen hardcoded the Pending pill even though `driver_create_request` inserts the row as `submitted`. Both fixed; the `submitted` key already existed in both ARBs, so parity stayed at 856/856.

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
| `4195:8626` | VB/01 All visits | PASS | Fixed status pill, `12 Aug` date order and a clipped ACTIONS column (`fa9d3ca`). Bulk-select shipped 2026-08-12: the checkbox column now drives Check in / Complete / No-show / Cancel, looping the existing per-booking RPC rather than a bulk one, so permissions and rider notifications are unchanged. |
| `4195:8350` | VB/00 Hub | PASS | MANAGE / CONFIGURE grouping with live badge counts. |
| `4195:9172` | VB/02 Calendar | PASS + gap | Day/Week toggle and branch picker correct; the purple Appointment overlay belongs to the appointments module. |
| `4195:10894` | VB/05 Slots | PASS | Blocked-date add → verify → remove round-trip, table back to 0 rows. |
| `4195:11133` | VB/06 Departments | PASS | 11 rows above the fold. `visit_departments.branch_id` shipped 2026-08-12 (nullable = every branch), so the Branch column and the modal's branch picker are real; the server enforces the same pin on slot listing and booking. |
| `4195:11679` | VB/08 Reports | PASS | Bars and date presets work. KPI trend deltas shipped 2026-08-12 against the immediately preceding window of equal length — computed client-side from a second fetch of the same action, so a delta can never disagree with the number above it. |

Day view scrolls horizontally with 11 real departments against Figma's 5 mock columns, which is acceptable for a resource calendar. The dev server died once from memory exhaustion and was restarted with `--max-old-space-size=6144`. `npx tsc --noEmit` clean.

### 2026-08-12 — Admin RCM detail + typed drawers re-test (11 rows)

| Node | Screen | Result | One-line reason |
|---|---|---|---|
| `4149:24728` | Request detail | PASS | `docH == 768` on all 8 requests; approve / reject / clarify / decision-terms round-trips verified against the DB. |
| `4149:25358` | "detail variant" | OUT OF SCOPE | The node is actually the list page's *Raise a request to a rider* modal, not a detail state. |
| `4149:26963` | Drawer Leave | PASS | 633px tall, no inner scroll; From/To collapsed into Figma's single "Dates" row. |
| `4149:27065` | Drawer Asset | PASS | Only populated rows, matching Figma (7 empty "—" rows removed). |
| `4149:27167` | Drawer Fuel | PASS | Amount reads `18.500 KWD`. |
| `4149:27269` | Drawer Complaint | PASS | `complaint_categories` seeded with 9 rows on 2026-08-12; the gate no longer fires. |
| `4149:27371` | Drawer Document | PASS | 534px. |
| `4332:4342` | Drawer Advance | PASS | `loan_tenure_options` seeded with 6 rows on 2026-08-12; everything else was already correct. |
| `4332:4455` | Drawer Salary justification | PASS | Reordered to Figma's Period / Net paid / Expected. |
| `4332:4561` | Drawer Sick leave | PASS | Attachment click reaches the server action (storage object genuinely absent). |
| `4321:8349` | Status conventions | PASS | `rescheduled` / `responded` / `closed` added to the `request_status` enum on 2026-08-12, each with real workflow behind it; the status tab bar and pill map all twelve values. |

Root cause of the drawer failure: `w-[min(440px,calc(100vw-24px))]` produced invalid CSS (`calc` needs spaces around the operator), so the drawer lost its width **and** height and ran off screen. Sized inline instead. Also removed the duplicate footer Close per ui-system §7.

Those gaps are closed as of 2026-08-12. Approval steps now carry `started_at` and `actor_display_name` (backfilled for existing rows), so the timeline renders Figma's "By Divya R" and "Open since 09 Jul"; the requester zone turned out to be shipped already (`admin_list_requests` returns it); Fuel's "Transfer type (on approval)" has a real column, `requests.fuel_transfer_type` (`cash` | `salary`), instead of being smuggled into the frozen decision-meta key list — **and the approver-facing control is now wired** (see the Fuel transfer type note at the end of this file).

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
| Detail | Figma's "Viewed" step showed a schema explanation to the user | Now a real timestamp: `esign_requests.viewed_at` shipped 2026-08-12, stamped by the app once the document resolves. The timeline also gained Declined, and the proof block gained the declaration acceptance time and the rider's decline reason. Proof rows stay in two columns so a signed request with 8 fields still fits. |
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

E-Sign gaps that need a client or schema decision: `Accepted` / `Completed` statuses exist in Figma but not in `esign_requests`; "Download audit trail" has no artifact defined. (The missing `viewed_at` column and its driver-app write were closed on 2026-08-12.) Also two QA seed rows (SIG-1400/1401) carry `document_storage_key` values prefixed with the bucket name (`esign-documents/demo/...`) pointing at objects that do not exist, so they can never render a document — real uploads use bucket-relative keys. And all five routes require `requests.manage`, not `requests.view`, which hides E-Sign entirely from read-only operators — fail-closed, but confirm it is intended.

### 2026-08-12 — Driver app re-verify (RCM + Visit Booking + E-Sign)

Verified in the Flutter repo (`MGgo(DPD)-USER/MG-GO`, branch `vikram-dev`) against Figma, `pg_proc` and the admin implementation. No emulator or device was available, so this is contract-and-layout verification, not runtime.

The good news first: **all 14 RPC calls in `support_service.dart` match the real function signatures exactly** — every function name, every argument name, all 8 `request_type` values and all 3 `severity_level` values. So none of the earlier User FAIL rows was a silent-failure defect. Two names in the re-test brief do not exist server-side and the app already used the correct ones (`driver_list_my_requests`, `driver_submit_clarification`). `listMyVisits()` deliberately queries `visit_bookings` directly rather than through an RPC, which works because of the `drivers_select_own_visit_bookings` policy.

Three commits: `03c22fb` — the rider check-in QR now encodes the bare `booking_code` through a shared `booking_qr.dart` (ticket step 88px, confirmed-visit row 48px), matching the admin's `<QRCodeSVG value={visit.booking_code} level="M">`; the previous code fell back to the literal string `visit` when the code was empty, which rendered a perfectly scannable QR pointing at no booking. It also adds a white background and padding, because `QrImageView` defaults to transparent and scanners read that as low contrast. `04df327` — approval-step decision times render in local time instead of UTC. `7517f36` — Figma's step wording, replacing a row that read "In review since" with nothing after it (`request_approval_steps` has no `started_at`, and `decided_at` is null while a step is open).

`qr_flutter` was already a dependency at `^4.1.0` resolving to 4.1.0 under `sdk: ^3.11.0`, so no version bump was needed. `flutter analyze`: 7 issues, 0 errors, all pre-existing.

**Release blocker found:** `lib/features/support/` contains **zero** `AppLocalizations` references. Every string across RCM, Visit Booking and E-Sign is hardcoded English, in an app whose other ~75 files are driven by `app_en.arb` / `app_ar.arb`. Roughly 20 files and several hundred strings. Too large to fix surgically inside a QA pass — needs its own task.

Smaller items flagged and deliberately left alone: `support_models.dart` maps both `pending` and `submitted` to the label "Pending" while Figma RSup/10b shows "Submitted" (changing it ripples through every list); the tab reads "Request Recieved", which is Figma's own spelling; and `DriverAppointment.needsResponse` checks only `status == 'pending'` although `driver_respond_appointment` accepts `pending` or `scheduled` — the getter is currently unused, so it is a trap rather than a live bug.

Server-side gaps that cap these screens: `request_approval_steps.decided_by` is a bare uuid with no name join, so Figma's "Ahmed K · 12 Jul, 09:14" can only ever render the timestamp; there is no `started_at`; and loan / complaint submission is blocked by design until `loan_tenure_options` and `complaint_categories` are seeded.

One consequence of the demo purge to keep in mind: because all four tables are now empty, nobody can exercise these screens with real data until a rider submits something or a staging seed is agreed.

### 2026-08-12 — Tagged QA seed restored, and two real defects it exposed

Runtime verification had become impossible: after the demo purge every backing table was empty, so no screen — Admin or driver — could be exercised with data. A tagged seed is back in production so the remaining screens can be verified, and it is designed to be deleted precisely.

**Seed inventory (all tagged, all removable):**

| Table | Rows | Tag to delete by |
|---|---|---|
| `requests` | RCM-9001 … RCM-9006 — `in_review`, `approved` + awaiting acknowledgement (loan, asset, sick), `needs_clarification`, `submitted` | `payload->>'qa_seed' = '2026-08-12'` |
| `request_approval_steps` | 24, built from `request_approval_step_templates` so the chain is faithful rather than invented | cascade from `requests` |
| `request_clarifications` | 1, on RCM-9005 | cascade from `requests` |
| `visit_bookings` | VIS-99001, VIS-99002, both `confirmed` | `note like '%qa_seed%'` |
| `esign_requests` | SIG-9001 `pending`, SIG-9002 `signed` with a real composed signed copy | `signer_meta->>'qa_seed' = '2026-08-12'` |
| `esign-documents` storage | `demo-qa/leave-policy.pdf`, `demo-qa/vehicle-handover.pdf`, `demo-qa/signature.png`, `signed/<id>/SIG-9002-signed.pdf` | `demo-qa/` prefix + the signed output |

Generated by `scripts/qa-seed-upload.mjs` (uploads) plus tagged inserts. Admin verified against production: `/requests/overview` shows 6 with correct tab counts (Submitted 1, In review 1, Needs clarification 1) and the attention dot on RCM-9005; `/visit-bookings/<id>` renders a real scannable QR of `VIS-99001`; the signed copy composes and downloads.

**Defect 1 — the e-sign detail claimed a document was missing while it was still loading.** The signed URL is minted per view, so it resolves a beat after the row. In that window the page rendered the full "No document attached — this request was sent without a document" empty state, which reads as a genuine failure: an admin would reasonably conclude the rider received nothing. Now shows a spinner until the links query settles. Reproduced on the first load of `/requests/esign/<id>` for SIG-9002 and gone after the fix.

Worth a product decision, not changed here: for a **signed** request the preview pane still shows the *original* document, and only the print/download buttons prefer the signed copy. Showing the stamped copy in the viewer may be what an admin expects.

**Defect 2 — a malformed signature PNG takes the composer worker down instead of failing cleanly.** `esign-compose-signed-document` sniffs only the leading magic bytes, then hands the buffer to `pdf-lib`'s `embedPng`. Feeding it a byte-plausible but structurally invalid PNG returned `WORKER_RESOURCE_LIMIT` (546) after 95 seconds on the first attempt and ~5s after, with **no** `signed_document_error` written — so the driver and the admin both see an opaque failure and the row records nothing. The `try/catch` around composition cannot help, because the worker is killed rather than throwing. A truncated upload from a mobile client is the realistic path into this. Not fixed: it needs a decision on where to validate (structural PNG/JPEG check before embedding, plus a signature size cap).

For the record, this is also why the composer looked broken at first: the failure was my invalid test PNG, not the revert deploy. With a genuine PNG the function returns 200 in 2.7s and stamps the last page bottom-right as specified.

### 2026-08-12 — RSup/11, 25, 26 verified properly, and a rider-blocking RLS gap fixed

These are the three rows the earlier re-test never actually looked at, because the brief I wrote mis-numbered them. Resolved this time by Figma **frame name** rather than number: `RSup/11-Tower-Intro` `4004:13714`, `RSup/25-Sign-Viewer` `4377:4431`, `RSup/26-Sign-Capture` `4377:4520`. The file key in that brief was also truncated — the real key is `n99SmGz5mrwpWoB363e314`, as recorded at the top of this file.

Verdicts: **RSup/11 PARTIAL**, **RSup/25 FAIL**, **RSup/26 PARTIAL**. §11A is now PASS 23 · PARTIAL 6 · BLOCKED 3 · FAIL 1, leaving exactly one FAIL row in the whole 73-row matrix.

**Fixed — riders could not open the document they were asked to sign.** The Sign Viewer calls `createSignedUrl` on `esign_requests.document_storage_key`, but the only rider policies on `esign-documents` allowed `{uid}/…` or `signed/…`, and the admin uploader writes `admin/{uuid}.{ext}` (`esign-actions.ts:242`). Every admin-sent request therefore had an unloadable document, and the viewer's retry guard turned that into a continuous stream of failing storage requests for as long as the screen stayed open. Migration `20260829100000_esign_driver_read_source_document.sql` adds `esign_documents_driver_read_source`, scoped exactly like the existing signed-copy policy: SELECT is allowed only when the object is the source document of a request owned by `auth.uid()`. Verified by impersonating both riders in a rolled-back transaction — each sees only their own document and not the other's. It also tolerates a `esign-documents/` key prefix, because the composer already documents that such rows exist and a prefix mismatch is how this bug hid.

**Remaining Sign Viewer divergences (why it stays FAIL):** the screenshot banner is lavender/blue with a camera glyph, where Figma is amber (`#fff7ed` / `#fed7aa` / `#b45309`) with ?? and reads "Screenshots disabled for this document"; and Decline is styled destructive-red, where Figma node `4388:17181` has it neutral. Both are in `lib/features/support/`, which another task currently owns, so they are queued rather than patched here.

**Driver-app defects found and queued** (all in `lib/features/support/`, deliberately untouched while the localisation task holds those files):

| # | Defect | Why it matters |
|---|---|---|
| D4 | `esign_capture_screen.dart:54` exports the signature at a hardcoded `Size(360, 180)` while strokes are recorded at the pad's real laid-out width | The stored **legal** signature is cropped on any device that is not 392pt wide — roughly 9% lost at 430pt, about half on a tablet |
| D7 | `driver_decline_esignature` writes `cancelled` although `esign_request_status` has a dedicated `declined` value, and `support_models.dart:431` hard-codes `isDeclined => status == 'cancelled'` | A rider's decline is indistinguishable from an admin cancellation; needs the RPC and the model changed together |
| D8 | The legal declaration checkbox gates submission client-side only — it never reaches `signer_meta` or the RPC | Nothing records that the rider accepted the declaration |
| D9 | The viewer re-fetches whenever `_documentUrl == null && !_loadingDoc`, and the failure path re-satisfies its own guard | Infinite retry loop on any load failure |
| D10 | The capture screen's timestamp is `DateTime.now()` inside `build` | Displays render time, never matches the server's `signed_at` |
| D5, D6, D11 | Missing in-pad baseline + "×" guides; `EMP-2048` rendered as driver code because `RiderProfile` never selects `drivers.employee_id`; Cancel inherits the theme's blue outline | Figma parity |
| D12 | `support_service.dart:158` picks a branch by `sort_order` though `visit_branches.is_default` exists | Correct with one branch, wrong the moment a second one sorts ahead. Fixed in the app, and on 2026-08-12 the same hardcoded-`central_tower` fallback was removed from `driver_book_visit` server-side |

Security note, not a Figma divergence: `EsignSensitiveScope` wraps the viewer but **not** the capture screen, so a `screenshot_restricted` document's signature capture is freely screenshottable.

**D7 and D8 fixed server-side (`20260829110000`).** Client approved both. `driver_decline_esignature` now writes `declined`; the pre-existing `cancelled` rows carrying a `declined_at` were migrated, and `cancelled` has no other writer, so that backfill is unambiguous. `driver_submit_esignature` keeps its four-argument signature — the declaration travels in `p_signer_meta`, which the app already sends — and returns `declaration_required` unless `declaration_accepted` is boolean `true`, then re-stamps the flag plus a **server** `declaration_accepted_at` over whatever the device sent. Proven in a rolled-back transaction while impersonating the owning rider: no declaration → `declaration_required`, `declaration_accepted:false` → `declaration_required`, `declaration_accepted:true` → `signed` with `declaration_text` preserved and a server timestamp, decline → `declined` with its reason, decline of a signed row → `not_pending`. The two QA seed rows were verified untouched afterwards.

Worth being honest about the limit of “server-side enforcement” here: the tick itself can only ever happen on the device, so what the server guarantees is that no signature is stored without an explicit acceptance and that the acceptance time is ours, not the phone’s. Both changes are breaking for the driver app — the decline path must stop reading `cancelled` as a decline, and the submit path must send the flag or every signature will be refused.

Nothing on these three screens was verified at runtime — there is no device or emulator, and the RLS conclusion came from evaluating the policy predicates in SQL rather than observing a 403.

### 2026-08-12 — Driver e-sign defect batch, and the two decisions that came with it

The nine queued driver-app defects are fixed, which clears the last FAIL row in the matrix. The one worth calling out is **D4**: the signature was rasterised at a hardcoded `Size(360, 180)` while strokes are recorded in the pad's real coordinate space, so on anything other than a 392pt-wide phone the stored **legal** signature was cropped — about 9% lost at 430pt and roughly half on a tablet. It now exports at the pad's laid-out size scaled by the device pixel ratio. The new in-pad guides are painted only in the widget's painter, never in `toPngBytes`, so the stored image stays the rider's ink alone.

Also fixed: the viewer's failed-load retry loop is terminal with an explicit Retry (and no longer flashes that failure on its first frame, before the fetch has even started), the capture timestamp is stamped at submit instead of recomputed in `build`, `RiderProfile` selects `drivers.employee_id` so the receipt stops showing the driver code, the branch picker honours `visit_branches.is_default` ahead of `sort_order`, two `Alignment.centerRight` sites became `AlignmentDirectional.centerEnd` so trailing content stops pinning to the leading edge in Arabic, and the capture screen is wrapped in `EsignSensitiveScope` — a `screenshot_restricted` document's *signature* was previously screenshottable, which is the one item here that was a security gap rather than a parity gap.

**D7 and D8 client side landed with the RPCs.** `isDeclined` now reads `declined`; `cancelled` means an admin withdrawal and gets its own neutral treatment in the inbox rather than being mislabelled a decline. The capture screen sends `declaration_accepted`, the exact declaration text and the locale it was read in, so the record shows what the rider agreed to and in which language.

Verified: `flutter analyze` unchanged at 7 issues / 0 errors, ARB parity `PARITY OK` at 856 keys each side, no new ARB keys needed (only the banner wording changed value, in both locales). **Nothing was rendered** — no emulator or device — so D4's geometry is a reasoned argument about coordinate spaces, not an observed screenshot, and the Figma colours were matched to node values rather than to pixels. `RSup/26`'s frame could not be found in the file at all, so its guides and Cancel treatment came from a written description; that is why the row stays PARTIAL even though every listed gap is closed.

### 2026-08-12 — Phase 4: RSup/26 found, and the device pass split into what a device is actually needed for

**`RSup/26-Sign-Capture` `4377:4520` resolves.** The frame was never missing — the earlier lookup failed transiently and the conclusion stuck. It is worth recording why the search for it failed twice: a full `get_metadata` dump of page `0:1` returns 37,899 lines that contain neither `RSup/26` nor `RSup/25`, even though both resolve when their node id is queried directly. Searching the page dump is not a valid way to decide a frame is absent.

Re-tested pin-to-pin against the real frame, two geometry gaps were real and are fixed. The pad is **190** tall, not 180 (`4388:17186` is 361x190). The in-pad guides were built from a written description and were all slightly wrong: the baseline sat at 0.72 of the height where the frame puts it at 145/190 = 0.763, the insets were a fixed 24pt where the frame uses 30/361 of the width, and the line started 16pt clear of the `x` marker where the frame has both starting at the same x. The guides are now expressed as those ratios and locked by a golden, `test/goldens/signature_pad_guides.png`.

**The row stays PARTIAL, but for an honest reason now.** Figma's receipt block carries an `IP 10.20.1.14` line and nothing in this app resolves a client IP, so that line is deliberately omitted — which is precisely the "Figma element, no server support" definition of PARTIAL. The score table is unchanged.

**Signature export geometry no longer needs a device.** `test/signature_pad_test.dart` settles it by decoding the exported PNG: the image is exactly `padSize x devicePixelRatio` at ratios 1, 2 and 3; a stroke drawn at y=60 is inked at y=60 x ratio and the area above it is clear, so nothing is clipped or letterboxed; and a pixel sampled on the baseline comes back pure white, proving the guides are painted in the widget only and never in `toPngBytes`. D4's earlier verdict was a reasoned argument about coordinate spaces; it is now an observed one.

**Bidi is closed, and the answer is that there was nothing to fix.** Ordering under the Unicode bidi algorithm does not depend on the typeface, so it can be settled off-device: `test/arabic_bidi_probe_test.dart` renders the six real composite strings under RTL with an Arabic-capable system font and writes `goldens/arabic_bidi_probe.png`. `RCM-0001 · 9 أغسطس 2026`, `SIG-0142 · اتفاقية السكن`, the three-part e-sign receipt line, the visit code, a code mid-sentence and a two-part clarification reason all resolve correctly — codes read left-to-right inside a right-to-left line, the `·` separators sit where they should, and both the comma in `2026, 13:52` and a sentence-final full stop land on the correct side. No LRM marks or `Directionality` wrappers are warranted; adding them would be cargo cult.

**Arabic overflow is closed too, and it did not need production access after all.** The whole reason it looked device-only is that `google_fonts` fetches at runtime and returns nothing under `flutter test`, so any layout measured in a test was measuring a fallback face. Committing the real `NotoSansArabic-Variable.ttf` as a fixture removes that, and a test is the better instrument here: a RenderFlex overflow throws and fails the build, where on an emulator it has to be noticed. `test/arabic_overflow_test.dart` renders the Help & Support hub, the dynamic request form and the signature capture screen at Pixel 9 metrics in Arabic, and the form again at 1.3x text scale — **no overflow, no clipped text**. The capture screen deliberately has no golden, because its receipt line is stamped from `DateTime.now()` and a golden would drift every minute; it asserts its layout instead.

Reviewing those renders confirmed the RTL mirroring is right where it counts: Clear moves to the leading edge, the checkbox sits on the right of its label, and Cancel/Confirm swap sides. Three things came out of it that are **not** defects but want a decision — the ink colour (Figma's sample is navy, the app stores black, and changing it alters a legal artefact and mismatches signatures already on file), the signature guide not mirroring in RTL (Figma has no RTL variant to copy), and a long Arabic label on a *custom* request type making its hub tile taller than its row neighbours. All three are recorded in the open-items doc rather than decided here.

What a device would still add: `my_requests`, request detail, the visit ticket, the e-sign viewer, and system chrome — the OS back gesture and the user's own font-size setting.

---

## Fuel transfer type — control wired (2026-08-12)

`4149:27167` scored PASS on its amount, and the one thing on that frame with no write path was **Transfer type (on approval)**. It now has one: `admin_set_fuel_transfer_type` (migration `20260904100000`) behind a two-option segment on `/requests/[id]`, sitting directly above the approve/reject actions the way Figma places it above the remark box.

It is not a parameter on `admin_decide_request`, and that is the whole design: a payout method is a standing instruction Accounts may correct after approval, so folding it into the decide call would have made it settable only at the instant of approval. Clicking the selected option clears it, which is why the RPC accepts an empty value as legal rather than only `cash` / `salary`. Only a `closed` request refuses the write; `rejected` stays writable, since a stale payout method on a rejected row is worse than none.

Two divergences from the frame, both deliberate:

1. **Nothing is pre-selected.** Figma shows *In cash* highlighted. Shipping that would make an untouched request claim a payout decision nobody took, so an unset request instead shows warning text naming the consequence — "payroll will not know how to pay this out" — the same shape as the loan/asset "Not set" row.
2. **Approving without one is not blocked.** The existing decision-terms dialog lets a loan be approved with no amount, so gating fuel would have been stricter than any comparable screen, and it would have broken bulk approve for a whole request type.

Verified in the browser against the real server action on `RCM-9006`: unset → *In cash* → survives a reload → the read-only **Transfer type** row appears on both the details card and the drawer → switching to *With salary* replaces rather than adds → clicking the selected option clears it, and the clear survives a reload too. Zero console errors. Server-side, a rolled-back production probe confirms `salary`, a whitespace-and-caps `' CASH '`, and the clear all land correctly, and that `cheque`, a non-fuel request and a missing id are refused with named errors.
