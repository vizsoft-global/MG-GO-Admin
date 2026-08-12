# RCM / Visit Booking / E-Sign — Open Items

This document consolidates every remaining item across RCM, Visit Booking, and E-Sign into one place, organised by **who is blocking it** — not by module — so Section A can be forwarded to the client as-is.

---

## 0. Status Snapshot

A 73-row Figma QA matrix has been scored: **54 PASS, 12 PARTIAL, 6 BLOCKED, 1 OUT OF SCOPE, 0 FAIL.**

- **PASS** — matches Figma and is fully backed by data/logic; nothing further needed.
- **PARTIAL** — the screen works but is missing a piece (usually a data source or a wording detail) that is tracked as an open item below.
- **BLOCKED** — cannot be closed without a decision, an asset, or a device that isn't available in this environment.

Admin covers 40 rows with zero FAIL. Driver app covers 33 rows, all scored from code and Figma, since no driver-app screen has been rendered on a physical device in this environment yet (see Section B).

---

## A. Needs a Decision from the Client

*This section is self-contained — no file paths or internal table names are referenced except where the client already uses the term. It can be forwarded on its own.*

### A.1 Value Lists — ✅ Confirmed and shipped (2026-08-12)

Both lists are live in production and editable from the admin panel: complaint categories under **Settings → Complaint categories**, tenures under **Settings → Loan tenure options**. Loan and complaint requests are no longer blocked in the driver app.

| Item | Decision |
|---|---|
| **Loan / Advance — Tenure Options** | 3, 6, 9, 12, 18, 24 months |
| **Complaint — Category List** | Payments, Salary Issues, Attendance / Check-in, Visit / Booking Issues, Vehicle / Fuel, HR / Workplace, Document / E-Sign Issues, App / Technical Issue, Other |

### A.2 Behaviour & Permissions — ✅ Confirmed

1. **E-Sign visibility** — All five E-Sign screens require the `requests.manage` permission, so a read-only operator cannot see E-Sign at all.
   **Decision: Confirmed as intended.** No change.

2. **Signed document preview** — For a signed request, the preview pane currently shows the original (unsigned) document; only print and download serve the signature-stamped copy.
   **Decision: Confirmed — preview should also show the stamped copy.** ✅ Shipped 2026-08-12: the preview prefers the stamped copy and says so, falling back to the original only while composition is pending or after it failed.

3. **Duplicate role key in approval templates** — Approval templates currently carry both `manager` and `managers` as role keys, producing two near-identical department filter options. This sits inside the locked approval chain, so it needed explicit sign-off.
   **Decision: Consolidate to a single role key — `manager`.** ✅ Shipped 2026-08-12: the loan chain's step 4 and the one in-flight request carrying the plural were corrected, so the department filter lists one Manager option.

4. **Driver app status wording** — Both the `pending` and `submitted` request states currently display as "Pending" in the app, while Figma shows "Submitted" (and, in one frame, the misspelling "Request Recieved").
   **Decision: Use "Pending" for `pending` and "Submitted" for `submitted`.** ✅ Shipped 2026-08-12, including the post-create confirmation screen, which hardcoded "Pending" even though the row is inserted as `submitted`. The Figma misspelling ("Request Recieved") was not carried into the product.

### A.3 Schema Additions — ✅ Confirmed: build all

The following are drawn in Figma but have no data or workflow behind them today. **Decision: all of them will be built** (schema plus the workflow each one implies).

The list was 11 when it went to the client. One item — requester zone on the overview list — turned out to be already shipped: `admin_list_requests` returns the driver's zone and the overview table renders it under the driver name. **10 remained; 8 are now shipped.**

1. ~~Workflow SLA and breach-action columns~~ — ✅ Shipped 2026-08-12. `request_approval_step_templates.sla_minutes` / `breach_action`, mirrored onto each live step as `sla_due_at` / `breach_action` / `sla_breached_at` and onto `requests.sla_due_at`. An hourly sweep (`admin_run_request_sla_sweep`) marks the breach and raises the attention badge. **Every SLA is NULL until an admin sets one** — no duration was invented, so the sweep is inert until the workflow builder is used. Breach action never decides a step: `notify` and `escalate` differ only in `attention_reason`, because auto-advancing a step is auto-approving it by another name. **Open question for the client: should `escalate` also re-route the step to the next approver?**
2. Dynamic request-type builder — the ability to create new request types from the admin side.
3. ~~E-Sign "Viewed" and "Accepted" timestamps~~ — ✅ Shipped 2026-08-12. `esign_requests` gains `sent_at`, `viewed_at`, `declined_at` and `declaration_accepted_at` as real columns, backfilled from `signer_meta`. Two of the four were already being written into the jsonb, where nothing could filter or report on them; `viewed_at` was never recorded at all, which is why the detail timeline's Viewed step had to render as permanently unavailable. The app now stamps it via `driver_mark_esign_viewed` **once the document actually resolves** — not on screen mount — so "Viewed" means the rider could see what they were asked to sign. First open wins, and decline/submit back-fill it so older app builds still produce an honest timeline.
4. ~~Acknowledgement completion timestamp~~ — ✅ Shipped 2026-08-12. `requests.acknowledged_at`, backfilled from `payload.driver_ack_at` and written by `driver_acknowledge_request`.
5. ~~`Rescheduled` / `Responded` / `Closed` status chips~~ — ✅ Shipped 2026-08-12, with the semantics the client confirmed. `rescheduled` holds the step open and waits on the rider (`driver_respond_reschedule`); `responded` is terminal with `completed_at`; `closed` is manual or automatic after `app_settings.request_auto_close_days` (default 30). Also fixed in the same pass: `submitted` used to be overwritten by `in_review` microseconds after insert, so it never appeared anywhere.
6. ~~Approval-step actor name and step start time~~ — ✅ Shipped 2026-08-12. `request_approval_steps.actor_display_name` and `started_at`, backfilled for existing rows and rendered in the Admin timeline.
7. ~~Fuel request transfer type~~ — ✅ Column shipped 2026-08-12 (`requests.fuel_transfer_type`, `cash` | `salary`). The approver-facing control on the fuel drawer is not wired yet.
8. ~~Visit bulk actions~~ — ✅ Shipped 2026-08-12. Row selection on `/visit-bookings` with Check in / Complete / No-show / Cancel across the selection. Deliberately **no bulk RPC**: the server action loops the existing `admin_update_visit_status` per booking, so `visits.operate`, the status transition rules and the rider notification behave exactly as they do for a single row, and one bad booking reports itself instead of aborting the batch.
9. ~~Visit departments tied to a branch~~ — ✅ Shipped 2026-08-12. Nullable `visit_departments.branch_id` — `NULL` means every branch, which is how all 11 existing rows already behaved, so nothing needed migrating. `key` was deliberately left globally unique: it is the FK target for `visit_slots.department_key` and `visit_bookings.department_key`, and re-keying it would have touched the locked one-active-booking-per (driver, date, department) index. If the client later needs the same department at several branches with different desks, the forward path is a `(branch_id, department_key)` junction table. `driver_list_visit_slots` hides mismatched slots and `driver_book_visit` rejects them with `department_not_at_branch`.
10. ~~Visit report prior-period comparison~~ — ✅ Shipped 2026-08-12. Each report KPI carries a delta against the immediately preceding window of equal length. No new RPC — the shell fetches the prior window through the existing report action and compares client-side, so the comparison cannot drift from the numbers shown above it.

---

## B. Needs a Device or a Figma Asset (Cannot Be Closed From Here)

- **On-device pass required** — Arabic overflow and bidi behaviour around Latin codes such as `RCM-0001`, the signature export geometry, and the signature pad guides. Nothing in the driver app has been rendered on a physical device in this environment.
- **Gulf-native Arabic review** — for coined or company-specific terms: E-Sign, Central Tower, salary justification, wrong action, acknowledge, check-in code. The nine complaint category labels seeded on 2026-08-12 are MSA and belong in the same review pass.
- **Missing Figma frame** — `RSup/26 Sign Capture` cannot be located in file `n99SmGz5mrwpWoB363e314` (node `4377:4520` resolves to nothing, and the `App` canvas lists no `RSup` frames). Its guides and Cancel button styling were built from a written description only — this is the sole reason that row is still scored PARTIAL.

---

## C. Our Work — No Client Input Needed

- ~~**Composer robustness — pre-validation missing.**~~ ✅ Fixed and deployed 2026-08-12. The function now walks the PNG chunk table and checks the JPEG end-of-image marker before the decoder sees the bytes, and caps sizes at 15MB source / 4MB signature. A corrupt PNG returns `malformed_signature_image` and records it, instead of taking the worker down with `WORKER_RESOURCE_LIMIT`.
- **Rotate `SUPABASE_SERVICE_ROLE_KEY`** and mirror the new value into Vercel project `dpdadmin-prod` — the current key was pasted in chat and should be treated as compromised.

---

## D. Production Housekeeping

Tagged QA seed data is currently live in production:

- 6 requests, with 24 approval steps and 1 clarification
- 2 visits
- 2 E-Sign rows, including one real composed signed copy

**Action needed before go-live:** record the exact tags used and the delete order (children must be removed before parents, since deletes cascade), then run the cleanup once QA closes.

---

*This document is the single source of truth for open items — the plan's own "Client Confirmation Required" table points here rather than duplicating it.*
