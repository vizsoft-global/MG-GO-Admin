# EmployeeDesk V2 — V1 → V2 Feature Parity Audit

> WS-A1. Written before any code change. Purpose: **prove that nothing that works today stops working**, and label the things that were already missing so they are not mistaken for regressions.

## 1. Method

1. Every route under `src/app/[locale]/(dashboard)/requests/**` and `visit-bookings/**` was enumerated (see §2).
2. Every exported server action in `src/features/requests/**` and `src/features/esign/**` was mapped to its RPC and permission.
3. V2 is planned as an **additive** route tree `/employeedesk/**` that **re-exports the same shell components**. V1 `/requests/**` and `/visit-bookings/**` keep their files and behaviour.
4. Therefore parity is structural: if a V1 route still renders its V1 shell, and the V2 route renders the *same* shell, no feature can be lost by the rename.

**Guarantee:** V2 does not copy-and-fork a shell. A fork is the only way parity can silently break, so it is forbidden. Where V2 needs a different shell (the new launcher, the new Reports page), the V1 route is left pointed at the V1 shell.

## 2. Route-by-route mapping

### 2.1 Requests (17 routes) — all `requests.view` except settings (`requests.manage`)

| V1 route | Shell | V2 treatment |
|---|---|---|
| `/requests` (hub) | `RequestsHubShell` | Keep V1; `/employeedesk` renders the new hub, links into V1 routes |
| `/requests/overview` | `RequestsPageShell` | Re-export at `/employeedesk/all` |
| `/requests/[id]` | `RequestDetailPageShell` | Re-export at `/employeedesk/[id]` |
| `/requests/reports` | `EsignReportsShell` (**stub**) | V1 left as-is; V2 replaces with a real page (see `EMPLOYEEDESK_V2_REPORTS_SETTINGS.md`) |
| `/requests/import-export` | `EsignImportExportShell` | Keep V1 |
| `/requests/settings` + 11 sub-routes | see reports/settings doc | Keep V1; V2 groups them under the new EmployeeDesk settings hub |

### 2.2 E-Sign (12 routes) — all `requests.manage` today

`/requests/esign`, `/send`, `/sent`, `/bulk`, `/batches`, `/batches/[id]`, `/templates`, `/templates/[id]`, `/categories`, `/signatures`, `/settings`, `/[id]`.

**V2 treatment:** re-export each at `/employeedesk/esign/*`. The permission split (`requests.view` for reads, `requests.manage` for writes — see the E-Sign audit) is applied by **gating the page**, not by forking the shell. A read-only user reaching `/employeedesk/esign/sent` sees the list; write controls are hidden by the existing `can()` checks.

### 2.3 Visits (9 routes)

`/visit-bookings`, `/all`, `/[id]`, `/calendar`, `/reception`, `/slots`, `/departments`, `/branches`, `/reports`.

**V2 treatment:** a tile inside EmployeeDesk plus optional `/employeedesk/visits/*` re-exports. No behaviour change. See `EMPLOYEEDESK_V2_VISITS.md`.

### 2.4 Fleet queues reached from the hub (2 routes)

`/fuel/requests` (`fuel_requests.view`), `/assets/requests` (`asset_requests.view`) — tiles only; kept where they are.

## 3. Feature-level parity checklist

Nothing in this list may be dropped, hidden behind a new permission, or moved behind a page that a current holder of `requests.view` / `requests.manage` cannot reach.

**List / queue**
- Date presets: All, Today, This week, Last week, This month, Last month, This year (`date-presets.ts`).
- Type filter, status tabs with per-type suppression (`statusFiltersForRequestType`), department filter, zone filter, debounced search.
- KPI strip incl. previous-period delta, attention badge.
- Bulk select gated by `canBulkSelectRequest`; bulk approve (approvable rows only) and bulk reject with reason.
- Row click opens the in-list popup and the detail page.
- URL-backed `?type=` and `?preset=` (a reused shell must not keep a previous type).

**Detail**
- Actions: approve, reject, clarify, reschedule, attach_send, attach_breakdown, request_documents, send_response, close. Reason required for reject / clarify / send_response.
- Fuel approve blocked until `fuel_transfer_type` is set (`fuelApproveBlocked`).
- Loan / asset / sick-leave decision terms dialog (`admin_set_request_decision_meta`).
- Awaiting-driver states: clarification, reschedule reply, acknowledgement (`awaiting_driver_ack` / `driver_ack_at`).
- Approval timeline + typed drawer + record body + field rows.
- Reschedule summary rendering.
- `logAdminRequestDetailOpened` on page open, keyed by request id.

**Settings (12 routes)** — see the reports/settings doc for the full table. None may be removed; several are regrouped.

**Attachments**
- Upload to `request-attachments`; read via `fetchRequestAttachmentUrl` with the existing permission OR-set (`requests.view` | `assets.view` | `fuel_requests.view` | `fuel_refunds.view` | `asset_requests.view`).
- `/api/esign/document-download` streaming route.

**Notifications**
- Requests and e-sign notifications are emitted **inside the RPCs** (`notify_driver_transactional`), not from panel code. V2 must not add a second client-side notification path.

**i18n**
- `pages.requests` (+ nested `pages.requests.esign`), `pages.requests.settings`, `pages.visits`. New keys are additive; `npm run test:i18n` must stay green (currently 7,758 keys x 2 locales).

## 4. Gaps that already exist in V1 (recorded, not introduced)

These are **not** parity risks — they are absent today and will stay absent unless a V2 workstream explicitly adds them:
- `/requests/overview` has **no pagination** (fixed `limit: 50`, `offset: 0`) and **no per-column column filters**.
- The requests list has **no CSV/XLSX export**.
- `/requests/reports` is an **e-sign stub** (`stubTitle` / `stubBody`).
- `EsignImportExportShell` has non-backed columns (`remarks`, `internalNotes`) and a disabled PDF export option.
- `decideAdminRequestsBulk` loops `admin_decide_request` per row (no bulk RPC).
- Settings panels have **no dedicated unit tests**.
- `REQUEST_STATUS_LABELS`, `TYPE_FIELDS`, `GATED_FIELD_KEYS`, `REQUEST_CREATE_TYPE_SEEDS` are hardcoded client-side fallbacks alongside server-driven fields.

**Decision needed at each V2 workstream:** if V2 fixes one of these (e.g. adds pagination), that is a *new* feature, tested as new — never assumed to have always existed.

## 5. Regression evidence

| Command | What it protects |
|---|---|
| `npm run typecheck` | no broken imports after re-exports |
| `npm run test:requests` (9 files) | status utils, create utils, kinds, audit summary, date presets, attachment names, decided terms, typed fields, reschedule payload |
| `npm run test:esign` (7 files) | due date, storage key, bulk parse, placeholders, document html, batch cap, compose stamp |
| `npm run test:visits` (3 files) | visit hours, upcoming count, slot copy |
| `npm run test:i18n` | key parity EN/AR |
| `npm run build` | route tree compiles; V1 routes still present |

Manual, per the UI rulebook: open each V1 route and confirm it is unchanged; then each V2 alias and confirm the same shell renders.

## 6. Verdict

Parity is **structural and testable**: V2 adds routes, it does not move behaviour. The audit found **zero V1 features that V2 is unable to preserve**. The only functional weakness in the module today is `/requests/reports` being a stub — and that is a V2 build item, not a parity loss.
