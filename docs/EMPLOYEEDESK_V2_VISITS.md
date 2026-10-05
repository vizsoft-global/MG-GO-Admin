# EmployeeDesk V2 — Visit Bookings Audit

> WS-A3. Question this answers: **does the reference require new V2 visit functionality, or only navigation?** Answer: navigation/visibility only. The module is already complete.

## 1. What exists today (verified)

### 1.1 Routes (9) — no stubs

| Route | Shell | Permission |
|---|---|---|
| `/visit-bookings` | `VisitsHubShell` | `visits.view` |
| `/visit-bookings/all` | `VisitsPageShell` | `visits.view` |
| `/visit-bookings/[id]` | `VisitDetailPageShell` | `visits.view` |
| `/visit-bookings/calendar` | `VisitsCalendarShell` | `visits.view` |
| `/visit-bookings/reception` | `VisitsReceptionShell` | `visits.operate` |
| `/visit-bookings/slots` | `VisitsSlotsShell` | `visits.manage_catalog` |
| `/visit-bookings/departments` | `VisitsDepartmentsShell` | `visits.manage_catalog` |
| `/visit-bookings/branches` | `VisitsBranchesShell` | `visits.manage_catalog` |
| `/visit-bookings/reports` | `VisitsReportsShell` | `visits.view` |

Stub scan over `visit-bookings/**` and `src/features/visits/**` returned **0** matches for `Coming soon|stub|placeholder|ModuleIndexPage|TODO`.

### 1.2 Features already implemented

- **List**: tabs All / Today / Upcoming / Past with counts; date-range, branch, department, status filters; search; sort direction; inline fast actions; bulk transitions to `checked_in` / `completed` / `no_show` / `cancelled` (open statuses `confirmed`, `checked_in`); local CSV export of visible rows.
- **Calendar**: day/week grid with slot capacity/booked, blocked dates, lunch, branch switcher.
- **Reception**: barcode/QR input, waiting / in-progress / done queue groups, search, recent lookups, fast status buttons.
- **Slots config**: working DOWs, opening/closing, lunch (must sit inside hours), slot length/buffer, capacity, booking window, blocked dates, copy weekday slots to all branches.
- **Detail**: booking code QR (`qrcode.react`), derived timeline, note-to-rider dialog, admin-only notes thread, reschedule in place (booking code survives).
- **Catalog**: branches CRUD, departments CRUD (with `desks_count`).
- **Reports**: KPIs vs prior window, weekly visits chart, busiest slots, department table, CSV.

### 1.3 RPCs used

`admin_list_visits`, `admin_set_visit_note_to_rider`, `admin_reschedule_visit`, `admin_update_visit_status` (single + bulk loop), `admin_sync_branch_slots_to_working_days`. Detail is read via direct PostgREST reads across `visit_bookings`, `visit_departments`, `visit_branches`, `visit_slots`, `drivers`, `profiles`.

### 1.4 Tests

`npm run test:visits` — `visit-hours.test.ts`, `visit-upcoming.test.ts`, `visit-slot-copy.test.ts`, plus `src/components/app/date-range-disabled.test.ts`.

### 1.5 Recent correctness already in place (do not regress)

- Visit availability applies: a weekday toggled ON generates slots; `driver_list_visit_slots` / `driver_book_visit` honour `working_dows`, opening/closing, booking window and `visit_blocked_dates`; `is_default` has an active check.
- `overlapping_visit` guard for same date + overlapping slot time across departments.
- Lunch must sit inside opening–closing (`lunch_outside_hours`).

## 2. V2 scope decision

**The reference needs a tile and a route alias only.** No new visit capability is required. Concretely:

1. Add a **Visit Bookings** tile inside the new EmployeeDesk hub (gated on `visits.view`; a holder without it sees a locked tile).
2. Optionally add `/employeedesk/visits/...` routes that **re-export** the existing shells, so the scoped EmployeeDesk sidebar can keep the operator inside the app. The V1 `/visit-bookings/*` routes stay live.
3. No schema change, no new RPC, no new migration.

## 3. What must not change

- Permission slugs `visits.view` / `visits.operate` / `visits.manage_catalog` keep their meaning and their assignments.
- The reschedule-in-place behaviour (booking code preserved) and the QR ticket.
- `visit_booking_notes` stays admin-only (no rider policy).
- The weekday-slot copy stays skip-if-exists and never writes `visit_bookings`.
- `admin_update_visit_status` bulk stays a per-row loop (so one bad row reports itself instead of aborting the batch).

## 4. Test plan

- `npm run test:visits` green (unchanged).
- New: assert the EmployeeDesk hub renders the Visit tile for a `visits.view` holder and a locked tile without it (component test, `test:requests` or a new `test:employeedesk`).
- Manual: each V1 visit route unchanged; each V2 alias renders the same shell.

## 5. Verdict

Visit Bookings is **not** a V2 build item beyond navigation. It is feature-complete, stub-free, tested, and must be reached from EmployeeDesk without being forked.
