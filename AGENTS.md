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

- **2026-10-19 — [admin] Launcher groups its tiles, and Vehicles is Fleet Hub everywhere:** `/dashboard` renders tiles under **EmployeeDesk / Operations / Fleet Hub / Settings / System** headings (`LAUNCHER_SECTIONS`, `sectionForTile`, `groupLauncherTiles` in `src/lib/menu/launcher-modules.ts`), and a typed search collapses back to the flat grid so a query never hides a hit behind a heading. The hardcoded `vehicles: "Vehicles"` launcher label override is removed, so the registry's **Fleet Hub** label (AR `مركز الأسطول`) reaches the launcher as it already did the sidebar. Duplicate Lucide glyphs across `MENU_REGISTRY` are replaced with distinct ones (`Undo2`, `CalendarDays`, `ShieldCheck`, `SlidersHorizontal`, `ListChecks`, `Droplets`, `PackageX`, `Tags`, `WalletCards`, `Percent`, `CreditCard`, `MonitorSmartphone`, `Factory`, `PackageCheck`, `AlertOctagon`, `Route`, `RefreshCw`, `Building`, `FileSpreadsheet`, `UsersRound`, `Workflow`), `MENU_CACHE_VERSION` moves v34 → v35, and `assignStaffStampSlots` is generic over its signer so the e-sign stamp path keeps `signatureKey` and the tree typechecks. Verified: `npx tsc --noEmit` clean, `npm run test:i18n` 9,653 keys × 2 locales, launcher suite 10/10, `npm run build` exit 0; deployed `dpl_E5AWUWjMQu9CjQHDXuQZfTPR49UQ` and `vercel inspect dpdadmin-prod.vercel.app` resolves the alias to it (`/en/login` and `/ar/login` 200, `/en/dashboard` 307 — the auth gate, not a 404). `npm run test:vehicles` is 99/101 with two pre-existing `menu-merge` ordering assertions (`drivers` / `compliance` sit in Operations at HEAD), untouched here. Commit `624d201` on `vk-firebase-dev`.
- **2026-10-19 — [admin+app] eSign unified:** Loan / Accident / Payslip sheets now follow the reference PDFs — loan carries Employee Information → Loan Request → Repayment Schedule (serial 03) → HR Verification → Management Decision, the accident tail prints Rider Name + declaration, and the payslip adds a verification block. Every sheet value is Admin-editable: `isSheetInput` accepts `system` rows (snapshot-prefilled, never hidden), `saveEsignFormSheet` is unsigned-only (`document_locked` for signed/declined/expired/cancelled), Edit Form covers titles, management and the footer, and the signer editor goes read-only after signature. The signed copy stamps both the rider and the staff counter-signatures in `hr → gm` / `hr → ceo` / `hr` slots, keyed by `sort_order`; `signed_document_source_hash` recomposes when the source, layout or signature set changes. Red/blue sheet boxes are gone, default stamp pieces are signature + name, and staff caption stacks are clamped inside their slots. Rider app: the ✕ guides are removed from the signature pad, the last filter chip no longer wraps, and the list refreshes to `signed` before leaving the capture screen. Verified: `npm run typecheck`, functions `tsc --noEmit`, `npm run test:esign` 229/229, functions tests 344/344, `test:i18n` 9,653 keys × 2 locales.
- **2026-10-19 — [admin] Bulk notifications send again:** `sendPushBatch` splits into `FCM_MAX_MESSAGES_PER_CALL` (500) slices with per-chunk aggregation, because the Admin SDK rejects `sendEach` above 500 messages and a fleet campaign failed outright with `invalid-argument`. `dispatchNotificationCampaign` writes its per-item status rows in bounded parallel slices (`DISPATCH_ITEM_UPDATE_CONCURRENCY = 25`) instead of awaiting 600+ updates one at a time, and both wizard transitions catch a rejected server action and toast `errors.saveFailed` rather than taking the page to the Next error boundary. Spreadsheet import matches more identity headers (`AM_ID_HEADER` / `MG_ID_HEADER`) and has its own `importParseFailed` / `importEmptyFile` copy in EN and AR. Verified: `npm run typecheck` clean, `test:i18n` 9,646 keys × 2 locales, `test:notifications` 19/19; deployed `dpl_HaenMTM3YFPyvnoKGqZGzowNLk68` and `vercel inspect` resolves `dpdadmin-prod.vercel.app` to it (`/en/login` and `/ar/login` 200, `/en/notifications` and `/en/notifications/new` 307 — the auth gate, not a 404).
- **2026-10-19 — [admin] Launcher tiles trimmed:** the Home launcher no longer draws **Dashboard**, **Payroll** or **Earnings** cards. `LAUNCHER_HIDDEN_TILE_IDS` filters them inside `mergeLauncherTiles` only, so `LAUNCHER_TILE_IDS`, Roles & Permissions, sidebar rows and routes are untouched. Group tiles resolve `appNavGroups.*` instead of `nav.*`, and `nav.system` now exists (EN "System" / AR "النظام"), which is what stopped the System card printing its raw key.
- **2026-10-19 — [admin+app] Delivery integrity:** check-in photo + restaurant proximity gate, early-drop/zone flags, on-device order-photo OCR with server cross-check, delivery timeline (admin + rider), vehicle companies catalog, fuel chip request id removal, attendance check-in proof. New `adminUpsertVehicleCompany` callable; `driverSetDutyState` / `driverCompleteDelivery` / `driverCreatePickup` / `driverGetDeliveryProximityContext` / `driverGetActivePickup` / `adminListAttendanceDaily` updated in `me-central1`.
- **2026-10-19 — [ops] Firestore cost + 429:** the three Worker HTTPS doors now run `cpu: 1 / concurrency: 40 / maxInstances: 20 / minInstances: 1`; Worker GPS sink is `r2` at 100% and cut over on 2026-10-19 after a full-day R2 export and a **220/220 OK** all-rider compare (`GPS_DUAL_WRITE=0`, `location_gps_r2_since=2026-10-19`); fleet roster reads are 120s and the post-roster rider read is 60s with per-driver coalescing; `FLEET_BASE_CACHE_MS` is 60s and degraded snapshot polling is 30s. Added `scripts/firestore-expiry-backfill.mjs` and `docs/FIRESTORE_COST_GUARDRAILS.md`; fixed `gps-archive-export` pagination with an explicit `__name__` order and made the compare read the Worker `/history` archive with timestamp dedupe + distance-coverage verdict.
- **2026-10-19 — [admin] eSign preview/print/edit:** A4 preview now contain-fits and zooms without clipping; Edit Form covers headers, value cells, options and footer while protecting signature/management slots; unsigned requests can be edited and regenerated from the template; stored sheets carry `sheet_render_version`; long sheets print on up to two A4 pages with `break-inside` guards.
