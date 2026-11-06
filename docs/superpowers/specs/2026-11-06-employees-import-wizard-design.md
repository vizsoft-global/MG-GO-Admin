# Employees bulk import — wizard

Status: proposed · Surface: `/en/drivers` → Import → New import · Owner: admin panel

## Problem

`DriverBulkImportDialog` opens on one dense screen that carries the template
downloads, the column picker, the lookup downloads, the column guide and the
dropzone at once. The create-vs-update decision is hidden as a
`duplicateStrategy: skip | update` switch on the *third* step, so an operator who
means to update one field has already been shown a screen built for creating
people. Field choice is a dropdown checkbox list, not a visible left/right
selection, and the required set is fixed to the create rules even on an update.

## Goal

Keep every existing capability, and reorder the same parts into a wizard:

`mode → fields → template → upload → map → dry run → apply`

Nothing about the data model, the preview statuses, the chunked job, or the
journal changes. This is a restructuring of the dialog's steps plus two new
authoring steps (mode, fields).

## What already exists and is reused as-is

| Concern | Module |
|---|---|
| Column catalogue, header text, samples, Guide sheet | `import/template.ts` |
| Header signature, guess mapping, stored mapping, row mapping | `import/parse.ts` |
| Name/zone/restaurant/partner/vehicle resolution | `import/resolve-lookups.ts` |
| Identity, duplicate and required-identity rules | `import/import-identity.ts` |
| Server preview (35 status codes) | `drivers-import-actions.ts` → `resolveDriverImportPreview` |
| Chunked apply, pause/resume/cancel, heartbeat | `import/import-job*.ts`, `driver-import-job-provider.tsx` |
| Per-row undo/redo | `import/driver-import-replay-actions.ts`, `import-journal-panel.tsx` |
| Create/update patch semantics (blank keeps, `-` clears) | `import/driver-import-patch.ts` |

## Steps

**1 · Mode.** Two cards: *Add new employees* (→ `duplicateStrategy: "skip"`) and
*Update existing employees* (→ `"update"`). The choice sets the required set for
every later step: create requires `full_name, employee_id, phone, civil_id,
passport_number`; update requires `employee_id` only.

**2 · Fields.** Left: every column grouped by area, mandatory ones starred.
Right: the operator's selection, in order, removable; *Select all*, *Required
only*, *Clear*. Defaults: add = all columns (today's behaviour), update = MG ID
only, so choosing a field is the deliberate act. The selection is the same
`templateSelection` state the generators already read, so the workbook, *Download
sample template* and *Export employees* all follow it with no new plumbing.

**3 · Template.** The existing generate/download block, moved to its own step:
sample template, all-IDs, export employees, restaurants/zones/partners lookups,
column guide collapsible.

**4 · Upload.** The dropzone alone.

**5 · Map.** The existing board, with the required set taken from the mode.
Fully editable; duplicate targets and unmapped required fields block *Continue*.

**6 · Dry run.** The existing preview, unchanged: grouped counts, ready/review/
error statuses, selectable ready rows, `downloadErrors`.

**7 · Apply.** The existing job panel: progress, pause/resume/cancel, credentials
download, journal undo/redo once finished.

## State

`import/wizard-state.ts` holds the pure decision logic — step order, mode →
strategy, required fields per mode, default selection, and the guard for leaving
a step. No React, so `node --test` covers it.

## Risks

- One 1059-line dialog gains step conditions; the risky parts (mapping, preview,
  apply) are untouched and stay behind their existing state.
- Update mode relaxes the mapped-required check from five fields to one. The
  server already accepts an MG-ID-only row for an existing person
  (`evaluateImportIdentity`: a blank name is only fatal for a *new* person), so
  this is the panel catching up with the engine rather than a new rule.
- i18n parity: `test:i18n` requires every new key in both `en.json` and
  `ar.json`.

## Out of scope

MG ID auto-generation (still typed by the operator; the only counter is
`driver_code_seq`). Import entry points beyond the drivers page. Server-side
changes of any kind.
