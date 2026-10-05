# EmployeeDesk V2 — E-Signature Audit & Build Contract

> WS-E0 / WS-A2. Written **before** any E-Sign code change.
> Rule of this document: a feature is only "done" when a working route, component, action/RPC, DB object, permission and test can be named for it. "A tile exists" is not evidence.

## 1. Confirmed decisions

1. **Signer model** — single signer (the employee) today, but the database is made **multi-signer-ready** via a new `esign_request_signers` table. The UI stays one signer. Existing `esign_requests` columns are kept and dual-written so V1 and installed app builds keep working.
2. **opened / not_opened** — derived from `esign_requests.viewed_at`. `opened = viewed_at IS NOT NULL`; `not_opened = status = 'pending' AND viewed_at IS NULL`. **No enum change.** `esign_request_status` keeps `pending | signed | expired | cancelled | declined`.
3. **Ship scope** — Admin panel **and** rider app (`MG-GO`), end to end.
4. **Permission split** (confirmed) — reads use `requests.view`; writes use `requests.manage`.

Note: `admin_esign_resolve_employees`, `admin_create_esign_batch`, `admin_upsert_esign_template*`, `admin_claim_esign_batch_rows` and `admin_create_esign_request` are already `SECURITY DEFINER` with an explicit `is_admin_panel_user()` + `staff_has_permission(...)` gate. The permission split only changes **client-side action gating** and, where a read RPC lacks it, adds the `requests.view` gate.

## 2. Current architecture (verified)

### 2.1 Tables (all on `eoksxkdssptgyqyywdju`)

- `esign_categories` — `key`, `label_en`, `description`, `icon_key`, `screenshot_restricted`, `is_active`, `sort_order`.
- `esign_requests` — `id`, `request_code` (`SIG-####`), `title`, `category_key`, `driver_id`, `status`, `due_at`, `document_storage_key`, `signature_storage_key`, `signed_document_storage_key`, `signed_document_error`, `signature_meta`... plus new columns from `20260901100000` and `20261027600000`: `sent_at`, `viewed_at`, `declined_at`, `declaration_accepted_at`, `signer_display_name`, `signer_meta`, `template_id`, `template_version`, `batch_id`, `batch_row`, `description`, `field_values jsonb`, `employee_snapshot jsonb`.
- `esign_templates` — bilingual `name/header/body/declaration_en|ar`, `default_language`, `version`, `is_active`.
- `esign_template_fields` — `field_key` (CHECK `^[a-z][a-z0-9_]*$` and **must not** be a reserved employee key), `label_en/ar`, `field_type`, `options`, `is_required`, `sort_order`. `UNIQUE (template_id, field_key)`.
- `esign_batches` — `batch_code` (`BAT-####`), `template_id`, `template_version`, `language`, `title`, `due_at`, `source_filename`, `total_count`, `created_count`, `failed_count`, `status` (`queued|processing|completed|partial`).
- `esign_batch_rows` — `batch_id`, `row_index`, `driver_id`, `employee_id`, `description`, `field_values jsonb`, `status` (`pending|created|failed`), `error`, `esign_request_id`. `UNIQUE (batch_id, row_index)`.

### 2.2 Server actions ([src/features/esign/esign-sender-actions.ts](src/features/esign/esign-sender-actions.ts))

- Templates: `fetchEsignTemplates`, `fetchEsignTemplate`, `upsertEsignTemplate`, `upsertEsignTemplateField`, `deleteEsignTemplateField`.
- Resolve: `resolveEsignEmployees(employeeIds)` → RPC `admin_esign_resolve_employees` (statuses `ok|unknown_id|archived|blocked|ambiguous|invalid`).
- Snapshot: `fetchEsignSnapshot(driverId)` → RPC `esign_employee_snapshot`.
- Send: `createEsignFromTemplate(input)` → `renderEsignPdf` → upload → RPC `admin_create_esign_request`.
- Bulk: `createEsignBatch(input)` → RPC `admin_create_esign_batch`; `processEsignBatchChunk(batchId)` → RPC `admin_claim_esign_batch_rows` → per-row render/upload/create; `fetchEsignBatches`, `fetchEsignBatch`.

### 2.3 Rendering engine ([src/features/esign/render/](src/features/esign/render/))

- `esign-document-html.ts` — deterministic HTML from `{ language, header, body, declaration, description, fields[], employee }`.
- `esign-pdf-renderer.ts` — `launchEsignBrowser()` + `renderEsignPdf(document, browser)` (headless PDF).
- `esign-compose-stamp.ts` — signature stamping.
- `esign-placeholders.ts` — `EsignEmployeeSnapshot` + reserved keys.
- `esign-batch-cap.ts` — `CHUNK_SIZE`.
- `esign-document-html` / `documentForLocale()` is the live-preview source of truth (same input as PDF).

### 2.4 RPCs

- Staff: `admin_upsert_esign_template(jsonb)`, `admin_upsert_esign_template_field(jsonb)`, `admin_esign_resolve_employees(jsonb)`, `esign_employee_snapshot(uuid)`, `admin_create_esign_batch(jsonb)`, `admin_claim_esign_batch_rows(uuid, int)`, `admin_create_esign_request(11 args)`.
- Rider: `driver_list_esign_requests`, `driver_get_esign_request(uuid)`, `driver_mark_esign_viewed(uuid)`, `driver_submit_esignature`, `driver_decline_esignature`, plus `driver_read_own_esign` RLS and `esign_documents_driver_read_source`.

### 2.5 Rider app (MG-GO)

- Routes: `/profile/support/sign`, `/profile/support/sign/:id`, `/profile/support/sign/:id/capture`, `/profile/support/sign/:id/confirmed`.
- RPC client: [support_service.dart](../../../MGgo-User/MG-GO/lib/features/support/support_service.dart) — `listEsignRequests`, `getEsignRequest`, `markEsignViewed`, `uploadEsignSignature`, `composeSignedEsignDocument`, `submitEsignature`, `declineEsignature`.
- Push deep link: [notification_router.dart](../../../MGgo-User/MG-GO/lib/core/notifications/notification_router.dart) maps `screen: esign` / `record_type: esign` → `/profile/support/sign/:id` and invalidates `esignRequestsProvider`.
- Send already notifies: `admin_create_esign_request` calls `notify_driver_transactional(...)` with `'musallam:///profile/support/sign/' || id`.

## 3. The 17 client capabilities — status, gap, planned mapping

Legend: **[EXISTS]** reuse as-is · **[PARTIAL]** piece exists, needs extension · **[MISSING]** net-new.

### F1 — Single eSign send — [EXISTS]
- Route `/requests/esign/send`; component [esign-send-shell.tsx](src/features/esign/esign-send-shell.tsx); action `createEsignFromTemplate`; RPC `admin_create_esign_request`; permission `requests.manage`; test `test:esign`.
- Gap: none functional. V2 route `/employeedesk/esign/send` re-exports the shell.

### F2 — Bulk Excel upload — [EXISTS]
- Route `/requests/esign/bulk`; component [esign-bulk-shell.tsx](src/features/esign/esign-bulk-shell.tsx); action `createEsignBatch`; RPC `admin_create_esign_batch`.
- Gap: none functional.

### F3 — Row validation & inline fix — [PARTIAL]
- Exists: `resolveEsignEmployees` returns per-row status; bulk preview shows unresolved rows (upload preview only).
- Gap: no way to **edit** an employee id / **remove** a row and re-resolve without re-uploading the file.
- Plan: bulk shell gains a "Fix rows" step; new component `src/features/esign/esign-bulk-row-fix.tsx`; new RPCs `admin_update_esign_batch_row(p_row_id, p_employee_id, p_field_values)` and `admin_remove_esign_batch_row(p_row_id)` (migration `20261115000300`); re-resolve via existing `admin_esign_resolve_employees`.
- Test: `src/features/esign/esign-bulk-rows.test.ts` — edit id → status flips `unknown_id`→`ok`; remove → `total_count`/rows recalculated.

### F4 — Bulk send — [EXISTS]
- Route bulk shell "Send"; action `createEsignBatch` + chunk driver; RPC `admin_claim_esign_batch_rows`.
- Gap: none.

### F5 — Batch progress tracking — [PARTIAL]
- Exists: `fetchEsignBatch` returns `total/created/failed/status`; [esign-batch-detail-shell.tsx](src/features/esign/esign-batch-detail-shell.tsx) shows lines; `processEsignBatchChunk` returns `remaining`.
- Gap: no visible progress bar; chunks are not auto-driven to completion.
- Plan: batch detail auto-loops `processEsignBatchChunk` while `remaining > 0`, shows a progress bar `(created + failed) / total`, status chips, live polling.
- Test: `src/features/esign/esign-batch-progress.test.ts` — remaining strictly decreases; status transitions `queued→processing→completed|partial`.

### F6 — Pending / waiting employee list — [MISSING]
- Plan: new route `/employeedesk/esign/waiting`; new component `src/features/esign/esign-waiting-shell.tsx` — `pending` requests with sub-filter **Opened / Not opened**, `due_at` age, last reminder, "Remind" and "Remind all not-opened".
- Data: `fetchEsignRequestsList({ status: 'pending' })` + derived opened filter (F7).
- Permission: `requests.view`.
- Test: `src/features/esign/esign-opened-status.test.ts`.

### F7 — Statuses opened / not_opened / signed / declined — [PARTIAL → DERIVE]
- Exists: `viewed_at`, `declined_at`, `signed_at`; status tabs on [esign-sent-shell.tsx](src/features/esign/esign-sent-shell.tsx); `fetchEsignStatusCounts`.
- Plan: extend `admin_list_esign_requests` and the counts RPC so `p_status` also accepts derived `opened` / `not_opened`, and `EsignStatusCounts` gains `opened` / `notOpened`. **No enum change.**
- Migration `20261115000400_esign_opened_status.sql`.
- Test: `esign-opened-status.test.ts` — a `pending` row with `viewed_at NULL` counts as `not_opened`; with `viewed_at` set counts as `opened`; a `signed` row is never counted as `not_opened`.

### F8 — Bulk & individual reminders with cooldown — [MISSING]
- Plan: new `src/features/esign/esign-reminder-button.tsx` (individual + "Remind all not-opened"); new RPCs `admin_send_esign_reminders(p_request_ids uuid[], p_kind text)` and `admin_esign_reminder_state(p_request_ids uuid[])`.
- DB (migration `20261115000100`): table `esign_reminders(id, request_id, batch_id, kind, channel, sent_at, sent_by)`; `app_settings.esign_reminder_cooldown_hours int NOT NULL DEFAULT 24`; a notification template seeded idempotently by name (migration `20261115000500`). Reminder delivery reuses `notify_driver_transactional` with the same `record_type: esign` payload so the app already deep-links it.
- Enforcement: cooldown is **server-side**; the UI disables the button and shows "Next reminder in Nh" from `admin_esign_reminder_state`.
- Permission: `requests.manage`.
- Test: `src/features/esign/esign-reminders.test.ts` — second reminder inside the window is refused; after the window it is allowed; bulk fan-out writes one row per id.

### F9 — Signed-document download & bulk ZIP — [PARTIAL]
- Exists: individual download via `esignDocumentHref(id, "signed"|"document"|"signature")` ([esign-storage-key.ts](src/features/esign/esign-storage-key.ts)).
- Plan: new route handler `src/app/api/esign/batch-zip/route.ts` (`?batch_id=` or `?ids=`) streaming a ZIP with `archiver`; a `manifest.csv` listing included/skipped; per-request `signed_document_storage_key`; cap (e.g. 500) with a clear message. "Download signed (ZIP)" button on batch detail and sent toolbar.
- Permission: `requests.view` + server-side `hasPermissionInSet`.
- Test: `src/features/esign/esign-zip.test.ts` — manifest names each included request; a row with no signed copy is listed as skipped, not silently dropped.

### F10 — Resume failed batch chunks — [MISSING]
- Exists: `admin_claim_esign_batch_rows` re-claims only `status = 'pending'`; failed rows cannot be retried.
- Plan: extend the RPC to `admin_claim_esign_batch_rows(p_batch_id uuid, p_limit int, p_mode text DEFAULT 'pending')` where `p_mode ∈ (pending|failed|all)`; `processEsignBatchChunk(batchId, mode = 'pending')`.
- Migration `20261115000300` (same file as F3). `DEFAULT 'pending'` keeps the existing 2-arg call working — **must not** be a new overload (PostgREST "function is not unique"). If the function is dropped, re-apply `REVOKE`/`GRANT`.
- UI: "Retry failed" on batch detail when `failed_count > 0`; clears each row's `error`.
- Test: `src/features/esign/esign-batch-reclaim.test.ts` — failed rows re-claimed under `mode='failed'`; counts recomputed.

### F11 — Drafts — [MISSING]
- Plan: new route `/employeedesk/esign/drafts`; new component `src/features/esign/esign-drafts-shell.tsx`; "Save draft" on send + bulk.
- DB (migration `20261115000200`): `esign_drafts(id, template_id, language, title, due_at, field_values jsonb, rows jsonb, source_filename, status, created_by, created_at, updated_at)` + staff RLS; RPCs `admin_save_esign_draft`, `admin_list_esign_drafts`, `admin_get_esign_draft`, `admin_delete_esign_draft`.
- Permission: `requests.manage`.
- Test: `src/features/esign/esign-drafts.test.ts` — save/list/get/delete round-trip; a stored bulk draft resumes to `createEsignBatch`.

### F12 — Template list / detail / builder — [EXISTS]
- Routes `/requests/esign/templates` + `/templates/[id]`; components [esign-templates-shell.tsx](src/features/esign/esign-templates-shell.tsx) + [esign-template-builder-shell.tsx](src/features/esign/esign-template-builder-shell.tsx); actions listed in §2.2.
- Gap: none functional (F14/F17 add UI inside it).

### F13 — Downloadable example Excel sheets — [PARTIAL]
- Exists: bulk dialog has a template download (generic).
- Plan: new `src/features/esign/esign-example-sheet.ts` — generate a sheet whose header is `employee_id` (required) plus one column per template field (`label_en`), reusing `orders-report-xlsx` styling; a Guide sheet explains required vs optional and reserved/system fields.
- Test: `src/features/esign/esign-example-sheet.test.ts` — header equals template fields; reserved keys never appear as columns.

### F14 — System vs Sheet fields resolution — [PARTIAL → UI]
- Exists: reserved keys enforced by CHECK `esign_template_fields_not_employee`; `esign_employee_snapshot` resolves them; sheet values travel in `field_values`.
- Plan: template builder renders two sections — **System fields** (read-only list from `ESIGN_RESERVED_FIELD_KEYS`) and **Sheet / Template fields**; bulk preview shows a legend of which value will be resolved from the driver vs from the sheet.
- Test: `src/features/esign/esign-field-resolution.test.ts` — reserved keys are rejected by the builder; snapshot value reaches the document.

### F15 — Signer configuration — [MISSING → single now, multi-ready]
- Plan: new table `esign_request_signers(id, request_id, driver_id, role, sort_order, status, signed_at, signature_storage_key, signer_display_name, signer_meta, created_at, updated_at)`, `role` default `'signer'`, `UNIQUE (request_id, sort_order)`, `UNIQUE (request_id, driver_id, role)`.
- Backfill: one `role='signer'` row per existing `esign_requests` from `driver_id`, `signature_storage_key`, `signer_meta`, `signer_display_name`, `signed_at`, `viewed_at`.
- Dual-write: `admin_create_esign_request` inserts the primary signer row; `driver_submit_esignature` / `driver_decline_esignature` / `driver_mark_esign_viewed` update it **and** the legacy columns. A trigger keeps legacy columns in sync if a signer row is written directly.
- RLS: staff read; rider reads own (`driver_id = auth.uid()`).
- Migration `20261115000000_esign_signers_multi_ready.sql`.
- Test: `src/features/esign/esign-signers.test.ts` — backfill count equals `esign_requests` count; submit writes the signer row; legacy columns still written (V1 + installed app unaffected).

### F16 — EN / AR bilingual templates — [EXISTS]
- Bilingual columns + `default_language`; render picks `_ar` when `locale='ar'` with `label_ar || label_en` fallback.
- Test: `test:esign` — ar document render.

### F17 — Live HTML/PDF preview — [MISSING]
- Plan: new `src/features/esign/esign-preview-dialog.tsx`; new server action `previewEsignDocument(input)` in `esign-sender-actions.ts` reusing `documentForLocale()` + `esign-document-html.ts` to return HTML rendered in an iframe (EN/AR toggle, sample employee snapshot). No PDF render for preview (faster); an optional "Render PDF" reuses `renderEsignPdf`.
- Entry points: template builder, send shell, bulk preview.
- Test: `src/features/esign/esign-preview.test.ts` — header/body/declaration chosen per locale; field label fallback.

## 4. Planned migrations (all pushed to `eoksxkdssptgyqyywdju` + `npm run db:types`)

- `20261115000000_esign_signers_multi_ready.sql` — F15.
- `20261115000100_esign_reminders.sql` — F8 (table + cooldown setting + 2 RPCs).
- `20261115000200_esign_drafts.sql` — F11 (table + 4 RPCs + RLS).
- `20261115000300_esign_batch_reclaim_failed.sql` — F3 + F10 (claim `p_mode`, row update/remove).
- `20261115000400_esign_opened_status.sql` — F7 (derived opened/not_opened in list + counts; no enum change).
- `20261115000500_esign_reminder_notify_template.sql` — F8 notification template (idempotent by name).

## 5. Rider app changes (`MG-GO`)

- **F7 opened/not-opened sub-filter** in [esign_documents_screen.dart](../../../MGgo-User/MG-GO/lib/features/support/esign_documents_screen.dart); confirm `viewed_at` is parsed in [support_models.dart](../../../MGgo-User/MG-GO/lib/features/support/support_models.dart) (add `viewedAt` if absent).
- **F8 reminders** — no new app RPC; the reminder is a `notify_driver_transactional` push that already deep-links through [notification_router.dart](../../../MGgo-User/MG-GO/lib/core/notifications/notification_router.dart) and invalidates `esignRequestsProvider`.
- **Opened tracking** — `markEsignViewed` already fires only after the document resolves; keep it that way, or `opened` becomes a false positive.
- **F15** — no app change (legacy primary-signer fields preserved).
- Tests: `flutter analyze` 0 errors; `flutter test` — inbox sub-filter case + reminder deep-link route case.

## 6. V1 preservation guarantees

- `/requests/esign/*` (12 routes) stay live and unchanged in behaviour; V2 routes re-export the same shells.
- `admin_create_esign_request` keeps its 11-arg signature and its `idempotent` batch-row behaviour.
- `admin_claim_esign_batch_rows` gains a `DEFAULT` argument, never a second overload.
- `esign_requests` legacy signer columns are dual-written, so the driver app payload `driver_get_esign_request` and the V1 detail page are unaffected.
- The status enum is untouched, so every existing filter, KPI and CSV column keeps its meaning.

## 7. Open watches

- Bulk ZIP must stream and cap; a 500-document ZIP built in memory will trip a serverless limit.
- Reminder cooldown must be enforced in SQL; a disabled button is not a lock.
- `esign_drafts.rows jsonb` for a large batch must be size-capped and validated.
