# RCM / Visit Booking / E-Sign — Open Items

This document consolidates every remaining item across RCM, Visit Booking, and E-Sign into one place, organised by **who is blocking it** — not by module — so Section A can be forwarded to the client as-is.

---

## 0. Status Snapshot

A 73-row Figma QA matrix has been scored: **72 PASS, 0 PARTIAL, 0 BLOCKED, 1 OUT OF SCOPE, 0 FAIL.** [`docs/RCM_VISIT_FIGMA_QA.md`](RCM_VISIT_FIGMA_QA.md) holds the per-row verdicts and is the authority on the count — quote it rather than restating a number here.

- **PASS** — matches Figma and is fully backed by data/logic; nothing further needed.
- **PARTIAL** — the screen works but is missing a piece (usually a data source or a wording detail) that is tracked as an open item below.
- **BLOCKED** — cannot be closed without a decision, an asset, or a device that isn't available in this environment.

Admin covers 40 rows with zero FAIL. Driver app covers 33 rows. Those were originally scored from code and Figma alone; as of 2026-08-12 seven of the screens are also rendered and measured under `flutter test` at Pixel 9 metrics in Arabic — the Help & Support hub, the dynamic request form, signature capture, my requests, the request detail, the visit ticket and the e-sign viewer's chrome. Device-bound rows are closed: resolved PDF preview, system chrome, and the signed confirmation for `SIG-9002`. See Section B and D.

---

## A. Needs a Decision from the Client

*This section is self-contained — no file paths or internal table names are referenced except where the client already uses the term. It can be forwarded on its own.*

### A.1 Value Lists — ✅ Confirmed and shipped (2026-08-12)

Both lists are live in production and editable from the admin panel: complaint categories under **Settings → Complaint categories**, tenures under **Settings → Loan tenure options**. Loan and complaint requests are no longer blocked in the driver app.

| Item | Decision |
|---|---|
| **Loan / Advance — Tenure Options** | 3, 6, 9, 12, 18, 24 months |
| **Complaint — Category List** | Payments, Salary Issues, Attendance / Check-in, Visit / Booking Issues, Vehicle / Fuel, HR / Workplace, Document / E-Sign Issues, App / Technical Issue, Other |

### A.2 Behaviour & Permissions — ✅ Confirmed

1. **E-Sign visibility** — All five E-Sign screens require the `requests.manage` permission, so a read-only operator cannot see E-Sign at all.
   **Decision: Confirmed as intended.** No change.

2. **Signed document preview** — For a signed request, the preview pane currently shows the original (unsigned) document; only print and download serve the signature-stamped copy.
   **Decision: Confirmed — preview should also show the stamped copy.** ✅ Shipped 2026-08-12: the preview prefers the stamped copy and says so, falling back to the original only while composition is pending or after it failed.

3. **Duplicate role key in approval templates** — Approval templates currently carry both `manager` and `managers` as role keys, producing two near-identical department filter options. This sits inside the locked approval chain, so it needed explicit sign-off.
   **Decision: Consolidate to a single role key — `manager`.** ✅ Shipped 2026-08-12: the loan chain's step 4 and the one in-flight request carrying the plural were corrected, so the department filter lists one Manager option.

4. **Driver app status wording** — Both the `pending` and `submitted` request states currently display as "Pending" in the app, while Figma shows "Submitted" (and, in one frame, the misspelling "Request Recieved").
   **Decision: Use "Pending" for `pending` and "Submitted" for `submitted`.** ✅ Shipped 2026-08-12, including the post-create confirmation screen, which hardcoded "Pending" even though the row is inserted as `submitted`. The Figma misspelling ("Request Recieved") was not carried into the product.

### A.3 Schema Additions — ✅ Confirmed: build all

The following are drawn in Figma but have no data or workflow behind them today. **Decision: all of them will be built** (schema plus the workflow each one implies).

The list was 11 when it went to the client. One item — requester zone on the overview list — turned out to be already shipped: `admin_list_requests` returns the driver's zone and the overview table renders it under the driver name. **10 remained; all 10 are now shipped.**

1. ~~Workflow SLA and breach-action columns~~ — ✅ Shipped 2026-08-12 (schema + sweep). ✅ Builder write path 2026-08-13: `/requests/settings/workflows` persists `sla_minutes` / `breach_action` via `admin_upsert_step_template` (`20260906100000`). Hours dropdown (4/8/24/48/72) on the selected step; empty = NULL, so the sweep stays inert until an admin sets one. Breach action never decides a step: `notify` and `escalate` differ only in `attention_reason`. **Answered: `escalate` stays a louder notification and does not re-route the step.**
2. ~~Dynamic request-type builder~~ — ✅ Shipped 2026-08-12, end to end: server side, admin builder screen, and the driver-app renderer. An admin can now create a type at `/requests/settings/types` (`?add=1`), describe its form on `/requests/settings/types/[key]`, and give it a chain in the workflow builder, whose type dropdown reads the definitions table instead of a hardcoded list. The app renders a custom type from its field definitions: the Help & Support hub tiles now come from `request_type_definitions` ordered by `sort_order`, and any key outside the built-in eight opens a generic form built from `request_field_definitions`. The built-in eight now render through the same generic form as custom types (shipped 2026-08-13), so the field-set lock is lifted. Delete / key rename / `is_system` remain blocked. The Add modal still says a new type has no rendering form on builds older than 2026-08-12, because it does not. The system-type lock is a **database trigger**, not a disabled button: the panel writes to these tables through PostgREST under a staff policy that would otherwise permit any write, so `rcm_guard_system_request_type` rejects field inserts/updates/deletes, key renames, `is_system` flips and deletes on built-ins. Migrations that legitimately need to touch a built-in set `SET LOCAL rcm.allow_system_edit = 'on'`. A request type is no longer a Postgres enum: `request_type_definitions` holds one row per type and `request_field_definitions` describes its form, so a new type needs data, not a migration. Everything that used to be a hardcoded branch now reads from those rows — the create-time gates, whether final approval lands on `approved` or `solved`, and whether the rider must acknowledge. The 8 built-in types were seeded to behave **identically**, verified case by case against a pre-migration baseline, and are marked as **system types with a locked field set**: their labels, chain, SLA, screenshot policy and active flag stay editable, but editing their *fields* would instantly break every installed app build, which still renders those forms from hardcoded Dart. That lock lifts when the app ships the generic renderer.
3. ~~E-Sign "Viewed" and "Accepted" timestamps~~ — ✅ Shipped 2026-08-12. `esign_requests` gains `sent_at`, `viewed_at`, `declined_at` and `declaration_accepted_at` as real columns, backfilled from `signer_meta`. Two of the four were already being written into the jsonb, where nothing could filter or report on them; `viewed_at` was never recorded at all, which is why the detail timeline's Viewed step had to render as permanently unavailable. The app now stamps it via `driver_mark_esign_viewed` **once the document actually resolves** — not on screen mount — so "Viewed" means the rider could see what they were asked to sign. First open wins, and decline/submit back-fill it so older app builds still produce an honest timeline.
4. ~~Acknowledgement completion timestamp~~ — ✅ Shipped 2026-08-12. `requests.acknowledged_at`, backfilled from `payload.driver_ack_at` and written by `driver_acknowledge_request`.
5. ~~`Rescheduled` / `Responded` / `Closed` status chips~~ — ✅ Shipped 2026-08-12, with the semantics the client confirmed. `rescheduled` holds the step open and waits on the rider (`driver_respond_reschedule`); `responded` is terminal with `completed_at`; `closed` is manual or automatic after `app_settings.request_auto_close_days` (default 30). Also fixed in the same pass: `submitted` used to be overwritten by `in_review` microseconds after insert, so it never appeared anywhere.
6. ~~Approval-step actor name and step start time~~ — ✅ Shipped 2026-08-12. `request_approval_steps.actor_display_name` and `started_at`, backfilled for existing rows and rendered in the Admin timeline.
7. ~~Fuel request transfer type~~ — ✅ Shipped 2026-08-12, control included. `requests.fuel_transfer_type` (`cash` | `salary`) is now written from a **Transfer type (on approval)** card that sits directly above the approve/reject actions on a fuel request. It is deliberately **not** a field on the approve call: Accounts may need to correct a payout method after the fact, so it is a standing instruction on the request — settable before the decision, correctable after it, and clearable by clicking the selected option again. Approving without one is **not** blocked, matching how the loan and asset decision terms already behave; instead an unset request says so in warning text ("payroll will not know how to pay this out"). One deliberate divergence from Figma: the frame shows **In cash** pre-selected, and it ships unselected, because a payout method nobody chose should not read as a decision somebody made. Only a `closed` request refuses the write.
8. ~~Visit bulk actions~~ — ✅ Shipped 2026-08-12. Row selection on `/visit-bookings` with Check in / Complete / No-show / Cancel across the selection. Deliberately **no bulk RPC**: the server action loops the existing `admin_update_visit_status` per booking, so `visits.operate`, the status transition rules and the rider notification behave exactly as they do for a single row, and one bad booking reports itself instead of aborting the batch.
9. ~~Visit departments tied to a branch~~ — ✅ Shipped 2026-08-12. Nullable `visit_departments.branch_id` — `NULL` means every branch, which is how all 11 existing rows already behaved, so nothing needed migrating. `key` was deliberately left globally unique: it is the FK target for `visit_slots.department_key` and `visit_bookings.department_key`, and re-keying it would have touched the locked one-active-booking-per (driver, date, department) index. If the client later needs the same department at several branches with different desks, the forward path is a `(branch_id, department_key)` junction table. `driver_list_visit_slots` hides mismatched slots and `driver_book_visit` rejects them with `department_not_at_branch`.
10. ~~Visit report prior-period comparison~~ — ✅ Shipped 2026-08-12. Each report KPI carries a delta against the immediately preceding window of equal length. No new RPC — the shell fetches the prior window through the existing report action and compares client-side, so the comparison cannot drift from the numbers shown above it.

---

## B. Needs a Device or a Figma Asset (Cannot Be Closed From Here)

- ~~**Signature pad guides**~~ — ✅ Closed 2026-08-12. The Figma frame turned up (see below), so the guides are no longer built from a description: the baseline sits at 145/190 of the pad height and runs inset 30/361 either side, with the `x` marker sharing the line's start x rather than standing clear of it. The pad itself is 190 tall, not 180. Locked by the golden `test/goldens/signature_pad_guides.png`.
- ~~**Signature export geometry**~~ — ✅ Closed 2026-08-12 by `test/signature_pad_test.dart`, which is decisive without a device: the exported PNG is exactly `padSize x devicePixelRatio` at ratios 1/2/3, ink lands at the same relative position at every ratio (so nothing is clipped or letterboxed), and the guides are never baked into the export.
- ~~**Bidi around Latin codes**~~ — ✅ Closed 2026-08-12. Ordering is a property of the Unicode bidi algorithm rather than the typeface, so it was settled by rendering the six real composite strings under RTL (`test/arabic_bidi_probe_test.dart`, golden `arabic_bidi_probe.png`). Codes, `·` separators, digits, the comma in `2026, 13:52` and a sentence-final full stop all resolve correctly. **No LRM or isolate wrapping is needed** — there is nothing to fix here.
- ~~**Arabic overflow**~~ — ✅ Closed 2026-08-12 for the four screens that matter, and **without** touching production. The reason a widget test could not answer this was that `google_fonts` fetches at runtime and returns nothing under `flutter test`, so the layout was being measured in a fallback face. Committing the real `NotoSansArabic-Variable.ttf` as a test fixture removes that objection entirely, and measuring in a test is *stronger* than an emulator run because a RenderFlex overflow throws and fails the build rather than having to be spotted in a screenshot. `test/arabic_overflow_test.dart` lays out the Help & Support hub, the dynamic request form and the signature capture screen at Pixel 9 metrics in Arabic, plus the form again at 1.3x text scale. **No overflow and no clipped text anywhere.** Extended the same day to `my_requests`, the request detail and the visit ticket by overriding their Riverpod providers with Arabic fixtures — the four data providers were the only thing that had made those screens look device-only. No overflow, RTL mirroring correct on all three, and the ticket QR keeps its full 48pt on the trailing edge of the card. The e-sign viewer went the same way for everything except the preview itself: its restriction banner, meta lines and the two footer buttons are plain layout, and the `no document attached` and `preview failed` branches need no network at all — the failure branch in fact comes for free, because `Supabase.instance` is not initialised under `flutter test` and the screen catches that into its retry state, which is exactly the state being asserted. What was left needing a device — a **resolved** preview (an image through `Image.network`, a PDF handed to `url_launcher`) and system-level chrome — was run on an emulator the same day; see the next entry.
- **Two rendering questions the pass raised:**
  - **Signature ink colour.** RSup/26 draws its sample signature in navy; the app stores black. Matching Figma would change the appearance of a legal artefact and would not match signatures already on file, so it was left alone. → *client decision*
  - ~~**The signature guide does not mirror in RTL.**~~ ✅ Fixed 2026-08-13. Under RTL the ✕ marker and the line's start sit on the right; LTR is unchanged (Figma). Locked by `test/goldens/signature_pad_guides_rtl.png`.
- ~~**One cosmetic finding**~~ — ✅ Fixed 2026-08-12. A long Arabic label on a *custom* request type wrapped to two lines and left its row neighbour at one-line height. The hub tiles are now paired into rows that share the taller height instead of flowing through a `Wrap`, which has no stretch alignment. Guarded by `a wrapping tile label does not leave its neighbour short` in `test/arabic_overflow_test.dart` — it fails against the previous layout.
- ~~**Month names in the approval timeline**~~ — ✅ Fixed 2026-08-12, and the new detail-screen test is what found it. `request_detail_screen.dart` formatted a decided step with `DateFormat('d MMM')`, which resolves against intl's *default* locale rather than the app's, so an Arabic timeline read `9 Aug` while the request list one tap away read `9 أغس`. Both now read the ARB month strings, which leaves the English output byte-identical (`9 Aug, 15:30`) and makes the Arabic consistent. The Arabic detail test now asserts it contains no Latin month name.
- ~~**The device pass itself**~~ — ✅ Run 2026-08-12 on a Pixel 9 emulator (Android 15, dpr 2.625) against production. It earned its keep by finding a defect no test could: `Image.network` with no width constraint sizes to the image's pixel dimensions divided by the device pixel ratio, so the e-sign image preview drew a document scan at about 40% of the card here and would draw it at a third on a 3x phone. Fixed with a tight width plus a 420pt height cap. Also proven: `viewed_at` is stamped by a real client (the Admin **Viewed** row has a value for the first time), Arabic mirrors correctly on glass, the OS back gesture pops rather than exits, and the hub survives the user's own font setting at both 1.3x and 2.0x. Two things recorded rather than changed — the PDF branch still leaves the app through `url_launcher` where Figma previews inline, and the numeric due date `2026-08-18` visually reorders to `18-08-2026` under RTL, which is correct bidi but ambiguous and would be solved by the ARB month-name formatter the request detail already uses. Everything the run touched was reverted; `SIG-9001.viewed_at` was deliberately left as evidence.
- **Gulf-native Arabic review** — the sheet is ready at [`docs/ARABIC_REVIEW_SHEET.md`](ARABIC_REVIEW_SHEET.md): 15 coined or company-specific terms plus the 9 complaint categories, each with the current Arabic and a Verdict column. It also names the four specific doubts worth a native speaker's time, chief among them `مخالفة` for "Wrong Action" (reads as a disciplinary violation) and `تسجيل الدخول` for check-in (the same phrase the app uses for signing in). The categories are DB-backed and editable from the panel, so those verdicts ship without an app release; the 15 terms need one.
- ~~**Missing Figma frame**~~ — ✅ Resolved 2026-08-12. `RSup/26-Sign-Capture` `4377:4520` **does** resolve in `n99SmGz5mrwpWoB363e314`; the earlier lookup failure was transient, not a missing frame. Worth knowing for next time: a full `get_metadata` dump of page `0:1` returns neither this node nor `RSup/25`, which is what made the frame look absent — query the node id directly instead of searching the page dump. The row is re-scored in the QA matrix.

---

## C. Our Work — No Client Input Needed

- ~~**Composer robustness — pre-validation missing.**~~ ✅ Fixed and deployed 2026-08-12. The function now walks the PNG chunk table and checks the JPEG end-of-image marker before the decoder sees the bytes, and caps sizes at 15MB source / 4MB signature. A corrupt PNG returns `malformed_signature_image` and records it, instead of taking the worker down with `WORKER_RESOURCE_LIMIT`.
- ~~**Rotate `SUPABASE_SERVICE_ROLE_KEY`**~~ — ✅ Done 2026-08-12. The new key (`dpd_userapp`) is verified to carry service-role rights, is in `.env.local` and in Vercel production, and production has been redeployed onto it. **Old `default` key revoked 2026-08-13.**

---

## D. Production Housekeeping

Tagged QA seed data is currently live in production. The tags are now recorded (2026-08-12) — they are not uniform, because each table was seeded through a different path:

| Table | Tag | Rows |
|---|---|---|
| `requests` | `payload->>'qa_seed' = '2026-08-12'` | 6 — `RCM-9001`…`RCM-9006` |
| `visit_bookings` | `note like '%[qa_seed 2026-08-12]%'` | 2 — `VIS-99001`, `VIS-99002` |
| `esign_requests` | `signer_meta->>'qa_seed' = '2026-08-12'` | 2 — `SIG-9001`, `SIG-9002` |

Children to remove first: `request_approval_steps` (24), `request_clarifications` (1) and `request_attachments` for those 6 requests; `visit_booking_notes` for those 2 bookings. `SIG-9002` also owns a composed signed copy in the `esign-documents` bucket, which a row delete will not reclaim.

**Two things the cleanup must not do.** It must not delete the two rider rows: `10001` and `10002` are real drivers that predate the seed by two months, and `10002` has 1,098 deliveries. And it must be scoped by tag rather than by code prefix — `RCM-90xx` is inside the live sequence's range and a future real request could land on it.

### The cleanup ran 2026-08-13

[`scripts/qa-seed-cleanup.mjs`](../scripts/qa-seed-cleanup.mjs) `--confirm` deleted the tagged seed after the signed-row device pass closed. Removed: 24 steps, 1 clarification, 6 requests, 2 bookings, 2 e-sign rows, 1 notification campaign, and 4 `esign-documents` objects (`demo-qa/*` plus the composed `SIG-9002` copy). Tags are at zero. `drivers` 84 / `profiles` 94 unchanged. `requests`, `visit_bookings` and `esign_requests` are empty — there was no non-seed data. Safe to re-run: a second pass resolves nothing.

The last BLOCKED matrix row was closed first: `SIG-9002` was temporarily reassigned from rider `10002` to `10001`, opened on a Pixel 9 emulator, and showed the signed confirmation (Download signed copy / stamp-on-last-page). Then the emulator was unbound and the seed deleted.

### Pre-existing debris, outside the tagged scope

~~Four transactional notification campaigns ("Appointment request / confirmed — `APT-1000`…`APT-1002`")~~ — ✅ Deleted 2026-08-13. Four `notification_campaigns` rows (`APT-1000` request+confirmed, `APT-1001` request, `APT-1002` request) deep-linked to appointment ids that no longer exist. Dispatch/analytics children cascaded. `appointments` was already empty.

---

*This document is the single source of truth for open items — the plan's own "Client Confirmation Required" table points here rather than duplicating it.*
