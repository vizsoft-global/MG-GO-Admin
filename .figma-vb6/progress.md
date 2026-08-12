# VB Figma verification pass — batch 6 (resumed)

Resuming after the previous agent died mid-run. Commits it had landed:
- `874213a` visits: selects `items`, reports bars, one-viewport boards
- `36c5cd8` visits: departments desk catalog title + above-the-fold rows

My commit: `fa9d3ca` visits: make the All visits row read and fit like the Figma board.

## Findings on resume
- Working tree listed `visit-detail-page-shell.tsx`, `visits-actions.ts`, `visits-branches-shell.tsx`,
  `visits-reception-shell.tsx` as modified, but `git diff` is EMPTY for all four — CRLF-only noise
  from a repo-wide lint run. Not staged, not committed. Confirms VB/07 was never actually changed.
- Reused the Figma frames the previous agent downloaded in `.figma-vb5/` (`fig-*.png`).

## Environment deviations (reported, not hidden)
- `plugin-browse-browser` is BROKEN: every call returns
  `spawn ...\browse\release_v0.2.4\node_modules\.bin\browse ENOENT`.
  Fallback = throwaway Playwright driver `.figma-vb6/drive.cjs` on the `playwright-core` shipped
  inside that same plugin, headless at exactly 1366x768 (the previous agent's approach).
  `cursor-ide-browser` was NOT touched.
- The dev server on :3000 (pid 19076) DIED on its own (~02:04, 13 GB private bytes, listener gone).
  Started a fresh `npm run dev` from the repo root with `--max-old-space-size=6144`.
- Dashboard routes intermittently answer **500**: `Error: No QueryClient set` at
  `useSidebarMenu` (`src/hooks/use-sidebar-menu.ts:66`) via `AppSidebar`
  (`src/components/layout/app-sidebar.tsx:542`). It also hits `/en/dashboard`, and
  `QueryProvider` *does* wrap children in `src/app/[locale]/layout.tsx`, so it is a dev/HMR
  module-duplication artifact, shell-wide, outside my file scope. Worked around with retry-on-500.
- `[browser] Encountered a script tag while rendering React component` also fires on
  `/en/requests/*`; there is no `<script>`/`dangerouslySetInnerHTML` anywhere in
  `src/features/visits`, so it is shell-level too.

## Screen log

- **VB/07 `4195:11440` Branches** `/en/visit-bookings/branches` — **PASS, no code change needed.**
  Breadcrumb, title, subtitle, BRANCH/ADDRESS-CITY/WORKING HOURS/DESKS/STATUS + Default chip +
  Edit all match Figma. Add modal is footer-first (no top header, Close floating outside at
  top:-19 right:+11, footer left "New branch" + subtitle, right Cancel/Save, Save disabled until
  key+name), fields Key/Name/Address/City/Start/End/Desks, height 332px. Edit round-trip saved
  desks and the row re-read from the server. doc 768/768. **Restored** `desks_count` to 1.
- **VB/01 `4195:8626` All visits** `/en/visit-bookings/all` — **PASS after 3 fixes** (`fa9d3ca`):
  STATUS was bare dot+text -> `StatusPill dot` (Figma status-conventions = filled pill + dot);
  DATE showed `Aug 12` -> `12 Aug`; ACTIONS overflowed the card and clipped `Cancel` -> icon-only
  check/cancel/complete with `title`+`aria-label`. Table now 1142/1142 unclipped, doc 768/768.
  Tabs All 3 / Today 0 / Upcoming 3 / Past 0; all 3 selects show real labels; status=Cancelled ->
  `0 of 3`; search -> 1 row. Real check-in round-trip: toast, row -> Checked in,
  `checked_in_at` set, driver-only notification campaign created. **Rolled back** to `confirmed`,
  `checked_in_at` NULL, my notification campaign+run+item deleted.
- **VB/00 `4195:8350` Hub** `/en/visit-bookings` — **PASS, no code change needed.** Title,
  subtitle, MANAGE (All visits / Calendar / Reception check-in) and CONFIGURE (Slot & availability /
  Departments & desks / Branches / Reports) tiles, amber count badge (3 = real upcoming). Tiles are
  permission-filtered in code (`visits.operate`, `visits.manage_catalog`). doc 768/768.
- **VB/02 `4195:9172` Calendar** `/en/visit-bookings/calendar` — **PASS.** Branch picker shows
  "Musallam Central Tower" (the `items` fix holds), date stepper, Today, legend, Day|Week.
  Day = TIME + one column per department with `Desk 1` and per-cell capacity; Week = TIME +
  Sun Aug 9..Sat Aug 15 with Fri/Sat `Blocked` from `working_dows`. doc 768/768 in both views.
  11 real departments make the day board scroll horizontally (`overflow-auto`) where the Figma
  mock had 5 — vertical stays in one viewport.
- **VB/05 `4195:10894` Slot availability** `/en/visit-bookings/slots` — **PASS.** Working days
  (emerald+check chips per ui-system §5), opening/closing/lunch, Slots & capacity with real labels
  ("30 minutes", "1 rider", "0 minutes", "14 days ahead"), Desks per department steppers, Blocked
  dates + Add blocked date. Blocked-date add + remove both round-tripped through the server;
  `visit_blocked_dates` is back to 0 rows. doc 768/768.
- **VB/06 `4195:11133` Department desk catalog** `/en/visit-bookings/departments` — **PASS.**
  Figma title/subtitle, 11 rows all above the fold, DEPARTMENT chip / DESK-COUNTER / ASSIGNED STAFF /
  AVG HANDLING / STATUS toggle / Edit. Edit modal is footer-first (h 232), fields Desk-counter,
  Assigned staff, Avg. handling + Active. Save round-trip verified: UI wrote
  `avg_handling_minutes = 12` to the DB. **Restored to NULL.**
- **VB/08 `4195:11679` Reports** `/en/visit-bookings/reports` — **PASS.** KPI trio, Visits over
  time (bars render now — the previous agent's definite-height fix holds), Busiest time slots,
  By department table. Branch filter options show real labels and apply; date presets
  All time / Today / Yesterday / Last 7 / 30 / 90 / Custom range all present and applying.
  doc 768/768.

## Gaps I did NOT fix (deliberate, with reason)
1. **VB/01 bulk-select checkbox column** exists in Figma. No bulk visit mutation exists in the RPC
   layer, so a checkbox column would be dead chrome. Needs a product decision + new RPC.
2. **VB/02 `Appointment` legend + appointment blocks.** Figma overlays appointments on the visit
   calendar; those rows live in the Appointments module (another agent's scope this session).
3. **VB/06 `All branches` filter above the table.** `visit_departments` has no branch column, so
   the filter would be decorative. Needs a schema decision.
4. **VB/08 KPI trend deltas** ("+96 this week", "1.2% lower", "-1 min vs last month"). Needs
   prior-period aggregation in the reports query; not inventable from the current payload.
5. **VB/08 default range** is All time; Figma defaults to Last 30 days. With only forward-dated
   visits a backward-looking default renders an empty report, so I left it and flagged it.
6. **Today/Upcoming bucketing uses the UTC date** (`new Date().toISOString().slice(0,10)`) while
   ops sit at UTC+3, so between 21:00-24:00 UTC today's visits read as Upcoming. Fixing it
   properly means aligning the shell and the `admin_list_visits` KPI together.
7. **Shell-level 500 / script-tag warning** (see Environment deviations) — `src/components/**`
   and `src/hooks/**` are outside my scope.

## Locked constraints — all respected
- Duplicate rule untouched (`visit_bookings_active_driver_date_dept_uidx`, `driver_book_visit`).
- RBAC verified, not loosened: routes gate `visits.view` (hub/all/calendar/reports/detail),
  `visits.manage_catalog` (branches/departments/slots), `visits.operate` (reception); server
  actions re-check; `admin_update_visit_status` requires `is_admin_panel_user()` +
  `staff_has_permission('visits.operate')`.
- Notifications stay driver-only through `notify_driver_transactional` (campaign + dispatch run +
  item); no admin push.
- No pending->confirmed workflow invented.
- No seed data added or deleted; every test mutation rolled back (see above).
