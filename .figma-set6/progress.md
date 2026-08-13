# RCM settings Figma verification — set 6 (resumed after b80dc78)

Env notes
- Shared dev server is on **port 3000** (an earlier one was on 3100 and died). Never killed it.
- `browser_take_screenshot` only captures a ~1024x535 crop of the emulated 1366x768 viewport.
  Use CDP `Page.captureScreenshot` + `.figma-set6/shot.cjs` to get the true viewport.
- Fit check must measure the **scrolling `main`/content containers**, not `document` —
  document scrollHeight is always 768 here. The left sidebar nav legitimately scrolls; ignore it.

Global findings
- Screenshot toggle polarity ON=Blocked **matches** Figma 4355:4570 (dark/on switch is labelled
  "Blocked" there too). An earlier note claiming Figma wanted ON=Allowed was wrong.
- Dev-server hazard: all `/en/requests/settings/*` subroutes started returning 404 while
  `/en/requests/settings` still rendered. Files were intact; touching the route `page.tsx`
  files made Turbopack re-register them. No restart needed — do not kill the shared server.

- PRE-EXISTING hydration error from `src/app/[locale]/(dashboard)/layout.tsx:55` (DashboardLayout).
  Out of my file scope, affects every dashboard route. Reported, not fixed.
- Breadcrumb root label is "Requests & Complaints" but Figma + sidebar say "Request & Complaint".
  Shared key `pages.requests.title`, also used by menu registry → reported, not changed.
- `request_approval_step_templates` contains BOTH `manager` and `managers` role keys
  (confirmed in DB). Known open item awaiting client decision — reported, not fixed.
- DB truth: workflows 8, screenshot-policy types 8, assets 6, departments 1, esign categories 7,
  complaint_categories 0, loan_tenure_options 0, request_staff_access 0, dept members 0.

## Screen log

| # | node | route | verdict | notes |
|---|------|-------|---------|-------|
| 1 | 4152:8349 | /en/requests | PASS | Hub grid + centered header (b80dc78 change verified on final state). |
| 2 | 4149:27473 | /en/requests/settings/workflows | PASS | Save workflow now disabled until dirty (b80dc78 fix verified). |
| 3 | 4149:27737 | /en/requests/settings/categories | BLOCKED (values only) | complaint_categories = 0 rows by design; CRUD works, list intentionally empty. |
| 4 | 4451:4342 | /en/requests/settings/types | PASS | 8 types; SCREENSHOTS/STATUS switches render after initial load. Figma node labels were swapped in .figma-qa5. |
| 5 | 4149:27958 | /en/requests/settings/assets | PARTIAL | 6 assets; asset_catalog.category / penalty_kwd empty for existing rows → Figma columns show placeholders. |
| 6 | 4149:28226 | /en/requests/settings/departments | PARTIAL | 1 department, 0 members → empty state correct but Figma member list unverifiable. |
| 7 | 4406:4342 | drawer "Edit access" | PASS (fixed) | Sheet was 384px (base `data-[side=right]:sm:max-w-sm` outranks utility) → "Salary justification" ellipsized. Set explicit 440px to match Figma; 0 clipped labels; no inner scroll. Save writes request_staff_access (verified in DB), revert deletes it. |
| 8 | 4407:4342 | drawer "Assign staff" | PASS | Same sheet; staff SearchSelect + per-type segments + footer match Figma. Minor copy deviations (trigger placeholder "Select staff…" vs Figma "Search staff by name...", title case). |
| 9 | 4149:26653 | /en/requests/settings/audit | PASS (fixed) | TARGET showed raw route keys and DETAILS raw UUIDs. Resolve entity_id / context.requestId to requests.request_code + type so TARGET reads "RCM-0007 · Salary justification"; UUID-valued context entries dropped from DETAILS. Trimmed toolbar/pagination padding: 10 rows now fit 768px with no inner scroll (was 778). |
| 12 | 4355:4570 | /en/requests/settings/screenshot | PARTIAL | Layout, banner, groups, ON=Blocked polarity all match Figma; toggle round-trip verified in request_type_screenshot_policy (fuel true→restored false). FAIL on Rsp: 15 real rows (8 types + 7 e-sign) overflow the viewport by 138px. Screen lives in src/features/esign/esign-screenshot-settings-shell.tsx — OUT OF MY FILE SCOPE, not fixed. |
| 10 | 4149:28796 | /en/requests/settings | PASS | 9 setting cards incl. E-Signature; counts read from DB. |
| 11 | 4355:4342 | /en/requests/settings/roles | PASS (fixed) | Matrix listed only staff WITH grants → empty. Replaced groupByStaff with buildStaffRows(staffOptions, rows) so all 7 staff render. DEPARTMENT column is "—" for everyone: profiles has no department and request_department_members = 0 rows. |
