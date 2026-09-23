# Artifact PLAY map (2026-09-23)

Source: https://claude.ai/artifact/48FoTM1us3YTeGUhSiwzUv

**PLAY mode is blocked.** The artifact iframe loads the 9-frame overview at 8% zoom. Clicks on PLAY do not enter a frame. The page shows "Sign in to see this artifact's data". Interactive options (dropdowns, chips, bulk steps) were not reachable from this session.

Below is the mapping from the numbered overview thumbnails + titles. UI todos stay paused until you confirm or paste PLAY screenshots.

| # | Artifact title (from overview) | Planned screen | Repo |
|---|--------------------------------|----------------|------|
| 1 | Outgoing (sender) and incoming overview — two hub tiles | `/requests?view=` Receiver / Sender segment | Admin |
| 2 | Incoming — category tile grid | Receiver hub (current `/requests`) | Admin |
| 3 | Sender — load from template (table + employee) | New from template (single send) | Admin |
| 4 | Sender — bulk import from Excel (grid + status) | Bulk Excel preview + confirm | Admin |
| 5 | Sender — penalty list + KPI strip | `/requests/esign/sent` + category/batch filters | Admin |
| 6 | Receiver — loan / request form | Existing Receiver create (not Sender PDF) | Admin |
| 7 | Sender — category form (penalty / decision fields) | Template field form on single-send | Admin |
| 8 | Sender — document / status form | Sender request detail / tracking | Admin |
| 9 | Templates — all categories table | `/requests/esign/templates` | Admin |
| 10 | Unnumbered table under 9 — template data model | Template builder field list | Admin |

## Constraints already locked (do not wait on PLAY)

- Standard employee block: Company, Employee name, ID — same on every template.
- Bulk Excel: Employee ID only; name/company autofill from master.
- One Excel → many PDFs → one e-sign notification per employee.
- Sender and Receiver are separate views with the same capabilities.
- PDF engine: HTML → Chromium (EN + AR `dir="rtl"`).
