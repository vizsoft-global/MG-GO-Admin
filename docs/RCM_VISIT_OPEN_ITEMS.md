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

### A.1 Value Lists — ✅ Confirmed

| Item | Decision |
|---|---|
| **Loan / Advance — Tenure Options** | 3, 6, 9, 12, 18, 24 months |
| **Complaint — Category List** | Payments, Salary Issues, Attendance / Check-in, Visit / Booking Issues, Vehicle / Fuel, HR / Workplace, Document / E-Sign Issues, App / Technical Issue, Other |

### A.2 Behaviour & Permissions — ✅ Confirmed

1. **E-Sign visibility** — All five E-Sign screens require the `requests.manage` permission, so a read-only operator cannot see E-Sign at all.
   **Decision: Confirmed as intended.** No change.

2. **Signed document preview** — For a signed request, the preview pane currently shows the original (unsigned) document; only print and download serve the signature-stamped copy.
   **Decision: Confirmed — preview should also show the stamped copy.** Preview will be updated to match print/download.

3. **Duplicate role key in approval templates** — Approval templates currently carry both `manager` and `managers` as role keys, producing two near-identical department filter options. This sits inside the locked approval chain, so it needed explicit sign-off.
   **Decision: Consolidate to a single role key — `manager`.** The duplicate `managers` key will be removed and the approval chain corrected.

4. **Driver app status wording** — Both the `pending` and `submitted` request states currently display as "Pending" in the app, while Figma shows "Submitted" (and, in one frame, the misspelling "Request Recieved").
   **Decision: Use "Pending" for `pending` and "Submitted" for `submitted`.** The Figma misspelling ("Request Recieved") will not be carried into the product; "Submitted" is used instead.

### A.3 Schema Additions — ✅ Confirmed: build all

The following are drawn in Figma but have no data or workflow behind them today. **Decision: all of them will be built** (schema plus the workflow each one implies).

The list was 11 when it went to the client. One item — requester zone on the overview list — turned out to be already shipped: `admin_list_requests` returns the driver's zone and the overview table renders it under the driver name. **10 remain.**

1. Workflow SLA and breach-action columns — a time limit per request and a defined action for when it's exceeded.
2. Dynamic request-type builder — the ability to create new request types from the admin side.
3. E-Sign "Viewed" and "Accepted" timestamps — when a signer opened and accepted a document.
4. Acknowledgement completion timestamp.
5. `Rescheduled` / `Responded` / `Closed` status chips — new status values plus the workflow logic behind each.
6. Approval-step actor name and step start time — who acted and when, per approval step.
7. Fuel request transfer type.
8. Visit bulk actions — acting on multiple visits at once.
9. Visit departments tied to a branch.
10. Visit report prior-period comparison.

---

## B. Needs a Device or a Figma Asset (Cannot Be Closed From Here)

- **On-device pass required** — Arabic overflow and bidi behaviour around Latin codes such as `RCM-0001`, the signature export geometry, and the signature pad guides. Nothing in the driver app has been rendered on a physical device in this environment.
- **Gulf-native Arabic review** — for coined or company-specific terms: E-Sign, Central Tower, salary justification, wrong action, acknowledge, check-in code.
- **Missing Figma frame** — `RSup/26 Sign Capture` cannot be located in file `n99SmGz5mrwpWoB363e314` (node `4377:4520` resolves to nothing, and the `App` canvas lists no `RSup` frames). Its guides and Cancel button styling were built from a written description only — this is the sole reason that row is still scored PARTIAL.

---

## C. Our Work — No Client Input Needed

- **Composer robustness — pre-validation missing.** The function does write a `signed_document_error` when composition fails, but a malformed signature PNG kills the edge worker outright with `WORKER_RESOURCE_LIMIT` before that handler can run, so the request just appears stuck. Fix: a structural PNG/JPEG check and a size cap before `embedPng` in `supabase/functions/esign-compose-signed-document`, so a bad image fails through the existing error path instead of taking the worker down.
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
