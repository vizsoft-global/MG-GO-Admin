# EmployeeDesk V2 — Reports & Settings Spec (audit-first)

> WS-B. Defines pages, widgets, actions, data and permissions **before** implementation. Nothing here is built yet.

## Part 1 — Current state (verified)

### 1.1 Settings routes (12) — all gated `requests.manage`

| Route | Panel | Edits |
|---|---|---|
| `/requests/settings` | inline hub (`LINKS` grid + `fetchSettingsHubCounts`) | read-only |
| `/requests/settings/workflows` | `WorkflowsSettingsPanel` | `request_approval_step_templates` via `admin_upsert_step_template` |
| `/requests/settings/types` | `TypesSettingsPanel` | `request_type_definitions` |
| `/requests/settings/types/[key]` | `RequestTypeDetailShell` | `request_type_definitions` + `request_field_definitions` |
| `/requests/settings/categories` | `CategoriesSettingsPanel` | `complaint_categories` |
| `/requests/settings/tenure` | `TenureSettingsPanel` | `loan_tenure_options` |
| `/requests/settings/departments` | `DepartmentsSettingsPanel` | `request_departments`, `request_department_members` |
| `/requests/settings/roles` | `RolesSettingsPanel` + `StaffAccessDrawer` | `request_staff_access` |
| `/requests/settings/screenshot` | `EsignScreenshotSettingsShell` | `request_type_definitions.screenshot_restricted`, `esign_categories` |
| `/requests/settings/assets` | `EsignAssetsLinkShell` | read-only link to `/assets` |
| `/requests/settings/audit` | `RequestsAuditPanel` | read-only `admin_activity_logs` |
| `/requests/settings/reports` | `RequestsReportsPanel` | read-only |
| `/requests/import-export` | `EsignImportExportShell` | e-sign CSV |
| `/requests/esign/settings` | `EsignScreenshotSettingsShell` (variant) | e-sign default |

**Important:** `request_type_screenshot_policy` was **dropped** in `20260902100100` (folded into `request_type_definitions`). No code may reference that table.

### 1.2 Reports

- `/requests/settings/reports` — `RequestsReportsPanel` — **works**: KPI row, group-by (department | type | status), date presets, 12-week volume chart, department table, appointment counts, e-sign counts, CSV export (`buildCsv` / `downloadCsv`).
- `/requests/reports` — `EsignReportsShell` — **stub**: four KPI cards plus a `stubTitle` / `stubBody` placeholder card and a link to the settings report. Permission `requests.view`.

## Part 2 — V2 Settings plan

### 2.1 Structure

Add `/employeedesk/settings` as a hub with three named groups, re-exporting the existing panels (no forks). Grouping is presentational; every existing route stays reachable.

- **Workflow**: Workflows, Request types, Field builder, Departments, Roles & access.
- **Catalog**: Complaint categories, Loan tenure, Assets (`/assets` link), Screenshot policy.
- **App**: E-Sign settings, Import / Export, Audit log.

### 2.2 Rules

- Every writer stays `requests.manage`. This is a **write** surface; the confirmed read/write split applies to E-Sign queues, not to settings editors.
- The audit log panel is read-only but currently `requests.manage`; recorded as-is, not silently widened.
- No new schema.

### 2.3 Test plan

- `npm run test:requests` green.
- New `test:employeedesk` (or extend `test:requests`): the settings hub renders each link for a `requests.manage` holder and hides the group for a `requests.view`-only holder.
- Settings panels have **no** existing unit tests; add none as a prerequisite — cover only the new hub navigation.

## Part 3 — V2 Reports plan (replacing the stub)

### 3.1 Page

`/employeedesk/reports` renders a new `EmployeeDeskReportsShell` (new file `src/features/employeedesk/employeedesk-reports-shell.tsx`). The V1 `/requests/reports` route is left pointing at its stub until the V2 page is verified, then repointed (a separate, revertible change).

### 3.2 Widgets (each with its own data call and export button)

- **Volume**: requests per day/week over the selected window, grouped by type or status.
- **Status mix**: counts per status with the fleet-wide total (reuse `admin_list_requests.kpi` / `status_counts`).
- **Department workload**: `admin_request_department_report` — open vs decided per department.
- **Resolution**: average resolution seconds and SLA breaches (`avg_resolution_seconds`, `sla_breached_at`).
- **Aging / backlog**: open requests by age bucket (0-2d, 3-7d, 8-30d, 30d+).
- **Staff workload**: decided count per staff actor (from `request_approval_steps.actor_display_name` or the audit log).
- **E-Sign completion**: sent / opened / signed / declined, with `opened` derived from `viewed_at` (see the E-Sign audit).
- **Visits summary** (optional tile only, linking to the visit reports page — no duplicated visit math).

### 3.3 Controls

Date preset (reuse `REQUEST_DATE_PRESETS`), group-by (type | status | department), and per-widget CSV; an XLSX workbook (one sheet per widget) reusing the `orders-report-xlsx` styling constants.

### 3.4 Data sources

Prefer existing RPCs: `admin_list_requests` (kpi, `status_counts`, `filtered_total`, `department_options`), `admin_count_requests_by_type`, `admin_request_department_report`, `esign_requests` counts. Only add an RPC if a widget cannot be answered from these.

- Candidate new RPC (only if needed): `admin_requests_trend(p_from, p_to, p_bucket, p_group_by)` for the volume chart, because bucketing in the client means pulling every row.

### 3.5 Permissions — **open decision**

- Recommended: the reports page reads with **`requests.view`** (it is read-only), and the export button is also `requests.view` because no `requests.export` slug exists today.
- Alternative: add a `requests.export` permission seeded to roles already holding `requests.view`.

## Part 4 — Open decisions (need confirmation before build)

1. **Reports export permission** — reuse `requests.view`, or add `requests.export`? (Recommend reuse.)
2. **Volume chart data** — add `admin_requests_trend`, or compute the buckets client-side from a capped row set? (Recommend the RPC if the window can exceed ~1,000 rows.)
3. **`/requests/reports` stub** — repoint it to the new page, or leave the stub and only expose reports from EmployeeDesk? (Recommend repoint, in its own commit.)

## Part 5 — What must not break

- All 12 settings routes and their panels, their RPCs and their tables (except the dropped `request_type_screenshot_policy`, which nothing may reference).
- `RequestsReportsPanel` stays functional at `/requests/settings/reports`.
- `npm run test:i18n` stays green; new report labels are additive under `pages.employeedesk.reports`.
