<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Language (mandatory)

Always respond to the user in **Kannada (ಕನ್ನಡ)**.

Keep code, file paths, commands, identifiers, and error messages in their original form (usually English). Explanations, summaries, and UI-facing guidance go in Kannada.

Applies to every agent and subagent working in this repo — this file is the global ruleset; `.cursor/rules/KA.mdc` mirrors it for Cursor.

## Stack — production only

Do not use the retired testing stack. Local `.env.local`, migrations, and Vercel deploys all target production.

| Thing | Production |
|-------|------------|
| Admin URL | https://dpdadmin-prod.vercel.app |
| Vercel project | `dpdadmin-prod` |
| Backend | Firestore + Cloud Functions on `musallam-delivery-prod` (`me-central2`) |
| Supabase | paused `eoksxkdssptgyqyywdju` — admin no longer calls it |
| R2 | `dpd-private-prod` |
| Firebase | `musallam-delivery-prod` |

Retired (never link, push, or deploy to): `dpdadmin` · `ytfmsgckjatiserpgdbz` · `dpd-private` · `musallam-delivery-kw`.

## UI/UX (mandatory)

Before **any** UI or UX change, read and follow [`.cursor/rules/ui-system.mdc`](.cursor/rules/ui-system.mdc). It is `alwaysApply: true` in Cursor — treat it as non-negotiable. Complete the pre-ship checklist in that file before claiming work is done.

Key patterns: footer-first modals via `AppModalFooter` (title in footer, Close top-right outside), action differentiation (view vs delete), compact `h-9` controls, semantic color for state.

## Change log

- **2026-10-19 — [admin] Launcher tiles trimmed:** the Home launcher no longer draws **Dashboard**, **Payroll** or **Earnings** cards. `LAUNCHER_HIDDEN_TILE_IDS` filters them inside `mergeLauncherTiles` only, so `LAUNCHER_TILE_IDS`, Roles & Permissions, sidebar rows and routes are untouched. Group tiles resolve `appNavGroups.*` instead of `nav.*`, and `nav.system` now exists (EN "System" / AR "النظام"), which is what stopped the System card printing its raw key.
- **2026-10-19 — [admin+app] Delivery integrity:** check-in photo + restaurant proximity gate, early-drop/zone flags, on-device order-photo OCR with server cross-check, delivery timeline (admin + rider), vehicle companies catalog, fuel chip request id removal, attendance check-in proof. New `adminUpsertVehicleCompany` callable; `driverSetDutyState` / `driverCompleteDelivery` / `driverCreatePickup` / `driverGetDeliveryProximityContext` / `driverGetActivePickup` / `adminListAttendanceDaily` updated in `me-central1`.
- **2026-10-19 — [admin] eSign preview/print/edit:** A4 preview now contain-fits and zooms without clipping; Edit Form covers headers, value cells, options and footer while protecting signature/management slots; unsigned requests can be edited and regenerated from the template; stored sheets carry `sheet_render_version`; long sheets print on up to two A4 pages with `break-inside` guards.
